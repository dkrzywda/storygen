import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { generateRequestSchema } from "@/lib/generate-request";
import { checkFormatContract, wordLimitFor } from "@/lib/format-contract";
import { buildRetryUserPrompt, buildSystemPrompt, buildUserPrompt, looksLikeRefusal, maxTokensFor } from "@/lib/prompt";
import { LlmTimeoutError, generateText } from "@/lib/llm";
import type { ApiErrorCode, GenerationFormat, LengthPreset } from "@/types";

/**
 * Budzet czasu na CALA operacje, per format — wprost z NFR (15 s / 30 s).
 *
 * Regula jednej ponownej proby oznacza dwie proby, wiec kazda dostaje mniej wiecej
 * polowe. Bez tego podzialu odrzucona pierwsza proba plus druga daja dwukrotnosc
 * obietnicy, a uzytkownik dowiaduje sie o tym czekajac.
 */
const TOTAL_BUDGET_MS: Record<GenerationFormat, number> = { joke: 15_000, story: 30_000 };

/** Zapas na walidacje i serializacje, zeby budzet calosci nie zostal przekroczony. */
const OVERHEAD_MS = 1_000;

/** Ponizej tego progu druga proba nie ma sensu — lepiej oddac timeout niz uciac model. */
const MIN_ATTEMPT_MS = 2_000;

interface Attempt {
  text: string;
  elapsedMs: number;
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError("UNAUTHORIZED");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError("VALIDATION_FAILED", { _: "Treść żądania musi być poprawnym JSON-em." });
  }

  const parsed = validate(generateRequestSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_FAILED", parsed.fields);
  }

  const format: GenerationFormat = parsed.data.format;
  const preset: LengthPreset = parsed.data.length;
  const wordLimit = wordLimitFor(format, preset);
  const promptInput = { topic: parsed.data.topic, format, wordLimit };

  const system = buildSystemPrompt(format);
  const maxTokens = maxTokensFor(wordLimit);
  const deadline = Date.now() + TOTAL_BUDGET_MS[format] - OVERHEAD_MS;
  const firstAttemptMs = Math.floor((TOTAL_BUDGET_MS[format] - OVERHEAD_MS) / 2);

  const fail = (code: ApiErrorCode, error: unknown): Response => {
    // Cialo zadania NIE trafia do loga — zawiera temat wpisany przez uzytkownika.
    logApiError("api/generate", code, error);
    return jsonError(code);
  };

  const attempt = async (user: string, budgetMs: number): Promise<Attempt> =>
    generateText({ system, user, maxTokens }, budgetMs);

  try {
    const first = await attempt(buildUserPrompt(promptInput), firstAttemptMs);

    if (looksLikeRefusal(first.text)) {
      // Odmowa modelu to spodziewana sciezka, nie awaria — nie logujemy jej jako bledu.
      return jsonError("TOPIC_REJECTED");
    }

    const firstCheck = checkFormatContract(first.text, format, preset);
    if (firstCheck.ok) {
      return jsonOk({ text: firstCheck.text, words: firstCheck.words, format, length: preset });
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs < MIN_ATTEMPT_MS) {
      return fail("GENERATION_TIMEOUT", new Error(`Brak czasu na druga probe (${String(remainingMs)} ms).`));
    }

    // Druga proba niesie POWOD odrzucenia — to zamienia loterie w korekte.
    const second = await attempt(buildRetryUserPrompt(promptInput, firstCheck.reason), remainingMs);

    if (looksLikeRefusal(second.text)) {
      return jsonError("TOPIC_REJECTED");
    }

    const secondCheck = checkFormatContract(second.text, format, preset);
    if (secondCheck.ok) {
      return jsonOk({ text: secondCheck.text, words: secondCheck.words, format, length: preset });
    }

    return fail("FORMAT_CONTRACT_FAILED", new Error(`Obie proby zlamaly kontrakt: ${secondCheck.reason}`));
  } catch (error) {
    if (error instanceof LlmTimeoutError) {
      return fail("GENERATION_TIMEOUT", error);
    }
    return fail(toApiErrorCode(error), error);
  }
};

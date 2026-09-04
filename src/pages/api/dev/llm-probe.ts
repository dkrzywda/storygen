import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { LlmTimeoutError, MODEL, generateText } from "@/lib/llm";

/**
 * RUSZTOWANIE POMIAROWE — USUNAC W FAZIE 3.
 *
 * Istnieje wylacznie po to, zeby ocenic jakosc polszczyzny modelu, ZANIM powstanie
 * walidator kontraktu formatu. Wysyla surowy prompt i zwraca nieprzetworzone wyjscie
 * wraz z liczba slow i czasem odpowiedzi.
 *
 * Nie ma tu walidacji kontraktu, nie ma reguly ponownej proby, nie ma presetow —
 * to nie jest zapowiedz endpointu generowania, tylko przyrzad pomiarowy.
 *
 * Plan: context/changes/first-joke-generation/plan.md, faza 1 i faza 3 punkt 4.
 */

const PROBE_BUDGET_MS = 20_000;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
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

  const topic = typeof body === "object" && body !== null ? (body as Record<string, unknown>).topic : undefined;
  if (typeof topic !== "string" || topic.trim().length === 0) {
    return jsonError("VALIDATION_FAILED", { topic: "Podaj temat." });
  }

  // Sufit tokenow wyprowadzony z limitu slow. Polski jest kosztowny tokenowo
  // (~3 tokeny na slowo), a zapas trzeba zostawic, zeby model zdazyl domknac
  // zdanie zamiast zostac ucietym w polowie puenty.
  const wordLimit = 60;
  const maxTokens = wordLimit * 4;

  try {
    const { text, elapsedMs } = await generateText(
      {
        system: [
          "Jesteś autorem krótkich dowcipów po polsku.",
          "Odpowiadasz wyłącznie treścią dowcipu — bez wstępu, bez komentarza, bez formatowania.",
          "Nigdy nie powtarzasz tej samej linii.",
        ].join(" "),
        user: [
          `Napisz dowcip na temat: ${topic.trim()}.`,
          `Maksymalnie ${String(wordLimit)} słów.`,
          "Zakończ puentą.",
        ].join("\n"),
        maxTokens,
      },
      PROBE_BUDGET_MS,
    );
    return jsonOk({ model: MODEL, text, words: countWords(text), elapsedMs });
  } catch (error) {
    if (error instanceof LlmTimeoutError) {
      logApiError("api/dev/llm-probe", "PROVIDER_UNAVAILABLE", error);
      return jsonError("PROVIDER_UNAVAILABLE");
    }
    const code = toApiErrorCode(error);
    logApiError("api/dev/llm-probe", code, error);
    return jsonError(code);
  }
};

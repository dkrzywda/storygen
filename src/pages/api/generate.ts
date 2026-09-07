import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { saveGeneration } from "@/lib/generations";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { generateRequestSchema } from "@/lib/generate-request";
import { checkFormatContract, wordLimitFor } from "@/lib/format-contract";
import { reserveAttempt, type GateOutcome } from "@/lib/limits";
import {
  CREATIVE_TEMPERATURE,
  buildRetryUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  looksLikeRefusal,
  maxTokensFor,
} from "@/lib/prompt";
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

  const supabase = createClient(context.request.headers, context.cookies);
  const userId = context.locals.user.id;

  const fail = (code: ApiErrorCode, error: unknown): Response => {
    // Cialo zadania NIE trafia do loga — zawiera temat wpisany przez uzytkownika.
    logApiError("api/generate", code, error);
    return jsonError(code);
  };

  /*
   * BRAMKA LIMITOW (FR-012, FR-013) — wszystko ponizej tego bloku kosztuje neurony,
   * wszystko powyzej jest darmowe.
   *
   * Fail-closed w dwoch miejscach: bez klienta Supabase i bez udanej rezerwacji
   * generowanie NIE startuje. Sufit, ktory przy awarii przestaje obowiazywac, nie
   * jest sufitem — to jest dokladnie R-07 z `test-plan.md`: awaria, ktorej objawem
   * jest rachunek, nie blad na ekranie.
   *
   * Zmiana zachowania wzgledem stanu sprzed S-04: przy nieskonfigurowanym Supabase
   * endpoint generowal i tylko nie zapisywal. Teraz odmawia. Swiadoma strata funkcji
   * w trybie nieskonfigurowanym — zapisana w planie, nie efekt uboczny.
   */
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  let decision: GateOutcome;
  try {
    // JEDNO wywolanie zamiast trzech krokow — ustalenie F2 przegladu. Liczenie,
    // decyzja i zapis dzieja sie w bazie, w jednej serializowanej instrukcji, wiec
    // rownolegle zadania nie moga juz zobaczyc tego samego stanu i wszystkie przejsc.
    //
    // Rezerwacja jest JEDNA na zadanie, nie na wywolanie modelu. Regula jednej
    // ponownej proby moze wolac model dwa razy, a sufit 30 byl policzony wlasnie
    // jako 30 pozycji z ponowna proba w cenie.
    decision = await reserveAttempt(supabase, format);
  } catch (error) {
    return fail("INTERNAL", error);
  }

  if (!decision.ok) {
    // BEZ `fail()`. Wyczerpany limit to sciezka spodziewana, nie awaria — tak samo jak
    // `TOPIC_REJECTED`. Logowanie jej jako bledu zasmiecaloby observability zdarzeniem,
    // ktore znaczy "system zadzialal zgodnie z projektem".
    return jsonError(decision.code);
  }

  // Budzet czasu startuje PO bramce. Gdyby `deadline` powstal wczesniej, obrot do bazy
  // zjadalby czas obiecany uzytkownikowi w NFR (15 s / 30 s) i model dostawalby go tym
  // mniej, im wolniejsza baza. Cena tej decyzji: czas rezerwacji lezy POZA zegarem NFR,
  // wiec laczny czas odczuwany moze przekroczyc 15 s / 30 s o czas bazy (ustalenie F6).
  const system = buildSystemPrompt(format);
  const maxTokens = maxTokensFor(wordLimit);
  const deadline = Date.now() + TOTAL_BUDGET_MS[format] - OVERHEAD_MS;
  const firstAttemptMs = Math.floor((TOTAL_BUDGET_MS[format] - OVERHEAD_MS) / 2);

  /**
   * Zwraca wynik i po drodze zapisuje go do historii (FR-009 — bez jawnego zapisu).
   *
   * Zapis jest **best-effort i to jest decyzja projektowa**, nie niedbalstwo:
   * tekst juz powstal, uzytkownik czekal na niego do 15 s i zostaly na to zuzyte
   * neurony. Oddanie bledu skasowaloby gotowy wynik z powodu awarii, ktora go nie
   * dotyczy. Cena jest jawna: `id === null` znaczy "tej pozycji nie da sie ocenic
   * ani dodac do ulubionych", i interfejs to pokazuje, zamiast milczec.
   *
   * Warunku `if (supabase)` juz tu nie ma: bramka limitow odrzuca brak klienta
   * wczesniej, wiec w tym miejscu jest on niepusty. Zapis nadal moze zawiesc z innych
   * powodow i nadal jest best-effort — zmienil sie tylko jeden z tych powodow.
   */
  const succeed = async (text: string, words: number): Promise<Response> => {
    let id: string | null = null;
    try {
      id = await saveGeneration(supabase, {
        userId,
        topic: parsed.data.topic,
        format,
        length: preset,
        content: text,
      });
    } catch (error) {
      logApiError("api/generate", "INTERNAL", error);
    }
    return jsonOk({ id, text, words, format, length: preset });
  };

  const attempt = async (user: string, budgetMs: number): Promise<Attempt> =>
    generateText({ system, user, maxTokens, temperature: CREATIVE_TEMPERATURE }, budgetMs);

  try {
    const first = await attempt(buildUserPrompt(promptInput), firstAttemptMs);

    if (looksLikeRefusal(first.text)) {
      // Odmowa modelu to spodziewana sciezka, nie awaria — nie logujemy jej jako bledu.
      return jsonError("TOPIC_REJECTED");
    }

    const firstCheck = checkFormatContract(first.text, format, preset);
    if (firstCheck.ok) {
      return await succeed(firstCheck.text, firstCheck.words);
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
      return await succeed(secondCheck.text, secondCheck.words);
    }

    return fail("FORMAT_CONTRACT_FAILED", new Error(`Obie proby zlamaly kontrakt: ${secondCheck.reason}`));
  } catch (error) {
    if (error instanceof LlmTimeoutError) {
      return fail("GENERATION_TIMEOUT", error);
    }
    return fail(toApiErrorCode(error), error);
  }
};

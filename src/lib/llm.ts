import { env } from "cloudflare:workers";

/**
 * Jedyne miejsce w kodzie, ktore wie o dostawcy modelu.
 *
 * Reszta aplikacji dostaje prompt na wejsciu i tekst na wyjsciu — nie wie, ze pod
 * spodem jest Workers AI ani jaki model. To nie jest ozdoba: `tech-stack.md` zapisal
 * te izolacje jako **warunek** portowalnosci otwartych wag. Bez niej przesiadka na
 * Groq, Together albo lokalny sprzet jest teoretyczna.
 *
 * Binding, nie klucz API. Guardrail z `## Success Criteria` ("poswiadczenia nigdy
 * nie sa obserwowalne z produktu") spelnia sie strukturalnie — nie ma sekretu,
 * ktory moglby wyciec.
 *
 * `import { env } from "cloudflare:workers"` — NIE `Astro.locals.runtime`.
 * Adapter @astrojs/cloudflare v13 usunal to drugie i siegniecie po nie zwraca
 * `undefined` w runtime, a nie blad typu (patrz rejestr ryzyk w infrastructure.md).
 */

/** Podmiana modelu to zmiana tej jednej stalej. */
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Rzucany, gdy dostawca nie zdazyl w wyznaczonym budzecie czasu. */
export class LlmTimeoutError extends Error {
  constructor(budgetMs: number) {
    super(`Dostawca nie odpowiedzial w ${String(budgetMs)} ms.`);
    this.name = "LlmTimeoutError";
  }
}

/** Workers AI zwraca ksztalt zalezny od modelu; interesuje nas wylacznie tekst. */
function extractText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "object" && raw !== null) {
    const response = (raw as Record<string, unknown>).response;
    if (typeof response === "string") {
      return response;
    }
  }
  throw new Error("Odpowiedz dostawcy nie zawiera tekstu.");
}

export interface GenerateResult {
  text: string;
  /** Czas od wyslania do odpowiedzi, w ms — potrzebny do oceny wobec NFR. */
  elapsedMs: number;
}

export interface GenerateRequest {
  /** Rola systemowa — trwale zasady, te same dla kazdej proby. */
  system: string;
  /** Tresc uzytkownika — temat i konkretne wymagania tej proby. */
  user: string;
  /** Twardy sufit na dlugosc odpowiedzi. Bez niego model wpada w petle powtorzen. */
  maxTokens: number;
}

/**
 * Wysyla zapytanie i zwraca tekst, albo rzuca `LlmTimeoutError` po przekroczeniu budzetu.
 *
 * Uzywa `messages`, NIE `prompt`. Zmierzone 2026-09-04 w fazie 1: przy surowym
 * `prompt` model omija wlasny szablon czatu i wpada w degeneracyjne petle
 * ("to jest bug" / "to jest feature" w kolko), produkujac 103-121 slow przy limicie 60.
 * `messages` uruchamia szablon instruct i zachowanie zmienia sie jakosciowo.
 *
 * Budzet czasu jest **twardy i podawany przez wolajacego**, bo NFR obiecuje 15 s na cala
 * operacje, a regula jednej ponownej proby oznacza dwie proby w tym samym budzecie.
 */
export async function generateText(request: GenerateRequest, budgetMs: number): Promise<GenerateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, budgetMs);
  const startedAt = Date.now();

  try {
    const raw: unknown = await env.AI.run(
      MODEL,
      {
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        max_tokens: request.maxTokens,
      },
      { signal: controller.signal },
    );
    return { text: extractText(raw), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmTimeoutError(budgetMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

import type { GenerationFormat, LengthPreset } from "@/types";

/**
 * Kontrakt formatu — jedyna logika biznesowa w tym produkcie.
 *
 * To jest rzecz, ktora odroznia Storygena od otwartego czatu: aplikacja podejmuje
 * decyzje o ksztalcie wlasnego wyjscia i odrzuca to, co jej nie spelnia.
 *
 * CZEGO TEN MODUL NIE SPRAWDZA: obecnosci puenty. Mechanicznie sie nie da, a drugie
 * wywolanie modelu jako sedziego podwoiloby czas i neurony, wywracajac NFR 15 s.
 * Puente wymusza prompt. Gwarancja jest przez to **slabsza, niz brzmi PRD**
 * `## Business Logic` — i to musi byc powiedziane wprost, a nie przemilczane.
 */

/**
 * Limity slow per format i preset.
 *
 * Liczby dla dowcipu dobrane pod POMIAR z fazy 1 (2026-09-04): model proszony
 * o maksymalnie 60 slow pisze samoistnie 18-38. Gdyby wszystkie presety mialy
 * sufit 60, wybor uzytkownika byl by pozorny — model i tak pisalby ~30 za kazdym
 * razem. Dlatego "krotki" wymusza realne skrocenie, a "dlugi" siega sufitu z PRD.
 *
 * Liczby dla opowiadania sa wyprowadzone z sufitu 400 slow w PRD i **nie sa
 * zmierzone** — `S-07` ma je zweryfikowac tak samo, jak faza 1 zweryfikowala dowcip.
 */
const WORD_LIMITS: Record<GenerationFormat, Record<LengthPreset, number>> = {
  joke: { short: 25, medium: 40, long: 60 },
  story: { short: 150, medium: 275, long: 400 },
};

/**
 * Dolny prog, ponizej ktorego tekst nie jest wyjsciem, tylko resztka.
 *
 * Plaski, nie proporcjonalny: przy progu liczonym jako ulamek limitu "dlugi dowcip"
 * wymagalby 24 slow, a zmierzona mediana to ~30 — czyli odrzucalibysmy poprawne
 * wyjscia za to, ze model jest zwiezly. Prog ma lapac obciecie i pustke, nie zwiezlosc.
 */
const MIN_WORDS: Record<GenerationFormat, number> = { joke: 8, story: 50 };

/** Prefiksy, ktorymi model lubi poprzedzac odpowiedz mimo instrukcji. */
const LEAD_IN = /^\s*(oto\s+)?(dowcip|opowiadanie|odpowiedź|odpowiedz|historia)\s*[:\-–—]/i;

/** Znaki markdownu, ktorych w czystym tekscie byc nie powinno. */
const MARKDOWN = /[*_#`]|\[.+?\]\(.+?\)/;

/** Tekst musi konczyc sie znakiem konca zdania — inaczej zostal ucienty. */
const SENTENCE_END = /[.!?…]["'»)]?\s*$/;

export function wordLimitFor(format: GenerationFormat, preset: LengthPreset): number {
  return WORD_LIMITS[format][preset];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export type ContractResult =
  | { ok: true; text: string; words: number }
  /** `reason` jest pisany tak, zeby dalo sie go wstawic wprost do promptu ponownej proby. */
  | { ok: false; reason: string };

/**
 * Ocenia, czy wyjscie modelu spelnia kontrakt formatu.
 *
 * Kolejnosc sprawdzen jest celowa: najpierw to, co czyni tekst bezuzytecznym
 * (pustka, obciecie), potem to, co da sie opisac modelowi liczba (dlugosc),
 * na koncu kosmetyka (prefiks, markdown). Pierwszy napotkany problem wygrywa,
 * bo prompt ponownej proby ma niesc jedno konkretne polecenie, nie liste.
 */
export function checkFormatContract(raw: string, format: GenerationFormat, preset: LengthPreset): ContractResult {
  const text = raw.trim();

  if (text.length === 0) {
    return { ok: false, reason: "Poprzednia odpowiedź była pusta. Napisz treść." };
  }

  if (LEAD_IN.test(text)) {
    return {
      ok: false,
      reason: "Poprzednia odpowiedź zaczynała się od wstępu. Odpowiedz samą treścią, bez wprowadzenia.",
    };
  }

  if (MARKDOWN.test(text)) {
    return {
      ok: false,
      reason:
        "Poprzednia odpowiedź zawierała formatowanie. Odpowiedz czystym tekstem, bez gwiazdek i myślników formatujących.",
    };
  }

  const words = countWords(text);
  const limit = wordLimitFor(format, preset);
  const minimum = MIN_WORDS[format];

  if (words > limit) {
    return {
      ok: false,
      reason: `Poprzednia wersja miała ${String(words)} słów. Zmieść się w ${String(limit)} słowach.`,
    };
  }

  if (words < minimum) {
    return {
      ok: false,
      reason: `Poprzednia wersja miała tylko ${String(words)} słów. Napisz pełny tekst, co najmniej ${String(minimum)} słów.`,
    };
  }

  // Obciecie na sufitcie tokenow wyglada jak poprawny, krotki tekst — z ta roznica,
  // ze urywa sie w polowie zdania. Bez tego sprawdzenia przechodzi walidacje.
  if (!SENTENCE_END.test(text)) {
    return {
      ok: false,
      reason: "Poprzednia wersja urwała się w połowie zdania. Zakończ tekst pełnym zdaniem.",
    };
  }

  return { ok: true, text, words };
}

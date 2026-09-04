import type { GenerationFormat } from "@/types";

/**
 * Tekstowy protokol rozmowy z modelem: budowanie promptu i rozpoznawanie odmowy.
 *
 * Ten modul celowo **nie importuje** `@/lib/llm` ani `cloudflare:workers` — dzieki
 * temu da sie go w calosci przetestowac bez bindingu i bez zuzycia neuronow.
 * `llm.ts` wie, JAK wyslac; ten modul wie, CO wyslac i jak zrozumiec odpowiedz.
 */

/**
 * Sufit tokenow wyprowadzony z limitu slow.
 *
 * Polski jest kosztowny tokenowo (~3 tokeny na slowo), a zapas jest konieczny, zeby
 * model zdazyl domknac zdanie zamiast zostac ucietym w polowie puenty. Obciecie lapie
 * potem walidator kontraktu, ale lepiej mu go nie podawac.
 */
export function maxTokensFor(wordLimit: number): number {
  return wordLimit * 4;
}

const FORMAT_NAME: Record<GenerationFormat, string> = {
  joke: "dowcipów",
  story: "opowiadań",
};

const FORMAT_RULE: Record<GenerationFormat, string> = {
  joke: "Zakończ puentą.",
  story: "Tekst ma mieć początek, rozwinięcie i zakończenie.",
};

/**
 * Rola systemowa — trwale zasady, identyczne w obu probach.
 *
 * Zmierzone w fazie 1 (2026-09-04): bez roli systemowej i bez sufitu tokenow model
 * wpada w degeneracyjne petle powtorzen. Zakaz powtarzania linii jest tu wlasnie z tego powodu.
 */
export function buildSystemPrompt(format: GenerationFormat): string {
  return [
    `Jesteś autorem krótkich ${FORMAT_NAME[format]} po polsku.`,
    "Odpowiadasz wyłącznie treścią — bez wstępu, bez komentarza, bez formatowania.",
    "Nigdy nie powtarzasz tej samej linii.",
    "Zawsze kończysz pełnym zdaniem.",
  ].join(" ");
}

export interface PromptInput {
  topic: string;
  format: GenerationFormat;
  wordLimit: number;
}

export function buildUserPrompt({ topic, format, wordLimit }: PromptInput): string {
  return [
    `Napisz tekst na temat: ${topic.trim()}.`,
    `Maksymalnie ${String(wordLimit)} słów.`,
    FORMAT_RULE[format],
  ].join("\n");
}

/**
 * Prompt ponownej proby niesie **powod odrzucenia** z walidatora kontraktu.
 *
 * Identyczna powtorka przy systematycznym lamaniu kontraktu jest loteria kosztujaca
 * czas i neurony; powod zamienia ja w korekte.
 */
export function buildRetryUserPrompt(input: PromptInput, reason: string): string {
  return [buildUserPrompt(input), "", reason].join("\n");
}

/**
 * Rozpoznanie odmowy modelu.
 *
 * Model nie zwraca kodu — odmawia **tekstem**, wiec rozpoznanie jest z natury
 * heurystyczne. Trzymane w jednym miejscu i pokryte testem, bo rozsypane po kodzie
 * rozjechaloby sie przy pierwszej zmianie modelu.
 *
 * Heurystyka jest **celowo waska**: falszywe rozpoznanie odmowy zamienia poprawny
 * dowcip w komunikat "zmien temat", co jest gorsze niz przepuszczenie odmowy do
 * walidatora kontraktu, ktory i tak ja odrzuci.
 */
const REFUSAL_MARKERS = [
  "nie mogę",
  "nie moge",
  "nie jestem w stanie",
  "nie będę",
  "nie bede",
  "i cannot",
  "i can't",
  "i'm sorry",
  "przepraszam, ale",
];

export function looksLikeRefusal(text: string): boolean {
  // Odmowa ZACZYNA sie markerem — nie wystarczy, ze go zawiera.
  //
  // Pierwsza wersja sprawdzala pierwsze 120 znakow przez `includes` i wywrocila sie
  // na dowcipie "Programista mowi do kota: nie moge juz patrzec na ten kod" (test
  // 2026-09-04). Falszywe rozpoznanie zamienia poprawny dowcip w komunikat
  // "zmien temat" — to gorsze niz przepuszczenie odmowy do walidatora kontraktu,
  // ktory i tak ja odrzuci za brak puenty albo za dlugosc.
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/^["'„»\s]+/, "");
  if (normalized.length === 0) {
    return false;
  }
  return REFUSAL_MARKERS.some((marker) => normalized.startsWith(marker));
}

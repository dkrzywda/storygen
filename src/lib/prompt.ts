import type { GenerationFormat } from "@/types";

/**
 * Tekstowy protokol rozmowy z modelem: budowanie promptu i rozpoznawanie odmowy.
 *
 * Ten modul celowo **nie importuje** `@/lib/llm` ani `cloudflare:workers` — dzieki
 * temu da sie go w calosci przetestowac bez bindingu i bez zuzycia neuronow.
 * `llm.ts` wie, JAK wyslac; ten modul wie, CO wyslac i jak zrozumiec odpowiedz.
 */

/**
 * Temperatura dla tekstu kreatywnego.
 *
 * Zmierzone 2026-09-04: przy domyslnej (~0.6) i ubogim prompcie model produkowal
 * DEFINICJE zamiast dowcipow — "Kawa to ulubiony napoj wielu ludzi, dajacy energie
 * i radosc". Humor mieszka w zaskoczeniu, a niska temperatura produkuje zdania
 * przewidywalne. Razem z promptem ponizej: 0 z 3 prawdziwych dowcipow → 2 z 3.
 *
 * Uwaga: wyzsza temperatura zwieksza tez ryzyko bledow jezykowych, wyrazne przy
 * dluzszych tekstach. Przy `S-07` (opowiadanie, 400 slow) to trzeba zmierzyc osobno.
 */
export const CREATIVE_TEMPERATURE = 0.95;

/**
 * Sufit tokenow wyprowadzony z limitu slow.
 *
 * Polski jest kosztowny tokenowo (~3 tokeny na slowo), a zapas jest konieczny, zeby
 * model zdazyl domknac zdanie zamiast zostac ucietym w polowie puenty.
 */
export function maxTokensFor(wordLimit: number): number {
  return wordLimit * 4;
}

/**
 * Rola systemowa — trwale zasady, identyczne w obu probach.
 *
 * Kluczowe sa DWA elementy, oba wynikaja z pomiaru:
 * 1. Opis, czym jest dowcip (zawiazanie → skret) — bez tego model pisze obserwacje.
 * 2. Jawny ZAKAZ definicji i obserwacji — bo to byl dokladny ksztalt zlych wyjsc.
 *
 * Zakaz powtarzania linii zostaje z fazy 1: bez niego model wpadal w petle.
 */
const SYSTEM: Record<GenerationFormat, string> = {
  joke: [
    "Jesteś polskim komikiem piszącym krótkie dowcipy.",
    "Dowcip ma dwie części: zawiązanie, które prowadzi czytelnika w jedną stronę, i puentę, która skręca w inną.",
    "Puenta to ostatnie zdanie i musi zaskakiwać.",
    "NIE piszesz definicji, obserwacji ani opisów — „Kawa to napój, który pobudza” nie jest dowcipem.",
    "NIE tłumaczysz dowcipu i nie dopisujesz komentarza.",
    "Nigdy nie powtarzasz tej samej linii.",
    "Odpowiadasz wyłącznie treścią dowcipu, czystym tekstem, kończąc pełnym zdaniem.",
  ].join(" "),
  story: [
    "Jesteś polskim autorem krótkich opowiadań z puentą.",
    "Opowiadanie ma początek, rozwinięcie i zakończenie — konkretną sytuację z bohaterem, nie rozważania.",
    "Ostatnie zdanie to puenta: myśl, która wynika z opisanej sytuacji i zostaje z czytelnikiem.",
    "Puenta ma wynikać z historii, nie być morałem doklejonym na końcu — nie zaczynasz jej od „Morał tej historii” ani od „Ta historia uczy”.",
    "NIE piszesz definicji ani obserwacji ogólnych.",
    "NIE tłumaczysz tekstu i nie dopisujesz komentarza.",
    "Nigdy nie powtarzasz tej samej linii.",
    "Odpowiadasz wyłącznie treścią, czystym tekstem, kończąc pełnym zdaniem.",
  ].join(" "),
};

/**
 * Przyklady formy (few-shot). Pokazuja SKRET, nie tresc — model ma nasladowac
 * budowe, nie temat. Dwa wystarcza; wiecej zjada budzet tokenow wejscia.
 */
const EXAMPLES: Record<GenerationFormat, string[]> = {
  joke: [
    "Kupiłem książkę o cierpliwości. Nadal czekam na dostawę.",
    "Lekarz mówi, że mam za wysokie ciśnienie. Odpowiadam, że to nie moje — to od rachunków.",
  ],
  story: [],
};

const CLOSING_RULE: Record<GenerationFormat, string> = {
  joke: "Ostatnie zdanie musi być puentą.",
  story:
    "Tekst ma mieć początek, rozwinięcie i zakończenie, a ostatnie zdanie ma być puentą wynikającą z opisanej sytuacji.",
};

export function buildSystemPrompt(format: GenerationFormat): string {
  return SYSTEM[format];
}

export interface PromptInput {
  topic: string;
  format: GenerationFormat;
  wordLimit: number;
}

export function buildUserPrompt({ topic, format, wordLimit }: PromptInput): string {
  const examples = EXAMPLES[format];
  const lead = examples.length > 0 ? ["Przykłady dobrej formy:", "", ...examples.flatMap((e) => [e, ""])] : [];

  return [
    ...lead,
    `Napisz tekst na temat: ${topic.trim()}.`,
    `Maksymalnie ${String(wordLimit)} słów.`,
    CLOSING_RULE[format],
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

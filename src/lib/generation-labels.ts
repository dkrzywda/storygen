import type { GenerationFormat } from "@/types";

/**
 * Etykiety zapisanej generacji: format, data, liczba slow.
 *
 * Powstalo z ustalenia F2 przegladu `browse-generation-history`. Do S-05 te trzy
 * rzeczy zyly w kopiach: `formatLabel` i `dateFormat` doslownie w `GenerationList.astro`
 * i w `generations.astro`, a liczba slow w dwoch KONWENCJACH — okno pisalo "22 slowa"
 * (przez wlasny helper), a generator gole "22 slow". Dokladnie ta klasa duplikacji,
 * przed ktora ostrzega komentarz naglowkowy `GenerationList.astro`, i ktora ten sam
 * plaster usuwal przy `CopyButton`.
 *
 * Trzeci widok nad ta tabela ma importowac stad, nie kopiowac.
 */

const FORMAT_LABEL: Record<GenerationFormat, string> = { joke: "Dowcip", story: "Historia" };

/**
 * Format po polsku. Wejscie jest `string`, nie `GenerationFormat`, bo kolumna w bazie
 * to `text` z constraintem — typy z bazy nie zwezaja jej do unii, a nierozpoznana
 * wartosc ma sie pokazac jak jest, nie wywrocic widoku.
 */
export function formatLabel(format: string): string {
  return format === "story" || format === "joke" ? FORMAT_LABEL[format] : format;
}

export const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" });

/**
 * Godzina odnowienia dziennych limitow (S-04).
 *
 * Strefa jest przypieta do `Europe/Warsaw`, nie brana z przegladarki, i to jest
 * celowe: granice doby liczy `public.usage_today()` wlasnie w tej strefie, wiec
 * pokazanie jej w innej dawaloby godzine prawdziwa co do momentu, ale niezgodna
 * z tym, co uzytkownik rozumie przez "polnoc" na tym samym ekranie. Produkt jest
 * po polsku i tylko po polsku — patrz Non-Goals w `prd.md`.
 */
export const resetTimeFormat = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

/**
 * Polska liczba mnoga slow: 1 slowo, 2-4 slowa, 5+ slow — z wyjatkiem 12-14, ktore
 * ida jak 5+ ("13 slow"), i z powrotem do 22-24 ("22 slowa").
 */
export function wordsLabel(n: number): string {
  if (n === 1) {
    return "1 słowo";
  }
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return `${String(n)} słowa`;
  }
  return `${String(n)} słów`;
}

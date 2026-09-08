import { TOPIC_MAX } from "@/lib/generate-request";
import type { GenerationFormat } from "@/types";

/**
 * Filtry historii generacji: odczyt z adresu, ucieczka znakow, etykiety.
 *
 * Modul niesie WYLACZNIE funkcje czyste — bez bazy, bez zegara, bez sieci. To ta
 * sama linia podzialu co w `@/lib/limits`: rzeczy testowalne bez Dockera zyja osobno
 * od dostepu do danych, ktory jest w `@/lib/generations`.
 *
 * Filtry jada przez parametry adresu, nie przez stan wyspy. Powod jest zapisany
 * w `src/pages/dashboard.astro`: kazdy filtr to inne ZAPYTANIE do bazy, wiec wyspa
 * musialaby i tak wolac serwer — a przy parametrach filtr ma wlasny adres, da sie go
 * odswiezyc, wrocic do niego przyciskiem wstecz i wkleic komus link.
 */

export interface GenerationFilters {
  format?: GenerationFormat;
  /** Ocena **co najmniej** tyle. `1` znaczy "jakakolwiek ocena". */
  minRating?: number;
  /**
   * Tylko `true` albo brak — NIE `false`.
   *
   * "Nie-ulubione" to inny filtr niz "brak filtra", a produkt go nie potrzebuje.
   * Typ literalny nie pozwala tej roznicy przemilczec.
   */
  favourite?: true;
  /** Fraza do szukania w temacie. Zawsze niepusta po `trim` — inaczej jej tu nie ma. */
  query?: string;
}

/** Nazwy parametrow adresu. Jedno miejsce, zeby link i odczyt nie rozjechaly sie literowka. */
const PARAM = { format: "format", rating: "rating", favourite: "fav", query: "q" } as const;

const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Czyta filtry z parametrow adresu.
 *
 * **Wartosc spoza zbioru jest POMIJANA, nie jest bledem** — ten sam wybor i to samo
 * uzasadnienie co przy zakladkach panelu: adres wpisuje czlowiek, a literowka
 * w `?rating=` nie powinna dawac komunikatu o bledzie. Skutkiem jest widok szerszy,
 * nie pusty.
 */
export function parseFilters(params: URLSearchParams): GenerationFilters {
  const filters: GenerationFilters = {};

  const format = params.get(PARAM.format);
  if (format === "joke" || format === "story") {
    filters.format = format;
  }

  const rating = Number(params.get(PARAM.rating));
  if (Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING) {
    filters.minRating = rating;
  }

  // Tylko doslowne "1". "true", "on" i "0" sa pomijane — jeden zapis zamiast slownika
  // wariantow, bo ten parametr generuje wylacznie nasz wlasny formularz.
  if (params.get(PARAM.favourite) === "1") {
    filters.favourite = true;
  }

  const query = params.get(PARAM.query)?.trim();
  if (query) {
    // Obciecie do gornej granicy tematu z FR-003: dluzsza fraza nie moze mieć trafienia,
    // bo dluzszy temat nie moze istniec.
    filters.query = query.slice(0, TOPIC_MAX);
  }

  return filters;
}

/**
 * Ucieczka znakow specjalnych `LIKE`.
 *
 * `ilike` traktuje `%` i `_` jako wieloznaczniki, wiec bez tego temat wpisany jako
 * `100%_pewne` szuka czegos innego, niz uzytkownik napisal — a wynik wyglada sensownie,
 * jest tylko nie ten. To blad niewidoczny, dlatego ma wlasna funkcje i wlasne testy.
 *
 * KOLEJNOSC PODMIAN JEST ISTOTNA: `\` musi byc pierwsze, inaczej ucieczka dodana
 * dla `%` zostanie sama poddana ucieczce w kolejnym przebiegu i wzorzec bedzie szukal
 * doslownego `\`.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Czy jakikolwiek filtr jest aktywny. Rozstrzyga o stanie pustym i o linku "wyczysc". */
export function hasAnyFilter(filters: GenerationFilters): boolean {
  return (
    filters.format !== undefined ||
    filters.minRating !== undefined ||
    filters.favourite !== undefined ||
    filters.query !== undefined
  );
}

/**
 * Sklada filtry z powrotem w query string — bez wiodacego `?`.
 *
 * Uzywane przez link "Otworz" i przez powrot z okna pozycji, zeby zamkniecie okna
 * wracalo do tych samych filtrow, a nie na goly `/generations`.
 *
 * Kolejnosc kluczy jest stala, wiec ten sam zestaw filtrow daje zawsze ten sam adres —
 * inaczej historia przegladarki mialaby wiele wpisow dla jednego widoku.
 */
export function filtersToQuery(filters: GenerationFilters): string {
  const params = new URLSearchParams();
  if (filters.format !== undefined) {
    params.set(PARAM.format, filters.format);
  }
  if (filters.minRating !== undefined) {
    params.set(PARAM.rating, String(filters.minRating));
  }
  if (filters.favourite !== undefined) {
    params.set(PARAM.favourite, "1");
  }
  if (filters.query !== undefined) {
    params.set(PARAM.query, filters.query);
  }
  return params.toString();
}

const FORMAT_FILTER_LABEL: Record<GenerationFormat, string> = {
  joke: "tylko dowcipy",
  story: "tylko historie",
};

/**
 * Polskie etykiety aktywnych filtrow, do wyliczenia w komunikacie stanu pustego.
 *
 * "Nie masz jeszcze zadnych generacji" jest KLAMSTWEM, gdy masz dwadziescia, a filtr
 * nic nie przepuscil. Bez wyliczenia uzytkownik metoda prob szuka, ktory filtr zdjac.
 */
export function filterLabels(filters: GenerationFilters): string[] {
  const labels: string[] = [];
  if (filters.format !== undefined) {
    labels.push(FORMAT_FILTER_LABEL[filters.format]);
  }
  if (filters.minRating !== undefined) {
    labels.push(`ocena co najmniej ${String(filters.minRating)}`);
  }
  if (filters.favourite !== undefined) {
    labels.push("tylko ulubione");
  }
  if (filters.query !== undefined) {
    labels.push(`temat zawiera „${filters.query}”`);
  }
  return labels;
}

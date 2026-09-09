/**
 * Wspoldzielone typy encji i DTO.
 *
 * Kontrakt odpowiedzi API (F-01): endpointy nie-auth zwracaja JSON z prawdziwym
 * statusem HTTP. Endpointy `/api/auth/*` pozostaja przy form-post + redirect i
 * przekazuja w `?error=` **kod**, nigdy tresc komunikatu.
 */

/**
 * Kody domenowe bledow. Interfejs reaguje na kod, nie na tekst — komunikat jest
 * wymienny, kod jest stabilny.
 *
 * Zestaw jest celowo niekompletny wobec calego produktu: kolejne plastry dokladaja
 * wlasne kody. Kazdy nowy kod
 * musi dostac wpis w `API_ERRORS` w `@/lib/api-errors` — `Record<ApiErrorCode, …>`
 * wymusza to bledem typu, nie dobra wola.
 */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "EMAIL_ALREADY_REGISTERED"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "TOPIC_REJECTED"
  | "FORMAT_CONTRACT_FAILED"
  | "GENERATION_TIMEOUT"
  // Dwa kody, nie jeden: FR-012 i FR-013 wymagaja WYJASNIENIA, a "limit wyczerpany"
  // bez powiedzenia CZYJ nie wyjasnia niczego. Rozdzielone tez dlatego, ze uzytkownik
  // ma wobec nich rozna moc sprawcza — wlasny limit odnowi sie jemu, sufit aplikacji nie.
  | "DAILY_LIMIT_REACHED"
  | "APP_LIMIT_REACHED"
  | "INTERNAL";

/** Format generowanego tekstu. `story` wchodzi z `S-07`, ale kontrakt zna go od poczatku. */
export type GenerationFormat = "joke" | "story";

/** Preset dlugosci wybierany przez uzytkownika (FR-005). */
export type LengthPreset = "short" | "medium" | "long";

/**
 * Rola konta (F-02, PRD v2 § Access Control).
 *
 * Zamkniety zestaw, nie `string` — literal wymusza blad kompilacji przy literowce
 * w porownaniu, zamiast cichego `false`.
 *
 * Rola mieszka w `app_metadata` uzytkownika Supabase, wiec middleware dostaje ja
 * razem z sesja i nie placi za nia dodatkowym zapytaniem. NIE jest wyprowadzana
 * z adresu e-mail przy zadaniu: adres to dane od uzytkownika, a traktowanie go jako
 * roszczenia o uprawnienia czyniloby sprawdzenie podrabialnym.
 */
export type AccountRole = "user" | "admin";

/**
 * Wiersz przegladu kont dla administratora (S-09, FR-014).
 *
 * LICZBY, NIGDY TRESC. Ten typ nie ma i nie moze miec pola z tematem, tytulem
 * ani tekstem generacji — to granica zapisana przy FR-014 w PRD v2 i wlasnie ona
 * utrzymuje NFR o izolacji kont nienaruszony. Dolozenie tu pola z trescia jest
 * zmiana w modelu dostepu, nie rozszerzeniem widoku.
 *
 * `registeredAt` jest `Date`, nie stringiem: RPC oddaje `timestamptz` jako tekst,
 * a mapowanie na `Date` dzieje sie raz, w `@/lib/admin-accounts` — tak samo jak
 * `resetsAt` w `UsageToday`.
 */
export interface AccountOverviewRow {
  email: string;
  registeredAt: Date;
  /** Liczba generacji ogolem na tym koncie. */
  generations: number;
  /** Zuzycie dzisiejsze wobec `ownLimit` — obie liczby przychodza z bazy. */
  usedToday: number;
  ownLimit: number;
  /**
   * Sufit liczby wierszy, jaki nalozyla funkcja w bazie (ustalenie F3 przegladu).
   *
   * Przychodzi Z BAZY, a nie ze stalej w widoku, i to jest istota tego pola: gdy
   * liczba wierszy rowna sie temu sufitowi, lista MOGLA zostac obcieta i interfejs
   * musi to powiedziec. Kopia tej liczby po stronie widoku ciszalaby ten komunikat
   * przy kazdej zmianie sufitu w SQL — bez zadnego bledu.
   */
  rowLimit: number;
}

/** Mapa nazwa pola → komunikat po polsku. Puste pole klucza (`_`) oznacza blad calego formularza. */
export type ApiFieldErrors = Record<string, string>;

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  fields?: ApiFieldErrors;
}

export interface ApiErrorBody {
  error: ApiErrorPayload;
}

export interface ApiSuccessBody<T> {
  data: T;
}

export type ApiResponseBody<T> = ApiSuccessBody<T> | ApiErrorBody;

/**
 * Odpowiedz `/api/generate`.
 *
 * `id` jest `null`, gdy tekst powstal, ale zapis do bazy zawiodl. Interfejs
 * ukrywa wtedy ocene i ulubione, bo nie ma czego ocenic — zamiast udawac, ze
 * zapisano, i gubic klikniecie uzytkownika w ciszy.
 */
export interface GenerationResult {
  id: string | null;
  text: string;
  words: number;
  format: GenerationFormat;
  length: LengthPreset;
}

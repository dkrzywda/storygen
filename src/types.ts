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
 * wlasne kody (np. odrzucony temat, przekroczony limit generowania). Kazdy nowy kod
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
  | "INTERNAL";

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

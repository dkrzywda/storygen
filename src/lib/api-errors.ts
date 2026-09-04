import type { ApiErrorCode } from "@/types";

/**
 * Jedno miejsce, ktore trzyma status HTTP i polski komunikat dla kazdego kodu.
 *
 * Status i komunikat sa **celowo** w jednej strukturze, nie w dwoch modulach:
 * rozdzielone gwarantuja, ze przy dodaniu kodu ktos zaktualizuje jedno, a zapomni
 * o drugim. `Record<ApiErrorCode, …>` sprawia, ze pominiety kod jest bledem typu.
 */
interface ApiErrorSpec {
  status: number;
  message: string;
}

export const API_ERRORS: Record<ApiErrorCode, ApiErrorSpec> = {
  VALIDATION_FAILED: {
    status: 400,
    message: "Podane dane są nieprawidłowe. Popraw zaznaczone pola i spróbuj ponownie.",
  },
  INVALID_CREDENTIALS: {
    status: 401,
    message: "Nieprawidłowy adres e-mail lub hasło.",
  },
  EMAIL_NOT_CONFIRMED: {
    status: 403,
    message: "Konto nie zostało jeszcze potwierdzone. Sprawdź skrzynkę i kliknij link aktywacyjny.",
  },
  EMAIL_ALREADY_REGISTERED: {
    status: 409,
    message: "Na ten adres e-mail założono już konto.",
  },
  PROVIDER_UNAVAILABLE: {
    status: 502,
    message: "Usługa jest chwilowo niedostępna. Spróbuj ponownie za chwilę.",
  },
  NOT_CONFIGURED: {
    status: 503,
    message: "Aplikacja nie jest w pełni skonfigurowana — ta funkcja jest teraz niedostępna.",
  },
  UNAUTHORIZED: {
    status: 401,
    message: "Ta operacja wymaga zalogowania.",
  },
  NOT_FOUND: {
    // Ten sam kod dla "nie istnieje" i dla "nie należy do Ciebie" — celowo.
    // Rozróżnienie potwierdzałoby istnienie cudzego rekordu, a wyliczanie
    // identyfikatorów pozwalałoby mapować, kto co ma.
    status: 404,
    message: "Nie znaleziono takiej pozycji.",
  },
  TOPIC_REJECTED: {
    // Odmowa modelu jest **spodziewana sciezka**, nie awaria. Wlasny kod, bo
    // uzytkownik ma tu co zrobic — zmienic temat — w odroznieniu od pozostalych dwoch.
    status: 422,
    message: "Nie mogę napisać tekstu na ten temat. Spróbuj sformułować go inaczej.",
  },
  FORMAT_CONTRACT_FAILED: {
    status: 502,
    message: "Nie udało się napisać tekstu w wymaganej formie. Spróbuj jeszcze raz.",
  },
  GENERATION_TIMEOUT: {
    status: 504,
    message: "Generowanie trwało zbyt długo. Spróbuj jeszcze raz.",
  },
  INTERNAL: {
    status: 500,
    message: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
  },
};

/** Kod uzywany dla wszystkiego, czego nie rozpoznano — w tym dla bledu bez tresci. */
export const DEFAULT_ERROR_CODE: ApiErrorCode = "INTERNAL";

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && Object.hasOwn(API_ERRORS, value);
}

export function statusForCode(code: ApiErrorCode): number {
  return API_ERRORS[code].status;
}

/**
 * Rozwiazuje kod podany jako tekst (np. z query stringa) na komunikat.
 *
 * Wartosc nierozpoznana **nigdy** nie wraca do uzytkownika — dostaje komunikat
 * domyslny. To jest warunek tego, ze `?error=` przestaje odbijac dowolna tresc z URL-a.
 */
export function messageForCode(value: unknown): string {
  return isApiErrorCode(value) ? API_ERRORS[value].message : API_ERRORS[DEFAULT_ERROR_CODE].message;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

/** Kody dostawcy (Supabase Auth) → kody domenowe. Preferowane nad dopasowaniem po tekscie. */
const PROVIDER_CODE_MAP: Record<string, ApiErrorCode> = {
  invalid_credentials: "INVALID_CREDENTIALS",
  email_not_confirmed: "EMAIL_NOT_CONFIRMED",
  user_already_exists: "EMAIL_ALREADY_REGISTERED",
  email_exists: "EMAIL_ALREADY_REGISTERED",
};

/** Fallback po tresci — dostawca nie zawsze podaje `code`. Kolejnosc ma znaczenie. */
const PROVIDER_MESSAGE_MAP: [needle: string, code: ApiErrorCode][] = [
  ["invalid login credentials", "INVALID_CREDENTIALS"],
  ["email not confirmed", "EMAIL_NOT_CONFIRMED"],
  ["already registered", "EMAIL_ALREADY_REGISTERED"],
  ["user already exists", "EMAIL_ALREADY_REGISTERED"],
];

/**
 * Zamienia dowolny blad (Supabase, dostawca LLM, wlasny rzut) na kod domenowy.
 *
 * Brak tresci jest **normalnym stanem do obsluzenia**, nie sytuacja niemozliwa:
 * komunikat pusty po `trim()` traktowany jest jak brakujacy i konczy sie kodem
 * domyslnym. Sprawdzone na produkcji 2026-08-24 — patrz `context/foundation/lessons.md`.
 */
export function toApiErrorCode(error: unknown): ApiErrorCode {
  const source = asRecord(error);
  if (!source) {
    return DEFAULT_ERROR_CODE;
  }

  const providerCode = readString(source, "code")?.trim().toLowerCase();
  if (providerCode && Object.hasOwn(PROVIDER_CODE_MAP, providerCode)) {
    return PROVIDER_CODE_MAP[providerCode];
  }

  const status = readNumber(source, "status");
  if (status !== undefined && status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }

  const message = readString(source, "message")?.trim().toLowerCase();
  if (!message) {
    return DEFAULT_ERROR_CODE;
  }

  const matched = PROVIDER_MESSAGE_MAP.find(([needle]) => message.includes(needle));
  return matched ? matched[1] : DEFAULT_ERROR_CODE;
}

/**
 * Zapisuje surowa tresc bledu po stronie serwera — uzytkownik jej nie zobaczy,
 * wiec bez tego znika jedyny slad diagnostyczny.
 *
 * NIGDY nie przekazuj tu ciala zadania: przy auth zawiera e-mail i haslo, przy
 * generowaniu temat wpisany przez uzytkownika.
 */
export function logApiError(scope: string, code: ApiErrorCode, error: unknown): void {
  const source = asRecord(error);
  // eslint-disable-next-line no-console -- observability Workera czyta stdout/stderr; nie ma tu innego kanalu
  console.error("[api]", {
    scope,
    code,
    providerCode: source ? readString(source, "code") : undefined,
    providerStatus: source ? readNumber(source, "status") : undefined,
    providerMessage: source ? readString(source, "message") : undefined,
  });
}

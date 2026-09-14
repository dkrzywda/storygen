import type { ApiErrorCode, ApiErrorPayload, ApiFieldErrors } from "@/types";

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
  SELF_DELETE_FORBIDDEN: {
    // 403, nie 409. Zadanie nie koliduje z przejsciowym stanem, ktory da sie
    // zmienic — jest odrzucane NA STALE i powtorzenie niczego nie da. Kod 409
    // sugerowalby "sprobuj jeszcze raz, inaczej", co byloby nieprawda.
    //
    // Brak tu obawy o ujawnienie czegokolwiek, ktora kaze mapowac `FORBIDDEN`
    // na 404: wolajacy pyta o WLASNE konto, wiec odpowiedz nie mowi mu nic,
    // czego by nie wiedzial.
    status: 403,
    message: "Nie możesz usunąć własnego konta. Poproś innego administratora.",
  },
  DESTROY_CONFIRM_REQUIRED: {
    // 409, jak `LAST_ADMIN_CONFIRM_REQUIRED`: zadanie jest poprawne i wykonalne,
    // ale koliduje ze stanem, o ktorym wolajacy moze nie wiedziec — ze operacja
    // zniszczy dane. Powtorzone z jawna zgoda przejdzie.
    status: 409,
    message: "Usunięcie konta niszczy jego zapisane teksty i jest nieodwracalne. Potwierdź, jeśli chcesz to zrobić.",
  },
  ACCOUNT_BLOCKED: {
    // 403, nie 401. Dane logowania sa poprawne i powtorzenie proby niczego nie
    // zmieni — to odmowa wobec wlasciwych danych, a nie brak uwierzytelnienia.
    status: 403,
    // BEZ ODSYLANIA DO KONTAKTU. Produkt nie ma zadnego kanalu kontaktu, a
    // `## Non-Goals` wyklucza zglaszanie naduzyc — komunikat nie ma obiecywac
    // drogi odwolawczej, ktorej nie ma. Mowi, co sie stalo, i tyle.
    message: "Dostęp do tego konta został zawieszony.",
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
  DAILY_LIMIT_REACHED: {
    // 429, nie 403: to nie jest brak uprawnienia, tylko wyczerpany budzet w czasie —
    // ta sama prosba zadziala po odnowieniu, bez zadnej zmiany po stronie konta.
    status: 429,
    // Forma BEZOSOBOWA jest celowa. Polski czasownik w drugiej osobie niesie rodzaj
    // ("wykorzystałeś"/"wykorzystałaś"), a produkt nie wie, ktory jest wlasciwy.
    message: "Dzienny limit generacji został wyczerpany. Odnowi się o północy.",
  },
  APP_LIMIT_REACHED: {
    status: 429,
    message: "Aplikacja osiągnęła dzienny limit generacji dla wszystkich kont. Spróbuj ponownie po północy.",
  },
  LAST_ADMIN_CONFIRM_REQUIRED: {
    // 409, nie 400 i nie 403: żądanie jest poprawne i wykonalne, ale koliduje ze
    // stanem, o którym wołający mógł nie wiedzieć — że to ostatnia rola. Powtórzone
    // z jawnym potwierdzeniem przejdzie, bez żadnej zmiany po stronie konta.
    status: 409,
    // Komunikat nazywa SKUTEK, nie mechanizm. Administrator ma podjąć decyzję,
    // a nie dowiedzieć się, że funkcja zwróciła kod.
    // KOMUNIKAT NAZYWA SKUTEK, NIE CZASOWNIK — ustalenie F4 przegladu S-11.
    // Wczesniej brzmial "Po jej ZDJECIU…", bo kod nalezal wylacznie do zmiany roli.
    // Od S-11 ten sam kod zwraca takze `set_account_blocked`, wiec administrator
    // BLOKUJACY ostatniego admina zobaczylby zdanie o zdejmowaniu roli — bez zadnego
    // bledu, tylko z nieprawda na ekranie. Jeden kod na jeden SKUTEK jest tanszy niz
    // dwa kody na dwa czasowniki: skutek jest ten sam i to on wymaga zgody.
    message:
      "To ostatni czynny administrator. Po tej operacji administracja przestanie być dostępna z poziomu aplikacji. Potwierdź, jeśli chcesz to zrobić.",
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

/**
 * Czyta blad z odpowiedzi API i ZAWSZE zwraca komunikat do pokazania.
 *
 * Powstalo z ustalenia F1 przegladu `delete-generation`: wyspy robily
 * `const body: ApiErrorBody = await response.json()` i braly `body.error.message`
 * na wiare. Dwa realne przypadki to lamia. Ochrona CSRF Astro odrzuca `DELETE`
 * bez `Origin` odpowiedzia 403 z CZYSTYM TEKSTEM — `json()` rzuca, a uzytkownik
 * dostaje komunikat o problemie z siecia dla zadania, ktore dotarlo do serwera.
 * Strona bledu 5xx od hostingu zachowuje sie identycznie. Drugi: gdy cialo sie
 * sparsuje, ale `message` jest puste, interfejs gasi akapit i nie pokazuje NIC.
 *
 * To ta sama awaria, ktora `lessons.md` zapisuje jako "Komunikat bledu od
 * zewnetrznej uslugi moze byc pusty", osiagnieta z innej strony: nie przez brak
 * tresci z SDK, a przez brak koperty kontraktu. Brak tresci jest tu NORMALNYM
 * stanem do obsluzenia, nie sytuacja niemozliwa.
 */
export async function readApiError(response: Response): Promise<ApiErrorPayload> {
  const fallback: ApiErrorPayload = {
    code: DEFAULT_ERROR_CODE,
    message: API_ERRORS[DEFAULT_ERROR_CODE].message,
  };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // Cialo nie jest JSON-em — czysty tekst, HTML strony bledu, pusta odpowiedz.
    return fallback;
  }

  const body = asRecord(parsed);
  const error = body ? asRecord(body.error) : undefined;
  if (!error) {
    return fallback;
  }

  const message = readString(error, "message")?.trim();
  const code = readString(error, "code");
  const fields = asRecord(error.fields);

  return {
    code: isApiErrorCode(code) ? code : fallback.code,
    // Puste `message` traktowane jak brakujace — to sedno tego helpera.
    message: message && message.length > 0 ? message : fallback.message,
    ...(fields ? { fields: fields as ApiFieldErrors } : {}),
  };
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
  // Zmierzone 2026-09-14 bezposrednim wywolaniem `POST /auth/v1/token` dla konta
  // z `banned_until` w przyszlosci: `400`, `{"code":400,"error_code":"user_banned",
  // "msg":"User is banned"}`. Bez tego wpisu status 400 nie jest >= 500, tekst nie
  // pasuje do zadnego wzorca i odmowa schodzila do `INTERNAL`.
  user_banned: "ACCOUNT_BLOCKED",
};

/** Fallback po tresci — dostawca nie zawsze podaje `code`. Kolejnosc ma znaczenie. */
const PROVIDER_MESSAGE_MAP: [needle: string, code: ApiErrorCode][] = [
  ["invalid login credentials", "INVALID_CREDENTIALS"],
  ["email not confirmed", "EMAIL_NOT_CONFIRMED"],
  ["already registered", "EMAIL_ALREADY_REGISTERED"],
  ["user already exists", "EMAIL_ALREADY_REGISTERED"],
  // Wariant tekstowy dla `user_banned` — dostawca nie zawsze podaje `error_code`,
  // a to jedyna warstwa, ktora wtedy zostaje.
  ["user is banned", "ACCOUNT_BLOCKED"],
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

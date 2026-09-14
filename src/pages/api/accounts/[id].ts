import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { accountPatchSchema } from "@/lib/account-blocked-patch";
import { deleteAccount, mapAccountActionCode, setAccountBlocked, setAccountRole } from "@/lib/admin-accounts";
import { readDeleteParams } from "@/lib/account-delete-params";

/**
 * Działania administratora na koncie: zmiana roli (FR-018, S-10), blokowanie
 * i odblokowanie (FR-016, S-11) oraz usunięcie (FR-017, S-12).
 *
 * DWIE METODY, NIE JEDNA. `PATCH` zmienia pole konta; `DELETE` niszczy zasob.
 * Trzecia galaz w `PATCH` nazywalaby zniszczenie zmiana pola.
 *
 * NAZWA OBEJMUJE WSZYSTKIE OPERACJE — ustalenie F9 przegladu faz 3-4. Naglowek brzmial
 * „Zmiana roli konta" jeszcze po tym, jak endpoint zaczal obslugiwac dwie rzeczy;
 * to trzecie wystapienie tej samej klasy w tym plastrze, po komunikacie
 * `LAST_ADMIN_CONFIRM_REQUIRED` i po naglowku kolumny w tabeli.
 *
 * Cialo niesie `role` ALBO `blocked`, nigdy oba — rozstrzyga to schemat
 * w `@/lib/account-blocked-patch`, ktory oddaje unie rozlaczna, wiec galezie
 * ponizej sa wyczerpujace z konstrukcji, a nie z dyscypliny.
 *
 * KOPIA WZORCA z `src/pages/api/generations/[id].ts` — ta sama kolejnosc bramek
 * i te same powody. Regex UUID jest tu powtorzony, a nie wyciagniety do wspolnego
 * modulu: to jedna linia o stabilnym ksztalcie, a wyciaganie jej dotknelo by pliku
 * spoza zakresu tej fazy. Decyzja swiadoma, nie przeoczenie.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH: APIRoute = async (context) => {
  // `context.locals.user` jest rozwiazywany przez middleware na kazdym zadaniu
  // i jest `null` takze przy niedostepnym Supabase — osobne sprawdzenie klienta
  // nie jest tu potrzebne.
  //
  // TEN HANDLER NIE SPRAWDZA `isAdmin`. Bramka roli mieszka w srodku funkcji
  // `set_account_role()` i czyta role Z BAZY dla `auth.uid()`. Drugie sprawdzenie
  // tutaj dalo by DWA zrodla prawdy o tym, kto jest administratorem — a rozjazd
  // miedzy nimi bylby bledem cichym: endpoint odmawialby, gdy baza pozwala, albo
  // odwrotnie. Sprawdzenie po stronie aplikacji sluzy wylacznie temu, zeby nie
  // rysowac przycisku (`dashboard.astro`), nigdy temu, by zdecydowac o dostepie.
  if (!context.locals.user) {
    return jsonError("UNAUTHORIZED");
  }

  const id = context.params.id;
  // Identyfikator spoza formatu UUID nie moze trafic do zapytania: baza rzucilaby
  // bledem skladni, a uzytkownik dostalby 500 zamiast uczciwego 404.
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError("VALIDATION_FAILED", { _: "Treść żądania musi być poprawnym JSON-em." });
  }

  const parsed = validate(accountPatchSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_FAILED", parsed.fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  const zadanie = parsed.data;

  let raw: string;
  try {
    // GALAZ WYBIERA UNIA ROZLACZNA ZE SCHEMATU, nie sprawdzenie obecnosci pola.
    // "Oba naraz" i "zadne" sa niewyrazalne po walidacji, wiec nie ma ich tu czym
    // obsluzyc — a dodanie trzeciej operacji bedzie bledem kompilacji, nie cicha
    // luka. Ostatni argument przekazywany ZAWSZE w obu galeziach.
    raw =
      zadanie.kind === "role"
        ? await setAccountRole(supabase, id, zadanie.role, zadanie.confirmLast)
        : await setAccountBlocked(supabase, id, zadanie.blocked, zadanie.confirmLast);
  } catch (error) {
    const code = toApiErrorCode(error);
    logApiError("api/accounts/[id]", code, error);
    return jsonError(code);
  }

  const mapped = mapAccountActionCode(raw);

  if (mapped === "ok") {
    // Endpoint mowi, CO zmienil, niezaleznie od tego, co z tym zrobi interfejs —
    // ta sama zasada co przy usuwaniu generacji. Odpowiedz niesie wylacznie pole
    // faktycznie zmienione, zeby interfejs nie zgadywal, ktora operacja przeszla.
    return jsonOk(zadanie.kind === "role" ? { id, role: zadanie.role } : { id, blocked: zadanie.blocked });
  }

  if (mapped === "INTERNAL") {
    // Kod spoza umowionego zbioru znaczy, ze baza i aplikacja rozjechaly sie
    // kontraktem. Uzytkownik dostaje komunikat domyslny, ale slad musi zostac,
    // bo inaczej ten rozjazd jest niewidoczny.
    const funkcja = zadanie.kind === "role" ? "set_account_role" : "set_account_blocked";
    logApiError("api/accounts/[id]", "INTERNAL", { message: `nieznany kod z ${funkcja}: ${raw}` });
  }

  return jsonError(mapped);
};

/**
 * Usuniecie konta (FR-017, S-12). JEDYNA NIEODWRACALNA operacja w produkcie.
 *
 * OSOBNA METODA, nie trzecia galaz `PATCH`. `PATCH` znaczy „zmien pole", a to
 * jest zniszczenie zasobu — nazwa klamalaby o skutku. Ta sama metoda i ta sama
 * kolejnosc bramek co w `src/pages/api/generations/[id].ts`.
 *
 * PULAPKA, KTORA DOTYCZY KAZDEGO `DELETE` W TYM REPO (zapisana przy `S-06`):
 * Astro odrzuca `DELETE` bez naglowka `Origin` PRZED middleware, zwracajac 403
 * CSRF — a nie kod z kontraktu bledow. `curl -X DELETE` bez naglowkow dostanie
 * wiec 403, ktore NIE jest bramka uprawnien, choc tak wyglada. Wywolanie
 * z przegladarki naglowek niesie samo.
 */
export const DELETE: APIRoute = async (context) => {
  // `context.locals.user` jest rozwiazywany przez middleware na kazdym zadaniu
  // i jest `null` takze przy niedostepnym Supabase.
  //
  // TEN HANDLER NIE SPRAWDZA `isAdmin` — z tego samego powodu co `PATCH`:
  // bramka mieszka w srodku `delete_account()` i czyta role Z BAZY dla
  // `auth.uid()`. Drugie sprawdzenie tutaj daloby dwa zrodla prawdy.
  if (!context.locals.user) {
    return jsonError("UNAUTHORIZED");
  }

  const id = context.params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("NOT_FOUND");
  }

  // Zgoda jedzie w adresie — patrz uzasadnienie w `@/lib/account-delete-params`.
  const params = readDeleteParams(context.url);
  if (!params.ok) {
    return jsonError("VALIDATION_FAILED", { confirmDestroy: params.message });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  let wynik: Awaited<ReturnType<typeof deleteAccount>>;
  try {
    // Argument zgody przekazywany ZAWSZE jawnie — patrz `deleteAccount`.
    wynik = await deleteAccount(supabase, id, params.data.confirmDestroy);
  } catch (error) {
    const code = toApiErrorCode(error);
    logApiError("api/accounts/[id]", code, error);
    return jsonError(code);
  }

  const mapped = mapAccountActionCode(wynik.code);

  if (mapped === "ok") {
    // Endpoint mowi, CO zniszczyl — liczba pochodzi z tej samej transakcji, co
    // usuniecie, wiec jest faktem, a nie przewidywaniem sprzed klikniecia.
    return jsonOk({ id, destroyedGenerations: wynik.destroyedGenerations });
  }

  if (mapped === "INTERNAL") {
    logApiError("api/accounts/[id]", "INTERNAL", { message: `nieznany kod z delete_account: ${wynik.code}` });
  }

  return jsonError(mapped);
};

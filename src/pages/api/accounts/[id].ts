import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { accountPatchSchema } from "@/lib/account-blocked-patch";
import { mapAccountActionCode, setAccountBlocked, setAccountRole } from "@/lib/admin-accounts";

/**
 * Zmiana roli konta (FR-018, S-10).
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

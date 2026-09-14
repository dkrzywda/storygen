import type { createClient } from "@/lib/supabase";
import type { AccountOverviewRow, AccountRole, ApiErrorCode } from "@/types";

/**
 * Przeglad kont dla administratora (S-09, FR-014 i FR-015).
 *
 * OSOBNY MODUL, a nie dopisek do `@/lib/limits` albo `@/lib/generations`: tamten
 * niesie limity, ten drugi tresc, a przeglad kont nie nalezy do zadnego z nich.
 *
 * AUTORYTETEM JEST BAZA. Bramka roli, okno doby, prog na konto i sufit wierszy
 * mieszkaja w `public.accounts_overview()`. Tutaj nie ma ani jednej z tych decyzji —
 * i nie moze ich byc: sprawdzenie roli po stronie klienta byloby obejsciem
 * o jedno wywolanie PostgREST.
 *
 * ZERO WIERSZY TO POPRAWNA ODPOWIEDZ, NIE AWARIA. Funkcja w bazie oddaje pusty
 * zbior kazdemu, kto nie ma roli `admin` — pusty wynik jest nieodroznialny od
 * "brak kont", wiec nie ujawnia, ze przeglad istnieje (FR-015). Ten modul NIE
 * zamienia pustki na blad.
 */

/** Typ klienta bierzemy z fabryki, zeby nie rozjechal sie przy zmianie w `supabase.ts`. */
type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * Czyta przeglad kont.
 *
 * **Rzuca** przy bledzie bazy — decyzje, co z tym zrobic, podejmuje wywolujacy,
 * tak samo jak przy `fetchUsageToday`. Panel degraduje: `null` znaczy "nie wiem",
 * a nie "brak kont".
 */
export async function fetchAccountsOverview(supabase: Client): Promise<AccountOverviewRow[]> {
  const { data, error } = await supabase.rpc("accounts_overview");

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    registeredAt: new Date(row.registered_at),
    // Zawezenie do `AccountRole` jest tu SWIADOME i jednostronne. Baza zwraca `text`,
    // a `coalesce(..., 'user')` gwarantuje jedna z dwoch wartosci — ale gwarantuje to
    // SQL, nie typ. Nierozpoznana wartosc traktujemy jak `user`, czyli fail-closed,
    // tak samo jak `isAdmin` traktuje brak klucza.
    role: row.role === "admin" ? "admin" : "user",
    isSelf: row.is_self,
    isLastAdmin: row.is_last_admin,
    generations: row.generations,
    usedToday: row.used_today,
    ownLimit: row.own_limit,
    rowLimit: row.row_limit,
  }));
}

/**
 * Kody, ktore `public.set_account_role()` moze zwrocic.
 *
 * Zwraca KOD, nie boolean i nie wyjatek — wzorzec `record_attempt_if_allowed`.
 * Wolajacy musi wiedziec, KTORA granica zadzialala: brak uprawnien to inna
 * sytuacja niz brak potwierdzenia przy ostatniej roli, i endpoint mapuje je na
 * rozne odpowiedzi.
 */
export type RoleChangeCode = "ok" | "FORBIDDEN" | "VALIDATION_FAILED" | "NOT_FOUND" | "LAST_ADMIN_NEEDS_CONFIRM";

/**
 * Mapuje kod z bazy na kod kontraktu API (F-01).
 *
 * `"ok"` przechodzi jako `"ok"`; wszystko inne wraca jako `ApiErrorCode`.
 *
 * `FORBIDDEN` → `NOT_FOUND`, NIE 403. Odpowiedz 403 potwierdzalaby istnienie
 * operacji kazdemu, kto zgadnie adres — dokladnie to, czego FR-015 zabrania dla
 * przegladu, i nie ma powodu, by zapis byl gadatliwszy od odczytu.
 *
 * FAIL-CLOSED: kod spoza zbioru daje `INTERNAL`, a nie `ok`. Baza jest tu
 * autorytetem, ale odpowiedz z sieci nie jest obietnica — nieznana wartosc znaczy
 * "nie wiem, co sie stalo", a to nie jest sukces.
 */
export function mapRoleChangeCode(raw: string): ApiErrorCode | "ok" {
  switch (raw) {
    case "ok":
      return "ok";
    case "FORBIDDEN":
      return "NOT_FOUND";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "VALIDATION_FAILED":
      return "VALIDATION_FAILED";
    case "LAST_ADMIN_NEEDS_CONFIRM":
      return "LAST_ADMIN_CONFIRM_REQUIRED";
    default:
      return "INTERNAL";
  }
}

/**
 * Zmienia role konta.
 *
 * **Rzuca** przy bledzie bazy — tak samo jak `fetchAccountsOverview`. Odmowa
 * bramki bledem NIE jest: wraca jako kod `FORBIDDEN`, bo funkcja wykonala sie
 * poprawnie i po prostu odmowila.
 *
 * `confirmLast` jest przekazywane ZAWSZE, nigdy pomijane. Funkcja w bazie ma
 * `default false`, wiec pominiecie argumentu bylo by rownowazne — ale poleganie
 * na domysle bazy zamiast na kontrakcie wywolania jest dokladnie tym rodzajem
 * cichego zalozenia, ktore ten plaster ma eliminowac (ustalenie F4 przegladu p1).
 */
export async function setAccountRole(
  supabase: Client,
  accountId: string,
  role: AccountRole,
  confirmLast: boolean,
): Promise<RoleChangeCode> {
  const { data, error } = await supabase.rpc("set_account_role", {
    p_account: accountId,
    p_role: role,
    p_confirm_last: confirmLast,
  });

  if (error) {
    throw error;
  }

  // `data` jest typowane jako `string`, ale przychodzi z sieci. Zawezenie zostawiamy
  // `mapRoleChangeCode`, ktore jest fail-closed — tu nie udajemy, ze wiemy wiecej.
  return data as RoleChangeCode;
}

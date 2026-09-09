import type { createClient } from "@/lib/supabase";
import type { AccountOverviewRow } from "@/types";

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
    email: row.email,
    registeredAt: new Date(row.registered_at),
    generations: row.generations,
    usedToday: row.used_today,
    ownLimit: row.own_limit,
  }));
}

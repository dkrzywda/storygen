import { z } from "zod";
import type { AccountRole } from "@/types";

/**
 * Schemat zadania zmiany roli konta (`PATCH /api/accounts/[id]`, S-10, FR-018).
 *
 * NIE lezy obok endpointu — w Astro kazdy plik `.ts` pod `src/pages/` staje sie
 * trasa, wiec schemat obok handlera wystawilby publiczny endpoint. Ta sama zasada
 * i ten sam powod co w `@/lib/generation-patch`.
 *
 * WALIDACJA TU NIE ZASTEPUJE WALIDACJI W BAZIE. `set_account_role()` sprawdza
 * zbior rol po swojej stronie, bo funkcje mozna wolac przez PostgREST z pominieciem
 * tego endpointu. Ten schemat istnieje po to, zeby uzytkownik dostal komunikat
 * o polu, a nie surowy kod z bazy.
 */

/**
 * Zbior rol powtorzony jako literal, a nie zaimportowany z `AccountRole`.
 *
 * Zod potrzebuje wartosci w CZASIE WYKONANIA, a `AccountRole` jest typem, ktory
 * znika przy budowaniu — nie da sie z niego wyprowadzic tablicy.
 *
 * `satisfies` pilnuje JEDNEGO kierunku: wartosc, ktora nie jest poprawna rola,
 * jest tu bledem kompilacji. Kierunku odwrotnego NIE pilnuje — dopisanie trzeciej
 * roli do `AccountRole` bez dopisania jej tutaj przejdzie bez bledu i taka rola
 * bylaby po cichu odrzucana przez walidacje. Zapisane wprost, bo to realna
 * pulapka, a nie teoretyczna: przy trzeciej roli trzeba ruszyc oba miejsca.
 */
const ROLES = ["admin", "user"] as const satisfies readonly AccountRole[];

export const accountRolePatchSchema = z.object({
  role: z.enum(ROLES, { error: "Rola musi być jedną z wartości: admin, user." }),

  /**
   * Jawna zgoda na zdjecie OSTATNIEJ roli administratora.
   *
   * Opcjonalne w schemacie, ale endpoint wysyla do bazy zawsze wartosc jawna —
   * ustalenie F4 przegladu fazy 1. Funkcja w bazie ma `default false`, wiec
   * pominiecie argumentu bylo by rownowazne odmowie; poleganie na tym byloby
   * jednak poleganiem na domysle bazy zamiast na kontrakcie endpointu.
   */
  confirmLast: z.boolean({ error: "Potwierdzenie musi być wartością logiczną." }).optional(),
});

export type AccountRolePatchInput = z.infer<typeof accountRolePatchSchema>;

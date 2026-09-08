import type { User } from "@supabase/supabase-js";
import type { AccountRole } from "@/types";

/**
 * Jedno miejsce, ktore odpowiada na pytanie "czy ten uzytkownik jest administratorem".
 *
 * Wolane i przez middleware (bramka tras), i przez przyszle handlery API `S-09` —
 * zeby nie powstaly DWIE definicje tego, kto jest adminem. Rozjazd miedzy nimi bylby
 * bledem cichym: strona odmawialaby, a endpoint wpuszczal, albo odwrotnie.
 *
 * FAIL-CLOSED, tak samo jak `interpretGate` w `@/lib/limits`. Kazde wejscie, ktorego
 * autor nie przewidzial — brak uzytkownika, brak `app_metadata`, brak klucza, wartosc
 * spoza zbioru, wartosc nie-tekstowa — daje `false`. Odwrotny domysl (wpuszczaj, gdy
 * nie wiesz) jest w granicy dostepu nie do przyjecia.
 */

const ADMIN_ROLE: AccountRole = "admin";

/**
 * ZAWEZANIE TYPU JEST TU KONIECZNE, NIE OSTROZNOSCIA.
 *
 * `UserAppMetadata` w SDK ma `[key: string]: any`
 * (`@supabase/auth-js/dist/module/lib/types.d.ts`), wiec `user.app_metadata.role` jest
 * typu `any`. Odczyt bez przejscia przez `unknown` wywraca `@typescript-eslint/no-unsafe-*`,
 * ktore w tym repo jest bledem, nie ostrzezeniem — a rzutowanie na `AccountRole` byloby
 * klamstwem wobec kompilatora: baza moze zawierac tam cokolwiek.
 *
 * `app_metadata` jest w typie nie-opcjonalne, ale sprawdzenie na `object` zostaje:
 * to pole przychodzi z sieci, a typ SDK jest obietnica, nie gwarancja.
 */
export function isAdmin(user: User | null): boolean {
  if (user === null) {
    return false;
  }

  const meta: unknown = user.app_metadata;
  if (typeof meta !== "object" || meta === null) {
    return false;
  }

  const role: unknown = (meta as Record<string, unknown>).role;
  return role === ADMIN_ROLE;
}

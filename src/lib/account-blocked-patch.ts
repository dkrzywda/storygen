import { z } from "zod";
import type { AccountRole } from "@/types";

/**
 * Schemat ciala zadania `PATCH /api/accounts/[id]` (S-10 + S-11).
 *
 * NIE lezy obok endpointu — w Astro kazdy plik `.ts` pod `src/pages/` staje sie
 * trasa, wiec schemat obok handlera wystawilby publiczny endpoint. Ta sama zasada
 * i ten sam powod co w `@/lib/generation-patch`.
 *
 * WALIDACJA TU NIE ZASTEPUJE WALIDACJI W BAZIE. `set_account_role()` i
 * `set_account_blocked()` sprawdzaja wejscie po swojej stronie, bo obie funkcje
 * mozna wolac przez PostgREST z pominieciem tego endpointu. Ten schemat istnieje
 * po to, zeby uzytkownik dostal komunikat o polu, a nie surowy kod z bazy.
 *
 * ============================================================================
 *  DLACZEGO JEDEN SCHEMAT NA DWIE OPERACJE, A NIE DWA OBOK SIEBIE
 * ============================================================================
 *
 * Regula „albo rola, albo blokada, nigdy oba" jest wlasnoscia CALEGO ciala, nie
 * zadnego pojedynczego pola. Rozbita na dwa osobne schematy musialaby zostac
 * dopowiedziana w handlerze — a walidacja mieszkajaca w handlerze to dokladnie
 * to, czemu `validate()` i Zod maja w tym repo zapobiegac.
 *
 * Zadanie BEZ zadnego z pol jest bledem walidacji, nie no-opem. Puste `{}`
 * konczyloby sie inaczej `200` i cisza: uzytkownik dostalby potwierdzenie zmiany,
 * ktora nie nastapila.
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
 * bylaby po cichu odrzucana przez walidacje.
 */
const ROLES = ["admin", "user"] as const satisfies readonly AccountRole[];

/** Klucz bledu dotyczacego calego ciala, nie pojedynczego pola. */
const FORM_KEY = "_";

const bodySchema = z.object(
  {
    role: z.enum(ROLES, { error: "Rola musi być jedną z wartości: admin, user." }).optional(),

    blocked: z.boolean({ error: "Stan blokady musi być wartością logiczną." }).optional(),

    /**
     * Jawna zgoda na skutek dotyczacy OSTATNIEGO czynnego administratora — zdjecie
     * jego roli albo jego zablokowanie.
     *
     * Opcjonalne w schemacie, ale endpoint wysyla do bazy zawsze wartosc jawna
     * (ustalenie F4 przegladu S-10). Obie funkcje maja `default false`, wiec
     * pominiecie argumentu byloby rownowazne odmowie; poleganie na tym byloby jednak
     * poleganiem na domysle bazy zamiast na kontrakcie endpointu.
     */
    confirmLast: z.boolean({ error: "Potwierdzenie musi być wartością logiczną." }).optional(),
  },
  {
    /**
     * KOMUNIKAT DLA CALEGO CIALA, po polsku — ustalenie F1 przegladu faz 3-4.
     *
     * Bez niego Zod wstawial tu wlasny tekst WEWNETRZNY I ANGIELSKI. Zmierzone na
     * pieciu wariantach: `null`, string, liczba, tablica i boolean dawaly
     * „Invalid input: expected object, received …", a `[id].ts` wklada `fields`
     * wprost do odpowiedzi. CLAUDE.md wymaga komunikatow pol po POLSKU, a NFR
     * z PRD zabrania wynoszenia wewnetrznej tresci bledu na powierzchnie produktu.
     *
     * Dzis nic tego nie renderuje — komunikat ladowal pod kluczem `_`, a wyspy
     * czytaja z `readApiError` tylko `{code, message}`. To jest jednak argument
     * za tym, ze nikt by tego nie zauwazyl, a nie za tym, ze nie szkodzi.
     */
    error: "Treść żądania musi być obiektem.",
  },
);

/**
 * Wynik walidacji jako UNIA ROZLACZNA, nie obiekt z dwoma opcjonalnymi polami.
 *
 * Dzieki temu handler nie moze zapomniec o galezi: TypeScript wymusi obsluge obu,
 * a „obie naraz" i „zadna" sa tu niewyrazalne z konstrukcji, a nie z dyscypliny.
 */
export type AccountPatchInput =
  | { kind: "role"; role: AccountRole; confirmLast: boolean }
  | { kind: "blocked"; blocked: boolean; confirmLast: boolean };

export const accountPatchSchema = bodySchema.transform((value, ctx): AccountPatchInput => {
  const { role, blocked } = value;
  const confirmLast = value.confirmLast ?? false;

  // KOLEJNOSC SPRAWDZEN JEST DOBRANA TAK, ZEBY TYPESCRIPT ZAWEZAL SAM.
  // Wariant z flagami (`const maRole = role !== undefined`) wymagal w galeziach
  // zwrotnych asercji `as`, bo kompilator nie wiaze flagi z polem. Tu asercji nie
  // ma ani jednej — a asercja w kodzie walidujacym wejscie z sieci jest dokladnie
  // tym miejscem, w ktorym nie chcemy obiecywac wiecej, niz sprawdzilismy.
  if (role !== undefined && blocked !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: [FORM_KEY],
      message: "Jedno żądanie zmienia albo rolę, albo stan blokady — nie oba naraz.",
    });
    return z.NEVER;
  }

  if (role !== undefined) {
    return { kind: "role", role, confirmLast };
  }

  // `blocked === false` to ODBLOKOWANIE, czyli pelnoprawna operacja. Rozroznienie
  // idzie po OBECNOSCI pola, nie po jego prawdziwosci — inaczej odblokowanie
  // wpadloby ponizej jako "zadne pole nie podane".
  if (blocked !== undefined) {
    return { kind: "blocked", blocked, confirmLast };
  }

  ctx.addIssue({
    code: "custom",
    path: [FORM_KEY],
    message: "Żądanie musi zmieniać rolę albo stan blokady.",
  });
  return z.NEVER;
});

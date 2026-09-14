import { z } from "zod";

/**
 * Parametry zadania `DELETE /api/accounts/[id]` (S-12, FR-017).
 *
 * NIE lezy obok endpointu — w Astro kazdy plik `.ts` pod `src/pages/` staje sie
 * trasa, wiec schemat obok handlera wystawilby publiczny endpoint. Ta sama
 * zasada i ten sam powod co w `@/lib/account-blocked-patch`.
 *
 * ============================================================================
 *  DLACZEGO PARAMETRY ZAPYTANIA, A NIE CIALO
 * ============================================================================
 *
 * `DELETE` moze niesc cialo, ale nie da sie na to liczyc: posrednicy bywaja
 * wolne od obowiazku jego przekazania, a `fetch` bez `body` jest tu naturalny.
 * Zgoda jedzie wiec w adresie, tak jak przy kazdym innym parametrze operacji.
 *
 * ============================================================================
 *  DLACZEGO JEDEN PARAMETR, A NIE DWA
 * ============================================================================
 *
 * Plan przewidywal takze zgode na usuniecie OSTATNIEGO administratora. Ta galaz
 * jest w `delete_account` NIEOSIAGALNA — wolajacy musi byc czynnym adminem, wiec
 * jest liczony, a celem nie moze byc on sam, wiec licznik ma zawsze co najmniej
 * dwa. Parametr, ktorego baza nie zna, byl by tu obietnica bez pokrycia. Pelne
 * uzasadnienie w naglowku migracji `20260914160000`.
 */

/** Klucz bledu dotyczacego calego zadania, nie pojedynczego pola. */
const FORM_KEY = "_";

/**
 * Zgoda przychodzi z ADRESU, czyli zawsze jako tekst — `z.boolean()` odrzucilby
 * kazda wartosc. Przyjmujemy WYLACZNIE `"true"` i `"false"`, a nie „cokolwiek
 * niepuste znaczy tak": literowka w adresie nie moze zamienic sie w zgode na
 * operacje, ktorej nikt nie cofnie.
 */
export const accountDeleteParamsSchema = z
  .object({
    confirmDestroy: z.enum(["true", "false"], {
      error: "Zgoda na usunięcie musi mieć wartość true albo false.",
    }),
  })
  .transform((value) => ({ confirmDestroy: value.confirmDestroy === "true" }));

export type AccountDeleteParams = z.infer<typeof accountDeleteParamsSchema>;

/**
 * Wyciaga parametry z adresu i waliduje je.
 *
 * BRAK PARAMETRU JEST BLEDEM, nie cichym `false`. Zadanie usuniecia bez slowa
 * o zgodzie to zadanie niepelne, a nie zadanie odmowne — i uzytkownik ma
 * dostac komunikat o tym, czego brakuje, zamiast odmowy bez wyjasnienia.
 * Sama baza i tak odmowi bez `p_confirm_destroy`, wiec to jest druga warstwa,
 * nie jedyna.
 */
export function readDeleteParams(url: URL): { ok: true; data: AccountDeleteParams } | { ok: false; message: string } {
  const raw = url.searchParams.get("confirmDestroy");

  if (raw === null) {
    return { ok: false, message: "Żądanie usunięcia musi nieść zgodę na zniszczenie zapisanych tekstów." };
  }

  const parsed = accountDeleteParamsSchema.safeParse({ confirmDestroy: raw });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.at(0)?.message ?? "Zgoda na usunięcie musi mieć wartość true albo false.",
    };
  }

  return { ok: true, data: parsed.data };
}

export { FORM_KEY as DELETE_PARAMS_FORM_KEY };

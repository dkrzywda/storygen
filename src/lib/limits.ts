import type { createClient } from "@/lib/supabase";
import type { ApiErrorCode, GenerationFormat } from "@/types";

/**
 * Dzienne limity generowania: na konto (FR-012) i na cala aplikacje (FR-013).
 *
 * AUTORYTETEM JEST BAZA, NIE TEN MODUL — ustalenie F2 przegladu. Liczenie, decyzja
 * i zapis proby wchodza do jednej instrukcji `public.record_attempt_if_allowed()`,
 * serializowanej blokada doradcza. Wczesniej odczyt i decyzja zyly tutaj, a zapis
 * szedl osobno: dwa obroty bez blokady, wiec czterdziesci rownoleglych zadan
 * odczytywalo `app_count = 0` i wszystkie przechodzily bramke.
 *
 * Konsekwencja: liczb 10 i 30 tu NIE MA. Nie moglyby tez byc parametrem funkcji —
 * wolajacy podalby wlasne wartosci prosto do PostgREST i obszedlby sufit. Mieszkaja
 * w `public.daily_per_account()` i `public.daily_app_ceiling()`, a `usage_today()`
 * je zwraca, zeby interfejs pokazywal te same liczby, ktore obowiazuja przy zapisie.
 *
 * Arytmetyki doby tu rowniez nie ma — granica `Europe/Warsaw` jest policzona w SQL
 * i to jej jedyne miejsce w produkcie.
 */

/** Typ klienta bierzemy z fabryki, zeby nie rozjechal sie przy zmianie w `supabase.ts`. */
type Client = NonNullable<ReturnType<typeof createClient>>;

export interface UsageToday {
  own: number;
  app: number;
  /** Limity przychodza z bazy razem z licznikami — jedno zrodlo prawdy. */
  ownLimit: number;
  appLimit: number;
  /** Moment odnowienia obu limitow: najblizsza polnoc czasu lokalnego. */
  resetsAt: Date;
}

/** Kody, ktorymi bramka moze odmowic. Zawezone, zeby nie dalo sie tu wpuscic dowolnego bledu. */
export type LimitCode = Extract<ApiErrorCode, "DAILY_LIMIT_REACHED" | "APP_LIMIT_REACHED">;

export type GateOutcome = { ok: true } | { ok: false; code: LimitCode };

/**
 * Tlumaczy surowa odpowiedz bramki na decyzje. Funkcja czysta — to jedyna czesc
 * decyzji, ktora zostala po stronie TypeScriptu, i jedyna, ktora da sie przetestowac
 * bez Dockera.
 *
 * **Rzuca przy wartosci nierozpoznanej i to jest zamierzone.** Bramka jest jedynym
 * ogranicznikiem kosztu w produkcie; gdyby nieznany napis byl cicho traktowany jak
 * zgoda, zmiana kontraktu funkcji w bazie otwieralaby generowanie bez limitu i nic
 * by tego nie zglosilo. Fail-closed konczy sie tu bledem, nie domyslem.
 */
export function interpretGate(raw: string): GateOutcome {
  if (raw === "ok") {
    return { ok: true };
  }
  if (raw === "DAILY_LIMIT_REACHED" || raw === "APP_LIMIT_REACHED") {
    return { ok: false, code: raw };
  }
  throw new Error(`record_attempt_if_allowed() zwrocilo nieznana wartosc: ${raw}`);
}

/**
 * Czyta zuzycie w biezacej dobie. **Rzuca** przy kazdym niepowodzeniu.
 *
 * Sluzy WYLACZNIE do pokazania liczb — o tym, czy wolno generowac, rozstrzyga
 * `reserveAttempt`. Rozdzielenie jest celowe: gdyby interfejs i bramka czytaly przez
 * te sama sciezke, awaria odczytu na ekranie blokowalaby generowanie, a to dwie
 * rozne rzeczy.
 */
export async function fetchUsageToday(supabase: Client): Promise<UsageToday> {
  const { data, error } = await supabase.rpc("usage_today");

  if (error) {
    throw error;
  }

  const row = data.at(0);
  if (!row) {
    throw new Error("usage_today() nie zwrocilo wiersza");
  }

  return {
    own: row.own_count,
    app: row.app_count,
    ownLimit: row.own_limit,
    appLimit: row.app_limit,
    resetsAt: new Date(row.resets_at),
  };
}

/**
 * Rezerwuje miejsce w dziennym limicie: liczy, decyduje i zapisuje probe w jednej
 * instrukcji. **Rzuca** przy bledzie bazy — decyzje, co z tym zrobic, podejmuje
 * wywolujacy, tak jak przy `saveGeneration`.
 *
 * Musi zostac wywolana PRZED wywolaniem modelu i tylko raz na zadanie. Zapisuje
 * takze proby, ktore potem padna — to one wydaly neurony, a nic nie zapisaly
 * do historii, wiec sufit liczony po samych sukcesach nie ograniczalby kosztu.
 */
export async function reserveAttempt(supabase: Client, format: GenerationFormat): Promise<GateOutcome> {
  const { data, error } = await supabase.rpc("record_attempt_if_allowed", { p_format: format });

  if (error) {
    throw error;
  }

  return interpretGate(data);
}

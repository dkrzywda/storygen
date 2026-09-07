import type { createClient } from "@/lib/supabase";
import type { ApiErrorCode, GenerationFormat } from "@/types";

/**
 * Dzienne limity generowania: na konto (FR-012) i na cala aplikacje (FR-013).
 *
 * Modul trzyma trzy rzeczy: obie liczby, dostep do licznika i **czysta decyzje**.
 * Rozdzielenie decyzji od wejscia/wyjscia jest celowe — `checkLimits` da sie
 * przetestowac jednostkowo bez bazy, a to ta czesc R-07 z `test-plan.md`, ktora
 * zyje w TypeScripcie.
 *
 * Arytmetyki doby tu NIE MA. Granica doby (Europe/Warsaw) jest policzona w calosci
 * przez `public.usage_today()` i to jest jej jedyne miejsce w produkcie — patrz
 * komentarz w `supabase/migrations/20260907192600_create_generation_attempts.sql`.
 */

/** Typ klienta bierzemy z fabryki, zeby nie rozjechal sie przy zmianie w `supabase.ts`. */
type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * Limit na konto. Trzy konta po tyle wyczerpuja sufit ponizej, wiec prog na konto
 * pozostaje realna granica sprawiedliwosci przy otwartej rejestracji.
 */
export const DAILY_PER_ACCOUNT = 10;

/**
 * Sufit calej aplikacji — rzeczywista granica kosztu.
 *
 * Wyprowadzony z darmowego przydzialu Workers AI: 10 000 Neuronow/dobe, co
 * `tech-stack.md` przelicza na ~300 dowcipow albo ~66 opowiadan (≈33 i ≈151
 * Neuronow). Najgorszy przypadek to same opowiadania, kazde z jedna ponowna proba
 * z reguly kontraktu formatu — ~302 Neurony na pozycje. 30 × 302 ≈ 9 060, czyli
 * mie sci sie w przydziale nawet wtedy, gdy KAZDA pozycja jest najdrozsza z mozliwych.
 *
 * Liczby 33/151 pochodza z dokumentu, nie z pomiaru na tym modelu i tych promptach —
 * dlatego sufit ma zapas, a nie stoi rowno na granicy.
 */
export const DAILY_APP_CEILING = 30;

/** Liczniki bez momentu odnowienia — tyle, ile potrzebuje decyzja. */
export interface UsageCounts {
  own: number;
  app: number;
}

export interface UsageToday extends UsageCounts {
  /** Moment odnowienia obu limitow: najblizsza polnoc czasu lokalnego. */
  resetsAt: Date;
}

/** Kody, ktorymi bramka moze odmowic. Zawezone, zeby `checkLimits` nie mogla oddac dowolnego bledu. */
export type LimitCode = Extract<ApiErrorCode, "DAILY_LIMIT_REACHED" | "APP_LIMIT_REACHED">;

export type LimitDecision = { ok: true } | { ok: false; code: LimitCode };

/**
 * Decyzja bramki. Funkcja czysta — bez bazy, bez zegara, bez sieci.
 *
 * Kolejnosc ma znaczenie: **najpierw wlasny limit**. Uzytkownik dowiaduje sie o swojej
 * sytuacji, nie o cudzej, a gdy oba progi stoja, bardziej uzyteczna informacja jest ta,
 * ktora dotyczy jego konta.
 *
 * Porownanie jest `>=`, nie `>`: limit jest OSIAGNIETY, nie przekroczony. Przy `>`
 * dziesiaty limit przepuscilby jedenasta generacje.
 */
export function checkLimits(usage: UsageCounts): LimitDecision {
  if (usage.own >= DAILY_PER_ACCOUNT) {
    return { ok: false, code: "DAILY_LIMIT_REACHED" };
  }
  if (usage.app >= DAILY_APP_CEILING) {
    return { ok: false, code: "APP_LIMIT_REACHED" };
  }
  return { ok: true };
}

/**
 * Czyta zuzycie w biezacej dobie. **Rzuca** przy kazdym niepowodzeniu.
 *
 * Rzucanie zamiast zwracania wartosci domyslnej jest tym, co czyni bramke fail-closed:
 * gdyby brak odpowiedzi dawal zera, awaria bazy zamienialaby sufit w atrape i dokladnie
 * to opisuje R-07 („generowanie dziala dalej — awaria jest rachunek, nie blad").
 *
 * Odczyt idzie przez RPC takze dla WLASNEGO zuzycia, mimo zasady z `@/lib/generations`,
 * ze zaden odczyt nie filtruje po `user_id`. Rozniaca sie okolicznosc: filtr po
 * `auth.uid()` siedzi w bazie, wewnatrz funkcji, i nie da sie go podac z zewnatrz —
 * a policzenie wlasnego zuzycia po stronie aplikacji wymagaloby drugiej implementacji
 * granicy doby, ktora musialaby sie zgadzac z ta w SQL.
 */
export async function fetchUsageToday(supabase: Client): Promise<UsageToday> {
  const { data, error } = await supabase.rpc("usage_today");

  if (error) {
    throw error;
  }

  // Funkcja zwraca dokladnie jeden wiersz (agregaty nad `left join`), wiec pusta
  // tablica znaczy, ze stalo sie cos nieprzewidzianego — i wtedy tez odmawiamy.
  const row = data.at(0);
  if (!row) {
    throw new Error("usage_today() nie zwrocilo wiersza");
  }

  return {
    own: row.own_count,
    app: row.app_count,
    resetsAt: new Date(row.resets_at),
  };
}

export interface RecordAttemptInput {
  userId: string;
  format: GenerationFormat;
}

/**
 * Zapisuje probe. **Rzuca** przy niepowodzeniu — tak jak `saveGeneration`, bo decyzje,
 * co zrobic z nieudanym zapisem, podejmuje wywolujacy.
 *
 * Wywolanie musi nastapic PRZED wywolaniem modelu. Zapis po fakcie pomijalby proby,
 * ktore padly — a to wlasnie one wydaly neurony i nic nie zapisaly do historii.
 *
 * `user_id` podajemy wprost, bo polityka INSERT wymaga `auth.uid() = user_id`.
 */
export async function recordAttempt(supabase: Client, input: RecordAttemptInput): Promise<void> {
  const { error } = await supabase.from("generation_attempts").insert({
    user_id: input.userId,
    format: input.format,
  });

  if (error) {
    throw error;
  }
}

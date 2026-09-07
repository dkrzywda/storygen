import type { createClient } from "@/lib/supabase";
import type { GenerationFormat, LengthPreset } from "@/types";

/**
 * Dostep do tabeli `generations` — zapis po generowaniu oraz odczyty dla historii,
 * rankingu i ulubionych.
 *
 * ZADEN z tych odczytow nie filtruje po `user_id`. Izolacja kont stoi na RLS
 * (`generations_select_own`), a filtr w kodzie dawalby ten sam wynik dla poprawnej
 * polityki i MASKOWAL bledna — czyli odbieralby testom RLS sile dowodowa.
 */

/** Typ klienta bierzemy z fabryki, zeby nie rozjechal sie przy zmianie w `supabase.ts`. */
type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * Kolumny czytane przez wszystkie trzy widoki. Jedna lista, bo trzy niezalezne
 * `select` rozjechalyby sie przy dodaniu kolumny i jeden widok pokazywalby mniej.
 */
const LIST_COLUMNS = "id, title, content, format, length_preset, rating, is_favourite, created_at";

export interface SaveGenerationInput {
  userId: string;
  topic: string;
  format: GenerationFormat;
  length: LengthPreset;
  content: string;
}

/**
 * Zapisuje udana generacje i zwraca jej identyfikator.
 *
 * `user_id` jest podawany wprost, bo polityka INSERT wymaga `auth.uid() = user_id` —
 * bez tej kolumny baza odrzuci wiersz. Blad jest RZUCANY, nie pochlaniany: decyzje,
 * co zrobic z nieudanym zapisem, podejmuje wywolujacy, ktory wie, czy uzytkownik
 * czeka na tekst.
 */
export async function saveGeneration(supabase: Client, input: SaveGenerationInput): Promise<string> {
  const { data, error } = await supabase
    .from("generations")
    .insert({
      user_id: input.userId,
      topic: input.topic,
      format: input.format,
      length_preset: input.length,
      content: input.content,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }
  return data.id;
}

/** Historia: wszystko, od najnowszego. */
export async function fetchHistory(supabase: Client) {
  const { data } = await supabase.from("generations").select(LIST_COLUMNS).order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Ranking jednego formatu: od najwyzej ocenionych.
 *
 * Nieocenione pozycje sa POMIJANE, nie wyswietlane na koncu — ranking pozycji bez
 * ocen nie jest rankingiem. Data rozstrzyga remisy, zeby kolejnosc byla stabilna
 * miedzy odswiezeniami; bez tego dwie oceny 5/5 zmienialyby miejsca losowo.
 */
export async function fetchRanking(supabase: Client, format: GenerationFormat) {
  const { data } = await supabase
    .from("generations")
    .select(LIST_COLUMNS)
    .eq("format", format)
    .not("rating", "is", null)
    .order("rating", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Ulubione: oznaczone, od najnowszego. */
export async function fetchFavourites(supabase: Client) {
  const { data } = await supabase
    .from("generations")
    .select(LIST_COLUMNS)
    .eq("is_favourite", true)
    .order("created_at", { ascending: false });
  return data ?? [];
}

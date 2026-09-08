import type { createClient } from "@/lib/supabase";
import { escapeLike, type GenerationFilters } from "@/lib/generation-filters";
import { logApiError } from "@/lib/api-errors";
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
const LIST_COLUMNS = "id, title, topic, content, format, length_preset, rating, is_favourite, created_at";

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

/**
 * Porzadek wyniku. Ranking i historia roznia sie NIE TYLKO filtrem, ale i sortowaniem —
 * ranking bez `rating desc` przestaje byc rankingiem, a zaden typ tego nie zlapie.
 */
export type GenerationOrder = "newest" | "ranked";

/**
 * Gorna granica liczby zwracanych wierszy — ustalenie F3 przegladu.
 *
 * Do tej poprawki odczyt nie mial ZADNEJ granicy, a `GenerationList` hydruje dwie
 * wyspy Reacta na pozycje (`TitleEditor`, `RatingControls`, oba `client:load`). Przy
 * dziennym limicie 10 generacji miesiac uzycia to ~300 wierszy, czyli ~600 gorliwie
 * hydrowanych wysp w jednym dokumencie.
 *
 * CENA JEST JAWNA I NIEPRZYJEMNA: bez paginacji limit znaczy CICHE OBCIECIE. Po
 * przekroczeniu 200 pozycji czesc historii przestanie byc osiagalna, a uzytkownik nie
 * dowie sie, ze cos odcieto — czyli ta sama klasa milczenia, ktora ta zmiana zwalczala
 * przy stanach pustych. Wartosc jest dlatego wysoka: przy maksymalnym tempie to ~20 dni
 * uzycia. WLASCIWA naprawa to paginacja, nie wieksza liczba tutaj.
 */
const RESULT_LIMIT = 200;

export interface FetchGenerationsOptions {
  filters?: GenerationFilters;
  order?: GenerationOrder;
}

/**
 * Jedyny odczyt listy w produkcie. Historia, ranking i ulubione sa jego wywolaniami.
 *
 * Powstalo z tej zmiany: filtrowanie po formacie i po ulubionych istnialo wczesniej
 * DWA RAZY (`fetchRanking`, `fetchFavourites`), a historia z filtrami bylaby trzecim
 * razem. Trzy kopie rozjechalyby sie przy pierwszym dodaniu kolumny do `LIST_COLUMNS` —
 * dokladnie ta klasa awarii, przed ktora ostrzega naglowek `GenerationList.astro`.
 *
 * Filtry lacza sie przez AND i kazdy jest niezalezny. To jedyna rzecz, ktorej zakladki
 * panelu nie potrafia: "ulubione + ocena 5 + dowcipy" nie da sie zlozyc z dwoch zakladek.
 *
 * `minRating` zamiast "ma ocene": przy constraincie 1-5 `rating >= 1` jest rownowazne
 * `rating is not null`, wiec ranking jest zwyklym przypadkiem tego filtra — i indeks
 * czesciowy `WHERE (rating IS NOT NULL)` nadal sie stosuje, bo warunek go implikuje.
 */
export async function fetchGenerations(supabase: Client, options: FetchGenerationsOptions = {}) {
  const { filters = {}, order = "newest" } = options;

  let filtered = supabase.from("generations").select(LIST_COLUMNS);

  if (filters.format !== undefined) {
    filtered = filtered.eq("format", filters.format);
  }
  if (filters.minRating !== undefined) {
    filtered = filtered.gte("rating", filters.minRating);
  }
  if (filters.favourite !== undefined) {
    filtered = filtered.eq("is_favourite", true);
  }
  if (filters.query !== undefined) {
    // `escapeLike` jest tu OBOWIAZKOWE, nie ozdobne: bez niego `%` i `_` z tematu
    // dzialaja jak wieloznaczniki i wynik jest sensownie wygladajacy, ale nie ten.
    filtered = filtered.ilike("topic", `%${escapeLike(filters.query)}%`);
  }

  // Data rozstrzyga remisy takze w rankingu, zeby kolejnosc byla stabilna miedzy
  // odswiezeniami; bez tego dwie oceny 5/5 zmienialyby miejsca losowo.
  const sorted =
    order === "ranked"
      ? filtered.order("rating", { ascending: false }).order("created_at", { ascending: false })
      : filtered.order("created_at", { ascending: false });

  const ordered = sorted.limit(RESULT_LIMIT);

  const { data, error } = await ordered;
  if (error) {
    // Ustalenie F2 przegladu. Zwracany KSZTALT zostaje pusty — strona ma sie
    // wyrenderowac — ale awaria musi zostawic slad. Bez tego niedostepna baza dawala
    // "Nie masz jeszcze zadnych generacji.", czyli TE SAMA kategorie klamstwa, ktora
    // ta zmiana naprawila dla filtrow, i nie bylo tego widac nigdzie.
    logApiError("generations/list", "INTERNAL", error);
  }
  return data ?? [];
}

/** Historia: wszystko, od najnowszego. */
export async function fetchHistory(supabase: Client) {
  return fetchGenerations(supabase);
}

/**
 * Ranking jednego formatu: od najwyzej ocenionych.
 *
 * Nieocenione pozycje sa POMIJANE, nie wyswietlane na koncu — ranking pozycji bez
 * ocen nie jest rankingiem. `minRating: 1` realizuje to samo co dawne
 * `.not("rating", "is", null)`, bo constraint dopuszcza tylko 1-5.
 */
export async function fetchRanking(supabase: Client, format: GenerationFormat) {
  return fetchGenerations(supabase, { filters: { format, minRating: 1 }, order: "ranked" });
}

/** Ulubione: oznaczone, od najnowszego. */
export async function fetchFavourites(supabase: Client) {
  return fetchGenerations(supabase, { filters: { favourite: true } });
}

/**
 * Jedna pozycja po identyfikatorze — zrodlo dla okna pozycji pod `?open=`.
 *
 * Istnieje, bo do tej zmiany okno bylo szukane w JUZ POBRANEJ liscie. Po dodaniu
 * filtrow pozycja spoza filtra dawalaby 404, choc istnieje i nalezy do uzytkownika —
 * czyli 404 zaczelo by znaczyc "odfiltrowane" i zepsulo nierozroznialnosc cudzego,
 * nieistniejacego i niepoprawnego identyfikatora, ktorej wymagal plan S-05.
 *
 * BEZ filtra po `user_id`: cudza pozycje odcina RLS, nie kod. Filtr w kodzie dalby
 * ten sam wynik dla poprawnej polityki i ZAMASKOWAL bledna.
 *
 * `null` takze przy bledzie bazy, i to jest wybor: niepoprawny uuid konczy sie po
 * stronie Postgresa bledem (`invalid input syntax for type uuid`), a propagowanie go
 * dalej dalo by 500 zamiast 404 i rozroznilo "niepoprawny" od "nie istnieje".
 * Blad jest POCHLANIANY, ale NIE MILCZACY — ustalenie F2 przegladu. Do tej poprawki
 * nie zostawial sladu nigdzie, wiec niedostepna baza wygladala jak "nie ma takiej
 * pozycji" i nie dalo sie tego odroznic po fakcie. Ekran nadal nie rozroznia tych
 * przypadkow, bo nie moze — ale log rozroznia.
 */
export async function fetchGenerationById(supabase: Client, id: string) {
  const { data, error } = await supabase.from("generations").select(LIST_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    logApiError("generations/byId", "INTERNAL", error);
    return null;
  }
  return data;
}

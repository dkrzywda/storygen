import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";
import { fetchGenerationById, fetchGenerations } from "@/lib/generations";

/**
 * R-05 z `context/foundation/test-plan.md` — jedyne ryzyko oznaczone jako krytyczne.
 *
 * Polityki RLS zyja w bazie, nie w kodzie, wiec test jednostkowy nie moze ich dotknac.
 * Ten zestaw sprawdza SAMA POLITYKE, jeszcze bez endpointu: gdyby szedl po endpointcie,
 * zielony wynik moglby oznaczac poprawny handler postawiony na dziurawej polityce.
 *
 * Wymaga `npx supabase start`. Uruchamiany przez `npm run test:integration`.
 *
 * CO TEN ZESTAW WYKRYWA, A CZEGO NIE — sprawdzone eksperymentalnie 2026-09-03.
 * Postgres wymaga spelnienia polityki SELECT takze przy `UPDATE ... WHERE`, bo
 * instrukcja czyta istniejace wiersze. Skutek: rozszerzenie samej polityki UPDATE
 * do `using (true)` NIE robi tych testow czerwonymi — Boba nadal blokuje polityka
 * odczytu. Czerwone robia sie dopiero, gdy rozszerzone sa OBIE polityki.
 *
 * Gwarancja izolacji jest przez to nienaruszona (samo UPDATE nie wystawia danych),
 * ale nie czytaj tego zestawu jako dowodu na poprawnosc polityki UPDATE w oderwaniu
 * od SELECT. Dowodzi on, ze zadna kombinacja polityk nie odslania cudzych danych.
 *
 * TA SAMA PULAPKA DOTYCZY DELETE. `delete ... where` rowniez czyta wiersze, zanim je
 * usunie, wiec rozszerzenie samej polityki `delete` nie zrobi tego zestawu czerwonym.
 * Czerwony wynik pojawia sie dopiero przy rozszerzeniu `delete` i `select` razem.
 *
 * Od S-06 istnieje polityka DELETE, wiec przypadki usuwania sprzataja po sobie wlasne
 * wiersze. Pozostale zostaja: kazdy przebieg zaklada swiezych uzytkownikow, wiec przebiegi
 * sie nie mieszaja, a kumulacje czysci `npx supabase db reset`.
 */

/*
 * Typy Cloudflare (`worker-configuration.d.ts`, generowane przez `npx wrangler types`)
 * deklaruja `process.env.X` jako nie-opcjonalne, wiec ESLint uwaza `??` za zbedne.
 * Typy klamia: bez ustawionych zmiennych srodowiskowych te wartosci sa `undefined`
 * i test musi miec wartosc domyslna. Usuniecie `??` dla lintera zepsuloby test,
 * dlatego regula jest wyciszona tutaj, a nie kod naprawiony pod nia. Ustalenie F9.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

/**
 * Dwie bariery przeciw falszywemu zielonemu wynikowi.
 *
 * 1. Nielokalna baza — test nigdy nie moze pojsc na produkcje.
 * 2. Klucz sekretny — `service_role` OMIJA RLS, wiec test przeszedlby takze przy
 *    polityce dopuszczajacej wszystkich. To dokladnie ten blad, ktory `deploy-plan.md`
 *    trzyma jako bramke ludzka.
 */
function assertSafeTestTarget(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Test integracyjny odmawia uruchomienia przeciwko nielokalnej bazie: ${host}`);
  }
  if (SUPABASE_KEY.startsWith("sb_secret_") || SUPABASE_KEY.includes("service_role")) {
    throw new Error(
      "Test integracyjny wymaga klucza publishable/anon. Klucz service_role omija RLS, " +
        "wiec test przeszedlby takze przy dziurawej polityce.",
    );
  }
}

async function signUpFreshUser(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
  const email = `rls-${crypto.randomUUID()}@example.test`;
  const { error } = await client.auth.signUp({ email, password: "Testowe-haslo-123" });
  if (error) {
    throw new Error(`Nie udalo sie zalozyc konta testowego: ${error.message || "brak tresci bledu"}`);
  }
  return client;
}

/** Sesja musi istniec — bez niej test sprawdzalby zachowanie anonima, nie izolacje kont. */
async function requireUserId(client: SupabaseClient<Database>): Promise<string> {
  const { data } = await client.auth.getUser();
  const id = data.user?.id;
  if (!id) {
    throw new Error("Konto testowe nie ma sesji — rejestracja nie zwrocila uzytkownika.");
  }
  return id;
}

describe("izolacja kont na tabeli generations (R-05)", () => {
  let alice: SupabaseClient<Database>;
  let bob: SupabaseClient<Database>;
  let aliceId: string;
  let aliceRowId: string;

  beforeAll(async () => {
    assertSafeTestTarget();
    [alice, bob] = await Promise.all([signUpFreshUser(), signUpFreshUser()]);
    aliceId = await requireUserId(alice);

    const { data, error } = await alice
      .from("generations")
      .insert({
        user_id: aliceId,
        topic: "koty programistow",
        format: "joke",
        length_preset: "short",
        content: "Dlaczego kot nie uzywa debuggera? Bo sam jest bledem.",
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Alice nie zapisala wlasnego wiersza: ${error.message || "brak tresci bledu"}`);
    }
    aliceRowId = data.id;
  });

  // Kontrola pozytywna. Bez niej zielony wynik testu izolacji moglby oznaczac,
  // ze aktualizacja nie dziala dla NIKOGO.
  it("Alice zmienia tytul wlasnego wiersza", async () => {
    const { data, error } = await alice
      .from("generations")
      .update({ title: "Moj ulubiony" })
      .eq("id", aliceRowId)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].title).toBe("Moj ulubiony");
  });

  it("Bob nie zmienia tytulu cudzego wiersza", async () => {
    const { data, error } = await bob
      .from("generations")
      .update({ title: "Przejete przez Boba" })
      .eq("id", aliceRowId)
      .select();

    expect(error).toBeNull();
    // Zero zmienionych wierszy — RLS odfiltrowal cudzy, zanim doszlo do zapisu.
    expect(data).toHaveLength(0);
  });

  it("zmiana Boba nie dotarla do wiersza Alice", async () => {
    const { data } = await alice.from("generations").select("title").eq("id", aliceRowId).single();
    expect(data?.title).toBe("Moj ulubiony");
  });

  it("Bob nie widzi wiersza Alice przy odczycie", async () => {
    const { data, error } = await bob.from("generations").select().eq("id", aliceRowId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Bob nie zapisze wiersza na konto Alice", async () => {
    const { error } = await bob.from("generations").insert({
      user_id: aliceId,
      topic: "podszywanie sie",
      format: "joke",
      length_preset: "short",
      content: "Wiersz podrzucony przez Boba.",
    });

    // Polityka insert ma `with check` na wlasnym user_id, wiec baza odrzuca zapis.
    expect(error).not.toBeNull();
  });

  /**
   * Anonim (klient bez sesji) nie usuwa niczego. Ustalenie F6 przegladu.
   *
   * Pozostale przypadki uzywaja dwoch ZAREJESTROWANYCH kont, wiec ten jest jedynym,
   * ktory w ogole dotyka roli `anon`. ZMIERZONE 2026-09-07, co dokladnie dowodzi:
   * rozszerzenie SAMEJ polityki `delete` do `to public using (true)` NIE robi go
   * czerwonym — anonima nadal blokuje polityka SELECT, bo `delete ... where` czyta
   * wiersze. Czerwony pojawia sie dopiero przy rozszerzeniu obu. Czyli ma ten sam
   * zasieg dowodowy co reszta pliku: zadna kombinacja polityk nie wystawia usuwania
   * anonimowi — a nie: klauzula roli w polityce `delete` wziela osobno.
   *
   * WLASNY wiersz, nie `aliceRowId`: przy zepsutych politykach ten przypadek jako
   * pierwszy usunalby wspolny wiersz i "Bob nie usuwa cudzego" przeszedlby falszywie
   * (zero wierszy, bo juz ich nie ma). Zmierzone w tym samym eksperymencie.
   */
  it("anonim nie usuwa niczego", async () => {
    const { data: created, error: insertError } = await alice
      .from("generations")
      .insert({
        user_id: aliceId,
        topic: "cel dla anonima",
        format: "joke",
        length_preset: "short",
        content: "Wiersz, ktorego anonim nie ma prawa usunac.",
      })
      .select("id")
      .single();
    if (insertError) {
      throw new Error(`Alice nie zapisala wiersza dla anonima: ${insertError.message || "brak tresci bledu"}`);
    }

    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await anon.from("generations").delete().eq("id", created.id).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: still } = await alice.from("generations").select("id").eq("id", created.id);
    expect(still).toHaveLength(1);
  });

  it("Bob nie usuwa cudzego wiersza", async () => {
    const { data, error } = await bob.from("generations").delete().eq("id", aliceRowId).select();

    expect(error).toBeNull();
    // Zero usunietych wierszy — RLS odfiltrowal cudzy, zanim doszlo do usuniecia.
    // Baza nie rzuca bledem, dokladnie tak jak przy update.
    expect(data).toHaveLength(0);
  });

  it("wiersz Alice przetrwal probe Boba", async () => {
    const { data, error } = await alice.from("generations").select("id").eq("id", aliceRowId).single();

    expect(error).toBeNull();
    expect(data?.id).toBe(aliceRowId);
  });

  // Kontrola pozytywna. Bez niej zielony wynik moglby oznaczac, ze usuwanie nie dziala
  // dla NIKOGO — czyli ze polityka `delete` nie istnieje, tak jak przed S-06.
  //
  // Przypadek zaklada WLASNY wiersz, nie uzywa `aliceRowId`: usuniecie wspolnego wiersza
  // zabraloby dane pozostalym przypadkom, a wtedy dopisanie czegokolwiek ponizej cicho
  // psuloby zestaw, zaleznie od kolejnosci deklaracji w pliku.
  it("Alice usuwa wlasny wiersz", async () => {
    const { data: created, error: insertError } = await alice
      .from("generations")
      .insert({
        user_id: aliceId,
        topic: "wiersz do usuniecia",
        format: "joke",
        length_preset: "short",
        content: "Ten wiersz istnieje wylacznie po to, zeby zostac usunietym.",
      })
      .select("id")
      .single();

    // Rzut, nie asercja non-null: bez wiersza ten przypadek nie ma czego dowodzic,
    // a `strictTypeChecked` zabrania `!`. Wzorzec z `beforeAll` w tym pliku — po
    // sprawdzeniu bledu `created` jest juz nie-null, bo klient typuje wynik jako unie.
    if (insertError) {
      throw new Error(`Alice nie zapisala wiersza do usuniecia: ${insertError.message || "brak tresci bledu"}`);
    }
    const rowId = created.id;

    const { data, error } = await alice.from("generations").delete().eq("id", rowId).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await alice.from("generations").select("id").eq("id", rowId);
    expect(after).toHaveLength(0);
  });
});

/**
 * FILTRY HISTORII A IZOLACJA KONT — dopisane przez `history-filters`.
 *
 * Roadmapa nazywa kazdy nowy odczyt nowa okazja do obejscia RLS filtrem w kodzie,
 * a ta zmiana dodaje dwie sciezki: `fetchGenerations` z filtrami i `fetchGenerationById`.
 * Naturalnym odruchem przy pisaniu filtra jest dopisanie `.eq("user_id", …)` obok
 * `.eq("format", …)` — dalo by to ten sam wynik dla poprawnej polityki i ZAMASKOWALO
 * bledna, czyli odebralo temu plikowi sile dowodowa.
 *
 * Przypadki wolaja PRAWDZIWE funkcje z `@/lib/generations`, nie odtworzone zapytania.
 * Odtworzenie sprawdzaloby test, nie produkt — a ucieczka znakow `LIKE` zyje wlasnie
 * wewnatrz `fetchGenerations` i inaczej nie byla by tu w ogole dotknieta.
 *
 * Wlasne konta, nie te z bloku R-05: tamten plik ostrzega, ze wspoldzielony wiersz
 * wiaze przypadki kolejnoscia deklaracji.
 */
describe("filtry historii nie omijaja izolacji kont (R-05)", () => {
  let owner: SupabaseClient<Database>;
  let stranger: SupabaseClient<Database>;
  let ownerId: string;
  let matchingRowId: string;

  /** Temat z LITERALNYM `%` — dowod, ze ucieczka dziala na prawdziwym zapytaniu. */
  const TOPIC_WITH_WILDCARD = "100%_pewne koty";

  beforeAll(async () => {
    assertSafeTestTarget();
    [owner, stranger] = await Promise.all([signUpFreshUser(), signUpFreshUser()]);
    ownerId = await requireUserId(owner);

    const { data, error } = await owner
      .from("generations")
      .insert([
        {
          user_id: ownerId,
          topic: TOPIC_WITH_WILDCARD,
          format: "story",
          length_preset: "short",
          content: "Kot byl pewny swojego. Reszta swiata dopiero sie dostosowywala.",
          rating: 5,
          is_favourite: true,
        },
        {
          user_id: ownerId,
          topic: "psy w biurze",
          format: "joke",
          length_preset: "short",
          content: "Pies przyszedl na standup i jako jedyny mial cos konkretnego do powiedzenia.",
          rating: 1,
          is_favourite: false,
        },
      ])
      .select("id, topic");

    if (error) {
      throw new Error(`Wlasciciel nie zapisal wierszy: ${error.message || "brak tresci bledu"}`);
    }
    const matching = data.find((row) => row.topic === TOPIC_WITH_WILDCARD);
    if (!matching) {
      throw new Error("Nie znaleziono wiersza z wieloznacznikiem w temacie");
    }
    matchingRowId = matching.id;
  });

  describe("kontrola pozytywna — filtr musi cokolwiek przepuszczac", () => {
    /*
     * Bez tych przypadkow zielony wynik izolacji ponizej moglby znaczyc, ze filtr nie
     * przepuszcza NIKOGO — czyli ze jest zepsuty, a nie ze chroni.
     */
    it("wlasciciel widzi swoj wiersz przez filtr formatu", async () => {
      const rows = await fetchGenerations(owner, { filters: { format: "story" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].topic).toBe(TOPIC_WITH_WILDCARD);
    });

    it("wlasciciel widzi swoj wiersz przez wszystkie filtry razem", async () => {
      const rows = await fetchGenerations(owner, {
        filters: { format: "story", minRating: 5, favourite: true, query: "pewne" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(matchingRowId);
    });

    it("filtr oceny odsiewa wlasny wiersz o nizszej ocenie", async () => {
      const rows = await fetchGenerations(owner, { filters: { minRating: 5 } });
      expect(rows).toHaveLength(1);
      expect(rows[0].topic).toBe(TOPIC_WITH_WILDCARD);
    });

    /*
     * UCIECZKA ZNAKOW NA PRAWDZIWYM ZAPYTANIU. Bez niej `%` byloby wieloznacznikiem
     * i fraza dopasowalaby OBA wiersze wlasciciela. Z ucieczka dopasowuje ten jeden,
     * ktory ma literalny procent w temacie.
     */
    it("fraza z `%` dopasowuje literalny znak, nie wszystko", async () => {
      const rows = await fetchGenerations(owner, { filters: { query: "%" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].topic).toBe(TOPIC_WITH_WILDCARD);
    });

    it("fraza z `_` tez jest traktowana literalnie", async () => {
      const rows = await fetchGenerations(owner, { filters: { query: "%_pewne" } });
      expect(rows).toHaveLength(1);
    });

    /*
     * GWIAZDKA NA PRAWDZIWYM ZAPYTANIU — ustalenie F1 przegladu.
     *
     * PostgREST ma wlasna warstwe wieloznacznikow nad SQL-em i przepisywal `*` na `%`,
     * czyli na "dowolny CIAG". Po poprawce `*` schodzi do `_`, czyli "dowolny JEDEN
     * znak". Temat wlasciciela to "100%_pewne koty", wiec miedzy "100" i "pewne" stoja
     * DWA znaki (`%` i `_`):
     *
     *   przed poprawka: `100%pewne` — pasuje (dowolny ciag)
     *   po poprawce:    `100_pewne` — NIE pasuje (jeden znak, a stoja dwa)
     *
     * To jest przypadek rozrozniajacy: przed poprawka byl zielony przy zlym zachowaniu.
     */
    it("gwiazdka pasuje do jednego znaku, nie do dowolnego ciagu", async () => {
      const rows = await fetchGenerations(owner, { filters: { query: "100*pewne" } });
      expect(rows).toHaveLength(0);
    });

    // Kontrola pozytywna do powyzszego: literalny `%`, potem dowolny JEDEN znak, potem
    // "pewne" — dopasowuje sie, wiec gwiazdka nadal jest uzytecznym wieloznacznikiem.
    it("gwiazdka laczy sie z literalnym procentem", async () => {
      const rows = await fetchGenerations(owner, { filters: { query: "100%*pewne" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].topic).toBe(TOPIC_WITH_WILDCARD);
    });
  });

  describe("izolacja — obcy nie widzi nic, przy zadnym filtrze", () => {
    it.each([
      ["bez filtra", {}],
      ["format", { format: "story" as const }],
      ["ocena", { minRating: 1 }],
      ["ulubione", { favourite: true as const }],
      ["fraza", { query: "pewne" }],
      ["fraza z wieloznacznikiem", { query: "%" }],
      ["wszystkie razem", { format: "story" as const, minRating: 5, favourite: true as const, query: "pewne" }],
    ])("obcy nie widzi wierszy wlasciciela: %s", async (_opis, filters) => {
      const rows = await fetchGenerations(stranger, { filters });
      expect(rows).toHaveLength(0);
    });
  });

  describe("odczyt po identyfikatorze", () => {
    it("wlasciciel odczytuje swoj wiersz", async () => {
      const row = await fetchGenerationById(owner, matchingRowId);
      expect(row?.id).toBe(matchingRowId);
    });

    /*
     * Sedno tej sciezki: `fetchGenerationById` NIE filtruje po `user_id`, wiec jedyne,
     * co odcina cudzy wiersz, to polityka SELECT. Gdyby byla zbyt szeroka, ten przypadek
     * zapali sie na czerwono — i to jest cala jego wartosc.
     */
    it("obcy nie odczyta wiersza wlasciciela", async () => {
      const row = await fetchGenerationById(stranger, matchingRowId);
      expect(row).toBeNull();
    });

    it("nieistniejacy identyfikator daje null, nie blad", async () => {
      const row = await fetchGenerationById(owner, "00000000-0000-0000-0000-000000000000");
      expect(row).toBeNull();
    });

    /*
     * NIEPOPRAWNY SKLADNIOWO identyfikator. Postgres odpowiada bledem
     * (`invalid input syntax for type uuid`), a propagowanie go dalo by 500 zamiast 404
     * i ROZROZNILO "niepoprawny" od "nie istnieje" — czego plan S-05 zakazuje, bo
     * rozroznienie potwierdza istnienie cudzego rekordu.
     */
    it("niepoprawny uuid daje null, a nie wyjatek", async () => {
      await expect(fetchGenerationById(owner, "nie-jest-uuidem")).resolves.toBeNull();
    });
  });
});

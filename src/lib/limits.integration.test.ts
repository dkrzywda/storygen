import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * R-07 z `context/foundation/test-plan.md` — czesc zyjaca w bazie.
 *
 * Od ustalenia F2 przegladu ten plik niesie **cala decyzje o limicie**, nie tylko jej
 * otoczenie. Liczenie, decyzja i zapis wchodza do jednej serializowanej instrukcji
 * `public.record_attempt_if_allowed()`, a progi 10 i 30 mieszkaja w SQL, bo parametrem
 * dalyby sie obejsc. Testowi jednostkowemu zostalo tlumaczenie odpowiedzi bramki
 * (`src/lib/limits.test.ts`) — wszystko inne jest tutaj: polityki RLS, wyjatki
 * `security definer`, progi, arytmetyka doby i sama egzekucja limitu.
 *
 * Wymaga `npx supabase start`. Uruchamiany przez `npm run test:integration`.
 *
 * NAJWAZNIEJSZY PRZYPADEK W TYM PLIKU to nie izolacja, tylko **zasieg wyjatku**:
 * `usage_today()` ma widziec cudze proby w `app_count` (bo tego wymaga FR-013)
 * i JEDNOCZESNIE nie wystawiac o nich niczego wiecej. Jedno bez drugiego znaczy
 * albo martwy sufit, albo dziure w izolacji kont.
 *
 * Osobno pilnowany jest regres z 2026-09-07: `revoke execute ... from public` NIE
 * odbieral uprawnienia roli `anon`, bo Supabase doklada jawne granty przez
 * `alter default privileges`. Bez wymienienia rol z nazwy niezalogowany odczytywal
 * `app_count` przez PostgREST. Przypadek "anonim nie wywola licznika" jest tego straznikiem.
 *
 * CZEGO TEN ZESTAW NIE DOWODZI: nie uruchamia prawdziwej wspolbieznosci. Wyscig
 * zamknela blokada doradcza w `record_attempt_if_allowed()`, ale dowodem na to jest
 * ksztalt funkcji, nie test — rzetelne sprawdzenie wymagaloby rownoleglych polaczen
 * i mierzenia, ile z nich przeszlo, czego ten runner nie robi.
 */

/*
 * Typy Cloudflare (`worker-configuration.d.ts`) deklaruja `process.env.X` jako
 * nie-opcjonalne, wiec ESLint uwaza `??` za zbedne. Typy klamia: bez ustawionych
 * zmiennych srodowiskowych te wartosci sa `undefined`. Ten sam wyciszony przypadek
 * co w `generations.integration.test.ts`.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

/**
 * Dwie bariery przeciw falszywemu zielonemu wynikowi — skopiowane z zestawu R-05,
 * bo ten sam blad przekreslilby ten plik tak samo.
 *
 * 1. Nielokalna baza — test nigdy nie moze pojsc na produkcje.
 * 2. Klucz sekretny — `service_role` OMIJA RLS, wiec test przeszedlby takze przy
 *    polityce dopuszczajacej wszystkich.
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
  const email = `limits-${crypto.randomUUID()}@example.test`;
  const { error } = await client.auth.signUp({ email, password: "Testowe-haslo-123" });
  if (error) {
    throw new Error(`Nie udalo sie zalozyc konta testowego: ${error.message || "brak tresci bledu"}`);
  }
  return client;
}

async function requireUserId(client: SupabaseClient<Database>): Promise<string> {
  const { data } = await client.auth.getUser();
  const id = data.user?.id;
  if (!id) {
    throw new Error("Konto testowe nie ma sesji — rejestracja nie zwrocila uzytkownika.");
  }
  return id;
}

/**
 * Odczekanie na rozjazd zegarow miedzy kontenerami.
 *
 * ZMIERZONE 2026-09-07: kontener `auth` potrafi chodzic o sekunde do przodu wzgledem
 * bazy i PostgREST-a. Swiezo wystawiony token ma wtedy `iat` w przyszlosci i pierwsze
 * zapytanie wraca bledem "JWT issued at future". Zestaw R-05 tego nie widzi tylko
 * dlatego, ze miedzy rejestracja a pierwszym zapytaniem robi wiecej pracy.
 *
 * To wada srodowiska, nie polityk — ale bez tego ten plik jest rzutem moneta, a test,
 * ktory czasem swieci na czerwono bez powodu, przestaje byc dowodem czegokolwiek.
 *
 * Petla jest WASKA CELOWO: ponawia wylacznie ten jeden komunikat i tylko przez chwile.
 * Kazdy inny blad wychodzi z niej natychmiast i wywraca test tam, gdzie powinien.
 */
async function settleAuth(client: SupabaseClient<Database>): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await client.rpc("usage_today");
    // Optional chain, nie `!error || …` — brak bledu i blad o innej tresci wychodza
    // tu tak samo, a `error?.message` zwija sie do `undefined`, gdy bledu nie ma.
    if (!error?.message.includes("JWT issued at future")) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
  }
}

interface Usage {
  own_count: number;
  app_count: number;
  own_limit: number;
  app_limit: number;
  resets_at: string;
}

async function readUsage(client: SupabaseClient<Database>): Promise<Usage> {
  const { data, error } = await client.rpc("usage_today");
  if (error) {
    throw new Error(`usage_today() zawiodlo: ${error.message || "brak tresci bledu"}`);
  }
  const row = data.at(0);
  if (!row) {
    throw new Error("usage_today() nie zwrocilo wiersza");
  }
  return row;
}

/** Ile prob Alice dokladamy w `beforeAll`. Dowolna liczba > 1, zeby delta nie mogla byc przypadkiem. */
const ALICE_ATTEMPTS_TODAY = 3;

describe("licznik prob i wyjatek od RLS (R-07)", () => {
  let alice: SupabaseClient<Database>;
  let bob: SupabaseClient<Database>;
  let aliceId: string;
  let bobId: string;
  let aliceRowId: string;
  let appCountBefore: number;

  beforeAll(async () => {
    assertSafeTestTarget();
    [alice, bob] = await Promise.all([signUpFreshUser(), signUpFreshUser()]);
    [aliceId, bobId] = await Promise.all([requireUserId(alice), requireUserId(bob)]);
    await Promise.all([settleAuth(alice), settleAuth(bob)]);

    // Baza jest wspoldzielona miedzy przebiegami, wiec `app_count` NIE moze byc
    // sprawdzany wartoscia bezwzgledna — tylko przyrostem wzgledem tego punktu.
    const baseline = await readUsage(bob);
    appCountBefore = baseline.app_count;

    /*
     * WARUNEK WSTEPNY, nie ostroznosc. Ten zestaw ZUZYWA dzienny sufit aplikacji —
     * okolo 15 miejsc z 30 na przebieg — a wyzerowac go z klienta NIE DA SIE, bo tabela
     * prob nie ma polityki DELETE (to jest jej mechanizm, nie brak). Drugi przebieg tego
     * samego dnia jeszcze przejdzie, trzeci juz nie.
     *
     * Bez tego sprawdzenia trzeci przebieg wywracalby sie w `beforeAll` na zapisie proby
     * z komunikatem o niczym. Tutaj mowi wprost, co zrobic.
     */
    const budgetNeeded = ALICE_ATTEMPTS_TODAY + baseline.own_limit + 3;
    const budgetFree = baseline.app_limit - baseline.app_count;
    if (budgetFree < budgetNeeded) {
      throw new Error(
        `Zestaw potrzebuje ${String(budgetNeeded)} wolnych miejsc w dziennym sufcie aplikacji, ` +
          `a wolnych jest ${String(budgetFree)} z ${String(baseline.app_limit)}. ` +
          "Licznika nie da sie wyzerowac z klienta (brak polityki DELETE) — " +
          "uruchom `npx supabase db reset` przed testami.",
      );
    }

    // Zapis idzie przez RPC, bo od ustalenia F1 przegladu klient NIE MA prawa pisac
    // do tabeli wprost — patrz `20260907221126_harden_generation_attempts.sql`.
    for (let i = 0; i < ALICE_ATTEMPTS_TODAY; i += 1) {
      const { error } = await alice.rpc("record_attempt_if_allowed", { p_format: "joke" });
      if (error) {
        throw new Error(`Alice nie zapisala proby: ${error.message || "brak tresci bledu"}`);
      }
    }

    const { data, error } = await alice.from("generation_attempts").select("id").limit(1).single();
    if (error) {
      throw new Error(`Alice nie odczytala wlasnej proby: ${error.message || "brak tresci bledu"}`);
    }
    aliceRowId = data.id;
  });

  describe("polityki tabeli", () => {
    // Kontrola pozytywna. Bez niej zielony wynik izolacji moglby znaczyc, ze zapis
    // nie dziala dla NIKOGO.
    it("Alice widzi wlasne proby", async () => {
      const { data, error } = await alice.from("generation_attempts").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(ALICE_ATTEMPTS_TODAY);
    });

    it("Bob nie widzi prob Alice", async () => {
      const { data, error } = await bob.from("generation_attempts").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    /*
     * STRAZNIK USTALENIA F1 PRZEGLADU — najwazniejszy przypadek w tej sekcji.
     *
     * Dopoki `authenticated` mial `grant insert` na tej tabeli, mogl podac WLASNY
     * `created_at`. Wiersz z data w przyszlosci liczyl sie do biezacej doby bez konca
     * (funkcja nie miala gornej granicy okna), a usunac go nie mogl nikt, bo polityki
     * DELETE nie ma i nie ma klienta `service_role`. Trzydziesci wstawien z dowolnego
     * konta blokowalo generowanie WSZYSTKIM bezterminowo. Zmierzone 2026-09-07:
     * app_count 24 → wiersz z data 2030 → 25, `DELETE 0`.
     *
     * Prawo zapisu zostalo odebrane, wiec caly ten atak jest teraz niekonstruowalny.
     */
    it("zalogowany nie zapisze wprost do tabeli, nawet na wlasne konto", async () => {
      const { error } = await alice.from("generation_attempts").insert({ user_id: aliceId, format: "joke" });
      expect(error).not.toBeNull();
    });

    it("zalogowany nie zapisze wprost wiersza z data w przyszlosci", async () => {
      const { error } = await alice.from("generation_attempts").insert({
        user_id: aliceId,
        format: "joke",
        created_at: "2030-01-01T00:00:00Z",
      });
      expect(error).not.toBeNull();
    });

    it("anonim nie zapisze proby", async () => {
      const anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
      const { error } = await anon.rpc("record_attempt_if_allowed", { p_format: "joke" });
      expect(error).not.toBeNull();
    });

    /*
     * Dwa przypadki ponizej sa sercem mechanizmu limitu: konto NIE MOZE obnizyc
     * wlasnego zuzycia. Nie chodzi o izolacje od cudzych danych, tylko o to, ze
     * na tej tabeli nie ma polityk UPDATE i DELETE dla NIKOGO — takze dla wlasciciela.
     */
    it("Alice nie zmieni wlasnej proby", async () => {
      const { data, error } = await alice
        .from("generation_attempts")
        .update({ format: "story" })
        .eq("id", aliceRowId)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("Alice nie usunie wlasnej proby", async () => {
      const { data, error } = await alice.from("generation_attempts").delete().eq("id", aliceRowId).select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proby Alice nadal sa po jej wlasnych probach zmiany i usuniecia", async () => {
      const { data } = await alice.from("generation_attempts").select("id, format");
      expect(data).toHaveLength(ALICE_ATTEMPTS_TODAY);
      expect(data?.every((row) => row.format === "joke")).toBe(true);
    });
  });

  describe("zasieg wyjatku security definer", () => {
    it("Bob widzi proby Alice w app_count", async () => {
      const usage = await readUsage(bob);
      // To jest CALY powod istnienia wyjatku od RLS: FR-013 liczy w poprzek kont.
      expect(usage.app_count).toBe(appCountBefore + ALICE_ATTEMPTS_TODAY);
    });

    it("Bob nie widzi prob Alice w own_count", async () => {
      const usage = await readUsage(bob);
      // I to jest granica tego wyjatku. Gdyby `own_count` liczyl wszystko, sufit
      // aplikacji zjadalby limity pojedynczych kont.
      expect(usage.own_count).toBe(0);
    });

    it("Alice widzi wlasne proby w own_count", async () => {
      const usage = await readUsage(alice);
      expect(usage.own_count).toBe(ALICE_ATTEMPTS_TODAY);
    });

    it("funkcja zwraca wylacznie skalary — zadnego identyfikatora ani tresci", async () => {
      const usage = await readUsage(bob);
      // Wyjatek od RLS oddaje LICZBY. Nowe pole w tej funkcji to nowa powierzchnia
      // wycieku, wiec ksztalt jest tu pilnowany wprost, a nie przez typy.
      expect(Object.keys(usage).sort()).toEqual(["app_count", "app_limit", "own_count", "own_limit", "resets_at"]);
    });

    /*
     * Progi przyszly z baza, nie z TypeScriptu — ustalenie F2. Gdyby interfejs czytal
     * wlasne stale, a baza egzekwowala swoje, rozjazd ujawnilby sie dopiero jako odmowa
     * przy liczniku pokazujacym wolne miejsce.
     */
    it("funkcja zwraca obowiazujace progi, a nie tylko liczniki", async () => {
      const usage = await readUsage(alice);
      expect(usage.own_limit).toBeGreaterThan(0);
      expect(usage.app_limit).toBeGreaterThan(0);
      // Zalozenie projektowe FR-012: prog na konto jest ulamkiem sufitu, inaczej jedno
      // konto zjada cala aplikacje i prog przestaje byc granica sprawiedliwosci.
      expect(usage.own_limit).toBeLessThan(usage.app_limit);
    });

    /*
     * Straznik regresu zmierzonego 2026-09-07: samo `revoke ... from public` zostawialo
     * `anon` z prawem wykonania, bo Supabase nadaje je jawnie przez `alter default
     * privileges`. Niezalogowany odczytywal wtedy `app_count` przez PostgREST.
     */
    it("anonim nie wywola licznika", async () => {
      const anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
      const { error } = await anon.rpc("usage_today");
      expect(error).not.toBeNull();
    });
  });

  describe("granica doby (Europe/Warsaw)", () => {
    /*
     * DO F1 STAL TU PRZYPADEK "proba sprzed lokalnej polnocy nie liczy sie do dzisiejszej
     * doby". Wstawial wiersz z wlasnym `created_at` — czyli robil dokladnie to, co
     * okazalo sie luka, tyle ze w niegrozna strone. Po odebraniu klientom prawa zapisu
     * nie da sie go napisac, i to jest MOCNIEJSZA gwarancja niz test: jedynym pisarzem
     * jest `record_attempt()`, ktora uzywa `now()`, wiec wiersz poza biezaca doba nie
     * powstanie. Gorna granica okna (`created_at < ends_at`) zostaje w funkcji jako
     * druga warstwa i jest sprawdzalna tylko na poziomie bazy, nie przez tego klienta.
     *
     * Zostaje to, co z klienta widac: swiezo zapisana proba WCHODZI do biezacej doby.
     */
    it("swiezo zapisana proba liczy sie do biezacej doby", async () => {
      const before = await readUsage(alice);
      const { error } = await alice.rpc("record_attempt_if_allowed", { p_format: "joke" });
      expect(error).toBeNull();

      const after = await readUsage(alice);
      expect(after.own_count).toBe(before.own_count + 1);
      expect(after.app_count).toBe(before.app_count + 1);
    });

    it("moment odnowienia wypada o polnocy czasu warszawskiego", async () => {
      const usage = await readUsage(alice);
      const formatted = new Intl.DateTimeFormat("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Warsaw",
      }).format(new Date(usage.resets_at));

      // Podwojna konwersja `at time zone` w funkcji ma dawac LOKALNA polnoc.
      // Przy naiwnym `date_trunc` na UTC wyszlaby tu 01:00 albo 02:00.
      expect(formatted).toBe("00:00");
    });

    it("moment odnowienia lezy w przyszlosci i nie dalej niz za dobe", async () => {
      const usage = await readUsage(alice);
      const delta = new Date(usage.resets_at).getTime() - Date.now();
      expect(delta).toBeGreaterThan(0);
      // 25 h, nie 24 — doba przestawienia czasu jest dluzsza i to jest poprawne.
      expect(delta).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
    });
  });

  describe("uzytkownik bez prob", () => {
    it("Bob ma zerowe wlasne zuzycie", async () => {
      const usage = await readUsage(bob);
      expect(usage.own_count).toBe(0);
    });
  });

  /*
   * EGZEKUCJA LIMITU — od F2 to jest serce R-07 i zyje w calosci w bazie.
   *
   * Uzywa WLASNEGO, trzeciego konta: wyczerpanie limitu Alice albo Boba rozjechaloby
   * wszystkie wczesniejsze asercje o ich licznikach. Kosztuje `own_limit` miejsc
   * w dziennym sufcie aplikacji — stad warunek wstepny w `beforeAll`.
   */
  describe("egzekucja limitu na konto", () => {
    it("bramka przepuszcza do limitu, potem odmawia, a odmowa nie zapisuje proby", async () => {
      const carol = await signUpFreshUser();
      await settleAuth(carol);

      const { own_limit: ownLimit } = await readUsage(carol);

      for (let i = 0; i < ownLimit; i += 1) {
        const { data, error } = await carol.rpc("record_attempt_if_allowed", { p_format: "joke" });
        expect(error).toBeNull();
        expect(data).toBe("ok");
      }

      const { data: refused, error } = await carol.rpc("record_attempt_if_allowed", { p_format: "joke" });
      expect(error).toBeNull();
      expect(refused).toBe("DAILY_LIMIT_REACHED");

      // Odmowa NIE moze zajmowac miejsca. Gdyby zajmowala, kazda odbita proba
      // pogarszalaby sytuacje konta, ktore juz nic nie moze zrobic.
      const after = await readUsage(carol);
      expect(after.own_count).toBe(ownLimit);
    });
  });

  /*
   * Ten blok stoi OSTATNI celowo: jako jedyny dopisuje probe Bobowi, wiec uruchomiony
   * wczesniej rozjechalby wszystkie asercje o jego zerowym zuzyciu. Kolejnosc jest tu
   * warunkiem poprawnosci i dlatego jest napisana wprost, a nie zostawiona domyslnie.
   *
   * Zastepuje dwa przypadki sprzed F1 ("Bob nie zapisze na konto Alice" i odwrotnie).
   * Po odebraniu klientom prawa zapisu ta mozliwosc nie istnieje nawet do
   * przetestowania — `record_attempt` nie przyjmuje `user_id`. Sprawdzamy rzecz
   * rownowazna: ze funkcja przypisuje probe WOLAJACEMU.
   */
  describe("atrybucja zapisu przez record_attempt", () => {
    // Jeden przypadek, nie dwa: obie asercje musza patrzec na TEN SAM zapis Boba,
    // a rozbicie ich wiazaloby drugi przypadek z liczba prob Alice sprzed niego.
    it("proba trafia na konto wolajacego i nie rusza zuzycia innego konta", async () => {
      const aliceBefore = await readUsage(alice);

      const { error } = await bob.rpc("record_attempt_if_allowed", { p_format: "story" });
      expect(error).toBeNull();

      const { data } = await bob.from("generation_attempts").select("user_id, format");
      expect(data).toHaveLength(1);
      expect(data?.[0].user_id).toBe(bobId);
      expect(data?.[0].format).toBe("story");

      const aliceAfter = await readUsage(alice);
      expect(aliceAfter.own_count).toBe(aliceBefore.own_count);
    });
  });
});

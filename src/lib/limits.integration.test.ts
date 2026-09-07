import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * R-07 z `context/foundation/test-plan.md` — czesc zyjaca w bazie.
 *
 * Ryzyko ma dwie twarze. Decyzje bramki bierze `src/lib/limits.test.ts` (bez bazy).
 * Ten zestaw bierze to, czego test jednostkowy dotknac nie moze: polityki RLS nowej
 * tabeli, WYJATEK `security definer` i arytmetyke doby — wszystkie trzy zyja
 * w Postgresie, nie w TypeScripcie.
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
 * CZEGO TEN ZESTAW NIE DOWODZI: nie dotyka wyscigu dwoch rownoleglych zadan tego
 * samego konta. Odczyt licznika i zapis proby to dwie operacje, wiec oba zadania moga
 * zobaczyc ten sam stan i oba przejsc. Swiadomie niedomkniete — patrz plan, Open Risks.
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
    appCountBefore = (await readUsage(bob)).app_count;

    const rows = Array.from({ length: ALICE_ATTEMPTS_TODAY }, () => ({
      user_id: aliceId,
      format: "joke",
    }));
    const { data, error } = await alice.from("generation_attempts").insert(rows).select("id");
    if (error) {
      throw new Error(`Alice nie zapisala prob: ${error.message || "brak tresci bledu"}`);
    }
    aliceRowId = data[0].id;
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
     * Zapis na cudze konto jest tu grozniejszy niz w tabeli `generations`. Tam
     * podrzucony wiersz zasmieca komus historie. Tutaj PODNOSI CUDZY LICZNIK, czyli
     * pozwala zablokowac obcemu kontu generowanie na cala dobe — odmowa uslugi na
     * wybranej ofierze. Dlatego kierunek jest sprawdzany w obie strony, a nie raz.
     */
    it("Bob nie zapisze proby na konto Alice", async () => {
      const { error } = await bob.from("generation_attempts").insert({ user_id: aliceId, format: "joke" });
      // `with check (auth.uid() = user_id)` — baza odrzuca zapis, nie filtruje go po cichu.
      expect(error).not.toBeNull();
    });

    it("Alice nie zapisze proby na konto Boba", async () => {
      const { error } = await alice.from("generation_attempts").insert({ user_id: bobId, format: "story" });
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

    it("funkcja zwraca wylacznie trzy skalary — zadnego identyfikatora ani tresci", async () => {
      const usage = await readUsage(bob);
      // Wyjatek od RLS oddaje LICZBY. Nowe pole w tej funkcji to nowa powierzchnia
      // wycieku, wiec ksztalt jest tu pilnowany wprost, a nie przez typy.
      expect(Object.keys(usage).sort()).toEqual(["app_count", "own_count", "resets_at"]);
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
    it("proba sprzed lokalnej polnocy nie liczy sie do dzisiejszej doby", async () => {
      const before = await readUsage(alice);

      const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const { error } = await alice
        .from("generation_attempts")
        .insert({ user_id: aliceId, format: "story", created_at: yesterday });
      if (error) {
        throw new Error(`Alice nie zapisala wczorajszej proby: ${error.message || "brak tresci bledu"}`);
      }

      const after = await readUsage(alice);
      expect(after.own_count).toBe(before.own_count);
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
});

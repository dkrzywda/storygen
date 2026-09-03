import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";

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
 * Uwaga: brak polityki DELETE (powstanie z S-06) znaczy, ze wierszy nie da sie sprzatnac
 * po tescie. Kazdy przebieg zaklada swiezych uzytkownikow, wiec przebiegi sie nie mieszaja;
 * kumulacje czysci `npx supabase db reset`.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

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

  it("nikt nie usuwa wierszy — polityki delete nie ma", async () => {
    const { data, error } = await alice.from("generations").delete().eq("id", aliceRowId).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

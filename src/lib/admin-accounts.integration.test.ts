import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `R-09` z `context/foundation/test-plan.md` — granica przegladu kont (S-09, FR-014/FR-015).
 *
 * DRUGA FUNKCJA W TYM PROJEKCIE OMIJAJACA RLS, i o szerszym zasiegu niz pierwsza:
 * `accounts_overview()` czyta `auth.users` WSZYSTKICH kont. Bramka nie da sie wyrazic
 * grantem, bo rola admina jest DANYMI w `app_metadata`, nie rola bazodanowa — wiec
 * `authenticated` MA prawo wykonania, a o dostepie decyduje warunek w srodku funkcji.
 * Ten plik pilnuje wlasnie tego: ze prawo wykonania nie oznacza dostepu do danych.
 *
 * Wymaga `npx supabase start`. Uruchamiany przez `npm run test:integration`.
 *
 * CZEGO TEN ZESTAW NIE DOWODZI — swiadome luki, nie przeoczenia:
 *
 * 1. **Sciezki pozytywnej.** Zbudowanie konta Z ROLA wymaga zapisu do
 *    `auth.users.raw_app_meta_data`, na co klucz publishable nie ma prawa — a klucza
 *    `service_role` straznik ponizej odrzuca, bo omija RLS i uczynilby caly zestaw
 *    bezwartosciowym. Ze administrator dostaje wiersze, zmierzono recznie 2026-09-09
 *    (46 wierszy przed `db reset`, 1 po ponownej rejestracji).
 * 2. **Braku pol z trescia.** Dla konta bez roli wynik jest PUSTY, wiec nie ma czego
 *    obejrzec. Gwarancja jest STRUKTURALNA, nie testowa: funkcja zwraca piec kolumn
 *    (`email, registered_at, generations, used_today, own_limit`) i nie ma wsrod nich
 *    zadnej z `topic`, `title` ani `content`. Zmierzone w fazie 1 przez `proargnames`.
 */

/*
 * Typy Cloudflare (`worker-configuration.d.ts`) deklaruja `process.env.X` jako
 * nie-opcjonalne, wiec ESLint uwaza `??` za zbedne. Typy klamia: bez ustawionych
 * zmiennych srodowiskowych te wartosci sa `undefined`.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

/**
 * Dwie bariery przeciw falszywemu zielonemu wynikowi — skopiowane z zestawow R-05,
 * R-07 i R-08, bo ten sam blad przekreslilby ten plik tak samo.
 */
function assertSafeTestTarget(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Test integracyjny odmawia uruchomienia przeciwko nielokalnej bazie: ${host}`);
  }
  if (SUPABASE_KEY.startsWith("sb_secret_") || SUPABASE_KEY.includes("service_role")) {
    throw new Error(
      "Test integracyjny wymaga klucza publishable/anon. Klucz service_role omija RLS " +
        "i pozwolilby nadac role, czyli obszedlby dokladnie to, co ten plik sprawdza.",
    );
  }
}

async function signUpFreshUser(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
  const email = `overview-${crypto.randomUUID()}@example.test`;
  const { error } = await client.auth.signUp({ email, password: "Testowe-haslo-123" });
  if (error) {
    throw new Error(`Nie udalo sie zalozyc konta testowego: ${error.message || "brak tresci bledu"}`);
  }
  return client;
}

describe("granica przegladu kont (R-09)", () => {
  let bezRoli: SupabaseClient<Database>;

  beforeAll(async () => {
    assertSafeTestTarget();
    bezRoli = await signUpFreshUser();
  });

  it("konto bez roli dostaje ZERO wierszy, nie blad", async () => {
    // NAJWAZNIEJSZY PRZYPADEK. `authenticated` MA prawo wykonania tej funkcji —
    // inaczej administrator tez by go nie mial. O dostepie decyduje warunek w srodku,
    // a pusty zbior jest nieodroznialny od "brak kont", wiec nie ujawnia, ze przeglad
    // istnieje (FR-015). Wyjatek potwierdzalby jego istnienie kazdemu, kto zgadnie nazwe.
    const { data, error } = await bezRoli.rpc("accounts_overview");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anon nie wykona funkcji", async () => {
    // Regres zmierzony przy S-04: `revoke execute ... from public` NIE odbiera prawa
    // roli `anon`, bo Supabase dokłada jawne granty przez `alter default privileges`.
    // Bez wymienienia `anon` z nazwy niezalogowany wywolalby przeglad wszystkich kont.
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await anon.rpc("accounts_overview");

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("konto bez roli nie widzi cudzych kont, mimo ze one istnieja", async () => {
    // Kontrola przeciw testowi, ktory przechodzilby takze wtedy, gdyby baza byla pusta:
    // to konto samo istnieje, a mimo to jego wynik jest pusty. Bez tego przypadku
    // "zero wierszy" moglo by znaczyc "nie ma kont", a nie "nie masz dostepu".
    const { data: own } = await bezRoli.auth.getUser();
    expect(own.user).not.toBeNull();

    const { data } = await bezRoli.rpc("accounts_overview");
    expect(data).toEqual([]);
  });
});

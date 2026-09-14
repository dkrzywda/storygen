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
 *
 *    **ZAMKNIETE OD S-10 innym narzedziem**: `context/changes/admin-grant-role/`
 *    `test-set-account-role.sql` podszywa sie pod uzytkownika przez
 *    `request.jwt.claims` — z czego `auth.uid()` czyta — wiec mierzy sciezke
 *    pozytywna i bramke ostatniej roli bez zadnego klucza sekretnego. Trzynascie
 *    przypadkow; zdjecie bramki z funkcji czerwieni szesc z nich (zmierzone
 *    2026-09-09). Ten plik zostaje przy tym, co potrafi wyrazic klient JS.
 * 2. **Braku pol z trescia.** Dla konta bez roli wynik jest PUSTY, wiec nie ma czego
 *    obejrzec. Gwarancja jest STRUKTURALNA, nie testowa: funkcja zwraca DZIESIEC kolumn
 *    (`email, registered_at, generations, used_today, own_limit, row_limit, id, role,
 *    is_self, is_last_admin`) i nie ma wsrod nich zadnej z `topic`, `title` ani
 *    `content` — same liczby i metadane konta, zgodnie z granica zapisana przy FR-014.
 *
 *    ZAKTUALIZOWANE 2026-09-14 (ustalenie F8 przegladu S-10). Wczesniej ten akapit
 *    mowil o PIECIU kolumnach i wymienial je z czasow S-09, choc migracja S-10
 *    podniosla liczbe do dziesieciu. To jedyne miejsce w repo, gdzie zapisano dowod,
 *    ze przeglad nie wystawia tresci generacji — a aktualizacja czesciowa jest tu
 *    gorsza od braku, bo czytelnik widzi swiezo dotkniety blok i ufa calosci.
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

  it("konto bez roli nie nada roli SAMEMU SOBIE", async () => {
    // ESKALACJA UPRAWNIEN — najgrozniejsze wywolanie tej funkcji, i jedyne, ktore
    // konto bez roli moze zlozyc w calosci samo: zna wlasny identyfikator, wiec nie
    // potrzebuje niczyjego. Gdyby bramka nie dzialala, kazde konto w produkcie
    // mogloby zostac administratorem jednym wywolaniem PostgREST.
    const { data: own } = await bezRoli.auth.getUser();
    const id = own.user?.id;
    expect(id).toBeDefined();

    const { data, error } = await bezRoli.rpc("set_account_role", {
      p_account: id ?? "",
      p_role: "admin",
      p_confirm_last: false,
    });

    // Kod, nie wyjatek — endpoint mapuje go na 404, zeby nie potwierdzac istnienia
    // operacji (FR-015). `error` jest `null`, bo funkcja WYKONALA sie poprawnie.
    expect(error).toBeNull();
    expect(data).toBe("FORBIDDEN");

    // SKUTEK, NIE TYLKO ZWROT. Ta czesc jest istotniejsza od poprzedniej: gdyby
    // zapis mimo odmowy przeszedl, `getUser()` czyta `app_metadata` Z BAZY
    // (`GoTrueClient.js:2480` robi `GET /user` w obu galeziach), wiec zobaczylibysmy
    // tu role. A przeglad kont oddalby wiersze zamiast pustki.
    const { data: po } = await bezRoli.auth.getUser();
    expect(po.user?.app_metadata.role).toBeUndefined();

    const { data: przeglad } = await bezRoli.rpc("accounts_overview");
    expect(przeglad).toEqual([]);
  });

  it("anon nie wykona zmiany roli", async () => {
    // `set_account_role` jest funkcja NOWA i wlasnie dlatego dostaje domyslne granty
    // Supabase dla `anon`, `authenticated` i `service_role` — bez jawnego `revoke`
    // niezalogowany zmienilby role dowolnemu kontu.
    //
    // POPRAWIONE 2026-09-14 (ustalenie F9 przegladu S-10): komentarz mowil wczesniej
    // o `drop function` kasujacym granty PRZEGLADU, a ten test wola zmiane roli, ktora
    // nigdy nie byla dropowana. Powod byl wiec opisem sasiedniej sciezki — ta sama
    // klasa pomylki, ktora `lessons.md` nazywa "zmierzono mutacje innej funkcji".
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await anon.rpc("set_account_role", {
      p_account: "11111111-1111-1111-1111-111111111111",
      p_role: "admin",
      p_confirm_last: false,
    });

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

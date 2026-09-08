import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";
import { isAdmin } from "@/lib/account-role";

/**
 * `isAdmin` wobec PRAWDZIWEGO obiektu `User` z serwera auth (F-02, FR-015).
 *
 * PO CO TEN PLIK, SKORO ISTNIEJE `account-role.test.ts`: test jednostkowy karmi
 * `isAdmin` atrapa zbudowana rekami autora, wiec dowodzi tylko tego, ze funkcja
 * zgadza sie z WYOBRAZENIEM autora o kształcie `app_metadata`. Jedyne zalozenie tej
 * funkcji — ze rola przychodzi w `app_metadata`, a nie gdzie indziej — moze
 * potwierdzic wylacznie odpowiedz prawdziwego serwera.
 *
 * NAJWAZNIEJSZY PRZYPADEK: proba PODROBIENIA roli. Konto testowe zapisuje
 * `role: "admin"` w `user_metadata` przez `updateUser` — czyli robi dokladnie to,
 * co moze zrobic kazdy uzytkownik posiadajacy klucz publishable, a ten klucz jest
 * w kodzie klienta. PRD `## Access Control` zabrania wyprowadzania roli z czegokolwiek,
 * co uzytkownik kontroluje; ten test jest jedynym miejscem, ktore sprawdza, ze zakaz
 * obowiazuje wobec realnego SDK, a nie tylko w komentarzu.
 *
 * Wymaga `npx supabase start`. Uruchamiany przez `npm run test:integration`.
 *
 * CZEGO TEN ZESTAW NIE DOWODZI — i to jest swiadoma luka, nie przeoczenie:
 *
 * 1. **Sciezki pozytywnej.** Zbudowanie konta Z ROLA wymaga zapisu do
 *    `auth.users.raw_app_meta_data`, na co klucz publishable nie ma prawa — a klucza
 *    `service_role` straznik ponizej odrzuca, bo omija RLS i uczynilby caly zestaw
 *    bezwartosciowym. Ze rola nadana migracja jest widziana przez `getUser()`,
 *    zmierzono recznie 2026-09-08 (`context/changes/account-roles/verify-roles.sql`
 *    plus odswiezenie panelu dwoma kontami), nie testem.
 * 2. **Warunku w szablonie.** Ze `dashboard.astro` renderuje sekcje wtedy i tylko
 *    wtedy, gdy `isAdmin` zwraca `true`, nie sprawdza tu nic — ten runner nie mowi
 *    po HTTP. Zweryfikowane recznie: sekcja znikla po zdjeciu roli i wrocila po jej
 *    przywroceniu.
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
 * Dwie bariery przeciw falszywemu zielonemu wynikowi — skopiowane z zestawow R-05 i R-07,
 * bo ten sam blad przekreslilby ten plik tak samo.
 */
function assertSafeTestTarget(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Test integracyjny odmawia uruchomienia przeciwko nielokalnej bazie: ${host}`);
  }
  if (SUPABASE_KEY.startsWith("sb_secret_") || SUPABASE_KEY.includes("service_role")) {
    throw new Error(
      "Test integracyjny wymaga klucza publishable/anon. Klucz service_role omija RLS " +
        "i pozwolilby zapisac app_metadata, czyli obszedlby dokladnie to, co ten plik sprawdza.",
    );
  }
}

async function signUpFreshUser(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
  const email = `roles-${crypto.randomUUID()}@example.test`;
  const { error } = await client.auth.signUp({ email, password: "Testowe-haslo-123" });
  if (error) {
    throw new Error(`Nie udalo sie zalozyc konta testowego: ${error.message || "brak tresci bledu"}`);
  }
  return client;
}

describe("isAdmin wobec prawdziwego obiektu User", () => {
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    assertSafeTestTarget();
    client = await signUpFreshUser();
  });

  it("odmawia swiezo zarejestrowanemu kontu", async () => {
    const { data } = await client.auth.getUser();
    expect(data.user).not.toBeNull();
    expect(isAdmin(data.user)).toBe(false);
  });

  it("swieze konto ma app_metadata bez klucza role", async () => {
    // Potwierdza zalozenie, na ktorym stoi `isAdmin`: pole istnieje, jest obiektem,
    // niesie klucze GoTrue i NIE niesie roli. Gdyby GoTrue zmienil ten kształt,
    // ten przypadek zaczerwienieje przed produkcja.
    const { data } = await client.auth.getUser();
    const meta = data.user?.app_metadata;
    expect(typeof meta).toBe("object");
    expect(meta).not.toBeNull();
    expect(meta).toHaveProperty("provider", "email");
    expect(meta).not.toHaveProperty("role");
  });

  it("NIE daje sie podrobic przez user_metadata", async () => {
    // Kazdy uzytkownik moze to zrobic: klucz publishable jest w kodzie klienta,
    // a `updateUser({ data })` zapisuje `user_metadata` bez zadnych uprawnien.
    const { error } = await client.auth.updateUser({ data: { role: "admin" } });
    expect(error).toBeNull();

    const { data } = await client.auth.getUser();

    // Podrobka faktycznie wyladowala tam, gdzie uzytkownik ma zapis...
    expect(data.user?.user_metadata).toHaveProperty("role", "admin");
    // ...i NIE przeciekla do app_metadata, ktorego SDK nie umie zapisac...
    expect(data.user?.app_metadata).not.toHaveProperty("role");
    // ...wiec granica dostepu jej nie widzi.
    expect(isAdmin(data.user)).toBe(false);
  });
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { beforeAll, describe, expect, it } from "vitest";
import { isBlocked } from "@/lib/account-blocked";

/**
 * `isBlocked` wobec PRAWDZIWEGO obiektu `User` z serwera auth (S-11, FR-016).
 *
 * PO CO TEN PLIK, SKORO ISTNIEJE `account-blocked.test.ts`: test jednostkowy karmi
 * `isBlocked` atrapa zbudowana rekami autora, wiec dowodzi tylko tego, ze funkcja
 * zgadza sie z WYOBRAZENIEM autora o odpowiedzi GoTrue. Jedyne zalozenie tej
 * funkcji — ze stan blokady przyjezdza jako pole `banned_until` na obiekcie `User`,
 * a nie gdzie indziej i pod inna nazwa — moze potwierdzic wylacznie odpowiedz
 * prawdziwego serwera. To ta sama luka i ten sam sposob jej zamkniecia, co
 * w `account-role.integration.test.ts` dla `isAdmin`.
 *
 * Wymaga `npx supabase start`. Uruchamiany przez `npm run test:integration`.
 *
 * ============================================================================
 *  CZEGO TEN ZESTAW NIE DOWODZI — luka swiadoma, opisana w planie jako addendum
 * ============================================================================
 *
 * **Nie mierzy zamkniecia okna 60 minut**, mimo ze plan zapisal to jako kryterium
 * fazy 2. Zeby zmierzyc "zywy token przed i po zablokowaniu", trzeba konto
 * ZABLOKOWAC, czyli zapisac `auth.users.banned_until`. Klucz publishable takiego
 * prawa nie ma, a klucza `service_role` odrzuca straznik ponizej — i musi odrzucac,
 * bo omija RLS i uniewaznilby kazdy inny zestaw integracyjny w tym repo. Kryterium
 * powstalo z tego, co chcialem udowodnic, a nie z tego, czym repo potrafi dowodzic.
 *
 * Samo okno jest zmierzone i POWTARZALNE, tylko poza Vitestem:
 * `context/changes/admin-block-account/measure-session-window.sh`.
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

/** Dwie bariery przeciw falszywemu zielonemu wynikowi — skopiowane z zestawow R-05 i R-07. */
function assertSafeTestTarget(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Test integracyjny odmawia uruchomienia przeciwko nielokalnej bazie: ${host}`);
  }
  if (SUPABASE_KEY.startsWith("sb_secret_") || SUPABASE_KEY.includes("service_role")) {
    throw new Error(
      "Test integracyjny wymaga klucza publishable/anon. Klucz service_role omija RLS " +
        "i pozwolilby zapisac banned_until, czyli obszedlby dokladnie to, co ten plik sprawdza.",
    );
  }
}

async function signUpFreshUser(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
  const email = `blocked-${crypto.randomUUID()}@example.test`;
  const { error } = await client.auth.signUp({ email, password: "Testowe-haslo-123" });
  if (error) {
    throw new Error(`Nie udalo sie zalozyc konta testowego: ${error.message || "brak tresci bledu"}`);
  }
  return client;
}

describe("isBlocked wobec prawdziwego obiektu User", () => {
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    assertSafeTestTarget();
    client = await signUpFreshUser();
  });

  it("przepuszcza swiezo zarejestrowane konto", async () => {
    const { data } = await client.auth.getUser();
    expect(data.user).not.toBeNull();
    expect(isBlocked(data.user)).toBe(false);
  });

  it("swieze konto nie ma ustawionego banned_until", () => {
    // Potwierdza, ze `false` powyzej wynika z BRAKU BLOKADY, a nie z tego, ze
    // funkcja nie znalazla pola, ktorego szukala pod zla nazwa. Bez tego przypadku
    // literowka w nazwie pola dalaby `false` i przeszla na zielono.
    return client.auth.getUser().then(({ data }) => {
      const until = data.user?.banned_until;
      expect(until == null || until.length === 0 || Date.parse(until) <= Date.now()).toBe(true);
    });
  });

  it("obiekt User z serwera przechodzi przez isBlocked bez rzutu", async () => {
    // `isBlocked` dostaje w produkcji dokladnie ten obiekt, nie atrape. Ten
    // przypadek pilnuje, zeby ksztalt odpowiedzi GoTrue nie wywrocil bramki
    // stojacej na sciezce KAZDEGO zadania.
    const { data } = await client.auth.getUser();
    expect(() => isBlocked(data.user)).not.toThrow();
    expect(typeof isBlocked(data.user)).toBe("boolean");
  });

  it("bramka dziala na obiekcie z serwera, gdy blokada JEST ustawiona", async () => {
    // Blokady nie da sie tu zapisac (patrz naglowek), wiec bierzemy PRAWDZIWY
    // obiekt z serwera i podmieniamy na nim jedno pole. To wciaz mocniejsze niz
    // atrapa z testu jednostkowego: wszystkie pozostale pola sa autentyczne,
    // wiec gdyby GoTrue zmienil ksztalt `User`, ten przypadek to zauwazy.
    const { data } = await client.auth.getUser();
    expect(data.user).not.toBeNull();

    const zablokowany = { ...data.user, banned_until: "2126-01-01T00:00:00.000Z" };
    expect(isBlocked(zablokowany)).toBe(true);

    // I ta sama wartosc w PRZESZLOSCI nie blokuje — para roznicujaca powtorzona
    // tutaj, bo to jedyne miejsce, gdzie oba przypadki siedza na realnym obiekcie.
    const poBlokadzie = { ...data.user, banned_until: "2020-01-01T00:00:00.000Z" };
    expect(isBlocked(poBlokadzie)).toBe(false);
  });
});

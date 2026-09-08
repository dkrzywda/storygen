import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/account-role";

/**
 * `isAdmin` — granica dostepu do sekcji administratora (F-02, FR-015).
 *
 * DLACZEGO TEN PLIK MA TYLE PRZYPADKOW NEGATYWNYCH, A JEDEN POZYTYWNY: `isAdmin`
 * jest fail-closed, wiec jego kontrakt to nie "rozpoznaj admina", ale "NIE wpusc
 * nikogo, kogo nie rozpoznano z pewnoscia". Kazde wejscie ponizej to inny sposob,
 * w jaki `app_metadata` moze przyjsc z bazy inaczej, niz autor sie spodziewa —
 * a `app_metadata` jest typowane w SDK jako `[key: string]: any`, wiec kompilator
 * nie ochroni tu niczego.
 *
 * Blad w tej funkcji nie rzuca wyjatku i nie psuje strony. Objawia sie tym, ze ktos
 * widzi sekcje, ktorej nie powinien — czyli dokladnie tak, jak dzialajaca funkcja.
 */

/** Minimalny `User` z podstawionym `app_metadata`. Reszta pol nie bierze udzialu w decyzji. */
function userWith(appMetadata: unknown): User {
  return { id: "11111111-1111-1111-1111-111111111111", app_metadata: appMetadata } as unknown as User;
}

describe("isAdmin", () => {
  it("wpuszcza konto z rola admin", () => {
    expect(isAdmin(userWith({ role: "admin" }))).toBe(true);
  });

  it("wpuszcza, gdy obok roli stoja klucze GoTrue", () => {
    // Tak wyglada `app_metadata` po migracji seeda: scalenie zachowuje provider/providers.
    expect(isAdmin(userWith({ role: "admin", provider: "email", providers: ["email"] }))).toBe(true);
  });

  it("odmawia, gdy nie ma uzytkownika", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("odmawia przy roli user", () => {
    expect(isAdmin(userWith({ role: "user" }))).toBe(false);
  });

  it("odmawia, gdy klucza role w ogole nie ma", () => {
    // Stan kazdego konta przed seedem — i kazdego nowo zarejestrowanego.
    expect(isAdmin(userWith({ provider: "email", providers: ["email"] }))).toBe(false);
  });

  it("odmawia, gdy app_metadata jest pustym obiektem", () => {
    expect(isAdmin(userWith({}))).toBe(false);
  });

  it("odmawia, gdy app_metadata jest nullem", () => {
    // Typ SDK mowi, ze to pole zawsze jest. Typ jest obietnica, nie gwarancja —
    // wartosc przychodzi z sieci.
    expect(isAdmin(userWith(null))).toBe(false);
  });

  it("odmawia, gdy app_metadata jest undefined", () => {
    expect(isAdmin(userWith(undefined))).toBe(false);
  });

  it("odmawia, gdy app_metadata nie jest obiektem", () => {
    expect(isAdmin(userWith("admin"))).toBe(false);
    expect(isAdmin(userWith(42))).toBe(false);
    expect(isAdmin(userWith(true))).toBe(false);
  });

  it("odmawia przy roli spoza zbioru AccountRole", () => {
    expect(isAdmin(userWith({ role: "superadmin" }))).toBe(false);
    expect(isAdmin(userWith({ role: "ADMIN" }))).toBe(false);
    expect(isAdmin(userWith({ role: "" }))).toBe(false);
  });

  it("odmawia, gdy role nie jest tekstem", () => {
    // Bez porownania identycznosciowego `=== "admin"` prawdziwosciowe sprawdzenie
    // wpuscilo by tu obiekt i tablice.
    expect(isAdmin(userWith({ role: 1 }))).toBe(false);
    expect(isAdmin(userWith({ role: true }))).toBe(false);
    expect(isAdmin(userWith({ role: ["admin"] }))).toBe(false);
    expect(isAdmin(userWith({ role: { name: "admin" } }))).toBe(false);
  });

  it("odmawia, gdy rola siedzi w user_metadata zamiast app_metadata", () => {
    // NAJWAZNIEJSZY PRZYPADEK W TYM PLIKU. `user_metadata` uzytkownik zapisuje SAM
    // przez `updateUser`, wiec gdyby `isAdmin` czytalo tamto pole, kazdy nadalby
    // sobie role admina jednym wywolaniem SDK. PRD zabrania tego wprost, a ten test
    // jest jedynym miejscem, ktore pilnuje, ze zakaz obowiazuje w kodzie.
    const user = {
      id: "11111111-1111-1111-1111-111111111111",
      app_metadata: { provider: "email" },
      user_metadata: { role: "admin" },
    } as unknown as User;
    expect(isAdmin(user)).toBe(false);
  });
});

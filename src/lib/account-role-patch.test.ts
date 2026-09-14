import { describe, expect, it } from "vitest";
import { accountRolePatchSchema } from "@/lib/account-role-patch";
import { validate } from "@/lib/validation";
import { FORM_FIELD_KEY } from "@/lib/validation";

/**
 * Kontrakt wejsciowy `PATCH /api/accounts/[id]` (S-10, FR-018).
 *
 * CZEGO TEN PLIK NIE DOWODZI: ze zbior rol jest egzekwowany. Egzekwuje go BAZA
 * (`set_account_role` odrzuca role spoza zbioru kodem `VALIDATION_FAILED`), bo
 * funkcje mozna wolac przez PostgREST z pominieciem tego endpointu. Schemat
 * istnieje po to, zeby uzytkownik dostal komunikat o polu zamiast surowego kodu —
 * i to jest jedyne, co tu sprawdzam.
 */

describe("accountRolePatchSchema", () => {
  it("przyjmuje obie dozwolone role", () => {
    for (const role of ["admin", "user"] as const) {
      const result = validate(accountRolePatchSchema, { role });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.role).toBe(role);
      }
    }
  });

  it("przyjmuje zadanie z jawnym potwierdzeniem", () => {
    const result = validate(accountRolePatchSchema, { role: "user", confirmLast: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.confirmLast).toBe(true);
    }
  });

  it("zostawia confirmLast jako undefined, gdy pola nie ma", () => {
    // Wazne dla endpointu: `undefined` musi dac sie odroznic od `false`, bo endpoint
    // dopisuje `?? false` i przekazuje wartosc jawnie. Gdyby schemat sam podstawial
    // `false`, ten `??` bylby martwy i nikt by nie zauwazyl jego usuniecia.
    const result = validate(accountRolePatchSchema, { role: "admin" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.confirmLast).toBeUndefined();
    }
  });

  it("odrzuca role spoza zbioru z komunikatem po polsku", () => {
    const result = validate(accountRolePatchSchema, { role: "superadmin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.role).toContain("admin, user");
    }
  });

  it("odrzuca brak pola role", () => {
    const result = validate(accountRolePatchSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.role).toBeDefined();
    }
  });

  it("odrzuca confirmLast, ktore nie jest wartoscia logiczna", () => {
    const result = validate(accountRolePatchSchema, { role: "user", confirmLast: "tak" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.confirmLast).toBeDefined();
    }
  });

  it("odrzuca cialo, ktore nie jest obiektem", () => {
    // Endpoint parsuje JSON sam, wiec tutaj moze przyjsc tablica albo liczba.
    const result = validate(accountRolePatchSchema, ["admin"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Blad calego formularza, nie konkretnego pola.
      expect(result.fields[FORM_FIELD_KEY]).toBeDefined();
    }
  });
});

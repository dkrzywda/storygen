import { describe, expect, it } from "vitest";
import { accountPatchSchema } from "@/lib/account-blocked-patch";
import { FORM_FIELD_KEY, validate } from "@/lib/validation";

/**
 * Kontrakt wejsciowy `PATCH /api/accounts/[id]` (S-10 + S-11).
 *
 * CZEGO TEN PLIK NIE DOWODZI: ze zbior rol i stan blokady sa egzekwowane.
 * Egzekwuje je BAZA — obie funkcje odrzucaja zle wejscie kodem `VALIDATION_FAILED`,
 * bo mozna je wolac przez PostgREST z pominieciem tego endpointu. Schemat istnieje
 * po to, zeby uzytkownik dostal komunikat o polu zamiast surowego kodu.
 *
 * Zastepuje `account-role-patch.test.ts` z `S-10`: schemat roli przestal istniec
 * osobno, bo regula „albo rola, albo blokada" jest wlasnoscia calego ciala.
 */

describe("accountPatchSchema", () => {
  describe("galaz roli", () => {
    it("przyjmuje obie dozwolone role", () => {
      for (const role of ["admin", "user"] as const) {
        const result = validate(accountPatchSchema, { role });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data).toEqual({ kind: "role", role, confirmLast: false });
        }
      }
    });

    it("przyjmuje zadanie z jawnym potwierdzeniem", () => {
      const result = validate(accountPatchSchema, { role: "user", confirmLast: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ kind: "role", role: "user", confirmLast: true });
      }
    });

    it("odrzuca role spoza zbioru z komunikatem po polsku", () => {
      const result = validate(accountPatchSchema, { role: "superadmin" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields.role).toContain("admin, user");
      }
    });
  });

  describe("galaz blokady", () => {
    it.each([true, false])("przyjmuje blocked: %s", (blocked) => {
      const result = validate(accountPatchSchema, { blocked });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ kind: "blocked", blocked, confirmLast: false });
      }
    });

    // `blocked: false` to ODBLOKOWANIE, czyli pelnoprawna operacja — a nie "brak
    // wartosci". Gdyby schemat rozroznial galezie przez prawdziwosc zamiast przez
    // obecnosc pola, odblokowanie wpadloby w blad "zadne pole nie podane".
    it("blocked: false jest operacja, nie brakiem wartosci", () => {
      const result = validate(accountPatchSchema, { blocked: false });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.kind).toBe("blocked");
      }
    });

    it("przyjmuje blokade z jawnym potwierdzeniem", () => {
      const result = validate(accountPatchSchema, { blocked: true, confirmLast: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ kind: "blocked", blocked: true, confirmLast: true });
      }
    });

    it("odrzuca blocked, ktore nie jest wartoscia logiczna", () => {
      const result = validate(accountPatchSchema, { blocked: "tak" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields.blocked).toBeDefined();
      }
    });
  });

  describe("rozlacznosc — sedno kontraktu tej fazy", () => {
    // OBA NARAZ. Bez tego sprawdzenia endpoint musialby zgadnac, ktora operacje
    // wykonac, albo wykonac obie — a zadna z tych odpowiedzi nie jest tym, o co
    // prosil uzytkownik.
    it("odrzuca zadanie z rola I blokada", () => {
      const result = validate(accountPatchSchema, { role: "admin", blocked: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields[FORM_FIELD_KEY]).toContain("nie oba naraz");
      }
    });

    // ZADNE. Puste cialo konczyloby sie inaczej odpowiedzia 200 i cisza:
    // uzytkownik dostalby potwierdzenie zmiany, ktora nie nastapila.
    it("odrzuca puste cialo", () => {
      const result = validate(accountPatchSchema, {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields[FORM_FIELD_KEY]).toBeDefined();
      }
    });

    it("samo confirmLast to wciaz zadne pole operacji", () => {
      const result = validate(accountPatchSchema, { confirmLast: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields[FORM_FIELD_KEY]).toBeDefined();
      }
    });
  });

  describe("wspolne", () => {
    // GWARANCJA "ZAWSZE JAWNIE" MIESZKA W SCHEMACIE, NIE W HANDLERZE.
    // Przy S-10 endpoint dopisywal `?? false` — czyli gwarancje dalo sie skasowac
    // edycja handlera, bez zadnego czerwonego testu. Teraz normalizacja jest tutaj.
    it("brak confirmLast normalizuje sie do false w obu galeziach", () => {
      const rola = validate(accountPatchSchema, { role: "admin" });
      const blokada = validate(accountPatchSchema, { blocked: true });
      expect(rola.ok && rola.data.confirmLast).toBe(false);
      expect(blokada.ok && blokada.data.confirmLast).toBe(false);
    });

    it("odrzuca confirmLast, ktore nie jest wartoscia logiczna", () => {
      const result = validate(accountPatchSchema, { role: "user", confirmLast: "tak" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields.confirmLast).toBeDefined();
      }
    });

    // ASERCJA NA TRESC, NIE NA OBECNOSC — ustalenie F1 przegladu faz 3-4.
    //
    // Wczesniej stalo tu `toBeDefined()`, ktore przechodzilo TAKZE dla wewnetrznego
    // komunikatu Zoda po angielsku („Invalid input: expected object, received …").
    // Test nazywal sie tak, jakby pilnowal tego przypadku, a nie mogl sczerwieniec
    // od jedynej awarii, ktora tu grozi. `lessons.md` § „Zielone czytaj z tego, co
    // zmienilo by sie przy porazce".
    it.each([
      ["tablica", ["admin"]],
      ["null", null],
      ["string", "admin"],
      ["liczba", 42],
      ["boolean", true],
    ])("odrzuca cialo bedace %s, komunikatem po polsku", (_opis, wejscie) => {
      // Endpoint parsuje JSON sam, wiec tutaj moze przyjsc kazda z tych wartosci.
      const result = validate(accountPatchSchema, wejscie);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields[FORM_FIELD_KEY]).toBe("Treść żądania musi być obiektem.");
      }
    });
  });
});

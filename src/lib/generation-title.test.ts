import { describe, expect, it } from "vitest";
import { TITLE_MAX_LENGTH, generationTitleSchema, normalizeTitle } from "@/lib/generation-title";
import { validate } from "@/lib/validation";

describe("schemat tytulu", () => {
  it.each([1, 40, TITLE_MAX_LENGTH])("przyjmuje tytul o dlugosci %i", (length) => {
    const result = validate(generationTitleSchema, { title: "a".repeat(length) });
    expect(result.ok).toBe(true);
  });

  it("odrzuca tytul dluzszy niz limit", () => {
    const result = validate(generationTitleSchema, { title: "a".repeat(TITLE_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.title).toContain(String(TITLE_MAX_LENGTH));
    }
  });

  it("liczy dlugosc po przycieciu, nie przed", () => {
    // 80 znakow tresci plus biale znaki dookola — po trim miesci sie w limicie.
    const padded = `   ${"a".repeat(TITLE_MAX_LENGTH)}   `;
    const result = validate(generationTitleSchema, { title: padded });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toHaveLength(TITLE_MAX_LENGTH);
    }
  });

  it.each([
    ["", "pusty string"],
    ["   ", "same spacje"],
    ["\n\t", "znaki sterujace"],
  ])("przyjmuje %j (%s) jako wyczyszczenie tytulu", (input, _opis) => {
    const result = validate(generationTitleSchema, { title: input });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(normalizeTitle(result.data.title)).toBeNull();
    }
  });

  it("odrzuca brak pola", () => {
    const result = validate(generationTitleSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields)).toContain("title");
    }
  });

  it.each([[42], [null], [true], [{ nested: "x" }], [["a"]]])("odrzuca wartosc %j, ktora nie jest tekstem", (input) => {
    const result = validate(generationTitleSchema, { title: input });
    expect(result.ok).toBe(false);
  });

  it("komunikaty sa po polsku, nie domyslne z Zoda", () => {
    const result = validate(generationTitleSchema, { title: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.fields.title;
      expect(message).toBeTruthy();
      expect(message.toLowerCase()).not.toContain("expected");
      expect(message.toLowerCase()).not.toContain("invalid");
    }
  });
});

describe("normalizeTitle", () => {
  it("zwraca NULL dla pustego, zeby baza nie trzymala dwoch reprezentacji braku", () => {
    expect(normalizeTitle("")).toBeNull();
  });

  it("zwraca tekst bez zmian, gdy cos w nim jest", () => {
    expect(normalizeTitle("Moj ulubiony")).toBe("Moj ulubiony");
  });
});

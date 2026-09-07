import { describe, expect, it } from "vitest";
import { RATING_MAX, RATING_MIN, generationPatchSchema } from "@/lib/generation-patch";
import { TITLE_MAX_LENGTH } from "@/lib/generation-title";
import { validate } from "@/lib/validation";

describe("schemat latki generacji", () => {
  it.each([[1], [2], [3], [4], [5]])("przyjmuje ocene %i", (rating) => {
    expect(validate(generationPatchSchema, { rating }).ok).toBe(true);
  });

  it.each([[0], [6], [-1], [2.5], ["3"], [true]])("odrzuca ocene %j", (rating) => {
    expect(validate(generationPatchSchema, { rating }).ok).toBe(false);
  });

  it("przyjmuje `null` jako wyczyszczenie oceny", () => {
    const result = validate(generationPatchSchema, { rating: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rating).toBeNull();
    }
  });

  it("granice zakresu sa wlaczone", () => {
    expect(validate(generationPatchSchema, { rating: RATING_MIN }).ok).toBe(true);
    expect(validate(generationPatchSchema, { rating: RATING_MAX }).ok).toBe(true);
  });

  it.each([[true], [false]])("przyjmuje oznaczenie ulubionego %j", (isFavourite) => {
    expect(validate(generationPatchSchema, { isFavourite }).ok).toBe(true);
  });

  it.each([["tak"], [1], [null]])("odrzuca oznaczenie ulubionego %j", (isFavourite) => {
    expect(validate(generationPatchSchema, { isFavourite }).ok).toBe(false);
  });

  it("pole nieobecne pozostaje nieobecne, a nie staje sie `undefined` do zapisu", () => {
    const result = validate(generationPatchSchema, { rating: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Endpoint rozstrzyga "zmieniac czy nie" przez porownanie z `undefined`,
      // wiec brak pola MUSI zostac brakiem, nie jawnym `undefined`.
      expect(result.data.isFavourite).toBeUndefined();
      expect(result.data.title).toBeUndefined();
    }
  });

  it("odrzuca zadanie bez ani jednego pola", () => {
    const result = validate(generationPatchSchema, {});
    expect(result.ok).toBe(false);
  });

  it("przyjmuje kilka pol naraz", () => {
    expect(validate(generationPatchSchema, { title: "Moj tekst", rating: 5, isFavourite: true }).ok).toBe(true);
  });

  it("tytul podlega tym samym regulom co w schemacie tytulu", () => {
    expect(validate(generationPatchSchema, { title: "a".repeat(TITLE_MAX_LENGTH) }).ok).toBe(true);
    const tooLong = validate(generationPatchSchema, { title: "a".repeat(TITLE_MAX_LENGTH + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.fields.title).toContain(String(TITLE_MAX_LENGTH));
    }
  });

  it("komunikaty sa po polsku, nie domyslne z Zoda", () => {
    const result = validate(generationPatchSchema, { rating: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.fields.rating;
      expect(message).toBeTruthy();
      expect(message.toLowerCase()).not.toContain("expected");
      expect(message.toLowerCase()).not.toContain("less than");
    }
  });
});

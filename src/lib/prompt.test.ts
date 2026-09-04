import { describe, expect, it } from "vitest";
import { buildRetryUserPrompt, buildSystemPrompt, buildUserPrompt, looksLikeRefusal, maxTokensFor } from "@/lib/prompt";
import { generateRequestSchema } from "@/lib/generate-request";
import { validate } from "@/lib/validation";

const input = { topic: "koty programistów", format: "joke" as const, wordLimit: 40 };

describe("buildUserPrompt", () => {
  it("niesie temat i limit slow", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("koty programistów");
    expect(prompt).toContain("40");
  });

  it("dla dowcipu wymaga puenty — walidator jej nie sprawdza, wiec prompt musi", () => {
    expect(buildUserPrompt(input)).toContain("puentą");
  });

  it("dla opowiadania wymaga poczatku, rozwiniecia i zakonczenia", () => {
    const prompt = buildUserPrompt({ ...input, format: "story", wordLimit: 400 });
    expect(prompt).toContain("początek");
  });

  it("temat trafia do promptu bez modyfikacji", () => {
    const odd = "temat z: dwukropkiem i „cudzysłowem”";
    expect(buildUserPrompt({ ...input, topic: odd })).toContain(odd);
  });
});

describe("buildSystemPrompt", () => {
  it("zakazuje wstepu i formatowania", () => {
    const system = buildSystemPrompt("joke");
    expect(system).toContain("bez wstępu");
    expect(system).toContain("bez formatowania");
  });

  // Zmierzone w fazie 1: bez tego zakazu model wpada w petle powtorzen.
  it("zakazuje powtarzania linii", () => {
    expect(buildSystemPrompt("joke")).toContain("Nigdy nie powtarzasz");
  });

  it("wymaga zakonczenia pelnym zdaniem", () => {
    expect(buildSystemPrompt("joke")).toContain("pełnym zdaniem");
  });
});

describe("buildRetryUserPrompt", () => {
  it("zawiera oryginalne polecenie oraz powod odrzucenia", () => {
    const reason = "Poprzednia wersja miała 95 słów. Zmieść się w 40 słowach.";
    const retry = buildRetryUserPrompt(input, reason);
    expect(retry).toContain(buildUserPrompt(input));
    expect(retry).toContain(reason);
  });

  it("rozni sie od promptu pierwszej proby — inaczej powtorka bylaby loteria", () => {
    expect(buildRetryUserPrompt(input, "powod")).not.toBe(buildUserPrompt(input));
  });
});

describe("maxTokensFor", () => {
  it("daje zapas ponad limit slow, bo polski jest kosztowny tokenowo", () => {
    expect(maxTokensFor(60)).toBeGreaterThan(60);
  });

  it("rosnie wraz z limitem", () => {
    expect(maxTokensFor(25)).toBeLessThan(maxTokensFor(60));
  });
});

describe("looksLikeRefusal", () => {
  it.each([
    "Nie mogę napisać dowcipu na ten temat.",
    "Przepraszam, ale nie jestem w stanie tego zrobić.",
    "I cannot help with that request.",
    "Nie będę pisać takiego tekstu.",
  ])("rozpoznaje odmowe %j", (text) => {
    expect(looksLikeRefusal(text)).toBe(true);
  });

  // Heurystyka jest celowo waska. Falszywe rozpoznanie zamienia poprawny dowcip
  // w komunikat "zmien temat" — to gorsze niz przepuszczenie odmowy do walidatora.
  it.each([
    "Programista mówi do kota: nie mogę już patrzeć na ten kod, a kot odpowiada: to nie patrz.",
    "Kot nie może znaleźć myszy, więc szuka błędu w kodzie.",
    "Dlaczego kot nie używa debuggera? Bo sam jest błędem.",
  ])("nie myli dowcipu zawierajacego podobna frazę z odmowa: %j", (text) => {
    expect(looksLikeRefusal(text)).toBe(false);
  });

  it("pusty tekst nie jest odmowa", () => {
    expect(looksLikeRefusal("   ")).toBe(false);
  });
});

describe("schemat zadania generowania", () => {
  const base = { topic: "koty", format: "joke", length: "short" };

  it("przyjmuje poprawne zadanie", () => {
    expect(validate(generateRequestSchema, base).ok).toBe(true);
  });

  it.each([
    ["ab", "za krotki"],
    ["a".repeat(81), "za dlugi"],
    ["  ", "same spacje"],
  ])("odrzuca temat %j (%s)", (topic, _opis) => {
    const result = validate(generateRequestSchema, { ...base, topic });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.topic).toBeTruthy();
    }
  });

  it("liczy dlugosc tematu po przycieciu", () => {
    const result = validate(generateRequestSchema, { ...base, topic: `   ${"a".repeat(80)}   ` });
    expect(result.ok).toBe(true);
  });

  it("odrzuca format `story` — wchodzi z S-07", () => {
    expect(validate(generateRequestSchema, { ...base, format: "story" }).ok).toBe(false);
  });

  it("odrzuca nieznany preset dlugosci", () => {
    expect(validate(generateRequestSchema, { ...base, length: "epicki" }).ok).toBe(false);
  });

  it("komunikaty sa po polsku, nie domyslne z Zoda", () => {
    const result = validate(generateRequestSchema, { ...base, topic: "ab" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.topic.toLowerCase()).not.toContain("expected");
      expect(result.fields.topic.toLowerCase()).not.toContain("string");
    }
  });
});

import { describe, expect, it } from "vitest";
import { checkFormatContract, countWords, wordLimitFor } from "@/lib/format-contract";
import type { LengthPreset } from "@/types";

/** Buduje tekst o dokladnie `n` slowach, zakonczony kropka. */
function words(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `slowo${String(i)}`).join(" ")}.`;
}

const PRESETS: LengthPreset[] = ["short", "medium", "long"];

describe("limity presetow", () => {
  it("kazdy preset dowcipu ma inny limit — inaczej wybor uzytkownika bylby pozorny", () => {
    const limits = PRESETS.map((p) => wordLimitFor("joke", p));
    expect(new Set(limits).size).toBe(PRESETS.length);
  });

  it("limity rosna wraz z presetem", () => {
    expect(wordLimitFor("joke", "short")).toBeLessThan(wordLimitFor("joke", "medium"));
    expect(wordLimitFor("joke", "medium")).toBeLessThan(wordLimitFor("joke", "long"));
  });

  it("najdluzszy preset dowcipu siega sufitu z PRD", () => {
    expect(wordLimitFor("joke", "long")).toBe(60);
  });

  it("najdluzszy preset opowiadania siega sufitu z PRD", () => {
    expect(wordLimitFor("story", "long")).toBe(400);
  });
});

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["jedno", 1],
    ["dwa  slowa", 2],
    ["z\nnowa\tlinia", 3],
  ])("dla %j liczy %i", (input, expected) => {
    expect(countWords(input)).toBe(expected);
  });
});

describe("granica dlugosci", () => {
  it.each(PRESETS)("dokladnie na limicie przechodzi (%s)", (preset) => {
    const limit = wordLimitFor("joke", preset);
    const result = checkFormatContract(words(limit), "joke", preset);
    expect(result.ok).toBe(true);
  });

  it.each(PRESETS)("jedno slowo ponad limit jest odrzucone (%s)", (preset) => {
    const limit = wordLimitFor("joke", preset);
    const result = checkFormatContract(words(limit + 1), "joke", preset);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Powod musi niesc obie liczby, bo wprost trafia do promptu ponownej proby.
      expect(result.reason).toContain(String(limit + 1));
      expect(result.reason).toContain(String(limit));
    }
  });

  it("tekst ponizej progu minimalnego jest odrzucony", () => {
    const result = checkFormatContract("Za krotko.", "joke", "long");
    expect(result.ok).toBe(false);
  });
});

describe("obciecie i pustka", () => {
  it.each([
    ["", "pusty"],
    ["   ", "same spacje"],
    ["\n\t", "znaki sterujace"],
  ])("odrzuca %j (%s)", (input, _opis) => {
    const result = checkFormatContract(input, "joke", "short");
    expect(result.ok).toBe(false);
  });

  // Sufit max_tokens moze uciac model w polowie zdania. Taki tekst ma poprawna
  // dlugosc i wyglada normalnie — bez tego sprawdzenia przeszedlby walidacje.
  it("odrzuca tekst urwany bez znaku konca zdania", () => {
    const truncated = `${Array.from({ length: 20 }, (_, i) => `slowo${String(i)}`).join(" ")} i wtedy`;
    const result = checkFormatContract(truncated, "joke", "long");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("zdania");
    }
  });

  it.each(["Koniec.", "Koniec!", "Koniec?", "Koniec…", 'Powiedział: "koniec."'])(
    "przyjmuje zakonczenie %j",
    (ending) => {
      const text = `${Array.from({ length: 15 }, (_, i) => `slowo${String(i)}`).join(" ")} ${ending}`;
      const result = checkFormatContract(text, "joke", "long");
      expect(result.ok).toBe(true);
    },
  );
});

describe("czystosc tekstu", () => {
  it.each([
    "Oto dowcip: reszta tekstu jest wystarczajaco dluga zeby przejsc prog minimalny slow.",
    "Dowcip: reszta tekstu jest wystarczajaco dluga zeby przejsc prog minimalny slow tutaj.",
    "Odpowiedź: reszta tekstu jest wystarczajaco dluga zeby przejsc prog minimalny slow.",
  ])("odrzuca wstep %j", (text) => {
    const result = checkFormatContract(text, "joke", "long");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("wstęp");
    }
  });

  it.each([
    "**Pogrubiony** tekst dowcipu wystarczajaco dlugi zeby przejsc prog minimalny slow.",
    "# Naglowek i tekst dowcipu wystarczajaco dlugi zeby przejsc prog minimalny slow.",
    "Tekst z `kodem` wystarczajaco dlugi zeby przejsc prog minimalny liczby slow tutaj.",
  ])("odrzuca formatowanie %j", (text) => {
    const result = checkFormatContract(text, "joke", "long");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("formatowanie");
    }
  });
});

describe("powod odrzucenia", () => {
  it("jest zawsze niepusty i po polsku", () => {
    const cases = [
      checkFormatContract("", "joke", "short"),
      checkFormatContract(words(200), "joke", "short"),
      checkFormatContract("Krotko.", "joke", "long"),
      checkFormatContract("Oto dowcip: cos tam dalej i jeszcze wiecej slow zeby byl dlugi.", "joke", "long"),
    ];
    for (const result of cases) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.trim().length).toBeGreaterThan(0);
        expect(result.reason.toLowerCase()).not.toContain("expected");
      }
    }
  });
});

describe("przypadki zmierzone w fazie 1", () => {
  // Rzeczywiste wyjscia modelu z 2026-09-04 — te musza przechodzic, bo inaczej
  // walidator odrzucalby to, co model realnie produkuje.
  it.each([
    "Koty programistów mają specjalną umiejętność, potrafią usunąć cały kod jednym przewróceniem klawiatury, a potem patrzą z niewinnością, jakby mówiły: to ja tego nie zrobiłam.",
    "Poniedziałek rano, szef pyta pracownika: Jak się masz? Pracownik odpowiada: Dobrze, dziękuję. Szef mówi: To idź do biura i to zmień.",
  ])("prawdziwe wyjscie modelu przechodzi kontrakt", (text) => {
    const result = checkFormatContract(text, "joke", "long");
    expect(result.ok).toBe(true);
  });
});

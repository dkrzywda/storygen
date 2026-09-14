import { describe, expect, it } from "vitest";
import { blockGateDecision, isBlocked } from "@/lib/account-blocked";

// Jeden punkt odniesienia dla wszystkich przypadkow. Zegar jest WSTRZYKIWANY,
// wiec zaden przypadek nie zalezy od tego, kiedy uruchomiono zestaw.
const TERAZ = new Date("2026-09-14T12:00:00.000Z");

describe("isBlocked", () => {
  describe("porownuje z czasem, a nie sprawdza obecnosci wartosci", () => {
    // TO JEST PARA ROZNICUJACA CALEGO MODULU. Obie wartosci sa NIEPUSTE, wiec
    // implementacja `banned_until != null` daje na obu `true` — i przechodzi
    // kazdy inny test w tym pliku. Bez tej pary nic nie broni konta, ktoremu
    // blokada minela.
    it("data w PRZYSZLOSCI znaczy zablokowane", () => {
      expect(isBlocked({ banned_until: "2126-09-14T12:00:00.000Z" }, TERAZ)).toBe(true);
    });

    it("data w PRZESZLOSCI znaczy AKTYWNE, mimo ze wartosc jest niepusta", () => {
      expect(isBlocked({ banned_until: "2026-09-13T12:00:00.000Z" }, TERAZ)).toBe(false);
    });

    it("sto lat do przodu — tyle ustawia migracja", () => {
      expect(isBlocked({ banned_until: "2126-09-14T12:00:00.000Z" }, TERAZ)).toBe(true);
    });

    it("sekunda po `now` juz blokuje", () => {
      expect(isBlocked({ banned_until: "2026-09-14T12:00:01.000Z" }, TERAZ)).toBe(true);
    });

    it("sekunda przed `now` juz nie blokuje", () => {
      expect(isBlocked({ banned_until: "2026-09-14T11:59:59.000Z" }, TERAZ)).toBe(false);
    });

    it("dokladnie `now` nie blokuje — granica jest ostra, tak jak `> now()` w bazie", () => {
      expect(isBlocked({ banned_until: TERAZ.toISOString() }, TERAZ)).toBe(false);
    });
  });

  describe("brak blokady", () => {
    it("pole nieobecne", () => {
      expect(isBlocked({}, TERAZ)).toBe(false);
    });

    it("pole `null` — tak wyglada konto odblokowane", () => {
      expect(isBlocked({ banned_until: null }, TERAZ)).toBe(false);
    });
  });

  describe("wejscie nieoczekiwane PRZEPUSZCZA", () => {
    // Decyzja zapisana w module: falszywe `true` wypchneloby zdrowe konto
    // z KAZDEGO zadania, a falszywe `false` zostawia co najwyzej godzine sesji,
    // po ktorej i tak odmawia dostawca. Bramka jest druga warstwa, nie jedyna.
    it("brak sesji to nie blokada", () => {
      expect(isBlocked(null, TERAZ)).toBe(false);
      expect(isBlocked(undefined, TERAZ)).toBe(false);
    });

    it("wartosc nieparsowalna", () => {
      expect(isBlocked({ banned_until: "kiedys" }, TERAZ)).toBe(false);
    });

    it("pusty string i same spacje", () => {
      expect(isBlocked({ banned_until: "" }, TERAZ)).toBe(false);
      expect(isBlocked({ banned_until: "   " }, TERAZ)).toBe(false);
    });

    it("zly typ, ktory przeszedlby przez granice sieci", () => {
      // `as` celowo: to jest dokladnie ten przypadek, ktorego typ nie zlapie,
      // bo wartosc przychodzi z zewnatrz jako JSON.
      expect(isBlocked({ banned_until: 123 } as unknown as { banned_until?: string | null }, TERAZ)).toBe(false);
      expect(isBlocked({ banned_until: {} } as unknown as { banned_until?: string | null }, TERAZ)).toBe(false);
    });
  });

  it("domyslny zegar to `teraz` — wywolanie bez drugiego argumentu dziala", () => {
    expect(isBlocked({ banned_until: "2126-09-14T12:00:00.000Z" })).toBe(true);
    expect(isBlocked({ banned_until: "2020-01-01T00:00:00.000Z" })).toBe(false);
  });
});

describe("blockGateDecision", () => {
  const ZABLOKOWANY = { banned_until: "2126-09-14T12:00:00.000Z" };
  const AKTYWNY = { banned_until: null };

  describe("konto niezablokowane przechodzi wszedzie", () => {
    it.each(["/", "/generate", "/generations", "/dashboard", "/api/generate", "/auth/signin"])("%s", (sciezka) => {
      expect(blockGateDecision(sciezka, AKTYWNY, TERAZ)).toBe("pass");
    });

    it("brak sesji tez przechodzi — tym zajmuje sie osobne sprawdzenie tras chronionych", () => {
      expect(blockGateDecision("/dashboard", null, TERAZ)).toBe("pass");
    });
  });

  describe("zablokowany: strony przekierowanie, API kontrakt bledu", () => {
    it.each(["/", "/generate", "/generations", "/dashboard", "/cokolwiek-nowego"])("%s → redirect", (sciezka) => {
      expect(blockGateDecision(sciezka, ZABLOKOWANY, TERAZ)).toBe("redirect");
    });

    // DWA KSZTALTY, JEDEN KONTRAKT BLEDU. Przekierowanie w odpowiedzi na `fetch()`
    // byloby dla wyspy HTML-em ze statusem 200 i uzytkownik zobaczylby komunikat
    // domyslny zamiast informacji o zawieszeniu dostepu.
    it.each(["/api/generate", "/api/generations/abc", "/api/accounts/abc"])("%s → json", (sciezka) => {
      expect(blockGateDecision(sciezka, ZABLOKOWANY, TERAZ)).toBe("json");
    });

    // Zasieg SZERSZY niz lista tras chronionych: trasa, ktorej dzis nie ma,
    // ma byc domyslnie zamknieta, a nie domyslnie otwarta.
    it("trasa spoza listy chronionych tez jest objeta", () => {
      expect(blockGateDecision("/jakas/przyszla/trasa", ZABLOKOWANY, TERAZ)).toBe("redirect");
    });
  });

  describe("wyjatki sa WARUNKIEM DZIALANIA, nie ulatwieniem", () => {
    // Bez tego bramka przekierowywalaby na strone, ktora sama przekierowuje —
    // petla, w ktorej komunikat nigdy sie nie pokazuje.
    it.each(["/auth/signin", "/auth/signup", "/auth/confirm-email"])("%s nie wpada w petle", (sciezka) => {
      expect(blockGateDecision(sciezka, ZABLOKOWANY, TERAZ)).toBe("pass");
    });

    // Zablokowany musi moc zakonczyc wlasna sesje. Odcieciem tego uwiezilibysmy
    // go w niej, a nie zablokowali.
    it("wylogowanie zostaje dostepne", () => {
      expect(blockGateDecision("/api/auth/signout", ZABLOKOWANY, TERAZ)).toBe("pass");
    });
  });

  describe("koncowy ukosnik w wyjatku jest znaczacy", () => {
    // TO JEST PRZYPADEK ROZNICUJACY. Wyjatek zapisany jako "/auth" zamiast "/auth/"
    // otworzylby te sciezki zablokowanemu — i zaden inny test by tego nie zlapal.
    it.each(["/authx", "/authorize", "/api/authorize", "/api/authx/token"])(
      "%s NIE jest wyjete spod bramki",
      (sciezka) => {
        expect(blockGateDecision(sciezka, ZABLOKOWANY, TERAZ)).not.toBe("pass");
      },
    );
  });

  it("data w PRZESZLOSCI nie uruchamia bramki", () => {
    expect(blockGateDecision("/dashboard", { banned_until: "2026-09-13T12:00:00.000Z" }, TERAZ)).toBe("pass");
  });
});

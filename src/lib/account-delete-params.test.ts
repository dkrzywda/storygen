import { describe, expect, it } from "vitest";
import { readDeleteParams } from "@/lib/account-delete-params";

/**
 * Parametry `DELETE /api/accounts/[id]` (S-12, FR-017).
 *
 * CZEGO TEN PLIK NIE DOWODZI: ze zgoda jest EGZEKWOWANA. Egzekwuje ja BAZA —
 * `delete_account()` odmawia bez `p_confirm_destroy`, takze administratorowi
 * wolajacemu przez PostgREST wprost. Ten schemat istnieje po to, zeby uzytkownik
 * dostal komunikat o brakujacym parametrze zamiast surowego kodu z bazy.
 */

const adres = (query: string) => new URL(`https://example.test/api/accounts/abc${query}`);

describe("readDeleteParams", () => {
  it("przyjmuje jawna zgode", () => {
    const r = readDeleteParams(adres("?confirmDestroy=true"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.confirmDestroy).toBe(true);
    }
  });

  it("przyjmuje jawna odmowe", () => {
    const r = readDeleteParams(adres("?confirmDestroy=false"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.confirmDestroy).toBe(false);
    }
  });

  // BRAK PARAMETRU TO BLAD, NIE CICHE `false`. Zadanie usuniecia bez slowa
  // o zgodzie jest niepelne, a nie odmowne — uzytkownik ma dostac komunikat
  // o tym, czego brakuje, zamiast odmowy bez wyjasnienia.
  it("odrzuca brak parametru z wlasnym komunikatem", () => {
    const r = readDeleteParams(adres(""));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("zgodę");
    }
  });

  // TO JEST PRZYPADEK ROZNICUJACY CALEGO SCHEMATU. Gdyby zgoda byla liczona
  // jako "cokolwiek niepuste znaczy tak", KAZDA z tych wartosci — w tym
  // literowka i losowy tekst — przechodzilaby jako zgoda na operacje,
  // ktorej nikt nie cofnie.
  it.each(["1", "yes", "tak", "TRUE", "True", "on", "confirm", " true", ""])(
    "odrzuca wartosc %j, ktora nie jest true ani false",
    (wartosc) => {
      const r = readDeleteParams(adres(`?confirmDestroy=${encodeURIComponent(wartosc)}`));
      expect(r.ok).toBe(false);
    },
  );

  it("komunikat o zlej wartosci jest po polsku i mowi, co jest dozwolone", () => {
    const r = readDeleteParams(adres("?confirmDestroy=tak"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("true");
      expect(r.message).toContain("false");
    }
  });

  it("nadmiarowe parametry sa ignorowane, nie odrzucane", () => {
    // Adres bywa doklejany przez posrednikow i narzedzia; obecnosc czegos
    // dodatkowego nie jest powodem, zeby odmowic operacji.
    const r = readDeleteParams(adres("?confirmDestroy=true&utm_source=cokolwiek"));
    expect(r.ok).toBe(true);
  });
});

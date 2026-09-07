import { describe, expect, it } from "vitest";
import { interpretGate } from "@/lib/limits";

/**
 * R-07 z `context/foundation/test-plan.md` — czesc zyjaca w TypeScripcie.
 *
 * ZAKRES TEGO PLIKU ZMIENIL SIE PRZY USTALENIU F2 PRZEGLADU. Wczesniej testowal
 * `checkLimits`, czyli samą decyzje o limicie. Decyzja przeniosla sie do bazy —
 * `public.record_attempt_if_allowed()` liczy, decyduje i zapisuje w jednej
 * serializowanej instrukcji, bo dwa obroty bez blokady przepuszczaly rownolegle
 * zadania. Progi 10 i 30 tez mieszkaja teraz w SQL i nie moga byc parametrem, bo
 * wolajacy podalby wlasne. Testy tamtej decyzji sa w `limits.integration.test.ts`.
 *
 * Po stronie TypeScriptu zostala JEDNA rzecz warta testu i to jest ta: tlumaczenie
 * surowej odpowiedzi bramki na decyzje. Jest to granica miedzy baza a aplikacja,
 * czyli dokladnie to miejsce, w ktorym cicha zmiana kontraktu funkcji przeszlaby
 * niezauwazona.
 */

describe("interpretGate — wartosci z kontraktu", () => {
  it("'ok' przepuszcza", () => {
    expect(interpretGate("ok")).toEqual({ ok: true });
  });

  it("wyczerpany limit konta zwraca wlasny kod", () => {
    expect(interpretGate("DAILY_LIMIT_REACHED")).toEqual({
      ok: false,
      code: "DAILY_LIMIT_REACHED",
    });
  });

  it("wyczerpany sufit aplikacji zwraca wlasny kod", () => {
    expect(interpretGate("APP_LIMIT_REACHED")).toEqual({
      ok: false,
      code: "APP_LIMIT_REACHED",
    });
  });
});

describe("interpretGate — wartosci spoza kontraktu", () => {
  /*
   * KAZDY z tych przypadkow ma RZUCIC, nie przepuscic. Bramka jest jedynym
   * ogranicznikiem kosztu w produkcie; gdyby nierozpoznany napis byl cicho traktowany
   * jak zgoda, zmiana kontraktu funkcji w bazie otwieralaby generowanie bez limitu
   * i nic by tego nie zglosilo — czyli dokladnie R-07: awaria widoczna dopiero
   * na rachunku.
   *
   * Przepuszczenie przy nieznanej wartosci byloby fail-open w miejscu, w ktorym caly
   * plaster jest fail-closed.
   */
  it.each([
    ["", "pusty napis"],
    ["OK", "poprawny kod zla wielkoscia liter"],
    ["true", "wartosc logiczna jako tekst"],
    ["DAILY_LIMIT", "obciety kod"],
    ["ALLOWED", "kod z innego slownika"],
    ["ok ", "kod z bialym znakiem na koncu"],
  ])("rzuca dla %j (%s)", (raw, _opis) => {
    expect(() => interpretGate(raw)).toThrow();
  });

  it("komunikat bledu niesie otrzymana wartosc, zeby dalo sie ja zdiagnozowac", () => {
    expect(() => interpretGate("cos-nowego")).toThrow(/cos-nowego/);
  });
});

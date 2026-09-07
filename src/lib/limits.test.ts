import { describe, expect, it } from "vitest";
import { DAILY_APP_CEILING, DAILY_PER_ACCOUNT, checkLimits } from "@/lib/limits";

/**
 * R-07 z `context/foundation/test-plan.md` — czesc zyjaca w TypeScripcie.
 *
 * Ryzyko ma dwie twarze i ten zestaw pokrywa jedna: **decyzje bramki** — ktora granica
 * wygrywa i gdzie dokladnie lezy. Druga twarz to polityki RLS i arytmetyka doby, ktore
 * zyja w bazie i nie da sie ich dotknac testem jednostkowym; bierze je
 * `src/lib/limits.integration.test.ts`.
 *
 * Progi sa czytane ze stalych, nie wpisane liczbami. Test wpisujacy 10 i 30 na sztywno
 * przestalby cokolwiek sprawdzac w dniu, w ktorym ktos zmieni limit — przechodzilby
 * dalej, opisujac limit, ktorego juz nie ma.
 */

describe("checkLimits — granica wlasnego limitu (FR-012)", () => {
  it("przepuszcza tuz pod limitem", () => {
    expect(checkLimits({ own: DAILY_PER_ACCOUNT - 1, app: 0 })).toEqual({ ok: true });
  });

  // Limit jest OSIAGNIETY, nie przekroczony. Przy `>` zamiast `>=` dziesiaty licznik
  // przepuscilby jedenasta generacje — blad o jeden, ktory kosztuje neurony.
  it("odmawia dokladnie na limicie", () => {
    expect(checkLimits({ own: DAILY_PER_ACCOUNT, app: 0 })).toEqual({
      ok: false,
      code: "DAILY_LIMIT_REACHED",
    });
  });

  // Stan mozliwy po wyscigu dwoch rownoleglych zadan (opisany w planie jako swiadomie
  // niedomkniety): licznik przekroczyl limit. Bramka ma nadal odmawiac, nie przepuszczac.
  it("odmawia takze powyzej limitu", () => {
    expect(checkLimits({ own: DAILY_PER_ACCOUNT + 5, app: 0 })).toEqual({
      ok: false,
      code: "DAILY_LIMIT_REACHED",
    });
  });
});

describe("checkLimits — sufit calej aplikacji (FR-013)", () => {
  it("przepuszcza tuz pod sufitem", () => {
    expect(checkLimits({ own: 0, app: DAILY_APP_CEILING - 1 })).toEqual({ ok: true });
  });

  it("odmawia dokladnie na sufcie", () => {
    expect(checkLimits({ own: 0, app: DAILY_APP_CEILING })).toEqual({
      ok: false,
      code: "APP_LIMIT_REACHED",
    });
  });
});

describe("checkLimits — pierwszenstwo", () => {
  // Gdy stoja oba progi, uzytkownik ma uslyszec o SWOIM. Informacja o cudzym zuzyciu
  // nie zmienia tego, co moze zrobic, a wlasny limit odnowi sie jemu.
  it("wlasny limit wygrywa, gdy oba sa wyczerpane", () => {
    expect(checkLimits({ own: DAILY_PER_ACCOUNT, app: DAILY_APP_CEILING })).toEqual({
      ok: false,
      code: "DAILY_LIMIT_REACHED",
    });
  });

  it("sufit odzywa sie tylko przy niewyczerpanym wlasnym limicie", () => {
    expect(checkLimits({ own: 0, app: DAILY_APP_CEILING })).toEqual({
      ok: false,
      code: "APP_LIMIT_REACHED",
    });
  });
});

describe("checkLimits — stan poczatkowy", () => {
  it("przepuszcza przy zerowym zuzyciu", () => {
    expect(checkLimits({ own: 0, app: 0 })).toEqual({ ok: true });
  });
});

describe("wzajemna relacja progow", () => {
  /*
   * Nie jest to test kodu, tylko **zalozenia projektowej**, na ktorej stoi FR-012.
   * Limit na konto ma byc ulamkiem sufitu — inaczej jedno konto zjada cala aplikacje
   * i prog na konto przestaje byc granica sprawiedliwosci, ktora mial byc.
   */
  it("limit na konto jest istotnie mniejszy od sufitu aplikacji", () => {
    expect(DAILY_PER_ACCOUNT).toBeLessThan(DAILY_APP_CEILING);
    expect(DAILY_APP_CEILING / DAILY_PER_ACCOUNT).toBeGreaterThanOrEqual(2);
  });
});

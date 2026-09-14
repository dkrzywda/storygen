import { describe, expect, it } from "vitest";
import { mapAccountActionCode } from "@/lib/admin-accounts";
import { API_ERRORS } from "@/lib/api-errors";

/**
 * Mapowanie kodow z funkcji dzialajacych na koncie — `public.set_account_role()`
 * (S-10) oraz `public.set_account_blocked()` (S-11) — na kontrakt bledow F-01.
 *
 * NAZWA OBEJMUJE OBIE FUNKCJE, bo zbior kodow jest wspolny i `mapAccountActionCode`
 * zostala celowo przemianowana na operacyjnie neutralna (ustalenie F9 przegladu
 * faz 3-4). Naglowek mowiacy o jednej z nich sugerowalby, ze druga ma wlasne
 * mapowanie — a wtedy ktos dopisalby drugie.
 *
 * DWIE RZECZY, KTORE TEN PLIK MA PILNOWAC, i obie sa granicami bezpieczenstwa,
 * nie kosmetyka:
 *
 * 1. `FORBIDDEN` NIE moze wyjsc jako 403. Odpowiedz 403 potwierdzalaby istnienie
 *    operacji kazdemu, kto zgadnie adres — dokladnie to, czego FR-015 zabrania
 *    dla przegladu. Zapis nie ma byc gadatliwszy od odczytu.
 * 2. Kod spoza zbioru NIE moze wyjsc jako `ok`. Nieznana wartosc znaczy "nie wiem,
 *    co sie stalo", a to nie jest sukces.
 */

describe("mapAccountActionCode", () => {
  it("przepuszcza ok jako ok", () => {
    expect(mapAccountActionCode("ok")).toBe("ok");
  });

  it("zamienia FORBIDDEN na NOT_FOUND, nie na 403", () => {
    const mapped = mapAccountActionCode("FORBIDDEN");
    expect(mapped).toBe("NOT_FOUND");
    // Czytane ze statusu, a nie z nazwy kodu: to status trafia do sieci i to on
    // ujawnilby istnienie operacji.
    expect(API_ERRORS[mapped as keyof typeof API_ERRORS].status).toBe(404);
  });

  it("zamienia NOT_FOUND na NOT_FOUND", () => {
    expect(mapAccountActionCode("NOT_FOUND")).toBe("NOT_FOUND");
  });

  it("zamienia VALIDATION_FAILED na VALIDATION_FAILED", () => {
    expect(mapAccountActionCode("VALIDATION_FAILED")).toBe("VALIDATION_FAILED");
  });

  it("zamienia LAST_ADMIN_NEEDS_CONFIRM na wlasny kod z 409", () => {
    const mapped = mapAccountActionCode("LAST_ADMIN_NEEDS_CONFIRM");
    expect(mapped).toBe("LAST_ADMIN_CONFIRM_REQUIRED");
    // 409, nie 400: zadanie jest poprawne, tylko koliduje ze stanem. Powtorzone
    // z potwierdzeniem przejdzie.
    expect(API_ERRORS[mapped as keyof typeof API_ERRORS].status).toBe(409);
  });

  it("jest FAIL-CLOSED wobec kodu spoza zbioru", () => {
    for (const nieznany of ["", "OK", "ok ", "sukces", "TRUE", "admin"]) {
      expect(mapAccountActionCode(nieznany)).toBe("INTERNAL");
    }
  });

  it("kazdy zwrocony kod istnieje w kontrakcie bledow", () => {
    // Bez tego mozna by zwrocic kod, ktorego `API_ERRORS` nie zna, a `jsonError`
    // wywrocilby sie dopiero w czasie wykonania, na produkcji.
    for (const raw of ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "LAST_ADMIN_NEEDS_CONFIRM", "cokolwiek"]) {
      const mapped = mapAccountActionCode(raw);
      expect(mapped).not.toBe("ok");
      expect(Object.hasOwn(API_ERRORS, mapped)).toBe(true);
    }
  });
});

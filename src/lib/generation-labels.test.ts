import { describe, expect, it } from "vitest";
import { resetTimeFormat } from "@/lib/generation-labels";

/**
 * Ustalenie F9 przegladu `daily-generation-limits`: plan wymienial ten test w Testing
 * Strategy i nie powstal, a zestaw integracyjny ODTWARZAL wlasne opcje
 * `Intl.DateTimeFormat` zamiast importowac eksport, ktory mial przypinac. Skutek byl
 * taki, ze zmiana strefy w `generation-labels.ts` nie zapalilaby niczego na czerwono.
 *
 * Testowana jest jedna rzecz i jest nia PRZYPIECIE STREFY. Godzina odnowienia limitow
 * musi zgadzac sie z granica doby liczona przez `public.usage_today()` w `Europe/Warsaw` —
 * gdyby formatter szedl za strefa maszyny, panel pokazywalby inna godzine niz ta,
 * o ktorej limit naprawde sie odnawia.
 */

describe("resetTimeFormat", () => {
  // Wrzesien: Europe/Warsaw = UTC+2. Polnoc lokalna to 22:00 poprzedniego dnia UTC.
  it("pokazuje polnoc warszawska dla czasu letniego", () => {
    expect(resetTimeFormat.format(new Date("2026-09-07T22:00:00Z"))).toBe("00:00");
  });

  // Styczen: Europe/Warsaw = UTC+1. Polnoc lokalna to 23:00 poprzedniego dnia UTC.
  // Oba przypadki razem dowodza, ze strefa jest przypieta, a nie przypadkiem zgodna —
  // staly offset przeszedlby tylko jeden z nich.
  it("pokazuje polnoc warszawska dla czasu zimowego", () => {
    expect(resetTimeFormat.format(new Date("2026-01-14T23:00:00Z"))).toBe("00:00");
  });

  it("nie idzie za strefa maszyny — poludnie UTC to nie poludnie w Warszawie", () => {
    const formatted = resetTimeFormat.format(new Date("2026-09-07T12:00:00Z"));
    expect(formatted).toBe("14:00");
  });

  it("formatuje dwucyfrowo, zeby godziny nie skakaly w ukladzie", () => {
    expect(resetTimeFormat.format(new Date("2026-09-07T05:05:00Z"))).toBe("07:05");
  });
});

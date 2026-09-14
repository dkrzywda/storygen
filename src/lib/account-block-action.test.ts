import { describe, expect, it } from "vitest";
import {
  blockActionAriaLabel,
  blockActionLabel,
  losesOwnAccess,
  planBlockAction,
  targetBlockedFor,
  type BlockActionContext,
} from "@/lib/account-block-action";

/**
 * Maszyna stanow przycisku blokady (S-11, FR-016).
 *
 * CZEGO TEN PLIK NIE DOWODZI: ze potwierdzenie jest EGZEKWOWANE. Przy ostatnim
 * czynnym administratorze egzekwuje je BAZA (`set_account_blocked` odmawia bez
 * `p_confirm`), a przy blokowaniu SIEBIE nikt — to swiadoma uprzejmosc wobec
 * klikajacego, opisana w module. Tutaj sprawdzam wylacznie, czy klikniecie pyta,
 * czy wysyla, i z jakim potwierdzeniem.
 */

const ctx = (over: Partial<BlockActionContext> = {}): BlockActionContext => ({
  isBlocked: false,
  isSelf: false,
  isLastAdmin: false,
  ...over,
});

describe("targetBlockedFor", () => {
  it("zawsze przestawia na stan przeciwny", () => {
    expect(targetBlockedFor(ctx({ isBlocked: false }))).toBe(true);
    expect(targetBlockedFor(ctx({ isBlocked: true }))).toBe(false);
  });
});

describe("planBlockAction", () => {
  describe("odblokowanie NIE PYTA NIGDY", () => {
    // Nikomu niczego nie odbiera i da sie je odklikac. Te trzy przypadki razem
    // pilnuja, zeby zaden z warunkow pytania nie przeciekl na te sciezke.
    it.each([
      ["zwykle konto", { isBlocked: true }],
      ["wlasne konto", { isBlocked: true, isSelf: true }],
      ["ostatni admin", { isBlocked: true, isLastAdmin: true }],
      ["wlasne i ostatni admin", { isBlocked: true, isSelf: true, isLastAdmin: true }],
    ] as const)("%s", (_opis, over) => {
      const action = planBlockAction(ctx(over), false);
      expect(action.kind).toBe("send");
      if (action.kind === "send") {
        expect(action.targetBlocked).toBe(false);
      }
    });
  });

  describe("blokowanie CUDZEGO konta bez znaczenia dla administracji nie pyta", () => {
    it("wysyla od razu", () => {
      const action = planBlockAction(ctx(), false);
      expect(action.kind).toBe("send");
      if (action.kind === "send") {
        expect(action.targetBlocked).toBe(true);
        expect(action.confirmLast).toBe(false);
      }
    });
  });

  describe("blokowanie OSTATNIEGO czynnego administratora", () => {
    it("najpierw pyta, nie wysyla", () => {
      const action = planBlockAction(ctx({ isLastAdmin: true }), false);
      expect(action.kind).toBe("confirm");
      if (action.kind === "confirm") {
        expect(action.warning).toContain("ostatni czynny administrator");
      }
    });

    it("po potwierdzeniu wysyla z jawna zgoda", () => {
      const action = planBlockAction(ctx({ isLastAdmin: true }), true);
      expect(action.kind).toBe("send");
      if (action.kind === "send") {
        expect(action.targetBlocked).toBe(true);
        expect(action.confirmLast).toBe(true);
      }
    });
  });

  describe("blokowanie SIEBIE", () => {
    it("pyta, nawet gdy administratorow jest wiecej", () => {
      const action = planBlockAction(ctx({ isSelf: true }), false);
      expect(action.kind).toBe("confirm");
      if (action.kind === "confirm") {
        expect(action.warning).toContain("własne konto");
      }
    });

    it("po potwierdzeniu wysyla BEZ zgody na ostatniego admina", () => {
      // WAZNE: `confirmLast` nie moze byc `true` tylko dlatego, ze uzytkownik
      // potwierdzil SLABSZE ostrzezenie. Zgoda dotyczy innego skutku.
      const action = planBlockAction(ctx({ isSelf: true }), true);
      expect(action.kind).toBe("send");
      if (action.kind === "send") {
        expect(action.confirmLast).toBe(false);
      }
    });

    // PRZYPADEK ROZNICUJACY OSTRZEZENIA. Gdy oba powody zachodza naraz, uzytkownik
    // ma zobaczyc ten POWAZNIEJSZY — utrata administracji jest nieodwracalna
    // z poziomu produktu, a utrata wlasnego dostepu przy innych adminach nie jest.
    it("przy ostatnim adminie wygrywa ostrzezenie o administracji", () => {
      const action = planBlockAction(ctx({ isSelf: true, isLastAdmin: true }), false);
      expect(action.kind).toBe("confirm");
      if (action.kind === "confirm") {
        expect(action.warning).toContain("ostatni czynny administrator");
        expect(action.warning).not.toContain("własne konto");
      }
    });
  });
});

describe("losesOwnAccess", () => {
  it("blokowanie SIEBIE odbiera dostep", () => {
    expect(losesOwnAccess(ctx({ isSelf: true }))).toBe(true);
  });

  it("blokowanie cudzego konta nie", () => {
    expect(losesOwnAccess(ctx())).toBe(false);
  });

  // Odblokowanie siebie jest z tego ekranu NIEOSIAGALNE — zablokowany nie
  // przechodzi bramki i wcale go nie widzi. Gdyby jednak kiedys bylo, nie moze
  // udawac utraty dostepu.
  it("odblokowanie siebie nie odbiera dostepu", () => {
    expect(losesOwnAccess(ctx({ isSelf: true, isBlocked: true }))).toBe(false);
  });
});

describe("etykiety", () => {
  it("tekst przycisku mowi, co sie stanie", () => {
    expect(blockActionLabel(ctx({ isBlocked: false }))).toBe("Zablokuj");
    expect(blockActionLabel(ctx({ isBlocked: true }))).toBe("Odblokuj");
  });

  describe("nazwa dostepna niesie kontekst, ktorego czytnik nie widzi", () => {
    it("zawsze zawiera adres konta", () => {
      for (const over of [{}, { isBlocked: true }, { isSelf: true }]) {
        expect(blockActionAriaLabel(ctx(over), "kto@example.test")).toContain("kto@example.test");
      }
    });

    it("odroznia wlasne konto od cudzego", () => {
      expect(blockActionAriaLabel(ctx({ isSelf: true }), "ja@example.test")).toContain("własne");
      expect(blockActionAriaLabel(ctx(), "ktos@example.test")).not.toContain("własne");
    });

    it("przy odblokowaniu nie mowi o blokowaniu", () => {
      const label = blockActionAriaLabel(ctx({ isBlocked: true }), "kto@example.test");
      expect(label).toContain("Odblokuj");
      expect(label).not.toContain("Zablokuj");
    });
  });
});

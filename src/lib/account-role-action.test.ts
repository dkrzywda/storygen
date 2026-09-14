import { describe, expect, it } from "vitest";
import {
  losesOwnAccess,
  planRoleAction,
  roleActionAriaLabel,
  roleActionLabel,
  targetRoleFor,
  type RoleActionContext,
} from "@/lib/account-role-action";

/**
 * Maszyna stanow przycisku zmiany roli (S-10, FR-018).
 *
 * NAJWAZNIEJSZY PRZYPADEK jest ten, w ktorym pierwsze klikniecie NIE wysyla zadania.
 * To jedyna bariera miedzy klikniecien a operacja, ktorej klikajacy nie cofnie
 * zadnym ekranem — zdjeciem sobie roli albo zdjeciem ostatniej.
 */

const ctx = (over: Partial<RoleActionContext> = {}): RoleActionContext => ({
  role: "user",
  isSelf: false,
  isLastAdmin: false,
  ...over,
});

describe("planRoleAction", () => {
  it("nadanie roli wysyla od razu, bez pytania", () => {
    // Nadanie nikomu niczego nie odbiera i da sie je odklikac — pytanie byloby tarciem
    // bez powodu, a tarcie bez powodu uczy ignorowac tarcie tam, gdzie powod jest.
    const action = planRoleAction(ctx({ role: "user" }), false);
    expect(action).toEqual({ kind: "send", targetRole: "admin", confirmLast: false });
  });

  it("zdjecie roli obcemu kontu, ktore nie jest ostatnie, wysyla od razu", () => {
    const action = planRoleAction(ctx({ role: "admin" }), false);
    expect(action).toEqual({ kind: "send", targetRole: "user", confirmLast: false });
  });

  it("OSTATNIA rola: pierwsze klikniecie PYTA i nie wysyla", () => {
    const action = planRoleAction(ctx({ role: "admin", isLastAdmin: true }), false);
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.targetRole).toBe("user");
      expect(action.warning).toContain("ostatnia rola administratora");
    }
  });

  it("OSTATNIA rola: drugie klikniecie wysyla z confirmLast = true", () => {
    const action = planRoleAction(ctx({ role: "admin", isLastAdmin: true }), true);
    expect(action).toEqual({ kind: "send", targetRole: "user", confirmLast: true });
  });

  it("zdjecie roli SOBIE: pierwsze klikniecie PYTA, nawet gdy nie jest ostatnia", () => {
    const action = planRoleAction(ctx({ role: "admin", isSelf: true }), false);
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.warning).toContain("sobie");
    }
  });

  it("zdjecie roli SOBIE: drugie klikniecie wysyla, ale confirmLast zostaje false", () => {
    // `confirmLast` dotyczy OSTATNIEJ roli, nie wlasnej. Wysylanie tu `true` bylo by
    // zgoda na cos, o co nikt nie pytal.
    const action = planRoleAction(ctx({ role: "admin", isSelf: true }), true);
    expect(action).toEqual({ kind: "send", targetRole: "user", confirmLast: false });
  });

  it("SOBIE i OSTATNIA naraz: ostrzezenie mowi o ostatniej, bo skutek jest szerszy", () => {
    const action = planRoleAction(ctx({ role: "admin", isSelf: true, isLastAdmin: true }), false);
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.warning).toContain("ostatnia rola administratora");
    }
  });

  it("nadanie roli nie pyta nawet wtedy, gdy dotyczy wlasnego konta", () => {
    // Konto z rola `user` nie moze byc `isSelf` w praktyce (nie-admin nie widzi
    // przegladu), ale maszyna stanow nie ma prawa na tym polegac.
    const action = planRoleAction(ctx({ role: "user", isSelf: true }), false);
    expect(action.kind).toBe("send");
  });
});

describe("targetRoleFor", () => {
  it("zawsze wskazuje role przeciwna", () => {
    expect(targetRoleFor(ctx({ role: "admin" }))).toBe("user");
    expect(targetRoleFor(ctx({ role: "user" }))).toBe("admin");
  });
});

describe("roleActionLabel", () => {
  it("mowi, co sie stanie, i jest krotki", () => {
    expect(roleActionLabel(ctx({ role: "user" }))).toBe("Nadaj rolę");
    expect(roleActionLabel(ctx({ role: "admin" }))).toBe("Odbierz rolę");
  });

  it("NIE rozroznia wlasnego konta — to niesie wiersz, nie przycisk", () => {
    expect(roleActionLabel(ctx({ role: "admin", isSelf: true }))).toBe(roleActionLabel(ctx({ role: "admin" })));
  });
});

describe("roleActionAriaLabel", () => {
  it("jest pelna, bo czytnik ekranu nie widzi wiersza", () => {
    // Tekst widoczny moze byc krotki, bo obok stoi kolumna "Rola" i znacznik "to Ty".
    // Nazwa dostepna musi wystarczyc SAMA — stad rola, adres i przypadek wlasnego konta.
    expect(roleActionAriaLabel(ctx({ role: "user" }), "a@b.pl")).toBe("Nadaj rolę administratora — a@b.pl");
    expect(roleActionAriaLabel(ctx({ role: "admin" }), "a@b.pl")).toBe("Odbierz rolę administratora — a@b.pl");
    expect(roleActionAriaLabel(ctx({ role: "admin", isSelf: true }), "a@b.pl")).toBe(
      "Odbierz rolę administratora sobie — a@b.pl",
    );
  });

  it("kazda nazwa dostepna niesie adres konta", () => {
    // Bez adresu dwa przyciski w tabeli mialyby identyczna nazwe i nie dalo by sie
    // ich odroznic bez patrzenia na wiersz.
    for (const c of [ctx({ role: "user" }), ctx({ role: "admin" }), ctx({ role: "admin", isSelf: true })]) {
      expect(roleActionAriaLabel(c, "ktos@example.test")).toContain("ktos@example.test");
    }
  });
});

describe("losesOwnAccess", () => {
  it("jest prawda tylko przy zdejmowaniu roli sobie", () => {
    expect(losesOwnAccess(ctx({ role: "admin", isSelf: true }))).toBe(true);
    expect(losesOwnAccess(ctx({ role: "admin", isSelf: false }))).toBe(false);
    // Nadanie sobie roli, ktorej sie nie ma, niczego nie odbiera.
    expect(losesOwnAccess(ctx({ role: "user", isSelf: true }))).toBe(false);
  });
});

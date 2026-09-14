import type { AccountRole } from "@/types";

/**
 * Decyzja, co robi klikniecie przy wierszu konta (S-10, FR-018).
 *
 * DLACZEGO TO JEST TU, A NIE W KOMPONENCIE. Repo nie ma infrastruktury do testowania
 * komponentow: `vitest.config.ts` ma `environment: "node"` i `include:
 * ["src/**\/*.test.ts"]`, wiec plik `.tsx` nie zostalby nawet wybrany, a jsdom ani
 * `@testing-library/react` nie sa zainstalowane — zaden z trzynastu istniejacych
 * plikow testowych nie renderuje komponentu. Rzecz warta sprawdzenia nie jest tu
 * zreszta markupem, tylko MASZYNA STANOW: czy to klikniecie pyta, czy wysyla, i z
 * jakim potwierdzeniem. Wyjeta tutaj jest testowalna bez DOM-u i zgodna z ksztaltem
 * calej reszty `src/lib/`.
 *
 * Wyspa zostaje cienka: renderuje stan i wola te funkcje.
 */

export interface RoleActionContext {
  /** Aktualna rola konta, ktorego dotyczy wiersz. */
  role: AccountRole;
  /** Czy to wiersz konta, ktore oglada przeglad. */
  isSelf: boolean;
  /** Czy zdjecie roli z tego konta zabraloby OSTATNIA role administratora. */
  isLastAdmin: boolean;
}

export type RoleAction =
  /** Najpierw zapytaj. Zadanie NIE jest wysylane. */
  | { kind: "confirm"; targetRole: AccountRole; warning: string }
  /** Wyslij teraz. */
  | { kind: "send"; targetRole: AccountRole; confirmLast: boolean };

/** Rola, na ktora klikniecie przestawia konto — zawsze przeciwna do obecnej. */
export function targetRoleFor(context: RoleActionContext): AccountRole {
  return context.role === "admin" ? "user" : "admin";
}

/** Etykieta przycisku. Mowi, co sie stanie, nie jaki jest stan. */
export function roleActionLabel(context: RoleActionContext): string {
  if (context.role === "admin") {
    return context.isSelf ? "Odbierz rolę sobie" : "Odbierz rolę";
  }
  return "Nadaj rolę administratora";
}

/**
 * Czy po tej operacji WOLAJACY straci wlasny dostep do sekcji administratora.
 *
 * Decyduje o tym, czy po sukcesie przeladowac strone (konto obce), czy najpierw
 * powiedziec, co sie stalo (konto wlasne). Ciche zniknniecie calej sekcji wyglada
 * identycznie jak awaria — `lessons.md` § "Degradacja odczytu nie chroni renderowania".
 */
export function losesOwnAccess(context: RoleActionContext): boolean {
  return context.isSelf && context.role === "admin";
}

/**
 * Czy klikniecie musi najpierw zapytac.
 *
 * DWA POWODY, OBA O NIEODWRACALNOSCI DLA KLIKAJACEGO, nie o wadze operacji:
 * zdejmujesz role SOBIE (stracisz dostep do tej sekcji) albo zdejmujesz OSTATNIA
 * (administracja przestanie byc dostepna z produktu i nie da sie jej przywrocic
 * zadnym ekranem — PRD v4, FR-018).
 *
 * NADANIE roli nigdy nie pyta: nikomu niczego nie odbiera i da sie je odklikac.
 */
function needsConfirm(context: RoleActionContext): boolean {
  return context.role === "admin" && (context.isSelf || context.isLastAdmin);
}

/** Ostrzezenie nazywa SKUTEK, nie mechanizm. Przypadek "ostatnia" wygrywa nad "sobie". */
function warningFor(context: RoleActionContext): string {
  if (context.isLastAdmin) {
    return "To ostatnia rola administratora. Po jej zdjęciu administracja przestanie być dostępna z poziomu aplikacji — przywrócić ją będzie można tylko poza nią.";
  }
  return "Zdejmujesz rolę sobie. Stracisz dostęp do tej sekcji przy następnym żądaniu.";
}

/**
 * Co ma zrobic klikniecie.
 *
 * `confirmed` mowi, czy uzytkownik przeszedl juz przez pytanie. Pierwsze klikniecie
 * wola to z `false`, drugie z `true`.
 *
 * `confirmLast` wysylamy ZAWSZE jawnie i rowne `isLastAdmin`. Gdy flaga jest
 * nieaktualna (ktos zmienil role rownolegle), baza odpowie `LAST_ADMIN_NEEDS_CONFIRM`
 * i interfejs zapyta wtedy — dlatego ta wartosc nie musi byc tu prorocza, tylko
 * uczciwa wobec tego, co widac na ekranie.
 */
export function planRoleAction(context: RoleActionContext, confirmed: boolean): RoleAction {
  const targetRole = targetRoleFor(context);

  if (needsConfirm(context) && !confirmed) {
    return { kind: "confirm", targetRole, warning: warningFor(context) };
  }

  return { kind: "send", targetRole, confirmLast: context.isLastAdmin };
}

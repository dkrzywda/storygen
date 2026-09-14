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

/**
 * Tekst WIDOCZNY na przycisku. Mowi, co sie stanie, nie jaki jest stan.
 *
 * Krotki celowo. Wczesniej bylo tu "Nadaj role administratora" i "Odbierz role sobie",
 * przez co kolumna akcji zajmowala 169 px, a caly przeglad nie miescil sie w panelu
 * (zmierzone 2026-09-14). Kontekst, ktory z tego tekstu zniknal, NIE ZNIKA z ekranu:
 * kolumna "Rola" pokazuje stan konta, a wiersz wlasnego konta jest oznaczony "to Ty".
 *
 * Dla czytnika ekranu to jednak za malo, bo on czyta przycisk w oderwaniu od wiersza —
 * stad `roleActionAriaLabel` ponizej, ktora zostaje pelna.
 */
export function roleActionLabel(context: RoleActionContext): string {
  return context.role === "admin" ? "Odbierz rolę" : "Nadaj rolę";
}

/**
 * Nazwa DOSTEPNA przycisku — pelna, bo czytnik ekranu nie widzi wiersza.
 *
 * Niesie trzy rzeczy, ktorych skrocony tekst juz nie ma: czego dotyczy operacja
 * (rola administratora), ktorego konta (adres) i czy chodzi o wlasne konto.
 */
export function roleActionAriaLabel(context: RoleActionContext, email: string): string {
  if (context.role !== "admin") {
    return `Nadaj rolę administratora — ${email}`;
  }
  return context.isSelf ? `Odbierz rolę administratora sobie — ${email}` : `Odbierz rolę administratora — ${email}`;
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
 * DWA POWODY, I SA ONE ROZNEJ WAGI — wczesniej ten komentarz twierdzil, ze oba sa
 * "o nieodwracalnosci dla klikajacego". To bylo NIEPRAWDA dla jednego z nich
 * i zostalo poprawione po przegladzie calosci (2026-09-14).
 *
 * 1. OSTATNIA rola — bariera realna. Administracja przestanie byc dostepna
 *    z produktu i zaden ekran jej nie przywroci (PRD v4, FR-018). Ta bariera stoi
 *    W BAZIE: `set_account_role` odmawia bez `p_confirm_last`, wiec nie da sie jej
 *    ominac wywolaniem RPC wprost. Pytanie tutaj jest tylko uprzejmoscia wobec
 *    tamtej odmowy, nie jej zrodlem.
 *
 * 2. Zdjecie roli SOBIE — uprzejmosc, nie bariera. `set_account_role` NIE ZNA
 *    pojecia wlasnego konta: przyjmuje `p_account`, `p_role`, `p_confirm_last`
 *    i tyle. To pytanie omija wiec zwykly `PATCH` z `curl`, i jest to SWIADOME.
 *    Zasada z planu ("Potwierdzenie jest parametrem funkcji, nie stanem
 *    interfejsu") dotyczy ochrony przed CUDZYM dzialaniem; tutaj chronimy
 *    klikajacego przed nim samym, a operacja jest odwracalna — inny administrator
 *    role przywroci, a gdy innego nie ma, jest to juz przypadek 1 i wtedy baza
 *    odmawia. Przenoszenie tego do bazy dolozyloby parametr bez zysku
 *    bezpieczenstwa.
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

/**
 * Decyzja, co robi klikniecie przycisku blokady przy wierszu konta (S-11, FR-016).
 *
 * DLACZEGO TO JEST TU, A NIE W KOMPONENCIE — ten sam powod co przy
 * `@/lib/account-role-action`: repo nie ma infrastruktury do testowania komponentow
 * (`vitest.config.ts` ma `environment: "node"` i `include: ["src/**\/*.test.ts"]`,
 * wiec plik `.tsx` nie zostalby nawet wybrany, a jsdom ani `@testing-library/react`
 * nie sa zainstalowane). Rzecz warta sprawdzenia nie jest tu zreszta markupem, tylko
 * MASZYNA STANOW: czy to klikniecie pyta, czy wysyla, i z jakim potwierdzeniem.
 *
 * Wyspa zostaje cienka: renderuje stan i wola te funkcje.
 */

export interface BlockActionContext {
  /** Czy konto z tego wiersza jest ZABLOKOWANE w tej chwili. */
  isBlocked: boolean;
  /** Czy to wiersz konta, ktore oglada przeglad. */
  isSelf: boolean;
  /**
   * Czy to konto jest OSTATNIM czynnym administratorem.
   *
   * Ta sama kolumna, ktorej uzywa przycisk roli, i to jest zamierzone: baza liczy
   * ja jako „ma role admin, nie jest zablokowane, a czynnych adminow jest dokladnie
   * jeden". Zablokowanie takiego konta i zdjecie mu roli maja DOKLADNIE TEN SAM
   * skutek — administracja przestaje byc osiagalna — wiec pytanie tez jest to samo.
   */
  isLastAdmin: boolean;
}

export type BlockAction =
  /** Najpierw zapytaj. Zadanie NIE jest wysylane. */
  | { kind: "confirm"; targetBlocked: boolean; warning: string }
  /** Wyslij teraz. */
  | { kind: "send"; targetBlocked: boolean; confirmLast: boolean };

/** Stan, na ktory klikniecie przestawia konto — zawsze przeciwny do obecnego. */
export function targetBlockedFor(context: BlockActionContext): boolean {
  return !context.isBlocked;
}

/**
 * Tekst WIDOCZNY na przycisku. Mowi, co sie stanie, nie jaki jest stan.
 *
 * Krotki celowo — kolumna akcji ma zmierzone 0 px zapasu (S-10), wiec dluzszy tekst
 * przywrocilby poziome przewijanie calej tabeli. Kontekst, ktorego tu nie ma, NIE
 * ZNIKA z ekranu: stan blokady jest oznaczony pod adresem konta.
 */
export function blockActionLabel(context: BlockActionContext): string {
  return context.isBlocked ? "Odblokuj" : "Zablokuj";
}

/**
 * Nazwa DOSTEPNA przycisku — pelna, bo czytnik ekranu czyta przycisk w oderwaniu
 * od wiersza i nie widzi ani adresu, ani znacznika stanu.
 */
export function blockActionAriaLabel(context: BlockActionContext, email: string): string {
  if (context.isBlocked) {
    return `Odblokuj konto — ${email}`;
  }
  return context.isSelf ? `Zablokuj własne konto — ${email}` : `Zablokuj konto — ${email}`;
}

/**
 * Czy po tej operacji WOLAJACY straci wlasny dostep do produktu.
 *
 * Decyduje o tym, czy po sukcesie przeladowac strone (konto obce), czy najpierw
 * powiedziec, co sie stalo (konto wlasne). Ciche wypchniecie na ekran logowania
 * wyglada identycznie jak awaria — `lessons.md` § „Degradacja odczytu nie chroni
 * renderowania".
 *
 * Tylko BLOKOWANIE siebie: odblokowanie siebie jest z tego ekranu nieosiagalne,
 * bo zablokowany nie przechodzi bramki i wcale go nie widzi.
 */
export function losesOwnAccess(context: BlockActionContext): boolean {
  return context.isSelf && !context.isBlocked;
}

/**
 * Czy klikniecie musi najpierw zapytac.
 *
 * ODBLOKOWANIE NIE PYTA NIGDY — nikomu niczego nie odbiera i da sie je odklikac.
 * Ten sam warunek stoi w bazie (`set_account_blocked` sprawdza `p_blocked` przed
 * liczeniem adminow), wiec interfejs nie wymysla tu wlasnej reguly.
 *
 * DWA POWODY, BY ZAPYTAC, I SA ONE ROZNEJ WAGI — dokladnie jak przy zmianie roli:
 *
 * 1. OSTATNI czynny administrator — bariera realna. Administracja przestanie byc
 *    osiagalna z produktu i zaden ekran jej nie przywroci. Ta bariera stoi W BAZIE:
 *    `set_account_blocked` odmawia bez `p_confirm`, wiec nie da sie jej ominac
 *    wywolaniem RPC wprost. Pytanie tutaj jest tylko uprzejmoscia wobec tamtej
 *    odmowy, nie jej zrodlem.
 *
 * 2. Zablokowanie SIEBIE, gdy administratorow jest wiecej — uprzejmosc, nie bariera.
 *    `set_account_blocked` NIE ZNA pojecia wlasnego konta: przyjmuje `p_account`,
 *    `p_blocked`, `p_confirm` i tyle. To pytanie omija wiec zwykly `PATCH`
 *    z `curl`, i jest to SWIADOME (ustalenie F3 przegladu faz 1-2, ktore zwrocilo
 *    uwage, ze plan zapowiadal ten warunek takze w bazie). Zasada „ochrona stoi
 *    w bazie" dotyczy ochrony przed CUDZYM dzialaniem; tutaj chronimy klikajacego
 *    przed nim samym, a operacja jest ODWRACALNA — inny administrator odblokuje,
 *    a gdy innego nie ma, jest to juz przypadek 1 i wtedy baza odmawia. Przenoszenie
 *    tego do bazy dolozyloby parametr bez zysku bezpieczenstwa.
 */
function needsConfirm(context: BlockActionContext): boolean {
  return !context.isBlocked && (context.isSelf || context.isLastAdmin);
}

/** Ostrzezenie nazywa SKUTEK, nie mechanizm. Przypadek „ostatni admin" wygrywa nad „sobie". */
function warningFor(context: BlockActionContext): string {
  if (context.isLastAdmin) {
    return "To ostatni czynny administrator. Po zablokowaniu administracja przestanie być dostępna z poziomu aplikacji — odblokować będzie można tylko poza nią.";
  }
  return "Blokujesz własne konto. Stracisz dostęp przy następnym żądaniu, a odblokować Cię będzie mógł tylko inny administrator.";
}

/**
 * Co ma zrobic klikniecie.
 *
 * `confirmed` mowi, czy uzytkownik przeszedl juz przez pytanie. Pierwsze klikniecie
 * wola to z `false`, drugie z `true`.
 *
 * `confirmLast` wysylamy ZAWSZE jawnie i rowne `isLastAdmin`. Gdy flaga jest
 * nieaktualna (ktos zmienil role albo zablokowal kogos rownolegle), baza odpowie
 * `LAST_ADMIN_NEEDS_CONFIRM` i interfejs zapyta wtedy — dlatego ta wartosc nie musi
 * byc prorocza, tylko uczciwa wobec tego, co widac na ekranie.
 */
export function planBlockAction(context: BlockActionContext, confirmed: boolean): BlockAction {
  const targetBlocked = targetBlockedFor(context);

  if (needsConfirm(context) && !confirmed) {
    return { kind: "confirm", targetBlocked, warning: warningFor(context) };
  }

  return { kind: "send", targetBlocked, confirmLast: context.isLastAdmin };
}

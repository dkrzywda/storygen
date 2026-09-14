/**
 * Decyzja, co robi klikniecie przycisku usuniecia przy wierszu konta (S-12, FR-017).
 *
 * DLACZEGO TO JEST TU, A NIE W KOMPONENCIE — ten sam powod co przy
 * `@/lib/account-role-action` i `@/lib/account-block-action`: repo nie ma
 * infrastruktury do testowania komponentow. Rzecz warta sprawdzenia nie jest tu
 * markupem, tylko trescia ostrzezenia i tym, czy klikniecie pyta.
 */

export interface DeleteActionContext {
  /** Czy to wiersz konta, ktore oglada przeglad. */
  isSelf: boolean;
  /** Ile zapisanych generacji zniknie razem z kontem — liczba z przegladu. */
  generations: number;
}

export type DeleteAction =
  /** Najpierw zapytaj. Zadanie NIE jest wysylane. */
  | { kind: "confirm"; warning: string }
  /** Wyslij teraz. */
  | { kind: "send" };

/** Tekst WIDOCZNY na przycisku. Krotki, bo kolumna akcji ma zmierzone 0 px zapasu. */
export function deleteActionLabel(): string {
  return "Usuń";
}

/** Nazwa DOSTEPNA — czytnik ekranu czyta przycisk w oderwaniu od wiersza. */
export function deleteActionAriaLabel(email: string): string {
  return `Usuń konto wraz z jego tekstami — ${email}`;
}

/**
 * Czy przycisk usuniecia ma sie w ogole pojawic przy tym wierszu.
 *
 * NIE przy wlasnym koncie. Baza i tak odmowi (`SELF_DELETE_FORBIDDEN`), ale
 * rysowanie przycisku, ktory ZAWSZE odmawia, byloby klamstwem ekranu — obiecuje
 * operacje, ktorej nie ma. Bariera stoi w bazie; to jest tylko uczciwosc widoku
 * wobec niej.
 */
export function canOfferDelete(context: DeleteActionContext): boolean {
  return !context.isSelf;
}

/**
 * Ostrzezenie nazywa to, co ZNIKNIE, a nie mechanizm.
 *
 * LICZBA JEST W TRESCI, bo to jest caly sens guardraila z PRD: „nic nie niszczy
 * zapisanych generacji bez uprzedzenia, na powierzchni produktu, CO zostanie
 * zniszczone". Ostrzezenie bez liczby spelnia wymog tylko pozornie.
 *
 * Konto BEZ generacji dostaje inne zdanie, a nie „0 tekstow": zero jest tu
 * informacja, ze nie ma czego zalowac, i lepiej powiedziec to wprost.
 */
function warningFor(context: DeleteActionContext): string {
  const trwale = "Tej operacji nie da się cofnąć.";

  if (context.generations === 0) {
    return `Usuniesz to konto. Nie ma zapisanych tekstów do utraty. ${trwale}`;
  }

  const n = context.generations;
  // PRZYMIOTNIK ODMIENIA SIE RAZEM Z RZECZOWNIKIEM. Pierwsza wersja zmieniala
  // tylko rzeczownik i produkowala „zapisanym tekstami" — blad niewidoczny
  // w tescie, bo sprawdzal on wylacznie forme pojedyncza. Wyszedl dopiero
  // na ekranie.
  const czym = n === 1 ? "zapisanym tekstem" : "zapisanymi tekstami";

  return `Usuniesz to konto wraz z jego ${czym} — zniknie ${odmiana(n)}. ${trwale}`;
}

/**
 * Polska odmiana liczebnika: 1 tekst, 2-4 teksty, 5+ tekstow — z wyjatkiem
 * nastolatek (12 tekstow, nie „12 teksty").
 *
 * Osobna funkcja, bo to jedyna rzecz w tym module, ktora da sie pomylic po cichu:
 * zla forma nie rzuci bledem, tylko sprawi, ze komunikat o NIEODWRACALNEJ
 * operacji zabrzmi jak maszyna — a ma byc przeczytany uwaznie.
 *
 * Pierwsza wersja budowala to zdanie dwoma lancuchowymi `replace` na tekscie,
 * ktory sama sklejala. Dzialalo, ale bylo nieczytelne i kruche na kazda zmiane
 * brzmienia — przepisane, zanim weszlo do commitu.
 */
function odmiana(n: number): string {
  if (n === 1) {
    return "1 tekst";
  }

  const ostatnia = n % 10;
  const przedostatnia = Math.floor(n / 10) % 10;
  const mnoga = ostatnia >= 2 && ostatnia <= 4 && przedostatnia !== 1 ? "teksty" : "tekstów";

  return `${String(n)} ${mnoga}`;
}

/**
 * Co ma zrobic klikniecie.
 *
 * PYTA ZAWSZE. Nie ma tu przypadku „wyslij od razu", ktory maja pozostale dwie
 * operacje dla dzialan nieodbierajacych niczego — usuniecia nie da sie odkliknac,
 * wiec kazde jego wywolanie z interfejsu przechodzi przez pytanie.
 */
export function planDeleteAction(context: DeleteActionContext, confirmed: boolean): DeleteAction {
  if (!confirmed) {
    return { kind: "confirm", warning: warningFor(context) };
  }

  return { kind: "send" };
}

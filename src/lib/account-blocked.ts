/**
 * Czy konto jest zablokowane (S-11, FR-016).
 *
 * DRUGI, NIEZALEZNY MECHANIZM. Dostawca tozsamosci pilnuje DRZWI WEJSCIOWYCH —
 * odmawia logowania kontu zawieszonemu i robi to sam, bez naszego kodu (zmierzone:
 * `400`, `user_banned`). Ten modul pilnuje tego, KTO JEST JUZ W SRODKU: zmierzone
 * 2026-09-14, po zablokowaniu konta jego trwajaca sesja czytala dane jeszcze przez
 * **60 minut** — tyle, ile zyje token. `GET /auth/v1/user` i `rpc/usage_today`
 * odpowiadaly 200 zarowno przed blokada, jak i po niej.
 *
 * FR-016 mowi, ze zablokowane konto "nie moze korzystac z produktu", wiec sama
 * odmowa logowania wymogu nie spelnia.
 *
 * `banned_until` PRZYCHODZI ZA DARMO. Jest w odpowiedzi `/auth/v1/user`, ktora
 * middleware i tak pobiera przy kazdym zadaniu, i jest zadeklarowane w typie SDK
 * (`@supabase/auth-js/dist/module/lib/types.d.ts:386`, `banned_until?: string`).
 * Bramka nie kosztuje ani jednego dodatkowego zapytania.
 */

/**
 * Ksztalt, ktorego ta funkcja naprawde potrzebuje — a nie caly `User`.
 *
 * Wezszy typ jest tu celem, nie oszczednoscia: dzieki niemu test moze podac
 * `{ banned_until: "..." }` bez budowania kilkunastopolowego obiektu uzytkownika,
 * wiec przypadki brzegowe da sie napisac wprost.
 */
export interface BlockableAccount {
  banned_until?: string | null;
}

/**
 * `true` tylko wtedy, gdy blokada obowiazuje TERAZ.
 *
 * POROWNANIE Z CZASEM, NIE SPRAWDZENIE OBECNOSCI WARTOSCI. `banned_until` jest
 * znacznikiem czasu, nie flaga — konto z data w PRZESZLOSCI jest AKTYWNE. Zapis
 * `banned_until != null` wygladalby poprawnie i przeszedlby wiekszosc testow,
 * a blokowalby konta, ktorym blokada minela. Ta sama pulapka jest opisana
 * w naglowku migracji `20260914120000` i pilnuje jej tam osobny przypadek testowy.
 *
 * WEJSCIE NIEOCZEKIWANE DAJE `false`, czyli PRZEPUSZCZA — i to jest decyzja,
 * nie przeoczenie. Plan zapisal w `Contract` "fail-closed", a w kryteriach sukcesu
 * wprost przeciwnie: "`null` i wejscia nieoczekiwane daja `false`". Rozstrzygniete
 * na korzysc kryterium, bo koszty sa niesymetryczne:
 *
 *   - falszywe `true` wypycha ZDROWE konto z KAZDEGO zadania, z komunikatem
 *     o zawieszeniu dostepu, i nie da sie tego obejsc z wnetrza produktu;
 *   - falszywe `false` zostawia zablokowanemu sesje na co najwyzej godzine —
 *     czyli dokladnie stan sprzed tego plastra — a przy nastepnym logowaniu
 *     i tak odmawia dostawca, ktory czyta kolumne, nie te funkcje.
 *
 * Bramka jest wiec DRUGA warstwa, a nie jedyna, i nie ma prawa byc grozniejsza
 * od problemu, ktory rozwiazuje.
 *
 * @param account konto z sesji; `null`/`undefined` znaczy "brak sesji", nie "zablokowane"
 * @param now wstrzykiwalny czas — test nie moze zalezec od zegara maszyny
 */
/**
 * Sciezki, ktorych bramka blokady NIE dotyczy.
 *
 * TO NIE JEST ULATWIENIE, TYLKO WARUNEK DZIALANIA. Bramka przekierowuje na
 * `/auth/signin`; bez wylaczenia z niej samej sciezki `/auth/*` powstalaby petla
 * przekierowan i zablokowany NIGDY nie zobaczylby komunikatu, dla ktorego to
 * wszystko powstalo.
 *
 * `/api/auth/` jest tu z drugiego powodu: zablokowany musi moc sie WYLOGOWAC.
 * Wylogowanie to `POST /api/auth/signout`, a odcinanie komus mozliwosci zakonczenia
 * wlasnej sesji byloby uwiezieniem go w niej, nie zablokowaniem. Logowaniu ta furtka
 * nie szkodzi — zablokowanemu i tak odmawia dostawca.
 *
 * KONCOWY UKOSNIK JEST ZNACZACY. Bez niego `/authx` albo `/api/authorize` wpadlyby
 * pod wyjatek jako prefiks. Pilnuje tego osobny przypadek testowy.
 */
const BLOCK_GATE_EXEMPT = ["/auth/", "/api/auth/"];

/**
 * Co bramka ma zrobic z tym zadaniem.
 *
 * `pass` — przepusc dalej. `redirect` — na strone logowania z kodem w adresie.
 * `json` — odpowiedz kontraktem bledu, bo to wolanie z wyspy, nie nawigacja.
 */
export type BlockGateDecision = "pass" | "redirect" | "json";

/**
 * Decyzja bramki jako FUNKCJA CZYSTA — ustalenie F6 przegladu S-11.
 *
 * Wyciagnieta z `src/middleware.ts`, bo tam nie dalo sie jej przetestowac: kryterium
 * planu wymagalo testu integracyjnego, ktorego zestaw nie potrafi wyrazic, wiec kod
 * stojacy na sciezce KAZDEGO zadania nie mial ani jednego testu. Tutaj ma — bez
 * Dockera, bez sesji i bez klucza sekretnego. To ten sam zabieg, co `planRoleAction`
 * w `@/lib/account-role-action` dla wyspy zmiany roli.
 *
 * DWA KSZTALTY ODPOWIEDZI, JEDEN KONTRAKT BLEDU — regula z CLAUDE.md. Przekierowanie
 * w odpowiedzi na `fetch()` z wyspy byloby dla niej HTML-em ze statusem 200:
 * `readApiError` nie znalazlby tam zadnego kodu, a uzytkownik zobaczylby komunikat
 * domyslny zamiast informacji o zawieszeniu dostepu.
 */
export function blockGateDecision(
  pathname: string,
  account: BlockableAccount | null | undefined,
  now: Date = new Date(),
): BlockGateDecision {
  if (BLOCK_GATE_EXEMPT.some((prefix) => pathname.startsWith(prefix))) {
    return "pass";
  }

  if (!isBlocked(account, now)) {
    return "pass";
  }

  return pathname.startsWith("/api/") ? "json" : "redirect";
}

export function isBlocked(account: BlockableAccount | null | undefined, now: Date = new Date()): boolean {
  if (!account) {
    return false;
  }

  const until = account.banned_until;
  if (typeof until !== "string" || until.trim().length === 0) {
    return false;
  }

  const parsed = Date.parse(until);
  if (Number.isNaN(parsed)) {
    // Wartosc jest, ale nie da sie jej odczytac. Patrz uzasadnienie powyzej:
    // przepuszczamy, bo odmowa logowania i tak stoi u dostawcy.
    return false;
  }

  return parsed > now.getTime();
}

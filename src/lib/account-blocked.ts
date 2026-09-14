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

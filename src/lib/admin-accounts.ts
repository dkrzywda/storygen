import type { createClient } from "@/lib/supabase";
import type { AccountOverviewRow, AccountRole, ApiErrorCode } from "@/types";

/**
 * Przeglad kont dla administratora (S-09, FR-014 i FR-015).
 *
 * OSOBNY MODUL, a nie dopisek do `@/lib/limits` albo `@/lib/generations`: tamten
 * niesie limity, ten drugi tresc, a przeglad kont nie nalezy do zadnego z nich.
 *
 * AUTORYTETEM JEST BAZA. Bramka roli, okno doby, prog na konto i sufit wierszy
 * mieszkaja w `public.accounts_overview()`. Tutaj nie ma ani jednej z tych decyzji —
 * i nie moze ich byc: sprawdzenie roli po stronie klienta byloby obejsciem
 * o jedno wywolanie PostgREST.
 *
 * ZERO WIERSZY TO POPRAWNA ODPOWIEDZ, NIE AWARIA. Funkcja w bazie oddaje pusty
 * zbior kazdemu, kto nie ma roli `admin` — pusty wynik jest nieodroznialny od
 * "brak kont", wiec nie ujawnia, ze przeglad istnieje (FR-015). Ten modul NIE
 * zamienia pustki na blad.
 */

/** Typ klienta bierzemy z fabryki, zeby nie rozjechal sie przy zmianie w `supabase.ts`. */
type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * Czyta przeglad kont.
 *
 * **Rzuca** przy bledzie bazy — decyzje, co z tym zrobic, podejmuje wywolujacy,
 * tak samo jak przy `fetchUsageToday`. Panel degraduje: `null` znaczy "nie wiem",
 * a nie "brak kont".
 */
export async function fetchAccountsOverview(supabase: Client): Promise<AccountOverviewRow[]> {
  const { data, error } = await supabase.rpc("accounts_overview");

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    registeredAt: new Date(row.registered_at),
    // Zawezenie do `AccountRole` jest tu SWIADOME i jednostronne. Baza zwraca `text`,
    // a `coalesce(..., 'user')` gwarantuje jedna z dwoch wartosci — ale gwarantuje to
    // SQL, nie typ. Nierozpoznana wartosc traktujemy jak `user`, czyli fail-closed,
    // tak samo jak `isAdmin` traktuje brak klucza.
    role: row.role === "admin" ? "admin" : "user",
    isSelf: row.is_self,
    isLastAdmin: row.is_last_admin,
    isBlocked: row.is_blocked,
    generations: row.generations,
    usedToday: row.used_today,
    ownLimit: row.own_limit,
    rowLimit: row.row_limit,
  }));
}

/**
 * Kody, ktore moga zwrocic funkcje dzialajace na koncie: `set_account_role()`
 * (S-10), `set_account_blocked()` (S-11) oraz `delete_account()` (S-12).
 *
 * Zwracaja KOD, nie boolean i nie wyjatek — wzorzec `record_attempt_if_allowed`.
 * Wolajacy musi wiedziec, KTORA granica zadzialala: brak uprawnien to inna
 * sytuacja niz brak potwierdzenia przy ostatnim administratorze, i endpoint
 * mapuje je na rozne odpowiedzi.
 *
 * NAZWA JEST OPERACYJNIE NEUTRALNA OD S-11 (dawniej `RoleChangeCode`). Zbior
 * kodow jest wspolny dla obu operacji, a nazwa mowiaca o jednej z nich sugeruje
 * czytelnikowi, ze druga ma wlasny — to ta sama pomylka, ktora przy komunikacie
 * `LAST_ADMIN_CONFIRM_REQUIRED` dala zdanie o „zdjeciu roli" przy blokowaniu
 * (ustalenie F4 przegladu S-11).
 */
export type AccountActionCode =
  | "ok"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "LAST_ADMIN_NEEDS_CONFIRM"
  // Dwa kody wylacznie z `delete_account()` (S-12). Zbior jest wspolny dla
  // wszystkich trzech funkcji dzialajacych na koncie, ale nie kazda zwraca
  // kazdy — `delete_account` nigdy nie odda `LAST_ADMIN_NEEDS_CONFIRM`, bo ta
  // galaz jest w niej nieosiagalna (patrz naglowek `20260914160000`).
  | "SELF_DELETE_FORBIDDEN"
  | "DESTROY_CONFIRM_REQUIRED"
  // NIE JEST KODEM Z BAZY — zaden `return query` go nie zwraca. Znaczy „funkcja
  // `returns table` oddala ZERO wierszy", czyli rozjazd kontraktu miedzy baza
  // a aplikacja. Celowo NIE MA go w `mapAccountActionCode`: ma wpasc w `default`
  // i wyjsc jako `INTERNAL`, zeby endpoint go zalogowal. Dopisanie mu tam
  // przypadku uciszyloby jedyna diagnostyke, dla ktorej powstal (ustalenie F2
  // przegladu `S-12`).
  | "NO_ROW";

/**
 * Mapuje kod z bazy na kod kontraktu API (F-01).
 *
 * `"ok"` przechodzi jako `"ok"`; wszystko inne wraca jako `ApiErrorCode`.
 *
 * `FORBIDDEN` → `NOT_FOUND`, NIE 403. Odpowiedz 403 potwierdzalaby istnienie
 * operacji kazdemu, kto zgadnie adres — dokladnie to, czego FR-015 zabrania dla
 * przegladu, i nie ma powodu, by zapis byl gadatliwszy od odczytu.
 *
 * FAIL-CLOSED: kod spoza zbioru daje `INTERNAL`, a nie `ok`. Baza jest tu
 * autorytetem, ale odpowiedz z sieci nie jest obietnica — nieznana wartosc znaczy
 * "nie wiem, co sie stalo", a to nie jest sukces.
 */
export function mapAccountActionCode(raw: string): ApiErrorCode | "ok" {
  switch (raw) {
    case "ok":
      return "ok";
    case "FORBIDDEN":
      return "NOT_FOUND";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "VALIDATION_FAILED":
      return "VALIDATION_FAILED";
    case "LAST_ADMIN_NEEDS_CONFIRM":
      return "LAST_ADMIN_CONFIRM_REQUIRED";
    // Te dwa NIE sa mapowane na `NOT_FOUND` jak `FORBIDDEN`, i to jest celowe.
    // Tam ukrywamy istnienie operacji przed kims, kto nie ma do niej prawa;
    // tutaj wolajacy JEST administratorem i pyta o wlasne konto albo o wlasna
    // zgode — nie ma czego przed nim ukrywac, a wyciszenie tych kodow zamienilo
    // by uczciwa odmowe w mylace "nie znaleziono".
    case "SELF_DELETE_FORBIDDEN":
      return "SELF_DELETE_FORBIDDEN";
    case "DESTROY_CONFIRM_REQUIRED":
      return "DESTROY_CONFIRM_REQUIRED";
    default:
      return "INTERNAL";
  }
}

/**
 * Zmienia role konta.
 *
 * **Rzuca** przy bledzie bazy — tak samo jak `fetchAccountsOverview`. Odmowa
 * bramki bledem NIE jest: wraca jako kod `FORBIDDEN`, bo funkcja wykonala sie
 * poprawnie i po prostu odmowila.
 *
 * `confirmLast` jest przekazywane ZAWSZE, nigdy pomijane. Funkcja w bazie ma
 * `default false`, wiec pominiecie argumentu bylo by rownowazne — ale poleganie
 * na domysle bazy zamiast na kontrakcie wywolania jest dokladnie tym rodzajem
 * cichego zalozenia, ktore ten plaster ma eliminowac (ustalenie F4 przegladu p1).
 */
export async function setAccountRole(
  supabase: Client,
  accountId: string,
  role: AccountRole,
  confirmLast: boolean,
): Promise<AccountActionCode> {
  const { data, error } = await supabase.rpc("set_account_role", {
    p_account: accountId,
    p_role: role,
    p_confirm_last: confirmLast,
  });

  if (error) {
    throw error;
  }

  // `data` jest typowane jako `string`, ale przychodzi z sieci. Zawezenie zostawiamy
  // `mapAccountActionCode`, ktore jest fail-closed — tu nie udajemy, ze wiemy wiecej.
  return data as AccountActionCode;
}

/**
 * Blokuje albo odblokowuje konto (S-11, FR-016).
 *
 * **Rzuca** przy bledzie bazy — tak samo jak `setAccountRole`. Odmowa bramki
 * bledem NIE jest: wraca jako kod `FORBIDDEN`, bo funkcja wykonala sie poprawnie
 * i po prostu odmowila.
 *
 * `confirm` jest przekazywane ZAWSZE, nigdy pomijane — ten sam powod co przy
 * `setAccountRole`: funkcja w bazie ma `default false`, ale poleganie na domysle
 * bazy zamiast na kontrakcie wywolania jest cichym zalozeniem.
 *
 * ODBLOKOWANIE NIE PYTA NIGDY — decyduje o tym baza, nie ten modul. Tutaj nie ma
 * ani jednej decyzji o tym, kiedy potrzebna jest zgoda, i nie moze byc: kopia tej
 * reguly po stronie aplikacji rozjechalaby sie z baza bez zadnego bledu.
 */
export async function setAccountBlocked(
  supabase: Client,
  accountId: string,
  blocked: boolean,
  confirm: boolean,
): Promise<AccountActionCode> {
  const { data, error } = await supabase.rpc("set_account_blocked", {
    p_account: accountId,
    p_blocked: blocked,
    p_confirm: confirm,
  });

  if (error) {
    throw error;
  }

  // `data` jest typowane jako `string`, ale przychodzi z sieci. Zawezenie zostawiamy
  // `mapAccountActionCode`, ktore jest fail-closed — tu nie udajemy, ze wiemy wiecej.
  return data as AccountActionCode;
}

/**
 * Wynik usuniecia konta (S-12, FR-017).
 *
 * Liczba wraca RAZEM z kodem, bo ekran ma powiedziec, co sie STALO, a nie co
 * przewidywal. Liczba z przegladu bywa nieaktualna — konto moglo generowac
 * miedzy odczytem tabeli a klikinieciem. Przy kazdej odmowie jest zerem.
 */
export interface AccountDeletion {
  code: AccountActionCode;
  destroyedGenerations: number;
}

/**
 * Usuwa konto wraz z jego generacjami (S-12, FR-017).
 *
 * **Rzuca** przy bledzie bazy — tak samo jak `setAccountRole` i `setAccountBlocked`.
 * Odmowa bramki bledem NIE jest: wraca jako kod, bo funkcja wykonala sie
 * poprawnie i po prostu odmowila.
 *
 * `confirmDestroy` przekazywane ZAWSZE jawnie. Funkcja w bazie ma `default false`,
 * wiec pominiecie argumentu byloby rownowazne odmowie — ale poleganie na domysle
 * bazy zamiast na kontrakcie wywolania jest dokladnie tym cichym zalozeniem,
 * ktore ustalenie F4 przegladu `S-10` kazalo wyeliminowac.
 *
 * NIE MA TU PARAMETRU ZGODY NA OSTATNIEGO ADMINISTRATORA. Ta galaz jest
 * w `delete_account` nieosiagalna: wolajacy musi byc czynnym administratorem,
 * wiec jest liczony, a celem nie moze byc on sam — licznik ma wiec zawsze co
 * najmniej dwa. Pelne uzasadnienie w naglowku `20260914160000`.
 */
export async function deleteAccount(
  supabase: Client,
  accountId: string,
  confirmDestroy: boolean,
): Promise<AccountDeletion> {
  const { data, error } = await supabase.rpc("delete_account", {
    p_account: accountId,
    p_confirm_destroy: confirmDestroy,
  });

  if (error) {
    throw error;
  }

  // `returns table` oddaje TABLICE wierszy, nie pojedynczy wiersz — nawet gdy
  // funkcja zwraca dokladnie jeden. Pusta tablica znaczy, ze baza i aplikacja
  // rozjechaly sie kontraktem; `INTERNAL` przez `mapAccountActionCode` jest
  // wtedy uczciwszy niz udawanie sukcesu.
  //
  // Pierwsza wersja zwracala tu `FORBIDDEN`, ktore mapuje sie na `NOT_FOUND`
  // — czyli 404 nieodroznialne od zwyklego braku konta, z pominieciem galezi
  // logujacej w `[id].ts`. Komentarz obiecywal `INTERNAL`, a kod go nie dawal:
  // sprawdzenie niezdolne zaczerwienic awarii, dla ktorej powstalo.
  const row = data.at(0);
  if (!row) {
    return { code: "NO_ROW", destroyedGenerations: 0 };
  }

  // Zawezenie zostawiamy `mapAccountActionCode`, ktore jest fail-closed —
  // tu nie udajemy, ze wiemy wiecej, niz przyszlo z sieci.
  return { code: row.code as AccountActionCode, destroyedGenerations: row.destroyed_generations };
}

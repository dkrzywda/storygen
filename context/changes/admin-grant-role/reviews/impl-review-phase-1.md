<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin nadaje i odbiera rolę administratora

- **Plan**: `context/changes/admin-grant-role/plan.md`
- **Scope**: Phase 1 of 3
- **Date**: 2026-09-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Weryfikacja kryteriów sukcesu (odtworzona 2026-09-14)

| Kryterium                     | Wynik                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| 1.1 migracja na czystej bazie | 9 migracji, exit 0                                               |
| 1.2 typy zregenerowane        | diff 8 linii, wyłącznie dwie funkcje                             |
| 1.3 skrypt kontrolny          | werdykt OK; `anon=f`, `service_role=f`, `auth=t` dla obu funkcji |
| 1.4 eskalacja odrzucona       | w zestawie Vitest, przechodzi                                    |
| 1.5 test SQL bramki           | 13/13, werdykt OK                                                |
| 1.6 `test:integration`        | 55 testów, **exit 0**                                            |
| 1.7 `tsc --noEmit`            | exit 0                                                           |
| 1.8 test mutacyjny            | zdjęcie bramki czerwieni 6 z 13                                  |

Kontrast potwierdzający czułość: przy wyłączonym Dockerze ten sam zestaw dawał `exit 1` i 55 pominiętych. Zielone przychodzi z czegoś, co porażka zaczerwieniła.

## Findings

### F1 — Bramka nie sprawdza `deleted_at` wołającego, a uzasadnienie tej asymetrii zniknęło

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260909121500_account_role_management.sql:113`, `:160`
- **Detail**: Bramka obu funkcji sprawdza wyłącznie `me.id = auth.uid()` i rolę. Zweryfikowane niezależnie: `deleted_at` jest filtrowane w czterech innych miejscach tego samego pliku (`:78` licznik adminów, `:110` lista kont, `:184` cel zapisu, `:201` licznik przy ostatniej roli) — ale nie dla wołającego. GoTrue przy miękkim usunięciu ustawia `deleted_at`, a wydane tokeny pozostają ważne do wygaśnięcia. Konto administratora „usunięte" może więc nadal nadać rolę `admin` dowolnemu kontu, czyli odtworzyć sobie dostęp trwale. Przy `S-09` konsekwencją tej samej decyzji był tylko odczyt liczb; tutaj jest nią **zapis do `auth.users`**, a migracja nie przewartościowała wagi. Dodatkowo: komentarz z `20260909072831:83` („Filtr dotyczy kont LISTOWANYCH (`u`), nie wolajacego") — jedyny ślad, że to była decyzja, a nie przeoczenie — nie został przeniesiony do nowej wersji funkcji, która jest odtąd kanoniczna.
- **Fix**: Dopisać `and me.deleted_at is null` w bramce obu funkcji i przywrócić komentarz wyjaśniający asymetrię; przy `S-11` dołożyć warunek na stan zablokowania.
  - Strength: Jeden predykat w dwóch miejscach; usuwa całą klasę „żywy token po usunięciu konta", zanim `S-11` i `S-12` odziedziczą ten mechanizm.
  - Tradeoff: Znikomy. Ryzykiem jest tylko to, że dziś nic tego nie testuje, więc zmiana wymaga własnego przypadku.
  - Confidence: HIGH — asymetria potwierdzona odczytem czterech innych wystąpień `deleted_at` w tym samym pliku.
  - Blind spot: Nie zmierzyłem, jak długo token przeżywa miękkie usunięcie w tej wersji GoTrue.
- **Decision**: ACCEPTED-AS-RULE (lessons.md § "Funkcja uprzywilejowana filtruje stan konta wolajacego, nie tylko celu") + FIXED. Dopisane `and me.deleted_at is null` w bramce OBU funkcji, przywrocony komentarz o asymetrii z `20260909072831:83`, dolozony komentarz o `S-11`. Migracja poprawiona w miejscu, bo nie jest jeszcze na produkcji. DOWOD CZULOSCI: przypadki 14-15 testu SQL uruchomione przeciw STAREJ funkcji daly `ok` i `admin` (czyli eskalacja przeszla); po zastosowaniu poprawki 15/15 OK, skrypt kontrolny OK.

### F2 — Zero testów czyta kolumnę `auth.users.role`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Safety & Quality
- **Location**: `context/changes/admin-grant-role/test-set-account-role.sql:41`
- **Detail**: Repo ostrzega przed pomyleniem kolumny `auth.users.role` (rola bazodanowa PostgREST) z `raw_app_meta_data->>'role'` **cztery razy**: w migracji dwukrotnie (`:9`, `:230`), w planie (`plan.md:99`) i w nagłówku samego pliku testowego (`:37`). Plik testowy jawnie ustawia `role => 'authenticated'` w `insert`, żeby pokazać, że o niej pamięta — po czym **nigdy jej nie odczytuje**. Zweryfikowane: `grep` na odczyt tej kolumny w testach daje zero trafień. Awaria opisywana w repo jako najgorsza z możliwych — cicha utrata autoryzacji w całej aplikacji — nie ma ani jednego sprawdzenia.
- **Fix**: Dodać przypadek czytający `u.role` z `auth.users` po ścieżce pozytywnej i oczekujący `'authenticated'`; podnieść oczekiwaną liczbę przypadków w werdykcie.
- **Decision**: FIXED. Dodany przypadek czytajacy `u.role` z `auth.users` po sciezce pozytywnej, oczekiwana wartosc `authenticated`. DOWOD CZULOSCI: mutacja dopisujaca `role = p_role` do `update` czerwieni DOKLADNIE ten przypadek i tylko jego (19 ok, 1 BLAD).

### F3 — Cztery nowe kolumny przeglądu nie są wykonane przez żaden test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Success Criteria
- **Location**: `context/changes/admin-grant-role/verify-grant-role.sql:29`
- **Detail**: `role`, `is_self` i `is_last_admin` nie są odczytane przez żaden artefakt. Zweryfikowane: test SQL **nie woła** `accounts_overview()` ani razu, a zestaw Vitest sprawdza tylko pusty zbiór dla konta bez roli. Jedyna kontrola to `przeglad_kolumn <> 10`, czyli **liczba** kolumn — więc `is_last_admin` zwracające na sztywno `false`, albo liczące adminów razem z usuniętymi, przeszłoby wszystko na zielono. To wzorzec z `lessons.md` § „Zielone czytaj z tego, co zmieniłoby się przy porażce". Dotkliwe podwójnie, bo `is_last_admin` jest **jedyną** podstawą ostrzeżenia wymaganego przez FR-018 przed jednokierunkowymi drzwiami, a `plan.md:60` argumentuje, że ta liczba musi przyjść z tego samego odczytu co dane — czego nic nie weryfikuje.
- **Fix**: Dodać w `test-set-account-role.sql` odczyty `accounts_overview()` w dwóch punktach, w których stan się różni: przy dwóch adminach i przy jednym. Te same dwa odczyty dają różne `is_last_admin`, więc przypadek jest różnicujący. Rozważyć sprawdzanie nazw kolumn (`proargnames`), nie tylko ich liczby.
  - Strength: Miejsce już istnieje i jest darmowe — test ma sesję administratora i zna role obu kont w każdym punkcie.
  - Tradeoff: Rośnie liczba przypadków i werdykt trzeba przestroić.
  - Confidence: HIGH — brak wywołania potwierdzony `grep`-em.
  - Blind spot: Nie sprawdziłem, czy `is_self` da się sensownie zmierzyć bez drugiej sesji.
- **Decision**: FIXED. Test SQL wola teraz `accounts_overview()` w trzech miejscach: `is_last_admin` przy DWOCH adminach (false), `is_self` dla wlasnego wiersza (true), `role` celu (admin), oraz `is_last_admin` przy JEDNYM adminie (true). Ostatnia para jest ROZNICUJACA z konstrukcji: ten sam odczyt, inny stan, inna wartosc — `is_last_admin` zwracajace stala nie przejdzie obu naraz. Sprawdzenie nazw kolumn w skrypcie kontrolnym NIE dodane (wybrana wezsza opcja).

### F4 — `p_confirm_last boolean default false` nie jest w planie ani w addendum

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Plan Adherence
- **Location**: `supabase/migrations/20260909121500_account_role_management.sql:144`
- **Detail**: Plan zapisał trójargumentową sygnaturę bez wartości domyślnej. `default false` sprawia, że PostgREST wystawia także **dwuargumentowy** wariant wywołania (`database.types.ts`: `p_confirm_last?: boolean`), którego kontrakt fazy 2 nie przewiduje. Bramki to nie osłabia — brak argumentu jest równoważny `false`, czyli stronie odmawiającej — ale to powierzchnia wywołania, o której plan milczy.
- **Fix**: Dopisać do addendum jedno zdanie o wartości domyślnej i jej skutku dla powierzchni PostgREST, albo zdjąć `default`.
- **Decision**: FIXED przez zapis, nie przez zmiane kodu. Addendum planu dostalo akapit o `default false`, o dwuargumentowym wariancie wystawianym przez PostgREST i o tym, ze faza 2 ma wysylac trzeci argument zawsze. `default` zostaje.

### F5 — Brak jawnej transakcji mimo wymogu planu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260909121500_account_role_management.sql` (cały) vs `plan.md:265`
- **Detail**: Plan mówi wprost: „Migracja **musi być jedną transakcją**, żeby nie zostawić funkcji usuniętej bez następcy". Plik nie zawiera `begin;`/`commit;`. Dziś spełnione przypadkiem, dwoma różnymi mechanizmami: `supabase db push/reset` opakowuje plik w transakcję, a SQL Editor wysyła całość jednym zapytaniem prostym. Żadne z nich nie jest zapisane w repo ani sprawdzane. Ryzyko materializuje się przy wklejeniu skryptu fragmentami — wtedy funkcja powstaje **bez końcowego bloku `revoke`**, czyli z domyślnymi grantami dla `anon` i `service_role`. Dokładnie ten scenariusz komentarz `:235` opisuje jako „nie rzuca błędu". Kryterium planu zostało odhaczone bez pokrycia w artefakcie.
- **Fix**: Dopisać w nagłówku migracji, że plik musi zostać wykonany w całości jednym wywołaniem i dlaczego; ewentualnie `begin;`/`commit;`.
  - Strength: Adresuje realną drogę wdrożenia na produkcję, gdzie migracja idzie ręcznie przez edytor dostawcy.
  - Tradeoff: Jawna transakcja daje ostrzeżenie o zagnieżdżeniu przy `db push`.
  - Confidence: HIGH — brak `begin`/`commit` potwierdzony.
  - Blind spot: Nie zmierzyłem, jak SQL Editor dostawcy zachowa się przy jawnej transakcji.
- **Decision**: FIXED przez zapis wymogu, nie przez begin/commit. Naglowek migracji niesie teraz akapit: plik MUSI zostac wykonany w calosci jednym wywolaniem, z wyjasnieniem obu mechanizmow (db push opakowuje plik w transakcje, edytor SQL dostawcy wysyla caly skrypt jako zapytanie proste) i z nazwaniem grozniejszego skutku wklejenia fragmentami — funkcja utworzona BEZ koncowego revoke, czyli z domyslnymi grantami Supabase, i to bez zadnego bledu.

### F6 — Skrypt kontrolny nie sprawdza `prosecdef` ani `proconfig`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Pattern Consistency
- **Location**: `context/changes/admin-grant-role/verify-grant-role.sql:32`
- **Detail**: Skrypt weryfikuje `provolatile` dla obu funkcji, ale nie `prosecdef` (`security definer`) ani `proconfig` (`search_path=''`) — czyli tych dwóch własności, na których stoi cały hardening. Na produkcji, gdzie skrypt jest jedyną bramką po ręcznej migracji, funkcja wklejona bez `set search_path = ''` dostałaby werdykt `OK`.
- **Fix**: Dodać dwie kolumny i dwie gałęzie w `case`.
- **Decision**: FIXED. Skrypt kontrolny sprawdza teraz prosecdef i proconfig dla obu funkcji, cztery nowe kolumny i cztery nowe galezie werdyktu. DOWOD CZULOSCI: funkcja bez set search_path daje BLAD: zmiana roli bez set search_path; funkcja bez security definer daje BLAD: zmiana roli nie jest security definer. Po wycofaniu obu mutacji werdykt wraca na OK.

### F7 — `update` nie powtarza filtru `deleted_at`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260909121500_account_role_management.sql:216`
- **Detail**: `update auth.users … where id = p_account` nie ma `and deleted_at is null`. Dziś bezpieczne, bo poprzedzający `select … into` (`:180`) zwróciłby NULL i funkcja wyszłaby przez `NOT_FOUND`. Ale ochrona zapisu leży w **innej instrukcji** niż zapis: zdjęcie filtru z `select`-a przy `S-11` cicho otworzy zapis do kont usuniętych.
- **Fix**: Dopisać predykat do `update`.
- **Decision**: FIXED. Predykat deleted_at is null dopisany do update, z komentarzem wyjasniajacym, ze dzis jest zbedny (select ... into wyszedlby przez NOT_FOUND), ale bez niego ochrona zapisu lezy w innej instrukcji niz zapis — a S-11 bedzie ten select modyfikowac.

### F8 — Nagłówek zestawu Vitest mówi „pięć kolumn"

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/admin-accounts.integration.test.ts:30`
- **Detail**: Punkt 2 nagłówka twierdzi, że funkcja zwraca pięć kolumn i wymienia je. Po tej migracji zwraca dziesięć. To jedyne miejsce w repo, gdzie zapisano dowód, że przegląd nie wystawia treści generacji (NFR o izolacji) — i akurat ten akapit nie został zaktualizowany, choć punkt 1 tuż nad nim dostał staranny dopisek. Aktualizacja częściowa jest gorsza od braku: czytelnik widzi świeżo dotknięty blok i ufa całości.
- **Fix**: Przepisać listę na dziesięć kolumn i powtórzyć, że żadna nie jest `topic`/`title`/`content`.
- **Decision**: FIXED. Naglowek zestawu Vitest wymienia teraz DZIESIEC kolumn zamiast pieciu, z data poprawki i z uwaga, ze aktualizacja czesciowa jest gorsza od braku: czytelnik widzi swiezo dotkniety blok i ufa calosci.

### F9 — Komentarz przypadku `anon` opisuje inną funkcję niż testowana

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — decyzja oczywista, poprawka wąska
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/admin-accounts.integration.test.ts:135`
- **Detail**: Komentarz tłumaczy przypadek tym, że „`drop function` skasował granty **przeglądu**", ale test wywołuje `set_account_role`, która nigdy nie była dropowana — dostaje domyślne granty po prostu dlatego, że jest **nowa**. Sam test jest różnicujący i dobry; zapisany powód dotyczy sąsiedniej ścieżki. Ta sama klasa pomyłki, którą `lessons.md` opisuje jako „zmierzono mutację innej funkcji".
- **Fix**: Poprawić komentarz na „nowo utworzona funkcja dostaje domyślne granty Supabase; bez jawnego `revoke` anonim wykonałby zmianę roli".
- **Decision**: FIXED. Komentarz poprawiony: set_account_role dostaje domyslne granty dlatego, ze jest NOWA, a nie przez drop przegladu. Stary powod zapisany w komentarzu jako pomylka tej samej klasy, ktora lessons.md nazywa mierzeniem mutacji innej funkcji.

### F10 — Mechanizm dziedziczony przez S-11 i S-12 nie ma zapisanego kontraktu ani uruchamiacza

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260909121500_account_role_management.sql:173`, `context/changes/admin-grant-role/test-set-account-role.sql:15`
- **Detail**: Dwie rzeczy o tym samym: co następne plastry odziedziczą, a czego nikt im nie powiedział. (a) Komentarz przy blokadzie mówi, że zapobiega ona stanowi „zostanie zero adminów" — ale PRD v4 (OQ9) ten stan **dopuszcza**; blokada gwarantuje trafność ostrzeżenia, nie istnienie admina. `S-12` doprowadzi do zera adminów **bez żadnej zgody**, jeśli nie weźmie tego samego klucza `hashtext('account_role_gate')`. (b) Test SQL nie jest podpięty do żadnego runnera — nie uruchamia go ani `npm test`, ani `npm run test:integration` — a nagłówek nie podaje komendy i `CLAUDE.md` go nie wymienia. To jedyny test ścieżki pozytywnej w całym produkcie i może po cichu przestać być uruchamiany.
- **Fix**: Doprecyzować komentarz przy blokadzie, zapisać w planie `M-3`, że `S-11` i `S-12` dzielą ten klucz, i dopisać komendę uruchomienia testu do jego nagłówka oraz wzmiankę w `CLAUDE.md`.
  - Strength: Koszt to trzy dopiski; chroni przed cichą utratą jedynego testu ścieżki pozytywnej.
  - Tradeoff: Żaden poza czasem.
  - Confidence: HIGH — brak wywołania w skryptach npm sprawdzony.
  - Blind spot: Nie sprawdziłem, czy da się ten test wpiąć do `test:integration` bez Dockera w CI.
- **Decision**: FIXED w trzech miejscach. (a) Komentarz przy blokadzie mowi teraz, czego ona NIE gwarantuje — PRD v4 OQ9 dopuszcza zero adminow, wiec blokada chroni trafnosc ostrzezenia, nie istnienie admina — i ze klucz chroni LICZBE ADMINOW, nie tylko zmiane roli. (b) Komenda uruchomienia testu SQL dopisana do jego naglowka. (c) roadmap.md: S-11 i S-12 maja w polu Risk jawny wymog wziecia tego samego klucza account_role_gate, bo usuniecie konta doprowadzi do zera adminow bez zgody, jesli policzy adminow poza ta blokada.

## Czego ten przegląd NIE znalazł (zapisane wprost)

- **Zero ustaleń CRITICAL.**
- **Poprawność — bez ustaleń.** Cztery sprawdzone punkty: `is_last_admin` liczy to, co obiecuje nazwa (nieskorelowane podzapytanie, wszystkie nieusunięte konta, nie tylko okno `limit 200`); `coalesce(role,'user')` daje `'user'` dla wszystkich trzech postaci braku; `select … into` poprawnie odróżnia „nie ma konta" od „konto bez roli"; scalenie `||` zachowuje klucze `provider`/`providers`.
- **Umiejscowienie blokady doradczej — bez zastrzeżeń.** Stoi przed odczytem celu i przed liczeniem adminów, zwalnia się po `update`, a brana jest **po** bramce roli, więc konto bez uprawnień nie zablokuje niczego.
- **Brak SQL injection**, brak `execute`/`format()`, `p_role` wyłącznie jako wartość parametru.
- **Kolumna `auth.users.role` nietknięta** — jedyny zapis to `raw_app_meta_data`.
- **Granty kompletne**, lista rol skopiowana z `20260907221925`, ponowne nadanie po `drop` obecne i opisane. To najlepiej zrobiona część migracji.
- **Kompatybilność wsteczna potwierdzona odczytem**: `fetchAccountsOverview` mapuje po nazwach, więc migrację można zastosować na produkcji przed wdrożeniem Workera.
- **Strażniki testów nienaruszone** — obie bariery `assertSafeTestTarget` bez zmian, oba nowe przypadki przez klucz publishable.

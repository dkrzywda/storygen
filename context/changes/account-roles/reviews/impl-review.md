<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Rola konta i serwerowe sprawdzenie dostępu

- **Plan**: `context/changes/account-roles/plan.md`
- **Scope**: wszystkie 3 fazy (22/22 kryteriów odhaczonych)
- **Date**: 2026-09-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations
- **Commity**: `10aa463` (p1), `cda49e5` (p2-p3), `427e9ea` (epilog)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | FAIL    |

**Czego przegląd NIE znalazł, sprawdzone wprost** — `isAdmin` nie daje się obejść (porównanie
identycznościowe, fail-closed na `null`/nie-obiekcie/nie-tekście/wartości spoza zbioru, źródłem
jest `getUser()` weryfikowane po stronie serwera auth, `user_metadata` nie jest czytane);
sekcja admina nie przecieka do zwykłego konta (jedyne wystąpienie słowa „Administracja"
w `dashboard.astro:140` leży wewnątrz `{showAdmin && …}`, komentarze Astro nie trafiają do HTML);
`404.astro` nie ujawnia tras; migracja jest bezpieczna dla danych i idempotentna; brak sekretów;
brak scope creep — wszystkie 12 zmienionych plików mają pokrycie w planie.

## Triage — 2026-09-08

Werdykt NEEDS ATTENTION wynikal z czterech ostrzezen i jednego FAIL na wymiarze Success Criteria.
Po triage: **szesc ustalen naprawionych, jedno pominiete swiadomie**, a trzy z nich (F1, F3, F4)
zapisane dodatkowo jako jedna regula w `context/foundation/lessons.md`.

**Najwazniejsze z tego przegladu:** F1, F3 i F4 nie byly bledami w kodzie — byly bledami
w moim SPRAWDZANIU kodu. Kolumna tozsamosci, ktora wszedzie zwraca to samo. Kryterium
twierdzace, ze mutacja czerwieni test, ktory tej sciezki nie wykonuje. Zielone odczytane
z licznika przy komendzie konczacej sie kodem 1. Kod przeszedl przeglad bez ani jednego
ustalenia krytycznego; zawiodla warstwa dowodu, nie warstwa implementacji.

Stan po naprawach: 241 testow jednostkowych, 50 integracyjnych (exit=0), tsc 0, ESLint 0.

## Findings

### F1 — `current_database()` nie rozróżnia środowisk, więc kolumna tożsamości nie jest dowodem

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: context/changes/account-roles/verify-roles.sql:20
- **Detail**: Skrypt powołuje się w komentarzu na regułę z `lessons.md` § „Weryfikacja bez
  tożsamości środowiska nie jest dowodem" i stawia `current_database()` w pierwszej kolumnie.
  Zmierzone 2026-09-08: lokalnie zwraca `postgres` — i to samo zwraca produkcyjne Supabase,
  bo taka jest domyślna nazwa bazy w obu. Kolumna spełnia regułę **literalnie, nie w istocie**:
  nie zapobiegłaby incydentowi, na który się powołuje. `inet_server_addr()` lokalnie jest puste,
  więc nie jest alternatywą samo w sobie.
- **Fix**: Zastąpić `current_database()` wartością faktycznie różnicującą — liczbą kont
  i wykazem obecnych adresów, które operator może skonfrontować z oczekiwaniem — plus jawną
  instrukcją potwierdzenia identyfikatora projektu w adresie Studio.
  - Strength: przywraca regule jej sens; sprawdzenie zaczyna odróżniać środowiska zamiast
    tylko wyglądać, jakby odróżniało.
  - Tradeoff: żadna wartość dostępna z samego SQL-a nie identyfikuje projektu Supabase
    jednoznacznie, więc część ciężaru zostaje na operatorze.
  - Confidence: HIGH — nazwa bazy zmierzona lokalnie, domyślna nazwa produkcyjna udokumentowana.
  - Blind spot: nie potwierdziłem wartości na produkcji własnym zapytaniem — z tej sieci nie ma
    dojścia do bazy produkcyjnej (port 5432 zablokowany).
- **Decision**: ACCEPTED-AS-RULE (lessons.md: Zielone czytaj z tego, co zmienilo by sie przy porazce) + FIXED. verify-roles.sql przepisany: inet_server_addr() rozroznia baze lokalna od hostowanej, doszedl odcisk palca (liczba kont, data najstarszego konta), a NIEMOZNOSC identyfikacji projektu z samego SQL-a jest nazwana wprost, z instrukcja potwierdzenia adresu Studio. Sprawdzone lokalnie: kolumna oddaje 'puste - baza lokalna'.

### F2 — `404.astro` opisuje w komentarzu barierę bezpieczeństwa, która nie istnieje

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/404.astro:14
- **Detail**: Komentarz twierdzi, że odmowa dostępu do trasy administratora „przepisuje żądanie
  WŁAŚNIE TUTAJ (`src/middleware.ts`, ADMIN_ROUTES)". `ADMIN_ROUTES` nie istnieje — `grep` po
  `src/` daje jedno trafienie i jest nim ten komentarz. Plan sam ten mechanizm unieważnia.
  Ryzyko jest konkretne: czytelnik może założyć, że trasy admina są bramkowane w middleware,
  i dołożyć `/admin` bez własnej ochrony.
- **Fix**: Usunąć powód nr 2 z komentarza albo przepisać go na stan faktyczny — `404.astro`
  istnieje z powodu NFR o języku, a roli pilnuje warunek w `dashboard.astro`.
- **Decision**: FIXED. Komentarz w 404.astro przepisany na stan faktyczny, z jawnym ostrzezeniem, ze middleware NIE bramkuje po roli i ze dokladajac trase administratora trzeba ja oslonic samodzielnie.

### F3 — Kryteria 3.3 i 3.5 twierdzą coś, czego żaden test nie sprawdza

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/account-roles/plan.md — Progress 3.3 i 3.5
- **Detail**: Oba kryteria mówią „testy padają po zdjęciu warunku `showAdmin`". **Żaden test nie
  renderuje `dashboard.astro`** — test integracyjny sam to przyznaje („ten runner nie mówi po
  HTTP"), więc usunięcie `showAdmin` nie zaczerwieniłoby niczego. Pomiar, który faktycznie
  wykonano, dotyczył mutacji `isAdmin` (3 czerwone jednostkowe, 1 integracyjny), nie `showAdmin`.
  Do tego 3.3 stoi pod nagłówkiem **Automated**, choć weryfikacja była ręczna. To błąd w moim
  brzmieniu kryteriów, nie w kodzie — ale kryterium, które twierdzi więcej, niż zmierzono,
  jest dokładnie tym rodzajem fałszywej zieleni, którą ta sesja już raz zapłaciła.
- **Fix**: Przepisać 3.3 i 3.5 na to, co zmierzono („mutacja `isAdmin` czerwieni 3 jednostkowe
  i 1 integracyjny"), a warunek w szablonie przenieść do sekcji „czego ten zestaw nie dowodzi",
  gdzie już zresztą jest opisany.
  - Strength: kryteria zaczynają odpowiadać dowodom; nie zostaje twierdzenie bez pokrycia.
  - Tradeoff: warunek w szablonie zostaje niepokryty testem — świadomie, bo pokrycie wymagałoby
    testu HTTP, którego ten runner nie prowadzi.
  - Confidence: HIGH — brak testu renderującego stronę potwierdzony `grep`-em.
  - Blind spot: nie sprawdzałem, ile pracy wymagałby test HTTP; ocena „za dużo" jest z planowania.
- **Decision**: ACCEPTED-AS-RULE (ta sama regula) + FIXED. Kryteria 3.3 i 3.5 przepisane na zmierzona mutacje isAdmin; 3.5 nazywa wprost, ze warunek showAdmin w szablonie nie jest pokryty zadnym testem, z odeslaniem do zestawu R-08.

### F4 — `npm run test:integration` kończy się kodem 1, a kryterium 3.2 jest odhaczone

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/account-roles/plan.md — Progress 3.2
- **Detail**: Komenda zwraca `exit=1`: `limits.integration.test.ts` rzuca w `beforeAll` —
  „Zestaw potrzebuje 16 wolnych miejsc w dziennym sufcie aplikacji, a wolnych jest 15 z 30".
  Zero testów pada, `account-role.integration.test.ts` przechodzi w całości. Przyczyna jest
  środowiskowa: moje trzy przebiegi zjadły lokalny sufit. Kryterium odhaczyłem, patrząc na
  „30 passed" i ignorując kod wyjścia — drugi raz w tej sesji po tym samym błędzie odczytu.
- **Fix**: Wyczyścić `public.generation_attempts` (15 wierszy, 3 konta; brak kluczy obcych
  wskazujących na tę tabelę, `public.generations` z 20 wierszami nietknięte), uruchomić zestaw
  ponownie i odhaczyć 3.2 na podstawie kodu wyjścia, nie liczników.
- **Decision**: ACCEPTED-AS-RULE (ta sama regula) + FIXED. Wyczyszczono 15 wierszy generation_attempts (generations nietkniete, 20 wierszy). Ponowny przebieg: exit=0, 3 pliki, 50 testow - odczytane z kodu wyjscia, nie z licznika.

### F5 — Treść fazy 3 nie zsynchronizowana ze zmianą ścieżki testu integracyjnego

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/account-roles/plan.md — faza 3, poz. 2 oraz kryteria automatyczne
- **Detail**: Test leży w `src/lib/account-role.integration.test.ts`, a treść planu w trzech
  miejscach nadal nazywa `src/pages/admin/admin-gate.integration.test.ts` i „bramkę w middleware".
  Tabela unieważnień mówi tylko „PRZEPISANE"; zaktualizowano `## Progress`, nie body. Nowa ścieżka
  jest logiczną konsekwencją usunięcia `src/pages/admin/` i zgodna z konwencją repo, ale nigdzie
  nie jest zapisana wprost.
- **Fix**: Dopisać nową ścieżkę do tabeli unieważnień albo poprawić trzy odniesienia w body.
- **Decision**: FIXED. Sciezka testu poprawiona w trzech miejscach tresci fazy 3 i dopisana do tabeli uniewaznien w sekcji Zmiana projektu.

### F6 — Zbieżność nazw z kolumną `auth.users.role` nieodnotowana

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260908124854_seed_account_roles.sql:28
- **Detail**: `auth.users` ma **kolumnę** `role` (`character varying`, zmierzone), używaną przez
  PostgREST jako rola bazodanowa z JWT. Migracja poprawnie pisze do `raw_app_meta_data`, ale
  ani ona, ani `verify-roles.sql` nie odnotowują tej zbieżności. Późniejsze „uproszczenie" na
  `set role = 'admin'` wywróciłoby autoryzację PostgREST w całej aplikacji — cicho, bo składnia
  jest poprawna.
- **Fix**: Jedno zdanie w komentarzu migracji odgraniczające `raw_app_meta_data->>'role'`
  od kolumny `auth.users.role`.
- **Decision**: FIXED. Komentarz w migracji odgranicza raw_app_meta_data->>role od KOLUMNY auth.users.role, z nazwanym skutkiem pomylki: wywrocenie autoryzacji PostgREST w calej aplikacji, cicho.

### F7 — Brak `Cache-Control` na trasach chronionych

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro (i całe `PROTECTED_ROUTES`)
- **Detail**: W repo nie ma żadnego nagłówka `Cache-Control`, a `/dashboard` oddaje teraz HTML
  różny per konto pod jednym adresem. Na Workers dynamiczne odpowiedzi nie są domyślnie
  cache'owane, więc ryzyko jest niskie i **pre-istniejące** — nie wniesione tą zmianą.
- **Fix**: Rozważyć `private, no-store` dla tras z `PROTECTED_ROUTES` jako osobną zmianę.
- **Decision**: SKIPPED. Ryzyko niskie (Workers nie cache'uje dynamicznych odpowiedzi domyslnie) i pre-istniejace, nie wniesione ta zmiana. Naglowki cache dla calego PROTECTED_ROUTES to zakres szerszy niz F-02.

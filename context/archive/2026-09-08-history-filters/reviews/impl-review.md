<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Filtrowanie i szukanie w historii generacji

- **Plan**: `context/changes/history-filters/plan.md`
- **Scope**: Phases 1–3 of 3 (pełny plan, 23/23 pozycji Progress)
- **Date**: 2026-09-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Zgodność z planem jest pełna: wszystkie siedem plików `MATCH`, żadnego naruszenia
„What We're NOT Doing", wszystkie dziewięć kontraktów sprawdzonych z numerami linii.
Kryteria automatyczne przechodzą: `npm run test:integration` 45, `npm test` 225,
`tsc --noEmit` 0, ESLint 0 na siedmiu plikach. `astro check` zastąpiony `tsc`, bo
token wrangler wygasł — zaznaczone jako zastępstwo, nie jako to samo.

## Triage — 2026-09-08

Werdykt NEEDS ATTENTION wynikal z trzech ostrzezen. Po triage: **F1, F2, F3 i F4 naprawione**,
F5-F10 swiadomie pominiete z uzasadnieniem przy kazdym.

Stan po naprawach: 229 testow jednostkowych, 47 integracyjnych, tsc 0, ESLint 0.

**Najwazniejsze z tego przegladu:** F1 byl bledem, ktorego nie zlapaly ani testy jednostkowe,
ani integracyjne — bo zaden nie uzywal gwiazdki, a funkcja niosla komentarz nazywajacy jeden
ze swoich przypadkow najwazniejszym w pliku. PostgREST ma wlasna warstwe wieloznacznikow nad
SQL-em i nie wynika to z niczego, co widac w kodzie.

## Findings

### F1 — `escapeLike` nie obsługuje `*`, a PostgREST traktuje go jak wieloznacznik

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/lib/generation-filters.ts:86
- **Detail**: `escapeLike` ucieka `\`, `%` i `_`, ale **nie `*`**. PostgREST przepisuje
  `*` na `%` wewnątrz wartości filtra `like`/`ilike`, a `URLSearchParams` przepuszcza
  `*` bez kodowania. Skutek: fraza z gwiazdką działa jak wieloznacznik.

  **Zmierzone 2026-09-08 na działającej aplikacji, na zalogowanym koncie z 7 pozycjami:**

  | wpisane | zwrócone                    |
  | ------- | --------------------------- |
  | `q=%`   | 1 pozycja (ucieczka działa) |
  | `q=*`   | **7 pozycji — wszystkie**   |

  Niezależnie zmierzone przez przegląd bezpośrednio na PostgREST: `koty*psy` zwraca
  „koty i psy" oraz „kotypsy".

  Scenariusz awarii: użytkownik szuka `koty*psy` i dostaje „koty i psy" — wynik
  wyglądający sensownie, ale nie ten, o który pytał. To **dokładnie ta klasa błędu,
  przed którą ta funkcja miała chronić** i którą jej własny komentarz nazywa
  „niewidoczną". Nie jest to wyciek danych: RLS obowiązuje przy każdym wariancie
  (sprawdzone — obce konto dostaje 0 wierszy dla `q=*`).

  Ucieczka przez `\*` **nie działa** — PostgREST podmienia bezwarunkowo, dając `\%`,
  czyli literalny procent i zero trafień (zmierzone przez przegląd).

- **Fix A ⭐ Recommended**: Odwzorować `*` na `_` w `escapeLike` — wieloznacznik na jeden znak.
  - Strength: Jedna linia w funkcji, która już istnieje i ma testy; usuwa „gwiazdka pasuje do dowolnego ciągu" i zostawia „pasuje do dowolnego JEDNEGO znaku", więc literalne `koty*psy` nadal się znajduje.
  - Tradeoff: Nie jest to pełna poprawność — `koty*psy` dopasuje też `kotyXpsy`. Fałszywe trafienia zamiast fałszywie szerokich; lepsze, ale nie idealne.
  - Confidence: HIGH — mechanizm podmiany w PostgREST zmierzony w obie strony.
  - Blind spot: Nie sprawdzono, czy przyszła wersja PostgREST nie zmieni tej podmiany.
- **Fix B**: Przenieść szukanie do funkcji w bazie (RPC), która przyjmuje frazę jako parametr.
  - Strength: Pełna poprawność — parametr nie przechodzi przez gramatykę query stringa PostgREST, więc `*` jest literalny i żadna ucieczka nie jest potrzebna.
  - Tradeoff: Migracja i trzecia funkcja bazodanowa w projekcie, w zmianie, która wprost zapisała „bez migracji"; szukanie przestaje składać się z filtrami przez ten sam builder.
  - Confidence: MED — droga jest znana, ale nie zmierzona w tym repo.
  - Blind spot: Nie wiadomo, jak taka funkcja współgra z pozostałymi filtrami bez duplikowania ich w SQL.
- **Decision**: FIXED via Fix A — `*` schodzi do `_` w `escapeLike`, podmiana OSTATNIA w lancuchu. Zweryfikowane testem rozrozniajacym: `q=100*koty` daje 0 pozycji (przed poprawka dopasowywalo "100%_pewne koty"), a `q=100%_pewne` nadal 1. UWAGA: `q=*` nadal zwraca wszystko i tak zostaje — pojedyncza gwiazdka to `_`, ktory kazdy niepusty temat zawiera. Fix zwezil wieloznacznik, nie usunal go.

### F2 — Odczyty pochłaniają błędy bazy bez żadnego śladu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/lib/generations.ts:111 oraz :155
- **Detail**: `fetchGenerations` nie destrukturyzuje `error` w ogóle
  (`const { data } = await ordered`), a `fetchGenerationById` zwraca `null` przy
  każdym błędzie. Żadna z nich nie woła `logApiError`.

  Scenariusz awarii: Supabase jest nieosiągalny albo token odrzucony. Lista renderuje
  „Nie masz jeszcze żadnych generacji." — **ta sama kategoria kłamstwa, którą ta
  zmiana celowo naprawiła dla filtrów** — a `?open=<własny poprawny id>` daje 404.
  Nic nie jest logowane, więc awaria nie zostawia śladu nigdzie.

  Rozjazd z rodzeństwem: `fetchUsageToday` i `saveGeneration` rzucają, a
  `dashboard.astro:34` i `GenerateScreen.astro:37` logują przez `logApiError`
  i degradują jedną sekcję. Twierdzenie w komentarzu `generations.ts`, że pochłanianie
  „jest zgodne z rodzeństwem", broni się tylko wewnątrz tego modułu — nie wobec
  `limits.ts`.

- **Fix**: Zachować zwracany kształt (`null` / `[]` — argument o nierozróżnialności 404 jest słuszny), ale odczytać `error` i zalogować go, żeby „pusto" i „zepsute" dały się odróżnić w logach, nawet gdy nie dają się na ekranie.
- **Decision**: FIXED — `logApiError` w obu odczytach (scope `generations/list` i `generations/byId`), zwracany kształt bez zmian. Zweryfikowane: `?open=nie-jest-uuidem` loguje `providerCode: 22P02`, wiec zly adres i awaria bazy sa rozroznialne w logach, mimo ze na ekranie nie sa. Tematu uzytkownika w logu nie ma.

### F3 — Brak `limit()` przy dwóch wyspach Reacta na pozycję

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/lib/generations.ts:87, src/components/generations/GenerationList.astro:71
- **Detail**: Brak `.limit()` i brak paginacji, a każda pozycja hydruje `TitleEditor`
  i `RatingControls` przez `client:load`.

  Scenariusz awarii: przy limicie 10 generacji na dobę miesiąc użycia daje ~300
  wierszy; strona wysyła wtedy nieograniczony zestaw wyników i ~600 gorliwie
  hydrowanych wysp w jednym dokumencie. Plan świadomie odłożył paginację przy dwóch
  pozycjach na konto, ale nie postawił żadnej górnej granicy.

- **Fix**: Dodać serwerowy `.limit()` do `fetchGenerations` (tanie, ogranicza też zasięg awarii z F2) i rozważyć `client:visible` dla obu wysp per pozycja.
- **Decision**: FIXED — `RESULT_LIMIT = 200` w `fetchGenerations`, wyspy bez zmian (`client:visible` odrzucone jako szerszy zakres). Wartosc wysoka celowo: przy maksymalnym tempie to ~20 dni uzycia. CICHE OBCIECIE zostaje jako znana konsekwencja, nazwana w komentarzu — wlasciwa naprawa to paginacja, nie wieksza liczba. Zweryfikowane: historia 7, ulubione 2, bez regresu.

### F4 — Zestaw testów przechodzi przy błędzie z F1

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: src/lib/generation-filters.test.ts:94-110
- **Detail**: Blok `escapeLike` wylicza `%`, `_` i `\`, a jeden przypadek nazywa
  „NAJWAZNIEJSZY PRZYPADEK W TYM PLIKU" — ale przypadku z `*` nie ma ani tu, ani
  w zestawie integracyjnym. Oba zestawy są zielone przy obecnym błędzie.
- **Fix**: Dodać przypadek z `*` w obu zestawach; przed poprawką z F1 ma być czerwony.
- **Decision**: FIXED — 4 przypadki jednostkowe i 2 integracyjne dla gwiazdki. MAJA ZEBY: po zdjeciu podmiany 3 testy jednostkowe i 1 integracyjny czerwienieja (zmierzone), potem przywrocone. Stan: 229 jednostkowych, 47 integracyjnych.

### F5 — `fetchHistory` jest martwym kodem

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Architecture
- **Location**: src/lib/generations.ts:116
- **Detail**: `generations.astro:32` woła `fetchGenerations` wprost, a `grep` nie
  znajduje innego wywołania `fetchHistory`. Plan **wymagał**, żeby została
  wyeksportowana (po to, by panel nie musiał się zmieniać), więc formalnie jest to
  zgodne z kontraktem — ale eksport nie ma już konsumenta. Zgłoszone niezależnie
  przez oba przeglądy.
- **Fix**: Usunąć `fetchHistory` albo dopisać w komentarzu, że jest zachowana jako publiczny kształt modułu.
- **Decision**: SKIPPED — martwy eksport zostaje; plan wprost wymagal, zeby fetchHistory pozostala publiczna.

### F6 — Komentarz o indeksie twierdzi więcej, niż zmierzono

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/lib/generations.ts:82
- **Detail**: Zmierzyłem `EXPLAIN` dla zapytania **rankingu** (`format` + `rating >= 1`
  sortowane `rating desc, created_at desc`) i planner faktycznie wybiera
  `generations_ranking_idx`. Komentarz nie rozróżnia jednak ścieżek: dla **historii**
  z `format` + `minRating` sortowanej `created_at desc` ten indeks nie posłuży do
  sortowania, bo `rating` stoi w kluczu między `format` a `created_at`. Osobno:
  `ilike '%…%'` ma wiodący wieloznacznik, więc żaden btree go nie obsłuży, a
  `pg_trgm` nie jest zainstalowany — szukanie to zawsze skan sekwencyjny po zbiorze
  widocznym przez RLS. Bez znaczenia przy tej skali; zapisane, żeby komentarz nie był
  czytany szerzej, niż zmierzono.
- **Fix**: Zawęzić komentarz do ścieżki rankingu albo dopisać, czego nie obejmuje.
- **Decision**: SKIPPED — czysto redakcyjne, bez wplywu na zachowanie.

### F7 — Nieskonfigurowany Supabase raportuje 404 zamiast braku konfiguracji

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Architecture
- **Location**: src/pages/generations.astro:50-53
- **Detail**: Gdy klient Supabase jest `null`, `?open=…` daje HTTP 404 i okno
  „nie znaleziono", zamiast ścieżki z bannerem konfiguracji. Problem konfiguracji
  jest raportowany jako brakujący wiersz.
- **Fix**: Rozróżnić brak klienta od braku wiersza przed ustawieniem statusu 404.
- **Decision**: SKIPPED — sciezka nieosiagalna, dopoki .env jest wypelniony.

### F8 — `GenerationList` typuje `format` jako `string`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/components/generations/GenerationList.astro:20
- **Detail**: `Item.format` to `string`, nie `GenerationFormat`. Jest to zgodne
  z `formatLabel`, które celowo przyjmuje `string` (kolumna w bazie to `text`
  z constraintem), ale w interfejsie komponentu unia byłaby ściślejsza.
- **Fix**: Zawęzić typ w interfejsie albo dopisać powód, dla którego jest szerszy.
- **Decision**: SKIPPED — typ jest szerszy CELOWO: formatLabel przyjmuje string, bo kolumna to text z constraintem.

### F9 — Podpowiedź stanu pustego nie nazywa kontrolki dosłownie

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: src/pages/generations.astro:68
- **Detail**: Tekst mówi „albo wyczyść wszystkie", podczas gdy kontrolka nazywa się
  „Wyczyść filtry" (`FilterBar.astro:94`). Plan opisywał to jako wskazanie na
  konkretny element. Kosmetyczna rozbieżność; link jest obecny zawsze, gdy widać
  podpowiedź.
- **Fix**: Ujednolicić brzmienie z etykietą kontrolki.
- **Decision**: SKIPPED — kosmetyczna rozbieznosc brzmienia; link jest obecny zawsze, gdy widac podpowiedz.

### F10 — `parseFilters` przyjmuje egzotyczne zapisy liczb

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/lib/generation-filters.ts:54
- **Detail**: `Number()` przyjmuje `rating=1e0`, `+1`, `0x3`, `3`. Wartość jest
  potem sprawdzana zakresem i normalizowana przez `filtersToQuery`, więc skutku nie
  ma — i jest to zgodne z wyrozumiałym wzorcem z `dashboard.astro:48`.
- **Fix**: Zostawić albo zawęzić do `/^[1-5]$/`, jeśli ścisłość jest warta linii kodu.
- **Decision**: SKIPPED — wyrozumiale Number() jest zgodne ze wzorcem z dashboard.astro; zakres i tak jest sprawdzany.

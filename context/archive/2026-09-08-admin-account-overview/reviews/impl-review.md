<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Przegląd kont dla administratora

- **Plan**: `context/changes/admin-account-overview/plan.md`
- **Scope**: wszystkie 3 fazy (19/19 kryteriów odhaczonych)
- **Date**: 2026-09-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations
- **Commity**: `b0e8347` (p1), `1f3f0ec` (p2-p3), `1bd7184` (epilog)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Czego przegląd NIE znalazł, sprawdzone wprost.** Bramki roli nie da się obejść: czytana z bazy
dla `auth.uid()`, z `raw_app_meta_data` (serwerowe), nie z tokenu i nie z `raw_user_meta_data`;
`WHERE` filtruje przed projekcją, więc dla nie-admina podzapytania się nie wykonują.
`search_path = ''` z pełną kwalifikacją wszystkich nazw. Zero ścieżek wycieku treści — funkcja
zwraca pięć kolumn, `topic`/`title`/`content` nie występują nigdzie w łańcuchu SQL → typ →
mapowanie → HTML, a RLS na `generations` nie jest poszerzone. Sekcja w panelu nie przecieka:
cała pod `showAdmin`, bez wyspy Reacta, bez serializacji do JS, bez atrybutów widocznych dla
konta bez roli; e-maile przez `{account.email}`, czyli escapowane przez Astro. `service_role`
bez claimów dostaje **0 wierszy** (zmierzone). Wydajność bezkosztowa: oba podzapytania mają
indeksy z `user_id` jako pierwszą kolumną. Zakres respektowany w całości — brak zarządzania
kontami, brak filtra adresów, brak trasy `/admin`, brak sufitu aplikacji per wiersz.

**Kryteria sukcesu przeliczone niezależnie**: `tsc` exit=0, `npm test` 241 exit=0,
`npm run test:integration` 53 exit=0, `astro build` exit=0.

## Triage — 2026-09-09

Werdykt NEEDS ATTENTION wynikal z trzech ostrzezen i piatki obserwacji. Po triage:
**siedem ustalen naprawionych, jedno odlozone do archiwizacji**, a trzy z nich (F1, F2, F4)
zapisane dodatkowo jako dwie reguly w `context/foundation/lessons.md`.

**Najwazniejsze z tego przegladu:** F1 i F2 to jedna sprawa w dwoch warstwach — pominieta
rola w `revoke` ORAZ kontrola, ktora tego nie widziala. Sam grant byl tani (dostep nie
przeciekal, bo `auth.uid()` jest null dla `service_role`). Kosztowna byla slepota kontroli:
napisalem ja DZIEN po zapisaniu reguly o czytaniu zielonego z tego, co zmienilo by sie
przy porazce, i zlamalem te regule w niej. Naprawa ma wlasny dowod czulosci: nowa kontrola
przeciw staremu stanowi bazy wypisala BLAD tam, gdzie stara wypisywala OK.

Kazda naprawa jest zmierzona, nie zalozona: `service_moze = f`, `row_limit = 200` w wyniku,
53 → 37 wierszy po miekkim usunieciu, szablon bez wywolan formatera w obszarze tabeli.

Stan po naprawach: 241 testow jednostkowych, 53 integracyjne (exit=0), tsc 0, ESLint 0,
build 0. Kontrola `verify-overview.sql`: werdykt OK.

## Findings

### F1 — `revoke` nie odbiera prawa roli `service_role`, w odróżnieniu od wszystkich czterech poprzednich funkcji

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260909072831_accounts_overview.sql:83
- **Detail**: Migracja robi `revoke execute … from public, anon`. Każda poprzednia
  uprzywilejowana funkcja w tym repo wymienia `service_role`: `usage_today`
  (`20260907192600:127`), `record_attempt` (`20260907221126:85`),
  `record_attempt_if_allowed` (`20260907221925:135`), `usage_today` ponownie
  (`20260907221925:142`). Zmierzone: `has_function_privilege('service_role', …)` zwraca `t`,
  więc prawo faktycznie tam jest — to nie teoria. Dostęp jednak nie przecieka: `service_role`
  bez claimów dostaje **0 wierszy**, bo `auth.uid()` jest `null`. To rozjazd ze wzorcem
  w jedynym miejscu, gdzie granty **są** granicą — wzorzec z `lessons.md` § „Milczenie reguły
  to nie zgoda": reguła opisująca sąsiedni przypadek mówi o intencji projektu.
- **Fix**: `revoke execute on function public.accounts_overview() from public, anon, service_role;`
  w nowej migracji (poprzednia jest już zaaplikowana na lokalnej bazie i wkrótce na produkcji).
- **Decision**: ACCEPTED-AS-RULE (lessons.md: Nowa funkcja uprzywilejowana kopiuje liste rol) + FIXED. Migracja poprawiona w miejscu (nie byla jeszcze na produkcji): revoke ... from public, anon, service_role. Zmierzone po naprawie: service_moze = f.

### F2 — `verify-overview.sql` pokazał `OK`, choć grant został pominięty

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: context/changes/admin-account-overview/verify-overview.sql:38-39
- **Detail**: Skrypt sprawdza `has_function_privilege` dla `anon` i `authenticated`, ale **nie
  dla `service_role`** — więc przy pominiętym `revoke` z F1 werdykt i tak wypisał `OK`.
  Sprawdzenie jest **niewrażliwe na awarię, którą ma wykrywać**. To dokładnie reguła
  z `lessons.md` § „Zielone czytaj z tego, co zmieniłoby się przy porażce", zapisana wczoraj —
  i to jest ostrzejsza połowa F1: sam rozjazd grantu jest tani, ale kontrola, która go nie
  widzi, jest tym, co pozwoliłoby mu przejść niezauważonym również następnym razem.
- **Fix**: Dodać trzeci wiersz `has_function_privilege('service_role', …)` i gałąź w `case`,
  wzorem wiersza dla `anon`.
  - Strength: przywraca kontroli czułość na klasę błędu, dla której powstała; koszt to trzy
    linie SQL-a.
  - Tradeoff: skrypt rośnie, a przy każdej nowej roli trzeba pamiętać o kolejnym wierszu —
    kontrola wylicza role zamiast pytać o nie ogólnie.
  - Confidence: HIGH — pominięcie zmierzone bezpośrednio (`t` przy werdykcie `OK`).
  - Blind spot: nie sprawdzałem, czy `pg_proc.proacl` dałoby się porównać z oczekiwaną listą
    rol jednym wyrażeniem, co byłoby odporne na dodanie kolejnej roli.
- **Decision**: ACCEPTED-AS-RULE (ta sama regula) + FIXED. Dodany wiersz has_function_privilege dla service_role i galaz w case. DOWOD CZULOSCI: nowa kontrola uruchomiona przeciw STAREMU stanowi bazy wypisala 'BLAD: service_role ma prawo wykonania' tam, gdzie stara wypisywala OK.

### F3 — Sufit 200 istnieje jako dwa niezależne literały bez wspólnego źródła

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260909072831_accounts_overview.sql:72 oraz src/pages/dashboard.astro:62
- **Detail**: SQL ma `limit 200`, a widok `const ACCOUNTS_LIMIT = 200` — dwie niezależne
  liczby. Zmierzone: funkcja **nie zwraca** sufitu wśród swoich pięciu kolumn
  (`email, registered_at, generations, used_today, own_limit`), więc widok nie ma jak go
  odczytać. Skutek zmiany sufitu w migracji bez zmiany widoku: komunikat o obcięciu **cichnie**
  bez żadnego błędu, i lista znowu twierdzi „widzisz wszystko", gdy widzisz część. To ten sam
  antywzorzec, którego `usage_today()` świadomie unika — limity są tam zwracane z bazy właśnie
  po to, żeby interfejs pokazywał liczby obowiązujące przy zapisie.
- **Fix A ⭐ Recommended**: Dołożyć kolumnę `row_limit` do `accounts_overview()` i czytać ją
  w widoku, wzorem `own_limit`/`app_limit` w `usage_today()`.
  - Strength: jedno źródło prawdy; zmiana sufitu w SQL automatycznie poprawia komunikat.
    Wzorzec już w repo, z zapisanym uzasadnieniem.
  - Tradeoff: szósta kolumna powtarzana w każdym wierszu; wymaga nowej migracji i regeneracji
    typów.
  - Confidence: HIGH — identyczny wzorzec działa w `usage_today()`.
  - Blind spot: nie sprawdzałem, czy przy jednym koncie na produkcji ta ścieżka kiedykolwiek
    się wykona — komunikat o obcięciu może pozostać nigdy niewidziany i nigdy nieprzetestowany.
- **Fix B**: Zostawić duplikat i dopisać w obu miejscach komentarz wiążący je nazwą.
  - Strength: zero migracji, zero nowych kolumn.
  - Tradeoff: wiąże liczby dyscypliną, nie strukturą — a to dokładnie to, co zawodzi cicho.
  - Confidence: MEDIUM — zależy od tego, czy sufit kiedykolwiek się zmieni.
  - Blind spot: brak.
- **Decision**: FIXED via Fix A. Funkcja zwraca kolumne row_limit; stala ACCOUNTS_LIMIT usunieta z widoku, ktory czyta sufit z danych. Liczba 200 wystepuje teraz JEDEN raz, w SQL (200::integer). Zmierzone: funkcja oddaje row_limit = 200 razem z wierszami.

### F4 — `email` i `created_at` w `auth.users` są nullowalne, a typ deklaruje je jako nie-null

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260909072831_accounts_overview.sql:37-38, src/types.ts
- **Detail**: Zmierzone w `information_schema`: `email`, `created_at` i `deleted_at` mają
  `is_nullable = YES`. `database.types.ts` i `AccountOverviewRow` deklarują pierwsze dwa jako
  nie-null. Przy `null` w `created_at`: `new Date(null)` daje 1970, a przy wartości
  nieparsowalnej `Intl.DateTimeFormat.format(Invalid Date)` **rzuca** — i dzieje się to
  w szablonie, **poza** blokiem `try` z odczytu, więc wywróciłoby **całą stronę**, nie samą
  sekcję. Dziś nieosiągalne: rejestracja jest tylko e-mailem i hasłem, więc oba pola zawsze
  mają wartość. Osiągalne stanie się, gdy pojawi się logowanie anonimowe albo po numerze
  telefonu — czego `## Non-Goals` dziś zabrania.
- **Fix**: `coalesce(u.email::text, '(brak adresu)')` i `coalesce(u.created_at, 'epoch')` w SQL —
  albo świadomie odnotować w typie, że jest szerszy niż schemat, i zostawić bez zmiany.
  - Strength: usuwa klasę awarii, w której jedna nietypowa wartość w bazie wywraca cały panel,
    a nie tylko sekcję, która ją czyta.
  - Tradeoff: broni się przed stanem, którego `## Non-Goals` dziś zakazuje — czyli kod na wypadek
    zmiany produktu, która może nie nastąpić.
  - Confidence: HIGH — nullowalność zmierzona; zachowanie `Intl` przy `Invalid Date` znane.
  - Blind spot: nie zmierzyłem, czy `Intl` faktycznie rzuca dla `new Date(null)` (to `0`, więc
    poprawna data 1970) — awaria dotyczy tylko wartości nieparsowalnej, nie samego `null`.
- **Decision**: ACCEPTED-AS-RULE (lessons.md: Degradacja odczytu nie chroni renderowania) + FIXED. Formatowanie daty przeniesione do tego samego try, co odczyt; szablon czyta gotowy registeredLabel. W obszarze tabeli kont nie ma zadnego wywolania formatera. UWAGA: resetTimeFormat w bloku licznika limitu (linia 177) nadal stoi w szablonie — kod zastany z S-04, swiadomie poza zakresem tego triage'u.

### F5 — Brak `comment on function`, w odróżnieniu od `record_attempt_if_allowed`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260909072831_accounts_overview.sql
- **Detail**: `record_attempt_if_allowed` niesie `comment on function` (`20260907221925:126`),
  więc opis jest widoczny w Studio i w `\df+`. Nowa funkcja go nie ma — cały kontekst żyje
  w komentarzach pliku migracji, których nikt nie widzi z konsoli bazy.
- **Fix**: Dodać `comment on function public.accounts_overview() is '…'` z jednozdaniowym opisem
  granicy „liczby, nigdy treść".
- **Decision**: FIXED. comment on function dodany przy przepisywaniu migracji dla F1 i F3.

### F6 — Konta soft-usunięte przez GoTrue pojawią się w przeglądzie

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260909072831_accounts_overview.sql:39
- **Detail**: `auth.users` ma kolumnę `deleted_at` (zmierzone), a funkcja nie filtruje po niej.
  Konto usunięte miękko przez GoTrue będzie więc widoczne w przeglądzie jak każde inne. Dziś
  nieosiągalne, bo nic w aplikacji nie usuwa kont — ale **plaster zarządzania kontami, który
  właśnie planujemy, to zmieni**.
- **Fix**: Dopisać `and u.deleted_at is null` do bramki albo świadomie zdecydować, że
  administrator ma widzieć także konta usunięte, i zapisać to w planie zarządzania.
- **Decision**: FIXED. Dodany filtr u.deleted_at is null, z komentarzem wyjasniajacym, ze filtr dotyczy kont listowanych, nie wolajacego. DOWOD: 53 wiersze przed, 37 po miekkim usunieciu 16 kont limits-% w transakcji wycofanej.

### F7 — Regeneracja `database.types.ts` nie jest zapisana w planie, tylko w treści commita

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/admin-account-overview/plan.md — faza 2
- **Detail**: Plan fazy 2 nie przewidywał regeneracji typów bazy, choć bez niej
  `.rpc("accounts_overview")` nie ma typu. Odstępstwo jest opisane w treści commita `1f3f0ec`,
  ale **nie w planie** — a plan jest kontraktem, wobec którego porównuje kolejny przegląd.
  Ten sam rodzaj rozjazdu wyszedł wczoraj jako ustalenie F5 przy `F-02`.
- **Fix**: Dopisać krok regeneracji do fazy 2 planu, z odesłaniem do `CLAUDE.md`.
- **Decision**: FIXED. Krok regeneracji typow dopisany do fazy 2 planu jako pozycja 0, z odeslaniem do CLAUDE.md i wymogiem sprawdzenia zakresu diffa.

### F8 — `roadmap.md` niezacommitowany; `S-09` wciąż `in-progress`, gdy `change.md` ma `implemented`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md
- **Detail**: Flip `S-09` na `in-progress` leży w drzewie roboczym od sesji planowania i nie
  wszedł do żadnego commita, bo rytuał wyklucza pliki brudne przed wejściem w fazę. Stan repo
  jest więc niespójny: `change.md` mówi `implemented`, roadmapa `in-progress`. Domknie to
  `/10x-archive`, ale do tego czasu roadmapa nie mówi prawdy o własnym stanie — a to reguła,
  którą projekt już raz zapisał jako lekcję.
- **Fix**: Zacommitować `roadmap.md` osobno przed archiwizacją albo pozwolić `/10x-archive`
  domknąć pozycję i zacommitować całość razem.
- **Decision**: DEFERRED do /10x-archive. Archiwizacja przestawi S-09 na done, doda wpis do ## Done i zacommituje roadmape razem z przeniesieniem folderu — jeden commit zamiast dwoch.

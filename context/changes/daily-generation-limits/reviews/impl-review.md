<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Dzienny limit na konto i sufit dzienny całej aplikacji

- **Plan**: `context/changes/daily-generation-limits/plan.md`
- **Scope**: Phases 1–4 of 4 (pełny plan, 26/26 pozycji Progress)
- **Date**: 2026-09-07
- **Verdict**: REJECTED
- **Findings**: 1 critical, 2 warnings, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Automatyczne kryteria wszystkich czterech faz przechodzą: `astro check` 0 błędów (64 pliki),
`npm test` 177 testów, `npm run test:integration` 25 testów, ESLint 0 błędów na 10 zmienionych
plikach `src/`, migracja obecna w historii lokalnej bazy. Werdykt REJECTED wynika wyłącznie
z F1.

## Triage — 2026-09-07

Werdykt REJECTED wynikal wylacznie z F1. Po triage: **F1 i F2 naprawione i zweryfikowane**,
F4/F6/F10 rozwiazane, F9 dopisane, F3/F5/F7/F8 swiadomie pominiete.

Stan po naprawach: `npm test` 182 testy (9 plikow), `npm run test:integration` 29 testow,
`astro check` 0 bledow, ESLint 0 bledow. Dwie nowe migracje:
`20260907221126_harden_generation_attempts.sql` i `20260907221925_atomic_limit_gate.sql`.

**Zmiana architektoniczna z F2, warta odnotowania poza samym ustaleniem:** autorytetem
limitow jest teraz baza, nie TypeScript. Progi 10 i 30 mieszkaja w `daily_per_account()`
i `daily_app_ceiling()`, a `usage_today()` je zwraca, zeby interfejs czytal te same liczby,
ktore obowiazuja przy zapisie. Plan zakladal odwrotnie.

## Findings

### F1 — Wiersz próby z datą w przyszłości trwale wyczerpuje sufit aplikacji

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260907192600_create_generation_attempts.sql:108 oraz :56-60
- **Detail**: Złączenie w `usage_today()` ma tylko dolną granicę doby
  (`a.created_at >= day.starts_at`); CTE liczy `ends_at`, ale nikt go nie używa w warunku.
  Jednocześnie polityka `generation_attempts_insert_own` pozwala roli `authenticated` wstawiać
  wiersze przez PostgREST z **dowolnym `created_at`** — kolumna ma `default now()`, ale nic nie
  wymusza tej wartości.

  **Zweryfikowane eksperymentalnie 2026-09-07** (transakcja z rollbackiem, rola `authenticated`):
  `app_count` przed 24 → wstawienie wiersza z `created_at = '2030-01-01'` → `app_count` 25.
  Próba usunięcia przez samego wstawiającego: `DELETE 0`.

  Scenariusz awarii: dowolne zarejestrowane konto (rejestracja jest otwarta z wyboru — PRD,
  `## Access Control`) wysyła 30 żądań na `/rest/v1/generation_attempts` z `created_at` w roku 2030. `app_count` jest odtąd trwale ≥ 30, `checkLimits` odmawia **każdemu kontu**, a wierszy
  nie da się usunąć: polityki DELETE nie ma, klienta `service_role` projekt świadomie nie ma
  („What We're NOT Doing"). Odzyskanie wymaga ręcznego dostępu do bazy. Gwarancja kosztu
  przetrwa (neurony nie są wydawane), gwarancja dostępności nie.

  Dowód eksploatowalności siedzi w samym zestawie testów: `src/lib/limits.integration.test.ts:266`
  wstawia jawny `created_at` i przechodzi.

- **Fix A ⭐ Recommended**: Zamknąć okno doby i odebrać klientom prawo zapisu — `and a.created_at < day.ends_at` w funkcji, `revoke insert ... from anon, authenticated`, a zapis przenieść do funkcji `security definer`, która sama ustawia `created_at` i `auth.uid()`.
  - Strength: Zamyka całą klasę, nie jeden objaw — po tym kliencki `created_at` przestaje istnieć jako pojęcie, a przy okazji znika droga do F2, bo sprawdzenie i zapis mogą wejść do jednej instrukcji.
  - Tradeoff: Druga funkcja `security definer`, czyli poszerzenie wyjątku od RLS, który ten plaster wprowadził jako jedyny i wąski. Wymaga migracji i zmiany w `recordAttempt`.
  - Confidence: HIGH — mechanizm sprawdzony eksperymentalnie w obie strony, a wzorzec definer jest już w repo.
  - Blind spot: Nie sprawdzono, czy `revoke insert` nie psuje czegoś w testach integracyjnych, które dziś wstawiają wiersze wprost.
- **Fix B**: Sama dolna i górna granica — dopisać `and a.created_at < day.ends_at`, resztę zostawić.
  - Strength: Jedna linia w migracji, żadnego nowego obiektu bazy, natychmiast skraca awarię z „bezterminowej" do najwyżej dobowej.
  - Tradeoff: Nie usuwa przyczyny. Konto nadal może wstawić 30 wierszy z dzisiejszą datą i zablokować wszystkich do północy, a wierszy nadal nie da się skasować.
  - Confidence: HIGH — poprawka trywialna i w pełni zrozumiała.
  - Blind spot: Zostawia otwartą dobową odmowę usługi jako zaakceptowane ryzyko, czego plan nigdzie nie rozważał.
- **Decision**: FIXED via Fix A — migracja 20260907221126_harden_generation_attempts.sql (gorna granica okna doby, funkcja record_attempt(), revoke insert od anon/authenticated); zweryfikowane eksperymentalnie: zapis wprost odmowiony, data ustawiana serwerowo

### F2 — Wyścig sprawdzenia i zapisu nie jest ograniczony do „jednej pozycji"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/generate.ts:89-111
- **Detail**: Plan zapisał ten wyścig jako świadomie odłożony i oszacował go na „przekroczenie
  o jedną pozycję, nie wyciek kosztu". To oszacowanie jest zaniżone. Odczyt i zapis to dwa
  obroty bez blokady, bez unikalnego ograniczenia i bez licznika atomowego, więc przekroczenie
  jest ograniczone **współbieżnością**, nie liczbą 1.

  Scenariusz awarii: 40 równoległych żądań z jednej sesji odczytuje `app_count = 0`, wszystkie
  przechodzą bramkę, wszystkie wołają Workers AI. Dzienny przydział neuronów — czyli jedyny
  powód istnienia sufitu — znika w jednej serii.

- **Fix**: Złożyć bramkę i zapis w jedną funkcję `security definer` (`record_attempt_if_allowed()`) zwracającą decyzję — jedna instrukcja, jedna migawka widoczności. Ta sama zmiana wchodzi w Fix A z F1.
- **Decision**: FIXED — migracja 20260907221925_atomic_limit_gate.sql: record_attempt_if_allowed() liczy, decyduje i zapisuje w jednej instrukcji serializowanej blokada doradcza; progi przeniesione do SQL (daily_per_account/daily_app_ceiling), usage_today() je zwraca; checkLimits zastapione przez interpretGate

### F3 — Weryfikacja ręczna faz 2 i 3 nie zostawiła odtwarzalnego śladu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: context/changes/daily-generation-limits/plan.md (Progress 2.4–2.6, 3.4–3.7)
- **Detail**: Siedem pozycji weryfikacji ręcznej jest zaznaczonych, ale bieżący stan bazy ich
  nie potwierdza. Wszystkie 36 kont w `auth.users` to fixtury testowe (18 × `rls-*`,
  18 × `limits-*`), zero kont prawdziwych; `auth.audit_log_entries` nie zawiera ani jednej
  rejestracji spoza testów; wszystkie 18 wierszy `generations` należy do kont `rls-*`, a
  wszystkie 32 wiersze `generation_attempts` do kont `limits-*`. Żadne konto nie ma jednego
  i drugiego, czyli **żadna generacja nie przeszła przez aplikację** od czasu `db reset` w fazie 1.

  Stan jest jednak **niejednoznaczny**, i to z winy kolejności kroków, którą sam podałem:
  weryfikacja 2.6 i 3.7 kończy się poleceniem `npx supabase stop`, które na tej maszynie
  potrafi skasować wolumen. Obecny stan jest tak samo zgodny z „zweryfikowano, po czym krok
  zatrzymania bazy skasował dowody" jak z „nie wykonano". Rozstrzygnąć się tego już nie da.

- **Fix**: W przyszłych planach umieszczać kroki niszczące stan (zatrzymanie bazy, reset) **jako pierwsze**, nie ostatnie, żeby weryfikacja nie kasowała własnych dowodów. Dla tej zmiany: powtórzyć 2.4–2.5 i 3.4–3.6 na świeżym koncie, jeśli ma to być twierdzenie, a nie deklaracja.
- **Decision**: SKIPPED — stanu nie da sie juz rozstrzygnac. Wniosek na przyszlosc zapisany w tresci ustalenia: kroki niszczace stan ida pierwsze, nie ostatnie

### F4 — Zestaw granicy doby sprawdza tylko krawędź przeszłą

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: src/lib/limits.integration.test.ts:260-273
- **Detail**: Test wstawia wiersz sprzed 26 godzin i sprawdza, że nie jest liczony — czyli
  dokładnie tę połowę okna, która **jest** ograniczona. Symetryczny przypadek („wiersz z datą
  w przyszłości nie liczy się do dziś") złapałby F1 przed przeglądem.
- **Fix**: Dodać przypadek z `created_at` w przyszłości; po poprawce z F1 ma być zielony, przed nią czerwony.
- **Decision**: NIEAKTUALNE po F1 — przypadek z wlasnym created_at nie da sie juz napisac, bo klient nie ma prawa zapisu do tabeli. Zastapiony przez "swiezo zapisana proba liczy sie do biezacej doby" oraz test egzekucji limitu

### F5 — Odpowiedź 429 nie niesie informacji o odnowieniu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Architecture
- **Location**: src/pages/api/generate.ts:96-102
- **Detail**: `resetsAt` jest już odczytane przez `fetchUsageToday`, ale zostaje porzucone.
  Klient pokazuje statyczny tekst „Odnowi się o północy" ze słownika, a odpowiedź nie ma
  nagłówka `Retry-After`. Dziś nieszkodliwe; błędne w chwili, gdy strefa albo okno zmieni się
  po stronie SQL, bo komunikat pozostanie niezależny od prawdy.
- **Fix**: Rozważyć `Retry-After` na odpowiedzi 429; zmiana treści komunikatu wymagałaby wyjścia poza kontrakt `{ error: { code, message, fields? } }`, więc nagłówek jest tańszą drogą.
- **Decision**: SKIPPED — po F2 endpoint nie czyta juz licznika przed bramka, wiec Retry-After wymagalby dodatkowego odczytu albo rozszerzenia funkcji bramki

### F6 — Zegar NFR przestał obejmować obroty do bazy

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Architecture
- **Location**: src/pages/api/generate.ts:113-119
- **Detail**: Przeniesienie `deadline` za bramkę jest słuszne dla budżetu modelu i tak zostało
  uzasadnione w komentarzu. Nie zostało powiedziane, że skutkiem ubocznym jest wyjście czasu
  obu obrotów do bazy **poza** zegar NFR — łączny czas odczuwany przez użytkownika może teraz
  przekroczyć 15 s / 30 s o czas bazy.
- **Fix**: Dopisać zdanie do komentarza; przy obecnym ruchu nie warto zmieniać zachowania.
- **Decision**: FIXED — komentarz w generate.ts nazywa teraz wprost, ze czas rezerwacji lezy poza zegarem NFR

### F7 — Indeks `generation_attempts_user_id_created_at_idx` nie ma ścieżki odczytu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260907192600_create_generation_attempts.sql:41-42
- **Detail**: Własne zużycie liczone jest **wewnątrz** `usage_today()` jednym przejściem
  filtrowanym po `created_at`, z `count(...) filter (where user_id = auth.uid())`. Nic nie
  odpytuje tabeli po `user_id`. Indeks kosztuje narzut przy zapisie, a jego komentarz opisuje
  ścieżkę odczytu, która nie istnieje.
- **Fix**: Usunąć indeks albo poprawić komentarz na „zapas pod przyszły odczyt per konto" — dziś twierdzi nieprawdę.
- **Decision**: SKIPPED — indeks szkodzi tylko narzutem przy zapisie, niewidocznym przy 30 wierszach na dobe

### F8 — Panel wykonuje dwa odczyty szeregowo

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:28-55
- **Detail**: `fetchUsageToday` jest oczekiwane przed `fetchRanking`/`fetchFavourites`, choć
  zapytania są niezależne i mogłyby pójść pod `Promise.all`. `GenerateScreen.astro:30` dokłada
  jedno RPC do każdego renderu `/` i `/generate`.
- **Fix**: Zrównoleglić oba odczyty w panelu.
- **Decision**: SKIPPED — zysk minimalny przy obecnych rozmiarach danych

### F9 — `resetTimeFormat` nie ma testu jednostkowego, wbrew Testing Strategy planu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: src/lib/generation-labels.ts:38-42, src/lib/limits.integration.test.ts:277
- **Detail**: Plan wymienia w Testing Strategy „Formatter godziny odnowienia: strefa
  `Europe/Warsaw`". Testu nie ma, a zestaw integracyjny **odtwarza własne** opcje
  `Intl.DateTimeFormat` zamiast zaimportować eksport, który miałby przypinać — zmiana strefy
  w `generation-labels.ts` nie zapali niczego na czerwono.
- **Fix**: Dodać test jednostkowy dla `resetTimeFormat` albo zaimportować go w teście integracyjnym zamiast duplikować opcje.
- **Decision**: FIXED — nowy src/lib/generation-labels.test.ts przypina strefe Europe/Warsaw na czasie letnim i zimowym

### F10 — Drobiazgi: nieanotowane `let usage` i literówka

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/generate.ts:89, src/lib/limits.ts:33
- **Detail**: `let usage;` bez adnotacji typu, podczas gdy plik konsekwentnie anotuje
  (`let body: unknown`). W `limits.ts:33` literówka „mie sci" zamiast „mieści".
- **Fix**: Dopisać adnotację typu i poprawić literówkę.
- **Decision**: FIXED — let decision: GateOutcome w generate.ts; literowka zniknela przy przepisaniu limits.ts

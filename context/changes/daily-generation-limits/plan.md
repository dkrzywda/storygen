# Dzienny limit na konto i sufit dzienny całej aplikacji — Implementation Plan

## Overview

Dwie bramki przed wywołaniem modelu: własny limit **10 generacji/dobę** (FR-012) i sufit
**30 generacji/dobę na całą aplikację** (FR-013). Obie liczone po **próbach**, nie po zapisanych
wynikach, z granicą doby w `Europe/Warsaw`, fail-closed przy awarii licznika. Zużycie widoczne
w panelu i na ekranie generatora, żeby limit był wyjaśnieniem, a nie niespodzianką.

## Current State Analysis

- **Neurony wydaje dokładnie jedno miejsce** — `src/pages/api/generate.ts`. Pierwsze wywołanie
  modelu startuje w `src/pages/api/generate.ts:107`. Wszystko przed nim (auth, parsowanie JSON,
  `validate`) jest darmowe. Bramka wchodzi w tę szczelinę.
- **Nie ma żadnego licznika.** `supabase/migrations/` ma trzy migracje; tabela `generations`
  jest jedyną tabelą aplikacji. Zero infrastruktury limitów.
- **RLS uniemożliwia policzenie sufitu aplikacji zwykłym zapytaniem.** Polityka
  `generations_select_own` (`supabase/migrations/20260903125113_create_generations.sql`)
  przepuszcza wyłącznie `auth.uid() = user_id`. `count` z klienta aplikacji zwróci liczbę
  własnych wierszy i **nie zgłosi błędu** — czyli po cichu skłamie o stanie całej aplikacji.
- **Liczenie zapisanych wierszy nie ogranicza kosztu.** `TOPIC_REJECTED`,
  `FORMAT_CONTRACT_FAILED`, `GENERATION_TIMEOUT` oraz nieudany best-effort zapis
  (`succeed()` w endpoincie) wydają neurony i **nie zapisują nic**.
- **Ryzyko jest już zapisane i przypisane do tego plastra.** `context/foundation/test-plan.md`,
  **R-07**: „Licznik limitu nie domyka się i sufit kosztu nie działa", objaw: „Generowanie
  działa dalej — awarią jest rachunek, nie błąd", status: „luka, wchodzi z `S-04`".
- **Ekran generatora jest jeden dla dwóch adresów.** `src/components/generate/GenerateScreen.astro`
  obsługuje `/` i `/generate`; jest renderowany serwerowo i osadza wyspę `GenerateForm`.
- **Panel ma dwie zakładki** (`src/pages/dashboard.astro`) — ranking i ulubione, oba wybierane
  przez `?tab=`, oba renderowane serwerowo.

## Desired End State

Zalogowany użytkownik widzi w panelu własne zużycie i zużycie całej aplikacji wraz z godziną
odnowienia, a na ekranie generatora liczbę pozostałych generacji przy przycisku. Po wyczerpaniu
własnego limitu albo sufitu aplikacji kliknięcie „generuj" kończy się polskim komunikatem
wyjaśniającym **którą** granicę osiągnięto, a model nie jest w ogóle wołany. Awaria licznika
blokuje generowanie. R-07 przestaje być luką w rejestrze ryzyk.

Weryfikacja: `npm test` (decyzja bramki), `npm run test:integration` (polityki nowej tabeli,
funkcja definer, granica doby), oraz ręczne przejście przez wyczerpanie limitu.

### Key Discoveries:

- Szczelina na bramkę: między `validate(generateRequestSchema, body)` i pierwszym `attempt()` —
  `src/pages/api/generate.ts:53`–`:107`.
- Wzorzec granularnych polityk per operacja i per rola oraz **celowego braku polityki** jako
  mechanizmu odmowy: `supabase/migrations/20260903125113_create_generations.sql` („Brak polityki
  DELETE jest zamierzony: dopóki jej nie ma, RLS odrzuca każde usunięcie").
- `Record<ApiErrorCode, ApiErrorSpec>` w `src/lib/api-errors.ts` zamienia zapomniany komunikat
  w błąd typu — nowy kod musi wejść w `src/types.ts` **i** w `API_ERRORS`.
- Wzorzec testu RLS pod kluczem **anon**: `src/lib/generations.integration.test.ts:38`–`:41`,
  ze strażnikiem odmawiającym uruchomienia poza lokalnym hostem i przy kluczu sekretnym.
- Duplikacja etykiet była już raz ustaleniem przeglądu (F2 w `browse-generation-history`), stąd
  `src/lib/generation-labels.ts` — formatter godziny odnowienia idzie tam od razu, nie przy
  drugim użyciu.

## What We're NOT Doing

- **Limitów per format.** Roadmapa odrzuca to wprost: „Rozróżnienie per format zbędne — sufit
  neuronowy sam wycenia opowiadanie ~4,5× drożej niż dowcip".
- **Zapisywania wyniku próby.** Tabela prób trzyma sam fakt próby. Bez polityki UPDATE konto
  nie może obniżyć własnego zużycia.
- **Klucza `service_role`.** Żadnego klienta omijającego RLS globalnie. Wyjątek jest zamknięty
  w jednej bezparametrowej funkcji zwracającej trzy liczby.
- **Płatnych progów i limitów innych niż dobowe.** PRD: daily limit jest identyczny dla wszystkich.
- **Kasowania starych wierszy prób.** Retencja to osobna decyzja; przy 30/dobę tabela rośnie
  o ~11 tys. wierszy rocznie w najgorszym razie.
- **Pomiaru Neuronów.** Liczby 33/151 pochodzą z `tech-stack.md`, nie z pomiaru. Sufit 30 ma
  z tego powodu zapas; pomiar zostaje otwarty.

## Implementation Approach

Kolejność: baza → logika → powierzchnia → dowód. Migracja stoi osobno, bo błąd w politykach
nowej tabeli albo w funkcji `security definer` jest błędem w modelu bezpieczeństwa i musi wyjść
przed napisaniem bramki, a nie razem z nią.

Bramka jest **synchroniczna i poprzedza wywołanie modelu**: jeden odczyt liczników, decyzja,
zapis wiersza próby, i tylko potem pierwsze `attempt()`. Zapis próby przed wywołaniem — nie po —
jest tym, co czyni sufit sufitem kosztu: próba, która padnie, i tak jest policzona.

## Critical Implementation Details

**Funkcja licznika nie może przyjmować żadnego parametru.** Gdyby granica doby wchodziła
argumentem, konto mogłoby wywołać RPC ze starą datą i dostać niski wynik — czyli obejść sufit
przez publiczne API. Funkcja liczy dobę sama. Konsekwencja: arytmetyka doby istnieje **wyłącznie
w SQL**, i to jest jedyne jej miejsce w produkcie.

**Kolejność zapisu wobec odczytu.** Odczyt liczników i zapis próby to dwie operacje, więc dwa
równoległe żądania tego samego konta mogą oba zobaczyć stan „9 z 10" i oba przejść. Przy jednym
realnym użytkowniku i limicie 10 to przekroczenie o jedną pozycję, nie wyciek kosztu; poprawne
domknięcie wymagałoby transakcji albo warunku liczącego wewnątrz jednej instrukcji `insert`.
Świadomie nie robimy tego teraz — zapisane w Open Risks, nie przemilczane.

**Fail-closed zmienia zachowanie aplikacji nieskonfigurowanej.** Dziś przy `supabase === null`
endpoint generuje i tylko nie zapisuje (`succeed()` sprawdza `if (supabase)`). Po tej zmianie
brak konfiguracji **odmawia generowania** kodem `NOT_CONFIGURED`, bo bez bazy nie ma licznika,
a bez licznika nie ma sufitu. To celowa strata funkcji w trybie nieskonfigurowanym.

---

## Phase 1: Migracja — tabela prób, RLS, funkcja definer

### Overview

Powstaje tabela `generation_attempts` z politykami węższymi niż w `generations` oraz jedna
bezparametrowa funkcja `security definer`, która jest jedynym w projekcie celowym wyjątkiem
od RLS.

### Changes Required:

#### 1. Migracja tabeli i polityk

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_generation_attempts.sql`

**Intent**: Utworzyć tabelę zdarzeń, na której stoją oba limity, z RLS włączonym w tej samej
migracji co tabela — tak jak zrobiła to migracja `generations`, żeby nie zostawić okna bez
gwarancji izolacji.

**Contract**: Tabela `public.generation_attempts` z kolumnami `id` (uuid, pk), `user_id`
(uuid, not null, `references auth.users (id) on delete cascade`), `format` (text, not null,
check `in ('joke','story')`), `created_at` (timestamptz, not null, default `now()`).
Dwa indeksy: `(created_at desc)` pod odczyt sufitu aplikacji i `(user_id, created_at desc)`
pod odczyt własnego zużycia.

Polityki — **tylko dwie**, granularne per operacja i per rola: `select` dla `authenticated`
z `using (auth.uid() = user_id)` oraz `insert` dla `authenticated` z
`with check (auth.uid() = user_id)`. Polityk `update` i `delete` **nie ma i to jest mechanizm,
nie przeoczenie**: bez nich RLS odrzuca każdą próbę zmiany i usunięcia, więc konto nie może
obniżyć własnego zużycia. Komentarz w migracji musi to nazwać, wzorem komentarza o braku
polityki DELETE w migracji `generations`.

`format` jest zapisywany, choć limit go nie używa: bez niego tabela nie odpowie na pytanie
„ile kosztowały porażki", które po wyborze „tylko fakt próby" jest jedyną pozostałą diagnostyką
kosztu, a opowiadanie jest ~4,5× droższe od dowcipu.

#### 2. Funkcja licznika

**File**: ta sama migracja

**Intent**: Udostępnić zalogowanemu trzy liczby — własne zużycie w dobie, zużycie całej
aplikacji w dobie, oraz moment odnowienia — nie udostępniając ani jednego cudzego wiersza.

**Contract**: Bezparametrowa funkcja `public.usage_today()` zwracająca dokładnie trzy skalary:
`own_count integer`, `app_count integer`, `resets_at timestamptz`. Zadeklarowana jako
`language sql`, `security definer`, `stable`, z `set search_path = ''`.

Ciało liczy jednym przejściem po tabeli: `count(*) filter (where user_id = auth.uid())` dla
własnego zużycia i `count(*)` dla całej aplikacji, z warunkiem
`created_at >= (date_trunc('day', now() at time zone 'Europe/Warsaw')) at time zone 'Europe/Warsaw'`.
`resets_at` to ta sama granica powiększona o `interval '1 day'`.

Podwójna konwersja `at time zone` nie jest ozdobą i dlatego zapisana wprost: pierwsza sprowadza
„teraz" do czasu lokalnego, żeby `date_trunc` uciął dobę na **lokalnej** północy, a druga wraca
do `timestamptz`, czyli do momentu na osi czasu — i przy tej drodze zmiana czasu daje poprawną
dobę 23- lub 25-godzinną bez ani jednej linii kodu na to poświęconej.

Uprawnienia: `revoke execute ... from public` **przed** `grant execute ... to authenticated`.
Bez odebrania domyślnego uprawnienia funkcja `security definer` byłaby wywoływalna także przez
rolę `anon` — czyli wyjątek od RLS stałby otwarty dla niezalogowanych.

#### 3. Wygenerowane typy bazy

**File**: `src/lib/database.types.ts`

**Intent**: Odświeżyć typy, żeby nowa tabela i funkcja były widoczne dla `astro check`.

**Contract**: `npx supabase gen types typescript --local`, następnie `npx prettier --write` na
tym pliku — CLI nie zna Prettiera, a plik jest ESLint-ignored jako wygenerowany.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czysto: `npx supabase db reset`
- Typy bazy przechodzą kontrolę: `npx astro check`
- Lint plików dotkniętych w tej fazie przechodzi: `npx eslint <pliki>`

#### Manual Verification:

- W Studio tabela `generation_attempts` ma dokładnie dwie polityki
- Wywołanie `select * from public.usage_today()` jako zalogowany zwraca trzy liczby
- `update` i `delete` na własnym wierszu prób są odrzucane

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na
potwierdzenie weryfikacji ręcznej przed przejściem do następnej fazy.

---

## Phase 2: Bramka w endpoincie i warstwa dostępu

### Overview

Dwa nowe kody błędu, limity w jednym miejscu, sprawdzenie i zapis próby wstawione dokładnie
między walidację a pierwsze wywołanie modelu, plus testy jednostkowe decyzji bramki.

### Changes Required:

#### 1. Kody błędów

**File**: `src/types.ts`

**Intent**: Dodać dwa rozłączne kody, żeby użytkownik dowiedział się, **którą** granicę
osiągnięto — jeden wspólny kod nie byłby wyjaśnieniem, którego wymagają FR-012 i FR-013.

**Contract**: `ApiErrorCode` zyskuje `"DAILY_LIMIT_REACHED"` i `"APP_LIMIT_REACHED"`.

#### 2. Słownik komunikatów

**File**: `src/lib/api-errors.ts`

**Intent**: Nadać obu kodom status HTTP i polski komunikat. `Record<ApiErrorCode, …>` wymusi to
błędem typu, jeśli któryś zostanie pominięty.

**Contract**: Oba dostają status **429**. Komunikaty w formie **bezosobowej** — polski czasownik
w drugiej osobie niesie rodzaj gramatyczny, którego nie znamy, więc nie „wykorzystałeś":
własny limit → „Dzienny limit generacji został wyczerpany. Odnowi się o północy."; sufit
aplikacji → „Aplikacja osiągnęła dzienny limit generacji dla wszystkich kont. Spróbuj ponownie
po północy."

#### 3. Warstwa limitów

**File**: `src/lib/limits.ts` (nowy)

**Intent**: Trzymać w jednym miejscu obie liczby, odczyt liczników, zapis próby i **czystą
decyzję** bramki — rozdzielenie decyzji od wejścia/wyjścia jest tym, co czyni ją testowalną
jednostkowo bez bazy.

**Contract**: Eksportuje stałe `DAILY_PER_ACCOUNT = 10` i `DAILY_APP_CEILING = 30`, z komentarzem
wyprowadzającym 30 z budżetu Neuronów (~302 Neurony na pozycję z ponowną próbą × 30 ≈ 9 060
z 10 000 dziennie). Dalej: `fetchUsageToday(supabase)` — wywołanie RPC `usage_today`, zwraca
trzy liczby albo rzuca; `recordAttempt(supabase, { userId, format })` — insert, **rzuca** przy
błędzie, tak jak `saveGeneration` w `src/lib/generations.ts`, bo decyzję o reakcji podejmuje
wywołujący; `checkLimits(usage)` — funkcja **czysta** zwracająca `{ ok: true }` albo
`{ ok: false, code }`, sprawdzająca najpierw własny limit, potem sufit aplikacji.

Odczyt idzie przez RPC także dla **własnego** zużycia. To odejście od zasady zapisanej
w `src/lib/generations.ts` („żaden odczyt nie filtruje po `user_id`"), więc powód wprost: filtr
po `auth.uid()` siedzi w **bazie, wewnątrz funkcji**, a nie w kodzie aplikacji, i nie da się go
podać z zewnątrz. Alternatywa — własny licznik pod RLS liczony w TypeScripcie — postawiłaby
arytmetykę doby w dwóch miejscach, które musiałyby się zgadzać.

#### 4. Bramka w endpoincie

**File**: `src/pages/api/generate.ts`

**Intent**: Odmówić przed wydaniem choćby jednego Neurona i policzyć każdą próbę, która
przeszła bramkę.

**Contract**: Po `validate(...)` i przed pierwszym `attempt(...)`, w tej kolejności: brak
klienta Supabase → `jsonError("NOT_CONFIGURED")` (fail-closed); `fetchUsageToday` rzuca →
`fail("INTERNAL", error)` i generowanie nie startuje; `checkLimits` odmawia → `jsonError(code)`
**bez** logowania jako błąd, bo wyczerpany limit to spodziewana ścieżka, dokładnie jak
`TOPIC_REJECTED`; `recordAttempt` rzuca → `fail("INTERNAL", error)` i również brak generowania.

Wiersz próby powstaje **raz na żądanie**, niezależnie od tego, czy padnie jedna próba modelu,
czy dwie — sufit 30 był policzony właśnie jako 30 pozycji z ponowną próbą w cenie.

#### 5. Testy decyzji bramki

**File**: `src/lib/limits.test.ts` (nowy)

**Intent**: Domknąć tę część R-07, która żyje w TypeScripcie: która granica wygrywa i gdzie
dokładnie leży.

**Contract**: Zestaw dla `checkLimits`: zużycie o jeden poniżej limitu przechodzi; **równe**
limitowi odmawia (limit jest osiągnięty, nie przekroczony); oba wyczerpane → wygrywa kod
własnego limitu; sufit wyczerpany przy niewyczerpanym własnym → kod sufitu; własny licznik
wyższy od limitu (stan po przekroczeniu wyścigiem) nadal odmawia.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro check`
- Lint plików dotkniętych w tej fazie przechodzi: `npx eslint <pliki>`

#### Manual Verification:

- Generowanie działa normalnie poniżej limitu
- Po wyczerpaniu limitu konta pojawia się polski komunikat, a w logach Workera **nie ma** wpisu
  błędu dla tej odmowy
- Zatrzymanie lokalnej bazy skutkuje odmową generowania, nie generowaniem

**Implementation Note**: Zatrzymaj się po weryfikacji automatycznej i poczekaj na potwierdzenie.

---

## Phase 3: Powierzchnia — panel i generator

### Overview

Zużycie staje się widoczne przed kliknięciem: dwie linie z godziną odnowienia w panelu, licznik
przy przycisku na ekranie generatora.

### Changes Required:

#### 1. Formatter godziny odnowienia

**File**: `src/lib/generation-labels.ts`

**Intent**: Sformatować moment odnowienia po polsku w jednym miejscu — panel i generator pokażą
tę samą wartość, bo duplikacja etykiet była już raz ustaleniem przeglądu (F2).

**Contract**: Nowy eksport formatujący `resets_at` do godziny w strefie `Europe/Warsaw`, obok
istniejących `formatLabel`, `dateFormat`, `wordsLabel`.

#### 2. Blok zużycia w panelu

**File**: `src/pages/dashboard.astro`

**Intent**: Pokazać własne zużycie i zużycie całej aplikacji, żeby FR-013 miał powierzchnię inną
niż komunikat błędu.

**Contract**: Blok nad zakładkami, renderowany serwerowo z `fetchUsageToday`, widoczny na obu
zakładkach. Dwie linie „X z 10" i „X z 30" plus godzina odnowienia. Gdy odczyt zawiedzie albo
klient jest `null` — blok mówi, że zużycia nie udało się odczytać, i **nie** pokazuje zer:
zero jest twierdzeniem o stanie, a wtedy go nie znamy.

#### 3. Licznik na ekranie generatora

**File**: `src/components/generate/GenerateScreen.astro`

**Intent**: Postawić liczbę pozostałych generacji tam, gdzie zapada decyzja o kliknięciu.

**Contract**: Odczyt `fetchUsageToday` po stronie serwera, wynik przekazany do wyspy
`GenerateForm` jako prop. Ekran obsługuje `/` i `/generate` jednocześnie, więc jedna zmiana
pokrywa oba adresy.

#### 4. Wyświetlanie i aktualizacja w wyspie

**File**: `src/components/generate/GenerateForm.tsx`

**Intent**: Pokazać pozostałe generacje przy przycisku i utrzymać liczbę uczciwą po odpowiedzi
serwera.

**Contract**: Nowy **opcjonalny** prop z początkowym zużyciem — opcjonalny, bo odczyt mógł
zawieść, i wtedy licznik się nie renderuje. Po odpowiedzi: kod `DAILY_LIMIT_REACHED` →
pozostało zero; każda inna odpowiedź → liczba bez zmian.

**Znane ograniczenie, zapisane świadomie:** po nieudanej generacji (timeout, złamany kontrakt,
odmowa tematu) próba została policzona po stronie serwera, a wyspa tego nie wie — licznik jest
o jeden zawyżony do odświeżenia strony. Alternatywą byłoby dołożenie zużycia do koperty
odpowiedzi błędu, co złamałoby kontrakt `{ error: { code, message, fields? } }` z F-01.
Wybieramy nieaktualny licznik zamiast rozszczelnionego kontraktu.

### Success Criteria:

#### Automated Verification:

- Kontrola typów przechodzi: `npx astro check`
- Testy jednostkowe przechodzą: `npm test`
- Lint plików dotkniętych w tej fazie przechodzi: `npx eslint <pliki>`

#### Manual Verification:

- Panel pokazuje oba liczniki i godzinę odnowienia, na obu zakładkach
- Licznik na generatorze zgadza się z panelem
- Po wyczerpaniu limitu licznik na generatorze pokazuje zero, a komunikat wyjaśnia którą granicę
- Przy zatrzymanej bazie panel mówi o nieudanym odczycie, a nie pokazuje „0 z 10"

**Implementation Note**: Zatrzymaj się po weryfikacji automatycznej i poczekaj na potwierdzenie.

---

## Phase 4: Testy integracyjne, R-07 i tech-stack

### Overview

Dowód w bazie: polityki nowej tabeli i funkcja definer pod kluczem anon. Potem domknięcie R-07
w rejestrze ryzyk i poprawka twierdzenia w `tech-stack.md`, które się nie broni.

### Changes Required:

#### 1. Zestaw integracyjny

**File**: `src/lib/limits.integration.test.ts` (nowy)

**Intent**: Sprawdzić to, czego test jednostkowy dotknąć nie może: polityki RLS, wyjątek
`security definer` i arytmetykę doby — wszystkie trzy żyją w bazie.

**Contract**: Musi skopiować strażnika z `src/lib/generations.integration.test.ts` — odmowa
uruchomienia poza lokalnym hostem i przy kluczu sekretnym. **Klucz publishable/anon jest
wymogiem, nie preferencją**: `service_role` omija RLS, więc dałby zielone światło także przy
dziurawej polityce, czyli na jedynej gwarancji, na której stoi cały model dostępu.

Przypadki: Bob nie widzi wierszy prób Alicji; Bob nie wstawi wiersza na `user_id` Alicji;
`update` i `delete` na **własnym** wierszu są odrzucane (brak polityki); `usage_today()`
policzone przez Boba widzi próby Alicji w `app_count`, a w `own_count` tylko własne — to jest
dowód, że wyjątek działa **i** że jest wąski; funkcja nie zwraca żadnego identyfikatora ani
treści; wiersz z datą sprzed lokalnej północy nie jest liczony, a z dzisiejszej doby jest.

Uwaga do pułapki zapisanej w komentarzu istniejącego zestawu: `update`/`delete ... where`
czytają wiersze, więc same przechodzą przez politykę SELECT. Przy tabeli prób nie ma jednak
żadnej polityki `update`/`delete`, więc odmowa jest bezwarunkowa — i test ma to potwierdzać
wprost, nie przez brak wyniku.

#### 2. Domknięcie R-07

**File**: `context/foundation/test-plan.md`

**Intent**: Zamienić lukę na pokrycie i dopisać zestaw, tak jak zrobiono dla R-01…R-06.

**Contract**: Wiersz R-07 zyskuje pliki testów i status „pokryte"; poniżej powstaje sekcja
„Zestaw R-07" z wymienionymi przypadkami i **jawnym zapisem, czego zestaw nie dowodzi** —
wyścigu dwóch równoległych żądań tego samego konta.

#### 3. Poprawka twierdzenia o sufcie

**File**: `context/foundation/tech-stack.md`

**Intent**: Usunąć z dokumentu fundamentowego liczbę, która się nie broni. `CLAUDE.md` ładuje
ten plik w każdej sesji, więc fałszywe twierdzenie propaguje się do każdej przyszłej decyzji.

**Contract**: Zdanie o sufcie „50 generacji/dzień fits with room for the one-retry rule" zostaje
zastąpione sufitem **30** z wyliczeniem najgorszego przypadku (same opowiadania, każde z ponowną
próbą, ~302 Neurony na pozycję, 30 × 302 ≈ 9 060 z 10 000) i wzmianką, że 50 broniło się tylko
dla mieszanki zdominowanej przez dowcipy.

### Success Criteria:

#### Automated Verification:

- Zestaw integracyjny przechodzi: `npm run test:integration` (wymaga `npx supabase start`)
- Szybki zestaw pozostaje wolny od Dockera: `npm test`
- Kontrola typów przechodzi: `npx astro check`
- Lint plików dotkniętych w tej fazie przechodzi: `npx eslint <pliki>`

#### Manual Verification:

- Eksperyment odwrotny: rozszerzenie polityki SELECT nowej tabeli do `using (true)` robi zestaw
  **czerwonym** — bez tego zielony wynik nic nie dowodzi
- R-07 w test-planie nie ma już statusu „luka"
- `tech-stack.md` nie zawiera już liczby 50 jako sufitu

**Implementation Note**: Zatrzymaj się po weryfikacji automatycznej i poczekaj na potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- `checkLimits`: granica dokładna (równe limitowi odmawia), pierwszeństwo kodu własnego limitu,
  stan po przekroczeniu wyścigiem
- Formatter godziny odnowienia: strefa `Europe/Warsaw`

### Integration Tests:

- Polityki `generation_attempts` pod kluczem anon: odczyt, wstawianie na cudze konto, brak
  polityk `update`/`delete`
- `usage_today()`: `app_count` liczy w poprzek kont, `own_count` nie; brak wycieku
  identyfikatorów i treści
- Granica doby: wiersz sprzed lokalnej północy nie liczy się do dzisiejszej doby

### Manual Testing Steps:

1. Wygenerować tekst poniżej limitu — działa normalnie, licznik spada
2. Wyczerpać limit konta i sprawdzić komunikat oraz brak wpisu błędu w logach Workera
3. Zatrzymać bazę i sprawdzić, że generowanie **odmawia**, a panel mówi o nieudanym odczycie
4. Rozszerzyć politykę SELECT do `using (true)` i potwierdzić, że zestaw integracyjny czerwienieje

## Performance Considerations

Jedno dodatkowe wywołanie RPC na żądanie generowania, na render panelu i na render ekranu
generatora — ten ostatni jest najczęściej odwiedzany. Oba indeksy nowej tabeli są dobrane pod
te dwa odczyty (`(created_at desc)` dla sufitu, `(user_id, created_at desc)` dla własnego).
Przy 30 wierszach na dobę koszt jest pomijalny; przy wielokrotnie większym ruchu właściwą
odpowiedzią jest tabela agregatów, nie kolejny indeks.

## Migration Notes

Migracja jest **czysto dodająca** — nowa tabela i nowa funkcja, zero zmian w `generations`.
Produkcja ma już zastosowane trzy migracje (potwierdzone 2026-09-07), więc ta wchodzi jako
czwarta. Kolejność wdrożenia jak poprzednio: **najpierw schemat, potem kod** — Worker bez bramki
działa dalej na bazie z nową tabelą. Cofnięcie jest asymetryczne: kod się cofa, migracja nie;
usunięcie wymagałoby migracji odwrotnej.

## References

- Identyfikacja plastra i liczby: `context/changes/daily-generation-limits/change.md`
- Wzorzec migracji z RLS i celowym brakiem polityki:
  `supabase/migrations/20260903125113_create_generations.sql`
- Wzorzec testu RLS pod kluczem anon: `src/lib/generations.integration.test.ts`
- Rejestr ryzyk, R-07: `context/foundation/test-plan.md`
- Ciało plastra S-04: `context/foundation/roadmap.md`

## Progress

> Konwencja: `- [ ]` do zrobienia, `- [x]` zrobione. Po wykonaniu kroku dopisz ` — <commit sha>`.
> Nie zmieniaj tytułów kroków.

### Phase 1: Migracja — tabela prób, RLS, funkcja definer

#### Automated

- [x] 1.1 Migracja stosuje się na czysto: `npx supabase db reset`
- [x] 1.2 Typy bazy przechodzą kontrolę: `npx astro check`
- [x] 1.3 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [x] 1.4 W Studio tabela `generation_attempts` ma dokładnie dwie polityki
- [x] 1.5 Wywołanie `select * from public.usage_today()` jako zalogowany zwraca trzy liczby
- [x] 1.6 `update` i `delete` na własnym wierszu prób są odrzucane

### Phase 2: Bramka w endpoincie i warstwa dostępu

#### Automated

- [ ] 2.1 Testy jednostkowe przechodzą: `npm test`
- [ ] 2.2 Kontrola typów przechodzi: `npx astro check`
- [ ] 2.3 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [ ] 2.4 Generowanie działa normalnie poniżej limitu
- [ ] 2.5 Po wyczerpaniu limitu konta pojawia się polski komunikat, bez wpisu błędu w logach
- [ ] 2.6 Zatrzymanie lokalnej bazy skutkuje odmową generowania, nie generowaniem

### Phase 3: Powierzchnia — panel i generator

#### Automated

- [ ] 3.1 Kontrola typów przechodzi: `npx astro check`
- [ ] 3.2 Testy jednostkowe przechodzą: `npm test`
- [ ] 3.3 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [ ] 3.4 Panel pokazuje oba liczniki i godzinę odnowienia, na obu zakładkach
- [ ] 3.5 Licznik na generatorze zgadza się z panelem
- [ ] 3.6 Po wyczerpaniu limitu licznik pokazuje zero, a komunikat wyjaśnia którą granicę
- [ ] 3.7 Przy zatrzymanej bazie panel mówi o nieudanym odczycie, a nie pokazuje „0 z 10"

### Phase 4: Testy integracyjne, R-07 i tech-stack

#### Automated

- [ ] 4.1 Zestaw integracyjny przechodzi: `npm run test:integration`
- [ ] 4.2 Szybki zestaw pozostaje wolny od Dockera: `npm test`
- [ ] 4.3 Kontrola typów przechodzi: `npx astro check`
- [ ] 4.4 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [ ] 4.5 Rozszerzenie polityki SELECT do `using (true)` robi zestaw czerwonym
- [ ] 4.6 R-07 w test-planie nie ma już statusu „luka"
- [ ] 4.7 `tech-stack.md` nie zawiera już liczby 50 jako sufitu

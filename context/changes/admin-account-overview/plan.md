# Przegląd kont dla administratora — plan implementacji

## Overview

Funkcja `security definer` z **bramką roli w środku** oddaje administratorowi jeden wiersz na
konto — adres, datę rejestracji, liczbę generacji ogółem i zużycie dobowe — a panel renderuje
to w sekcji, którą `F-02` już postawił nad zakładkami. Realizuje FR-014 i FR-015.

Granica jest jedna i twarda: **liczby, nigdy treść**. To ona utrzymuje NFR o izolacji kont
nienaruszony, bo polityka RLS na `generations` nie jest w ogóle ruszana.

## Current State Analysis

- **`F-02` dostarczył fundament** (zarchiwizowany 2026-09-08, `context/archive/2026-09-08-account-roles/`):
  rola w `auth.users.raw_app_meta_data`, `isAdmin()` w `src/lib/account-role.ts` (fail-closed),
  oraz **sekcja zastępcza** w `src/pages/dashboard.astro` renderowana pod warunkiem `showAdmin`.
  Ta sekcja jest miejscem, które ten plaster wypełnia.
- **Rola `authenticated` NIE MA prawa czytać `auth.users`** — zmierzone 2026-09-08:
  `permission denied for table users`, z podpowiedzią Postgresa o `GRANT SELECT`. Agregacja
  ponad kontami musi więc iść przez `security definer`.
- **Wzorzec „definer + bramka w środku" udowodniony pomiarem**, nie rozumowaniem. Prototyp
  w transakcji wycofanej: administrator dostał 46 wierszy, konto bez roli **0**, przy
  `revoke execute … from public, anon` i `grant … to authenticated`.
- **Istnieje precedens takiej funkcji**: `usage_today()` z `S-04`
  (`supabase/migrations/20260907221925_atomic_limit_gate.sql`) — `security definer`,
  `set search_path = ''`, `stable`, okno doby przez podwójne `at time zone 'Europe/Warsaw'`.
  Ten plaster przepisuje z niej okno doby i wywołanie `public.daily_per_account()`.
- **Sufit odczytu ma precedens**: `RESULT_LIMIT = 200` w `src/lib/generations.ts:79`.
- **Degradacja przy błędzie ma precedens**: `dashboard.astro` czyta licznik limitu do
  `usage: UsageToday | null`, a `null` znaczy „nie wiem", NIE „zero" — z komentarzem, że zero
  byłoby twierdzeniem o stanie. Reszta panelu działa dalej, błąd idzie do `logApiError`.
- **Lokalnie istnieje 46 kont**, w większości `roles-*@example.test` i `limits-*@example.test`
  z przebiegów integracyjnych. Na produkcji są dwa.

## Desired End State

Administrator wchodzi na `/dashboard` i w sekcji nad zakładkami widzi tabelę kont:

| kto                                | co widzi                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| administrator                      | wiersz na konto: pełny adres, data rejestracji, liczba generacji, zużycie dobowe (`N z 10`) |
| zalogowany bez roli                | panel **bez żadnego śladu** sekcji — jak po `F-02`                                          |
| niezalogowany                      | przekierowanie na `/auth/signin`                                                            |
| konto bez roli wołające RPC wprost | **zero wierszy**, bez błędu                                                                 |
| `anon` wołający RPC                | odmowa uprawnień                                                                            |

Weryfikowalne: `anon` nie wykona funkcji, świeże konto dostanie pusty zbiór, a w żadnym
wierszu nie ma **ani znaku treści generacji**.

### Key Discoveries:

- **Rola NIE MOŻE być czytana z tokenu.** Zmierzone 2026-09-08: token wystawiony przed
  nadaniem roli nie ma jej w claimach — `auth.jwt() #>> '{app_metadata,role}'` zwraca `NULL`.
  Panel czyta rolę przez `getUser()` (świeżo z serwera auth), więc funkcja SQL czytająca token
  widziałaby stan sprzed odświeżenia sesji. Bramka musi czytać `auth.users` dla `auth.uid()`.
- `revoke execute … from public` **nie odbiera** prawa rolom `anon`/`authenticated` — Supabase
  dokłada jawne granty przez `alter default privileges`. Ustalenie z `S-04`, zapisane
  w `CLAUDE.md`; role trzeba wymienić z nazwy.
- `auth.users` ma **kolumnę** `role` (`character varying`), zupełnie inną niż
  `raw_app_meta_data->>'role'`. Ostrzeżenie stoi w migracji `F-02`.

## What We're NOT Doing

- **Nie pokazujemy treści generacji** — ani tematu, ani tytułu, ani tekstu. To granica
  z FR-014, która utrzymuje NFR o izolacji kont; jej poszerzenie wymaga własnego uzasadnienia.
- **Nie ruszamy polityki RLS na `generations`.** Agregacja idzie przez definer, nie przez
  poszerzenie polityki.
- **Nie dodajemy zarządzania kontami** — bez blokowania, usuwania, zmiany limitów.
  `## Non-Goals` w PRD v2 wylicza to wprost.
- **Nie filtrujemy kont testowych.** Filtr po wzorcu adresu byłby regułą biznesową wziętą
  z niczego, a na produkcji problem nie istnieje.
- **Nie dodajemy trzeciej zakładki ani trasy `/admin`.** Sekcja nad zakładkami wystarcza,
  a każda dodatkowa powierzchnia to kolejne miejsce do osłonięcia.
- **Nie pokazujemy sufitu aplikacji per wiersz** — FR-014 mówi o limicie na konto. Sufit
  aplikacji panel już pokazuje dla własnego konta administratora.

## Implementation Approach

Trzy fazy „dane → widok → dowód", ten sam kształt co w `F-02`. Faza 1 kończy się stanem
bezpiecznym do wdrożenia osobno: funkcja istnieje, nikt jej nie woła. Faza 2 podłącza odczyt
i widok. Faza 3 dowodzi ścieżek negatywnych, bo to one zawodzą w ciszy.

## Critical Implementation Details

**Timing & lifecycle — bramka roli czyta BAZĘ, nie token.** `auth.jwt()` niesie claimy z chwili
wystawienia tokenu, a rola jest nadawana migracją już po rejestracji konta. Administrator
z aktywną sesją miałby więc token bez roli aż do odświeżenia. Bramka musi wyglądać jak
`exists (select 1 from auth.users me where me.id = auth.uid() and me.raw_app_meta_data->>'role' = 'admin')`.
Ta sama różnica jest przyczyną, dla której panel woła `getUser()`, a nie dekoduje tokenu.

**State sequencing — `revoke` musi wymienić role z nazwy.** `revoke execute on function … from public`
zostawia prawo rolom `anon` i `authenticated`, bo Supabase nadaje im je jawnie przez
`alter default privileges`. To regres zmierzony przy `S-04`: bez wymienienia `anon` z nazwy
niezalogowany odczytywał `app_count` przez PostgREST. Kolejność: `revoke … from public, anon`,
potem `grant … to authenticated`.

**User experience spec — obcięcie listy musi być widoczne.** Sufit 200 bez komunikatu na ekranie
zamienia „widzisz wszystko" w „widzisz część" bez śladu. Gdy wierszy jest dokładnie tyle, ile
sufit, sekcja mówi to wprost.

---

## Phase 1: Funkcja i uprawnienia

### Overview

Funkcja agregująca z bramką roli i właściwymi grantami. Aplikacja jeszcze jej nie woła.

### Changes Required:

#### 1. Migracja z funkcją przeglądu

**File**: `supabase/migrations/20260909072831_accounts_overview.sql`

**Intent**: Dodać `public.accounts_overview()` — jeden wiersz na konto z liczbami, dostępny
wyłącznie dla konta z rolą `admin`. Bramka jest **w środku funkcji**, bo rola jest danymi,
nie rolą bazodanową, więc nie da się jej wyrazić grantem.

**Contract**: `returns table (email text, registered_at timestamptz, generations integer,
used_today integer, own_limit integer)`, `security definer`, `set search_path = ''`, `stable`.
Sortowanie po `registered_at` malejąco, `limit 200`. Okno doby przepisane z `usage_today()`
(podwójne `at time zone 'Europe/Warsaw'`), próg z `public.daily_per_account()`.

Bramka i granty — dwa miejsca, w których ta funkcja może zawieść cicho:

```sql
where exists (
  select 1 from auth.users me
   where me.id = auth.uid() and me.raw_app_meta_data->>'role' = 'admin'
)
```

```sql
revoke execute on function public.accounts_overview() from public, anon;
grant  execute on function public.accounts_overview() to authenticated;
```

**Zero wierszy dla nie-administratora, nie wyjątek** — pusty zbiór jest nieodróżnialny od
„brak kont", więc nie ujawnia, że przegląd istnieje (FR-015).

#### 2. Zapytanie kontrolne

**File**: `context/changes/admin-account-overview/verify-overview.sql`

**Intent**: Potwierdzić po każdej aplikacji migracji, że granty trafiły do właściwych rol
i że bramka działa w obie strony.

**Contract**: Sprawdza `has_function_privilege` dla `anon` (musi być `false`) i `authenticated`
(musi być `true`), obecność funkcji, oraz — wzorem `F-02` — **niesie tożsamość środowiska
wartością, która się różni**: `inet_server_addr()` plus odcisk palca (liczba kont), z jawną
notą, że identyfikator projektu trzeba potwierdzić samemu w adresie Studio.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Typy przechodzą: `npx tsc --noEmit`
- Testy jednostkowe przechodzą: `npm test`

#### Manual Verification:

- Zapytanie kontrolne: `anon` nie może wykonać, `authenticated` może
- Wywołanie jako administrator zwraca wiersze; jako konto bez roli zwraca zero
- Żadna kolumna wyniku nie niesie treści generacji

---

## Phase 2: Odczyt i widok

### Overview

Moduł dostępu, typ i tabela w sekcji panelu, z degradacją przy błędzie.

### Changes Required:

#### 1. Typ wiersza przeglądu

**File**: `src/types.ts`

**Intent**: Dodać `AccountOverviewRow` obok istniejących typów encji i DTO.

**Contract**: Pola w camelCase (`email`, `registeredAt`, `generations`, `usedToday`, `ownLimit`),
mapowane z snake_case zwracanego przez RPC — tak jak robi to `UsageToday` w `src/lib/limits.ts`.

#### 2. Odczyt przeglądu

**File**: `src/lib/admin-accounts.ts`

**Intent**: Jedno miejsce wołające RPC i mapujące wynik. Nowy plik, bo `src/lib/limits.ts`
niesie limity, a `src/lib/generations.ts` treść — przegląd kont nie należy do żadnego z nich.

**Contract**: `export async function fetchAccountsOverview(supabase: SupabaseClient<Database>):
Promise<AccountOverviewRow[]>`. **Rzuca** przy błędzie — wołający decyduje o degradacji, tak
samo jak `fetchUsageToday`. Pusty zbiór zwraca pustą tablicę, **nie** rzuca: dla konta bez roli
to poprawna odpowiedź, nie awaria.

#### 3. Tabela w sekcji panelu

**File**: `src/pages/dashboard.astro`

**Intent**: Zastąpić treść zastępczą z `F-02` prawdziwą tabelą. Odczyt tylko wtedy, gdy
`showAdmin` — konto bez roli nie może wygenerować nawet zapytania.

**Contract**: `let accounts: AccountOverviewRow[] | null = null` — `null` znaczy „nie wiem",
NIE „brak kont", dokładnie jak `usage`. Błąd łapany, logowany przez `logApiError("dashboard/accounts", "INTERNAL", error)`,
sekcja pokazuje komunikat, a ranking i ulubione działają dalej. Gdy liczba wierszy równa się
sufitowi 200, sekcja mówi wprost, że lista jest obcięta.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx tsc --noEmit`
- Lint przechodzi na zmienionych plikach
- Testy jednostkowe przechodzą: `npm test`
- Build przechodzi: `npx astro build`

#### Manual Verification:

- Administrator widzi tabelę kont z czterema kolumnami liczb i adresem
- Konto bez roli nie widzi sekcji ani żadnego jej śladu w źródle strony
- Zużycie dobowe zgadza się z licznikiem własnego konta administratora
- W źródle strony nie ma ani znaku treści generacji

---

## Phase 3: Testy granicy

### Overview

Dowód ścieżek negatywnych. To one zawodzą w ciszy.

### Changes Required:

#### 1. Test integracyjny przeglądu

**File**: `src/lib/admin-accounts.integration.test.ts`

**Intent**: Dowieść, że granica trzyma wobec prawdziwego PostgREST, a nie tylko w SQL-u.

**Contract**: Wzorzec i obie bariery `assertSafeTestTarget` skopiowane z
`src/lib/limits.integration.test.ts` (odmowa wobec nielokalnej bazy i wobec klucza `service_role`).
Przypadki: świeżo zarejestrowane konto dostaje **zero wierszy** (nie błąd); `anon` **nie wykona**
funkcji; wynik dla konta bez roli nie niesie żadnego pola z treścią.

**Czego nie dowiedzie** — ścieżki pozytywnej: zbudowanie konta z rolą wymaga zapisu do
`auth.users`, na co klucz publishable nie ma prawa, a `service_role` odrzuca strażnik. To ta
sama świadoma luka co w `F-02`; zapisana, nie przemilczana.

#### 2. Ryzyko w planie testów

**File**: `context/foundation/test-plan.md`

**Intent**: Dopisać `R-09` do rejestru ryzyk i jego zestaw.

**Contract**: Ryzyko: „przegląd kont wystawia dane szerzej, niż zamierzono — cudzą treść albo
komukolwiek poza administratorem". Dlaczego cicho: panel renderuje się poprawnie, status 200,
ktoś po prostu widzi więcej. Wraz z sekcją „czego ten zestaw nie dowodzi".

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Testy integracyjne przechodzą, **kod wyjścia 0**: `npm run test:integration`
- Mutacja bramki (usunięcie warunku roli) czerwieni zestaw — zmierzone
- Lint przechodzi na plikach testowych

#### Manual Verification:

- `context/foundation/test-plan.md` odnotowuje `R-09` i jego zestaw

---

## Testing Strategy

### Unit Tests:

Mapowanie snake_case → camelCase jest cienkie i bez rozgałęzień, więc nie dostaje własnego
zestawu jednostkowego. Cała wartość dowodowa tego plastra leży w testach integracyjnych,
bo granica jest w bazie.

### Integration Tests:

- Świeże konto: zero wierszy, nie błąd
- `anon`: odmowa wykonania funkcji
- Wynik dla konta bez roli nie niesie żadnego pola z treścią
- Mutacja bramki czerwieni zestaw

### Manual Testing Steps:

1. Zaloguj się jako administrator, wejdź na `/dashboard` — tabela kont w sekcji nad zakładkami
2. Sprawdź, że zużycie dobowe Twojego konta zgadza się z blokiem limitu wyżej
3. Zdejmij sobie rolę jednym `UPDATE`, odśwież — sekcja znika bez śladu; przywróć rolę
4. Uruchom zapytanie kontrolne i potwierdź tożsamość środowiska w pierwszych kolumnach
5. Przejrzyj źródło strony i potwierdź brak jakiejkolwiek treści generacji

## Performance Considerations

Funkcja liczy dwa podzapytania na konto — generacje ogółem i próby z dzisiaj. Przy dwóch
kontach na produkcji to bez znaczenia; lokalnie przy 46 kontach też. Sufit 200 chroni przed
odczytem bez ograniczenia, a `generations_ranking_idx` i indeksy na `generation_attempts`
z `S-04` pokrywają oba liczenia. Gdyby liczba kont kiedyś rosła, właściwą odpowiedzią jest
agregacja po stronie SQL-a z `group by`, nie podzapytania per wiersz — ale przy obecnej skali
byłaby to optymalizacja bez problemu do rozwiązania.

## Migration Notes

**Kolejność wdrożenia wymuszona**: migracja przed kodem. Odwrotna kolejność daje administratorowi
błąd odczytu i komunikat „nie udało się" zamiast tabeli.

Cofnięcie kodu nie cofa migracji (`context/deployment/deploy-plan.md`, § Rollback). Zostawiona
funkcja bez kodu, który ją woła, jest nieszkodliwa — ale **tylko dzięki bramce w środku**:
bez niej byłaby wystawionym przez PostgREST odczytem wszystkich kont dla każdego zalogowanego.

Na produkcji port 5432 jest zablokowany w sieci autora, więc migracja pójdzie przez SQL Editor
z ręcznym zaksięgowaniem wersji w `supabase_migrations.schema_migrations` — tak samo jak `S-04`
2026-09-08. To znane obejście, nie improwizacja.

## References

- Roadmapa: `context/foundation/roadmap.md`, `S-09`
- Wymagania: `context/foundation/prd.md` v2, FR-014 i FR-015
- Fundament: `context/archive/2026-09-08-account-roles/` (`isAdmin`, sekcja w panelu)
- Wzorzec funkcji definer i okna doby: `supabase/migrations/20260907221925_atomic_limit_gate.sql`
- Wzorzec degradacji przy błędzie: `src/pages/dashboard.astro` (`usage: UsageToday | null`)
- Wzorzec testu integracyjnego i barier: `src/lib/limits.integration.test.ts`
- Reguły: `context/foundation/lessons.md` — zwłaszcza „Zielone czytaj z tego, co zmieniłoby się przy porażce"

## Progress

> Konwencja: `- [ ]` w toku, `- [x]` zrobione. Dopisz ` — <commit sha>` przy domknięciu kroku.
> Nie zmieniaj tytułów kroków.

### Phase 1: Funkcja i uprawnienia

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie: `npx supabase db reset` — b0e8347
- [x] 1.2 Typy przechodzą: `npx tsc --noEmit` — b0e8347
- [x] 1.3 Testy jednostkowe przechodzą: `npm test` — b0e8347

#### Manual

- [x] 1.4 Zapytanie kontrolne: `anon` nie może wykonać, `authenticated` może — b0e8347
- [x] 1.5 Administrator dostaje wiersze, konto bez roli zero — b0e8347
- [x] 1.6 Żadna kolumna wyniku nie niesie treści generacji — b0e8347

### Phase 2: Odczyt i widok

#### Automated

- [x] 2.1 Typy przechodzą: `npx tsc --noEmit` — 1f3f0ec
- [x] 2.2 Lint przechodzi na zmienionych plikach — 1f3f0ec
- [x] 2.3 Testy jednostkowe przechodzą: `npm test` — 1f3f0ec
- [x] 2.4 Build przechodzi: `npx astro build` — 1f3f0ec

#### Manual

- [x] 2.5 Administrator widzi tabelę kont z adresem i liczbami — 1f3f0ec
- [x] 2.6 Konto bez roli nie widzi sekcji ani jej śladu w źródle — 1f3f0ec
- [x] 2.7 Zużycie dobowe zgadza się z licznikiem własnego konta — 1f3f0ec
- [x] 2.8 W źródle strony nie ma treści generacji — 1f3f0ec

### Phase 3: Testy granicy

#### Automated

- [x] 3.1 Testy jednostkowe przechodzą: `npm test` — 1f3f0ec
- [x] 3.2 Testy integracyjne przechodzą, kod wyjścia 0: `npm run test:integration` — 1f3f0ec
- [x] 3.3 Mutacja bramki czerwieni zestaw — zmierzone — 1f3f0ec
- [x] 3.4 Lint przechodzi na plikach testowych — 1f3f0ec

#### Manual

- [x] 3.5 `context/foundation/test-plan.md` odnotowuje `R-09` i jego zestaw — 1f3f0ec

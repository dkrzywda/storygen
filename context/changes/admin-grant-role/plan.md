# Admin nadaje i odbiera rolę administratora — Implementation Plan

## Overview

Administrator nadaje innemu kontu rolę administratora i odbiera ją, z panelu, bez ręcznego SQL-a. Realizuje `FR-018` z PRD v4 i plaster `S-10` z kamienia `M-3`.

Ten plaster ma drugie, cichsze zadanie: jest **pierwszym zapisem do `auth.users` z wnętrza aplikacji** i wybrany tu mechanizm odziedziczą `S-11` (blokowanie) i `S-12` (usuwanie). Decyzje o kształcie funkcji, o bramce i o odmowie są więc decyzjami całego kamienia, nie tego jednego plastra.

## Current State Analysis

**Rola już istnieje i już jest sprawdzana.** `F-02` postawiło `isAdmin()` w `src/lib/account-role.ts` — fail-closed, czyta `user.app_metadata.role` przez `unknown`, bo `UserAppMetadata` w SDK ma `[key: string]: any`. Middleware woła `getUser()` na każdym żądaniu, więc sprawdzenie roli nie kosztuje dodatkowego zapytania.

**Rolę nadaje się dziś ręcznie.** Jedyny zapis do `auth.users` w repo to jednorazowy `update` w `supabase/migrations/20260908124854_seed_account_roles.sql:27` i `:31`, dopasowujący po adresie e-mail. Migracja sama nazywa się seedem, nie mechanizmem. Tak nadano rolę 2026-09-08 i tak samo trzeba by ją nadać każdemu następnemu koncie.

**Przegląd kont jest read-only z konstrukcji.** `public.accounts_overview()` (`supabase/migrations/20260909072831_accounts_overview.sql`) jest `stable`, a w takiej funkcji Postgres zapisu **zabrania**. Zwraca sześć kolumn: `email`, `registered_at`, `generations`, `used_today`, `own_limit`, `row_limit` — i **ani jednego identyfikatora**, więc dziś nie ma czym zaadresować konta docelowego.

**Wzorzec zapisu istnieje, ale nie dla `auth.*`.** `public.record_attempt_if_allowed(text)` (`20260907221925:80`) to `plpgsql` + `security definer` + `set search_path = ''`, **bez** `stable`, z blokadą doradczą, zwracająca **kod** zamiast boolean, z `raise exception` przy `auth.uid() is null`. Żadna funkcja w repo nie pisze jednak do `auth.*`.

**Klienta `service_role` nie ma i nie ma go świadomie.** Trzynaście trafień na tę nazwę w `src/` to wyłącznie strażniki testów, które sekretny klucz **odrzucają**. `astro.config.mjs:19-20` zna tylko `SUPABASE_URL` i `SUPABASE_KEY`.

**Panel nie ma ani jednego elementu interaktywnego w sekcji kont.** `src/pages/dashboard.astro:193-246` renderuje tabelę serwerowo; `grep` na `<form|<button` w tym pliku daje zero trafień.

## Desired End State

Administrator otwiera `/dashboard`, w sekcji Administracja widzi przy każdym koncie jego aktualną rolę i przycisk, który tę rolę zmienia. Kliknięcie na koncie obcym działa od razu. Kliknięcie, które zdjęłoby **ostatnią** rolę administratora, najpierw pokazuje ostrzeżenie, że administracja przestanie być dostępna z produktu — i dopiero drugie kliknięcie ją zdejmuje. Konto, któremu rolę nadano, ma ją przy swoim następnym żądaniu, bez ponownego logowania.

Weryfikacja: konto bez roli, wołające funkcję wprost przez RPC, nie zmienia niczego i nie dowiaduje się, że operacja istnieje. Skrypt kontrolny na bazie zwraca tożsamość środowiska w pierwszej kolumnie i werdykt w ostatniej.

### Key Discoveries

- **`getUser()` czyta z bazy, nie z tokenu.** `_getUser` robi `GET /user` w obu gałęziach — `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:2480` i `:2496`. Rola nadana przez admina działa u drugiego konta przy następnym żądaniu. **Nie jest to sprzeczne** z pomiarem z 2026-09-08, gdzie `auth.jwt() #>> '{app_metadata,role}'` zwracało `NULL`: tamto czyta claimy z tokenu, które zamarzają w chwili wystawienia. Dwie różne drogi do tej samej wartości, jedna zamrożona.
- **`create or replace` nie zmieni typu zwracanego.** Zmierzone lokalnie 2026-09-09: `ERROR: cannot change return type of existing function / HINT: Use DROP FUNCTION accounts_overview() first.` Rozszerzenie przeglądu wymaga `drop` + `create`.
- **`drop function` kasuje granty.** Stan przed zmianą: `postgres=EXECUTE`, `authenticated=EXECUTE` — `anon` i `service_role` nieobecne, czyli naprawa F1/F2 z triage'u S-09 trzyma. Po dropie funkcja wraca z **domyślnymi** grantami Supabase dla `anon`, `authenticated` i `service_role`. Precedens: `20260907221925:137-142` musiała ponownie odebrać granty `usage_today()` po dropie `record_attempt`.
- **`auth.users` niesie dwa różne pola o nazwie `role`** — kolumnę `character varying`, po której PostgREST autoryzuje, i klucz w `raw_app_meta_data`. Pułapka opisana w `20260908124854:36-44`. Pomyłka wywraca autoryzację całej aplikacji **cicho**.
- **Wzorzec mutującego endpointu jest kompletny** — `src/pages/api/generations/[id].ts`: guard UUID przed zapytaniem (żeby błąd składni nie zamienił się w 500), `validate()` + schemat Zoda, `toApiErrorCode`, `logApiError`, `jsonOk`/`jsonError`, oraz zasada „zero wierszy znaczy nie istnieje albo nie Twoje" **bez** porównywania właściciela w kodzie.
- **Scalenie `||` przy zapisie `raw_app_meta_data` jest obowiązkowe.** GoTrue trzyma w tym polu `provider` i `providers`; nadpisanie całego obiektu psuje logowanie (`20260908124854:26`).

## What We're NOT Doing

- **Żadnego audytu zmian rol** — ani kolumny „kto zmienił", ani tabeli. PRD nie wymaga, a `## Non-Goals` parkuje analitykę poza logowaniem błędów. Decyzja świadoma, nie przeoczenie; konsekwencja przy braku podłogi jest realna: nikt nie odtworzy, kto zakończył administrację.
- **Żadnego blokowania ani usuwania kont** — to `S-11` i `S-12`.
- **Żadnego klucza `service_role`** i żadnej zmiany w schemacie zmiennych środowiskowych.
- **Żadnej podłogi na liczbę adminów.** PRD v4 `## Open Questions` #9 rozstrzygnął, że wolno zdjąć ostatnią rolę. Plaster stawia ostrzeżenie i wymóg potwierdzenia, nie zakaz.
- **Żadnej zmiany polityki RLS na `generations`** ani żadnej ścieżki do cudzej treści. Granica FR-014 zostaje nienaruszona.
- **Żadnego czyszczenia 61 kont testowych** zaśmiecających lokalną bazę — to osobna praca.
- **Żadnej zmiany kontraktu `usage_today()`** ani limitów.

## Implementation Approach

Bramka mieszka w bazie, w środku funkcji `security definer`, i czyta rolę wołającego **z `auth.users`**, nie z tokenu — dokładnie tak jak `accounts_overview()`, i z tego samego zmierzonego powodu. Aplikacja nie sprawdza roli po to, by zdecydować; sprawdza ją po to, by nie rysować przycisku. Sprawdzenie w kodzie byłoby obejściem o jedno wywołanie RPC.

Funkcja zwraca **kod**, nie boolean i nie wyjątek — wzorzec `record_attempt_if_allowed`, bo wołający musi wiedzieć, **która** granica zadziałała: brak uprawnień to inna sytuacja niż brak potwierdzenia przy ostatniej roli. Endpoint mapuje `FORBIDDEN` na `NOT_FOUND`, żeby nie potwierdzać istnienia operacji nikomu, kto zgadnie adres.

Kolejność faz jest ta sama, która w `S-09` pozwoliła zmierzyć bramkę, zanim istniał jakikolwiek widok: baza z własnym skryptem kontrolnym, potem kontrakt, na końcu interfejs.

## Critical Implementation Details

**Kolejność w migracji jest wymuszona, nie stylistyczna.** `drop function public.accounts_overview()` musi poprzedzić `create`, bo typ zwracany się zmienia (zmierzone wyżej). Bezpośrednio po `create` muszą stać `revoke execute … from public, anon, service_role` i `grant execute … to authenticated` — drop zabrał stare granty, a Supabase nadaje nowej funkcji domyślne dla trzech rol. Pominięcie tego to ta sama dziura, którą zamykała migracja `20260907221925`, i **nie rzuci błędu**.

**`is_last_admin` liczy się w bazie i tylko tam.** To ta sama zasada, którą ustalenie F3 z przeglądu `S-09` wymusiło dla `row_limit`: liczba, na której opiera się komunikat, musi przyjść z tego samego odczytu co dane. Kopia w widoku uciszyłaby ostrzeżenie przy każdej zmianie w SQL-u, bez żadnego błędu.

**Potwierdzenie jest parametrem funkcji, nie stanem interfejsu.** Ochrona w widoku byłaby pomijalna wywołaniem RPC wprost — ta sama klasa obejścia, którą zamknęło `S-09`.

## Phase 1: Baza — przegląd rozszerzony i funkcja zmiany roli

### Overview

Jedna migracja przebudowuje `accounts_overview()` i dodaje `set_account_role()`. Po fazie bramka jest mierzalna bez istnienia jakiegokolwiek widoku.

### Changes Required

#### 1. Migracja

**File**: `supabase/migrations/20260909121500_account_role_management.sql`

**Intent**: Rozszerzyć przegląd o cztery kolumny, których panel potrzebuje, by nie kazać administratorowi klikać w ciemno, i dodać jedyny mechanizm zmiany roli w produkcie.

**Contract**: Dwie funkcje.

`public.accounts_overview()` — `drop` + `create`, `stable`, `security definer`, `set search_path = ''`. Sześć istniejących kolumn **w niezmienionej kolejności i typach**, plus cztery nowe:

```
id            uuid     -- u.id; identyfikator celu dla set_account_role
role          text     -- coalesce(u.raw_app_meta_data->>'role', 'user')
is_self       boolean  -- u.id = auth.uid()
is_last_admin boolean  -- role = 'admin' AND (liczba nieusunietych adminow) = 1
```

`role` przez `coalesce` na `'user'`, bo konto bez klucza w `raw_app_meta_data` jest zwykłym użytkownikiem — tak samo, jak `isAdmin()` traktuje brak klucza jako `false`. Bramka, filtr `u.deleted_at is null`, `order by u.created_at desc` i `limit` z `cfg` zostają bez zmian.

`public.set_account_role(p_account uuid, p_role text, p_confirm_last boolean)` — `plpgsql`, `security definer`, `set search_path = ''`, **volatile** (bez `stable` — `stable` zabroniłoby zapisu). Zwraca `text`:

- `'FORBIDDEN'` — wołający nie ma roli `admin` w `auth.users`. Sprawdzane **przed** czymkolwiek innym; zwrot kodu, nie `raise`, żeby endpoint mógł go zamienić na 404.
- `'LAST_ADMIN_NEEDS_CONFIRM'` — operacja zdjęłaby ostatnią rolę admina, a `p_confirm_last` nie jest prawdą.
- `'NOT_FOUND'` — nie ma nieusuniętego konta o tym `id`.
- `'VALIDATION_FAILED'` — `p_role` poza zbiorem `('admin','user')`.
- `'ok'` — zapisano. Idempotentnie: nadanie roli, którą konto już ma, też daje `'ok'`.

Zapis przez `raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('role', p_role)` — scalenie, nie nadpisanie. **Nie dotykać kolumny `u.role`.**

Liczenie adminów i zapis pod jedną blokadą doradczą (`pg_advisory_xact_lock`), wzorzec z `record_attempt_if_allowed`: bez niej dwaj administratorzy zdejmujący sobie role równolegle przy READ COMMITTED obaj zobaczą dwóch adminów i obaj przejdą, zostawiając zero.

Na końcu, dla **obu** funkcji: `revoke execute … from public, anon, service_role` i `grant execute … to authenticated`. Lista rol skopiowana z `20260907221925`, nie odtworzona z pamięci — `lessons.md` § „Nowa funkcja uprzywilejowana kopiuje listę rol".

#### 2. Skrypt kontrolny

**File**: `context/changes/admin-grant-role/verify-grant-role.sql`

**Intent**: Jeden `SELECT`, którym da się sprawdzić stan bazy po ręcznej aplikacji na produkcji.

**Contract**: Kolumna pierwsza to tożsamość środowiska (`inet_server_addr()`), ostatnia to `werdykt`. Pomiędzy: liczba kolumn zwracanych przez `accounts_overview()`, istnienie `set_account_role`, jej tryb (`provolatile`), oraz `has_function_privilege` dla **każdej** roli, której dotyczy `revoke` — `anon`, `service_role`, `authenticated` — dla obu funkcji. Skrypt **kończy się** tym `SELECT`-em, nie `commit`-em: „Success. No rows returned" nie odróżnia sukcesu od no-opu.

### Success Criteria

#### Automated Verification

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Typy zregenerowane i sformatowane: `npx supabase gen types typescript --local > src/lib/database.types.ts` a potem `npx prettier --write src/lib/database.types.ts`; diff dotyczy **wyłącznie** dwóch tych funkcji
- Skrypt kontrolny zwraca `werdykt = OK` i `anon_moze = f`, `service_moze = f`, `auth_moze = t` dla obu funkcji
- Test integracyjny: konto bez roli wołające `set_account_role` dostaje `FORBIDDEN` i **rola celu nie zmienia się** — sprawdzana wartość po wywołaniu, nie sam zwrot
- Test integracyjny: zdjęcie ostatniej roli bez potwierdzenia zwraca `LAST_ADMIN_NEEDS_CONFIRM` i nie zmienia niczego; z potwierdzeniem zwraca `ok` i zmienia
- `npm run test:integration` kończy się **kodem wyjścia 0** (nie „N passed" w wypisie)
- `npx tsc --noEmit` bez błędów

#### Manual Verification

- Zdjęcie warunku bramki z funkcji czerwieni test integracyjny nieuprawnionego dostępu (test mutacyjny — sprawdzenie, że test mierzy tę ścieżkę, a nie sąsiednią)

---

## Phase 2: Kontrakt — endpoint, typy, moduł biblioteki

### Overview

Jedna droga z aplikacji do funkcji, z kontraktem błędów F-01.

### Changes Required

#### 1. Kod błędu

**File**: `src/types.ts`

**Intent**: Odmowa zdjęcia ostatniej roli bez potwierdzenia jest nowym stanem i potrzebuje własnego kodu; `Record<ApiErrorCode, …>` zamienia zapomniany wpis w błąd kompilacji.

**Contract**: `ApiErrorCode` zyskuje `"LAST_ADMIN_CONFIRM_REQUIRED"`. `AccountOverviewRow` zyskuje `id: string`, `role: AccountRole`, `isSelf: boolean`, `isLastAdmin: boolean`. Komentarz o braku pola z treścią zostaje nienaruszony — cztery nowe pola to metadane konta, nie treść.

#### 2. Komunikat

**File**: `src/lib/api-errors.ts`

**Intent**: Polski komunikat dla nowego kodu.

**Contract**: Wpis w `API_ERRORS` plus status HTTP. Komunikat nazywa skutek, nie mechanizm: administracja przestanie być dostępna z produktu.

#### 3. Moduł

**File**: `src/lib/admin-accounts.ts`

**Intent**: Dołożyć zapis obok istniejącego odczytu, w tym samym module, bo to ta sama domena.

**Contract**: `setAccountRole(supabase, accountId, role, confirmLast)` woła RPC i zwraca kod z bazy jako typ sumaryczny, bez zamiany na wyjątek — wołający decyduje. `fetchAccountsOverview` mapuje cztery nowe kolumny.

#### 4. Endpoint

**File**: `src/pages/api/accounts/[id].ts`

**Intent**: Jedno wejście, symetryczne dla nadania i odebrania.

**Contract**: `PATCH`. Cztery bramki w kolejności z `generations/[id].ts`: `locals.user` → `UNAUTHORIZED`; `id` poza formatem UUID → `NOT_FOUND` (przed zapytaniem, żeby błąd składni nie stał się 500); ciało nie-JSON i schemat Zoda → `VALIDATION_FAILED`; brak klienta → `NOT_CONFIGURED`. Schemat: `role` ze zbioru dwóch wartości, `confirmLast` opcjonalny boolean, komunikaty pól po polsku w schemacie.

Mapowanie kodu z bazy: `ok` → `jsonOk`; `FORBIDDEN` → `NOT_FOUND` (**nie** 403 — nie potwierdzamy istnienia operacji); `LAST_ADMIN_NEEDS_CONFIRM` → `LAST_ADMIN_CONFIRM_REQUIRED`; `NOT_FOUND` → `NOT_FOUND`; `VALIDATION_FAILED` → `VALIDATION_FAILED`. Endpoint **nie** sprawdza `isAdmin` samodzielnie: dwa źródła prawdy o tym, kto jest adminem, rozjechałyby się cicho.

### Success Criteria

#### Automated Verification

- Test jednostkowy: schemat odrzuca rolę poza zbiorem, `confirmLast` nie-boolean, brak `role`
- Test jednostkowy: mapowanie każdego z pięciu kodów bazy na kod API, w tym `FORBIDDEN` → `NOT_FOUND`
- Test integracyjny: konto, któremu nadano rolę, widzi ją **bez ponownego logowania** — czyta świeżość `getUser()` zamiast zakładać ją z lektury SDK
- `npm test` kodem wyjścia 0
- `npx tsc --noEmit` i ESLint na dotkniętych plikach bez błędów

#### Manual Verification

- `curl` z sesją zwykłego konta na `PATCH /api/accounts/<uuid>` zwraca 404, nie 403

---

## Phase 3: Interfejs — wyspa na wiersz

### Overview

Przycisk przy wierszu, ostrzeżenie z liczby z bazy, uczciwe zachowanie przy degradacji siebie.

### Changes Required

#### 1. Wyspa

**File**: `src/components/admin/AccountRoleButton.tsx`

**Intent**: Jedyny element interaktywny w sekcji kont; tabela zostaje serwerowa.

**Contract**: Props z wiersza: `accountId`, `email`, `role`, `isSelf`, `isLastAdmin`. Przycisk pokazuje operację odwrotną do stanu. Gdy operacja zdjęłaby ostatnią rolę, pierwsze kliknięcie pokazuje ostrzeżenie i przełącza przycisk w stan potwierdzenia; drugie wysyła `confirmLast: true`. Po sukcesie na koncie obcym — przeładowanie strony. Po sukcesie na **własnym** koncie z degradacją — komunikat, że uprawnienia zostały zdjęte, i dopiero potem przejście; ciche zniknięcie sekcji wygląda identycznie jak awaria (`lessons.md` § „Degradacja odczytu nie chroni renderowania"). Błąd z endpointu wyświetlany z `message` z kontraktu, nigdy z SDK.

#### 2. Tabela

**File**: `src/pages/dashboard.astro`

**Intent**: Dołożyć kolumnę roli i kolumnę akcji.

**Contract**: Nowa kolumna z rolą i osadzenie wyspy per wiersz. Formatowanie **we frontmatterze**, w tym samym `try` co odczyt — reguła z `lessons.md`. Sekcja nadal renderuje trzy stany (`null`, pusto, lista) i komunikat o obcięciu.

### Success Criteria

#### Automated Verification

- `npx astro build` przechodzi
- ESLint i `npx tsc --noEmit` na dotkniętych plikach bez błędów
- Test jednostkowy wyspy: przy `isLastAdmin` pierwsze kliknięcie **nie** wysyła żądania, drugie wysyła z `confirmLast: true`

#### Manual Verification

- Nadanie roli drugiemu kontu i sprawdzenie na jego sesji, że sekcja admina pojawia się **bez ponownego logowania**
- Zdjęcie roli sobie: ostrzeżenie pojawia się, drugie kliknięcie działa, komunikat wyjaśnia, co się stało
- Po degradacji siebie: rola przywrócona przez konsolę dostawcy (droga zapisana w PRD v4 § FR-018)
- Zwykłe konto nie widzi ani sekcji, ani przycisków

---

## Testing Strategy

### Unit Tests

- Schemat żądania: rola poza zbiorem, `confirmLast` nie-boolean, brak pola
- Mapowanie pięciu kodów bazy na kody API
- Wyspa: dwuetapowe potwierdzenie przy `isLastAdmin`

### Integration Tests

Plik `src/lib/admin-accounts.integration.test.ts` — istniejący, z oboma strażnikami `assertSafeTestTarget`.

- Konto bez roli: `FORBIDDEN` **i** niezmieniona rola celu
- Admin nadaje rolę: `ok`, rola celu zmieniona
- Powtórzenie tej samej roli: `ok`, bez błędu
- Ostatnia rola bez potwierdzenia: `LAST_ADMIN_NEEDS_CONFIRM`, stan nietknięty; z potwierdzeniem: `ok`
- Nadana rola widoczna dla drugiego konta bez ponownego logowania
- `anon` nie może wykonać żadnej z dwóch funkcji

### Manual Testing Steps

1. Zaloguj się jako admin, otwórz `/dashboard`, sprawdź kolumnę roli i przyciski
2. Nadaj rolę drugiemu kontu; w drugiej przeglądarce odśwież i sprawdź sekcję admina
3. Odbierz tę rolę; sprawdź, że sekcja znika po odświeżeniu
4. Zdejmij rolę sobie: ostrzeżenie, potwierdzenie, komunikat
5. Przywróć rolę przez konsolę dostawcy

## Performance Considerations

`is_last_admin` liczy adminów raz na wywołanie przeglądu, nie raz na wiersz — podzapytanie skalarne, nie skorelowane. Przy sufcie 200 wierszy koszt jest nieistotny; blokada doradcza w `set_account_role` serializuje wyłącznie zmiany rol, których jest kilka na życie produktu.

## Migration Notes

Na produkcji port 5432 jest zablokowany (tripwire w `CLAUDE.md`), więc migracja idzie przez SQL Editor, a wersja musi zostać wpisana do `supabase_migrations.schema_migrations` ręcznie — inaczej następny `db push` zastosuje ją ponownie. Skrypt kontrolny idzie **po** migracji i kończy się `SELECT`-em, nie `commit`-em.

`drop function accounts_overview()` na produkcji tworzy okno, w którym panel admina zwraca błąd odczytu. Sekcja degraduje się osobno (`null` znaczy „nie wiem"), więc reszta panelu działa; okno trwa tyle, ile jedna transakcja. Migracja musi być jedną transakcją, żeby nie zostawić funkcji usuniętej bez następcy.

## References

- Wymaganie: `context/foundation/prd.md` § `### Account management`, FR-018
- Plaster: `context/foundation/roadmap.md` § `### S-10`
- Wzorzec funkcji zapisującej: `supabase/migrations/20260907221925_atomic_limit_gate.sql:80`
- Wzorzec mutującego endpointu: `src/pages/api/generations/[id].ts`
- Pułapka dwóch pól `role`: `supabase/migrations/20260908124854_seed_account_roles.sql:36`
- Świeżość `app_metadata`: `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:2480`

## Addendum 2026-09-09 — adaptacja fazy 1

**Blok `## Phase 1` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Doszedł plik, którego plan nie przewidywał:** `context/changes/admin-grant-role/test-set-account-role.sql`.

Powód: kryterium 1.5 wymagało testu integracyjnego bramki ostatniej roli, a taki test potrzebuje **sesji administratora**. Zbudowanie konta z rolą przez klienta JS wymaga zapisu do `auth.users.raw_app_meta_data`, na co klucz publishable prawa nie ma — a klucz `service_role` odrzuca `assertSafeTestTarget`, bo omija RLS i unieważniłby cały zestaw. Ta luka była **już opisana** w `src/lib/admin-accounts.integration.test.ts:18` przy `S-09`; kryterium 1.5 napisałem, nie sprawdzając, czy zestaw potrafi je wyrazić. Błąd planowania, nie niespodzianka środowiska.

Rozstrzygnięte przez autora: test na poziomie SQL, podszywający się pod użytkownika przez `request.jwt.claims` — dokładnie to ustawienie, z którego czyta `auth.uid()`. Mierzy bramkę bezpośrednio, bez warstwy SDK, i nie potrzebuje żadnego klucza sekretnego.

Trzynaście przypadków, werdykt OK. Test mutacyjny: **zdjęcie bramki z funkcji czerwieni sześć z trzynastu**, w tym oba przypadki bezpośrednio o bramce; po wycofaniu transakcji wraca 13/13.

**Kryterium 1.4 dostało mocniejszy przypadek, niż plan zapisał.** Zamiast „konto bez roli dostaje `FORBIDDEN`" test w Vitest składa **eskalację uprawnień**: konto bez roli nadaje rolę **samemu sobie**. To jedyne wywołanie, które takie konto potrafi złożyć w całości bez cudzych danych, i najgroźniejsze. Sprawdzany jest skutek, nie tylko zwrot — po odmowie `getUser()` (czytający `app_metadata` z bazy) nie widzi roli, a przegląd kont nadal oddaje pustkę.

**Skrypt kontrolny dostał trzy dowody czułości**, których plan nie wymagał: nadanie `anon` prawa zmiany roli, odebranie `authenticated` prawa przeglądu i przywrócenie starej sześciokolumnowej funkcji — każdy czerwieni inną gałąź werdyktu. Trzeci pokazał w działaniu zagrożenie, o które chodzi: odtworzona bez ponownego `revoke` funkcja miała `anon` i `service_role` z prawem wykonania.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baza — przegląd rozszerzony i funkcja zmiany roli

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie (`npx supabase db reset`)
- [x] 1.2 Typy zregenerowane; diff dotyczy wyłącznie dwóch funkcji
- [x] 1.3 Skrypt kontrolny: werdykt OK, `anon_moze = f`, `service_moze = f`, `auth_moze = t` dla obu funkcji
- [x] 1.4 Test integracyjny: konto bez roli dostaje FORBIDDEN i nie zmienia roli celu
- [x] 1.5 Test integracyjny: ostatnia rola bez potwierdzenia odmawia, z potwierdzeniem przechodzi
- [x] 1.6 `npm run test:integration` kończy się kodem wyjścia 0
- [x] 1.7 `npx tsc --noEmit` bez błędów

#### Manual

- [x] 1.8 Zdjęcie bramki z funkcji czerwieni test nieuprawnionego dostępu

### Phase 2: Kontrakt — endpoint, typy, moduł biblioteki

#### Automated

- [ ] 2.1 Test jednostkowy schematu żądania
- [ ] 2.2 Test jednostkowy mapowania pięciu kodów bazy na kody API
- [ ] 2.3 Test integracyjny: nadana rola widoczna bez ponownego logowania
- [ ] 2.4 `npm test` kodem wyjścia 0
- [ ] 2.5 `npx tsc --noEmit` i ESLint na dotkniętych plikach bez błędów

#### Manual

- [ ] 2.6 `curl` zwykłym kontem na PATCH zwraca 404, nie 403

### Phase 3: Interfejs — wyspa na wiersz

#### Automated

- [ ] 3.1 `npx astro build` przechodzi
- [ ] 3.2 ESLint i `npx tsc --noEmit` na dotkniętych plikach bez błędów
- [ ] 3.3 Test jednostkowy wyspy: dwuetapowe potwierdzenie przy `isLastAdmin`

#### Manual

- [ ] 3.4 Nadanie roli drugiemu kontu widoczne bez ponownego logowania
- [ ] 3.5 Zdjęcie roli sobie: ostrzeżenie, potwierdzenie, komunikat
- [ ] 3.6 Rola przywrócona przez konsolę dostawcy
- [ ] 3.7 Zwykłe konto nie widzi sekcji ani przycisków

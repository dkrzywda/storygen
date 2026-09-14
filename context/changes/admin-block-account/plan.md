# Admin blokuje i odblokowuje konto — Implementation Plan

## Overview

Administrator blokuje konto i później je odblokowuje. Realizuje `FR-016` z PRD v4 i plaster `S-11` z kamienia `M-3`.

Zablokowane konto jest odrzucane **przy logowaniu** — to rozstrzygnięcie PRD (`## Open Questions` #7) — ale samo to nie wystarczy. Zmierzone 2026-09-14: po zablokowaniu **trwająca sesja działa dalej przez godzinę**, a konto może w tym czasie generować. FR-016 mówi, że zablokowane konto „nie może korzystać z produktu", więc plaster zamyka też to okno.

## Current State Analysis

**Dostawca ma własne pojęcie konta zawieszonego i sam odmawia logowania.** Zmierzone przez wywołanie `POST /auth/v1/token` po ustawieniu `banned_until` w przyszłości: odpowiedź `400`, `{"error_code":"user_banned","msg":"User is banned"}`. Nie budujemy więc odmowy — ona już istnieje.

**Aplikacja tę odmowę gubi.** `user_banned` nie występuje ani w `PROVIDER_CODE_MAP`, ani w `PROVIDER_MESSAGE_MAP` (`src/lib/api-errors.ts:177-190`) — zmierzone, zero trafień. Status 400 nie jest ≥ 500, a komunikat „User is banned" nie pasuje do żadnego wzorca, więc `toApiErrorCode` schodzi do `DEFAULT_ERROR_CODE`. Zablokowany widzi dziś **„Coś poszło nie tak. Spróbuj ponownie za chwilę."** — czyli dokładnie tę ogólną awarię, której FR-016 zabrania.

**Blokada nie kończy trwającej sesji.** Zmierzone tym samym tokenem, przed i po ustawieniu `banned_until`:

| Wywołanie                       | Przed | Po                |
| ------------------------------- | ----- | ----------------- |
| `GET /auth/v1/user`             | 200   | **200**           |
| `POST /rest/v1/rpc/usage_today` | 200   | **200**           |
| nowe logowanie                  | 200   | 400 `user_banned` |

Okno równa się czasowi życia tokenu — zmierzone z `iat`/`exp`: **60 minut**.

**`banned_until` przychodzi za darmo.** Jest w odpowiedzi `/auth/v1/user` (15 pól, zmierzone) i **jest zadeklarowane w typie SDK** — `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:386`, `banned_until?: string`. Middleware woła `supabase.auth.getUser()` na każdym żądaniu (`src/middleware.ts:18`) i wkłada wynik do `context.locals.user`, więc bramka nie kosztuje ani jednego dodatkowego zapytania.

**Mechanizm zapisu jest gotowy.** `S-10` zostawiło `set_account_role` — `plpgsql`, `security definer`, `set search_path = ''`, volatile, bramka czytająca `auth.users` dla `auth.uid()` z `deleted_at`, blokada doradcza na kluczu `account_role_gate`, zwrot kodu zamiast wyjątku, `revoke`/`grant` dla trzech rol.

**Tabela kont nie ma zapasu szerokości.** Zmierzone po poprawce estetycznej: potrzeba 638 px, dostępne 638 px, `brakuje_px = 0`. Nowa kolumna przywróci poziome przewijanie.

## Desired End State

Administrator widzi przy każdym koncie przycisk blokady. Zablokowane konto jest oznaczone pod adresem, tak jak dziś oznaczone jest własne. Zablokowany użytkownik przy próbie logowania dostaje komunikat o zawieszeniu dostępu — nie ogólną awarię. Jeśli miał otwartą sesję, przy **następnym żądaniu** zostaje z niej wypchnięty na stronę logowania z tym samym komunikatem.

Weryfikacja: żywy token, który przed zablokowaniem czytał `usage_today`, po zablokowaniu przestaje przechodzić przez middleware.

### Key Discoveries

- **Odmowa logowania jest wbudowana**: `400 / user_banned / "User is banned"`, zmierzone bezpośrednim wywołaniem API dostawcy.
- **Aplikacja mapuje ją dziś na `INTERNAL`** — zero trafień na `user_banned` w obu mapach `api-errors.ts`.
- **Okno trwającej sesji to 60 minut**, zmierzone z `iat`/`exp` tokenu; w tym czasie `usage_today` odpowiada 200.
- **`banned_until` jest w typie SDK** (`types.d.ts:386`) i w odpowiedzi `getUser()`, więc bramka w middleware jest darmowa.
- **`auth.users.banned_until` to `timestamp with time zone`**, nullowalne — dostawca obsługuje blokadę terminową, z której świadomie nie korzystamy.
- **Tabela kont ma 0 px zapasu** — stan blokady musi zmieścić się bez nowej kolumny.
- **Wzorzec funkcji uprzywilejowanej i jej pułapki** są w `20260909121500_account_role_management.sql`, razem z ustaleniami dziesięciu ustaleń przeglądu.

## What We're NOT Doing

- **Żadnego unieważniania sesji po stronie dostawcy.** Wymagałoby Admin API i klucza `service_role`, którego projekt świadomie nie ma. Okno zamykamy własną bramką, nie zmianą modelu bezpieczeństwa.
- **Żadnej blokady terminowej.** `banned_until` jest znacznikiem czasu i dostawca to potrafi, ale FR-016 mówi „blokuje i **później** odblokowuje" — dwa stany, nie trzeci wymiar.
- **Żadnej podłogi.** Wolno zablokować administratora, ostatniego administratora i samego siebie — spójnie z decyzją o rolach (PRD v4, OQ9). Pytamy, nie zabraniamy.
- **Żadnego usuwania kont** — to `S-12`.
- **Żadnego audytu** kto kogo zablokował — nadal poza zakresem, jak przy `S-10`.
- **Żadnego kanału kontaktu** dla zablokowanego. Produkt go nie ma i `## Non-Goals` wyklucza zgłaszanie nadużyć; komunikat nie obiecuje czegoś, czego nie ma.
- **Żadnej zmiany w liczeniu dobowych sufitów.** Próby zablokowanego konta nadal liczą się do `FR-013` — inaczej blokada zwalniałaby sufit, czyli robiła to samo, co usunięcie.
- **Żadnej wspólnej funkcji stanu konta.** `set_account_blocked` stoi obok `set_account_role`, nie zastępuje go.

## Implementation Approach

Bramka roli zostaje w bazie, w środku funkcji — bez zmian wobec `S-10`. Nowa funkcja kopiuje z niej wszystko: listę rol w `revoke`, `search_path`, `deleted_at` w bramce, **ten sam klucz blokady doradczej** (roadmapa zapisuje to przy `S-11` jako wymóg, bo klucz chroni liczbę administratorów, nie tylko zmianę roli).

Bramka dla zablokowanego użytkownika jest **drugim, niezależnym mechanizmem** i mieszka w middleware. Nie zastępuje odmowy dostawcy — dopełnia ją: dostawca pilnuje drzwi wejściowych, middleware pilnuta tego, kto jest już w środku.

Kolejność faz jest wymuszona przez uczciwość, nie przez wygodę: **bramka powstaje przed przyciskiem**. Inaczej istniałby moment, w którym blokada da się kliknąć, a trwająca sesja jej nie zauważa.

## Critical Implementation Details

**`banned_until` w przeszłości NIE znaczy zablokowany.** Kolumna jest znacznikiem czasu, a nie flagą — konto z datą w przeszłości jest aktywne. Każde sprawdzenie musi porównywać z `now()`, i to samo dotyczy kolumny w przeglądzie oraz bramki w middleware. Traktowanie „niepuste = zablokowane" zablokowałoby konta, którym blokada minęła.

**Wyjątek dla ścieżki auth jest warunkiem działania, nie ułatwieniem.** Bramka przekierowuje na `/auth/signin`; bez wyłączenia z niej samej ścieżki `/auth/*` powstałaby pętla przekierowań, a użytkownik nie zobaczyłby komunikatu, dla którego to wszystko robimy. Wylogowanie musi zostać dostępne z tego samego powodu.

## Phase 1: Baza — funkcja blokady i stan w przeglądzie

### Overview

Jedna migracja dodaje `set_account_blocked` i rozszerza przegląd o `is_blocked`. Po fazie blokadę da się ustawić i zmierzyć bez istnienia endpointu.

### Changes Required

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_account_blocking.sql`

**Intent**: Dodać jedyny mechanizm blokowania konta w produkcie i pokazać stan blokady w przeglądzie.

**Contract**: `drop` + `create` na `public.accounts_overview()` (typ zwracany się zmienia, więc `create or replace` odmówi — zmierzone przy `S-10`), dziesięć istniejących kolumn bez zmian plus `is_blocked boolean` liczone jako `u.banned_until is not null and u.banned_until > now()`. Powtórzyć `revoke`/`grant` — drop kasuje granty.

`public.set_account_blocked(p_account uuid, p_blocked boolean, p_confirm boolean default false)` — `plpgsql`, `security definer`, `set search_path = ''`, volatile. Bramka identyczna jak w `set_account_role`, z `me.deleted_at is null`. **Ten sam klucz** `pg_advisory_xact_lock(hashtext('account_role_gate'))`. Zwraca kod: `ok` / `FORBIDDEN` / `NOT_FOUND` / `LAST_ADMIN_NEEDS_CONFIRM`. Zapis ustawia `banned_until` na odległą datę przy blokowaniu i `null` przy odblokowaniu; **nie dotyka** `raw_app_meta_data` ani kolumny `role`.

Warunek potwierdzenia: blokowanie konta, które jest administratorem, gdy jest ostatnim — albo gdy celem jest wołający. Odblokowanie nie pyta nigdy.

#### 2. Skrypt kontrolny i test SQL

**File**: `context/changes/admin-block-account/verify-blocking.sql`, `context/changes/admin-block-account/test-set-account-blocked.sql`

**Intent**: Ta sama para co przy `S-10`: kontrola stanu bazy do wklejenia na produkcji i test bramki podszywający się przez `request.jwt.claims`.

**Contract**: Kontrola — tożsamość środowiska w pierwszej kolumnie, werdykt w ostatniej, `prosecdef`, `proconfig`, `provolatile` i `has_function_privilege` dla trzech rol, dla **wszystkich trzech** funkcji. Kończy się `SELECT`-em. Test — numery liczone, komenda uruchomienia w nagłówku, `rollback` na końcu; przypadki różnicujące dla `is_blocked` przy dacie w przyszłości **i w przeszłości**.

### Success Criteria

#### Automated Verification

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Typy zregenerowane; diff dotyczy wyłącznie nowej funkcji i nowej kolumny
- Skrypt kontrolny: werdykt OK, `anon` i `service_role` bez prawa dla **wszystkich trzech** funkcji
- Test SQL: konto bez roli nie zablokuje nikogo **i stan celu pozostaje niezmieniony**
- Test SQL: `is_blocked` jest `false` dla daty w **przeszłości** i `true` dla daty w przyszłości
- Test SQL: blokada ostatniego administratora bez zgody odmawia, ze zgodą przechodzi
- `npm run test:integration` kończy się kodem wyjścia 0
- `npx tsc --noEmit` bez błędów

#### Manual Verification

- Zdjęcie bramki z `set_account_blocked` czerwieni testy nieuprawnionego dostępu

---

## Phase 2: Zablokowany użytkownik — komunikat i bramka

### Overview

Faza zamyka okno 60 minut i naprawia komunikat. Sprawdzalna w całości **przed** powstaniem jakiegokolwiek przycisku: blokadę ustawia się SQL-em.

### Changes Required

#### 1. Kod błędu i mapowanie

**File**: `src/types.ts`, `src/lib/api-errors.ts`

**Intent**: Przestać gubić odmowę dostawcy w `INTERNAL`.

**Contract**: `ApiErrorCode` zyskuje kod dla konta zawieszonego. `API_ERRORS` dostaje wpis: status **403** (to nie jest błąd danych logowania ani awaria — to odmowa wobec poprawnych danych) i polski komunikat mówiący o zawieszeniu dostępu, **bez** odsyłania do kontaktu, którego produkt nie ma. `PROVIDER_CODE_MAP` dostaje `user_banned`; `PROVIDER_MESSAGE_MAP` dostaje wariant tekstowy, bo dostawca nie zawsze podaje `code`.

#### 2. Bramka w middleware

**File**: `src/middleware.ts`, `src/lib/account-blocked.ts`

**Intent**: Wypchnąć zablokowanego z trwającej sesji przy pierwszym żądaniu, zamiast czekać na wygaśnięcie tokenu.

**Contract**: Nowa funkcja czysta `isBlocked(user)` — fail-closed wobec nieoczekiwanego wejścia, porównuje `banned_until` z bieżącym czasem, nie sprawdza samej obecności wartości. Middleware, po rozwiązaniu `locals.user`, przekierowuje zablokowanego na stronę logowania z kodem błędu w adresie — **z wyjątkiem ścieżek `/auth/*`**, bez którego powstałaby pętla przekierowań i komunikat nigdy by się nie pokazał.

### Success Criteria

#### Automated Verification

- Test jednostkowy `isBlocked`: data w przyszłości daje `true`, w przeszłości `false`, `null` i wejścia nieoczekiwane dają `false`
- Test jednostkowy: `toApiErrorCode` mapuje `user_banned` na nowy kod, **nie** na `INTERNAL`
- **Test integracyjny: żywy token, który przed zablokowaniem czytał dane, po zablokowaniu nie przechodzi** — to jedyny test mierzący okno, które ta faza zamyka
- `npm test` kodem wyjścia 0
- `npx tsc --noEmit` i ESLint na dotkniętych plikach bez błędów

#### Manual Verification

- Zablokowanie konta SQL-em przy otwartej sesji: następne żądanie ląduje na logowaniu z komunikatem o zawieszeniu
- Próba zalogowania zablokowanego: komunikat o zawieszeniu, nie „Coś poszło nie tak"
- Zablokowany może otworzyć stronę logowania i wylogować się — nie ma pętli przekierowań

---

## Phase 3: Kontrakt — endpoint i moduł

### Overview

Droga z aplikacji do funkcji, wzorem `S-10`.

### Changes Required

#### 1. Schemat, moduł, endpoint

**File**: `src/lib/account-blocked-patch.ts`, `src/lib/admin-accounts.ts`, `src/pages/api/accounts/[id].ts`

**Intent**: Wystawić blokowanie tą samą drogą co zmianę roli.

**Contract**: Schemat Zoda w `src/lib/`, **nie** pod `src/pages/` — tam stałby się trasą. `setAccountBlocked` obok `setAccountRole`, zwraca kod z bazy bez zamiany na wyjątek; mapowanie kodów fail-closed, `FORBIDDEN` → `NOT_FOUND`. `AccountOverviewRow` zyskuje `isBlocked`.

Endpoint: rozszerzyć istniejący `PATCH /api/accounts/[id]` o pole blokady — ciało niesie `role` **albo** `blocked`, nie oba naraz; żądanie bez żadnego z nich jest błędem walidacji, inaczej pusty JSON dawałby 200 i nic by się nie stało.

### Success Criteria

#### Automated Verification

- Test jednostkowy schematu: samo `role`, samo `blocked`, oba naraz odrzucone, żadne odrzucone
- Test jednostkowy mapowania czterech kodów bazy na kody API
- `npm test` kodem wyjścia 0
- `npx tsc --noEmit` i ESLint bez błędów

#### Manual Verification

- `curl` zwykłym kontem na blokowanie zwraca 404, nie 403

---

## Phase 4: Interfejs — przycisk i znacznik

### Overview

Ostatnia faza. Przycisk przy wierszu, znacznik stanu pod adresem, uczciwe zachowanie przy zablokowaniu siebie.

### Changes Required

#### 1. Maszyna stanów i wyspa

**File**: `src/lib/account-block-action.ts`, `src/components/admin/AccountBlockButton.tsx`

**Intent**: Decyzja „czy pytać, czy wysyłać" w funkcji czystej; wyspa cienka — repo nie ma infrastruktury do testowania komponentów (`vitest.config.ts:13-14`, brak jsdom).

**Contract**: Pytanie przy blokowaniu siebie i przy blokowaniu ostatniego administratora; odblokowanie nie pyta nigdy. Po sukcesie na cudzym koncie — przeładowanie; na **własnym** — komunikat, że dostęp został zawieszony i następne żądanie wyloguje, dopiero potem przejście. Stan końcowy **przed** przeładowaniem, wzorem `S-10`.

#### 2. Tabela

**File**: `src/pages/dashboard.astro`

**Intent**: Pokazać stan blokady **bez nowej kolumny** — tabela ma zmierzone 0 px zapasu.

**Contract**: Znacznik pod adresem, obok istniejącego „to Ty". Etykieta liczona we frontmatterze, w tym samym `try` co odczyt.

### Success Criteria

#### Automated Verification

- Test jednostkowy maszyny stanów: blokowanie siebie i ostatniego admina pyta, odblokowanie nie pyta nigdy
- `npx astro build` przechodzi
- ESLint i `npx tsc --noEmit` bez błędów

#### Manual Verification

- Zablokowanie drugiego konta: znika mu dostęp przy następnym żądaniu, widzi komunikat
- Odblokowanie: konto wraca bez żadnego dodatkowego kroku
- Zablokowanie siebie: ostrzeżenie, potwierdzenie, komunikat, potem wyjście
- Tabela nadal mieści się bez poziomego przewijania
- Zwykłe konto nie widzi sekcji ani przycisków

---

## Testing Strategy

### Unit Tests

- `isBlocked`: przyszłość, przeszłość, `null`, wejścia nieoczekiwane
- `toApiErrorCode` dla `user_banned` po kodzie i po tekście
- Schemat żądania: rozłączność `role` i `blocked`
- Maszyna stanów blokady

### Integration Tests

- Żywy token przestaje przechodzić po zablokowaniu — **najważniejszy przypadek całego plastra**
- Konto bez roli nie zablokuje nikogo
- `anon` nie wykona `set_account_blocked`

### SQL Tests

- Bramka, ostatni administrator, `is_blocked` dla daty przeszłej i przyszłej, nienaruszona kolumna `auth.users.role`

### Manual Testing Steps

1. Zarejestruj dwa konta, nadaj rolę pierwszemu
2. Zaloguj drugie w innej przeglądarce, zostaw otwarte
3. Zablokuj je z panelu; odśwież u drugiego — ma wylądować na logowaniu z komunikatem
4. Spróbuj zalogować zablokowane — komunikat o zawieszeniu
5. Odblokuj; drugie konto loguje się normalnie
6. Zablokuj siebie: ostrzeżenie, potwierdzenie, komunikat
7. Odblokuj się przez konsolę dostawcy

## Performance Considerations

Bramka w middleware **nie dokłada zapytania** — czyta `banned_until` z tej samej odpowiedzi `getUser()`, którą middleware już pobiera. Koszt to jedno porównanie dat na żądanie.

## Migration Notes

Port 5432 na produkcji jest zablokowany, więc migracja idzie przez edytor SQL, a wersja musi zostać zaksięgowana w `supabase_migrations.schema_migrations` ręcznie. **Kontrola idzie osobnym wklejeniem**, z nowej sesji — zasada przyjęta 2026-09-14 po tym, jak migracja `S-09` zniknęła z produkcji razem z wpisem w rejestrze, a przyczyny nie ustalono.

`drop function accounts_overview()` znów tworzy okno, w którym panel admina zwraca błąd odczytu sekcji kont. Skrypt musi zostać wykonany w całości, jednym wywołaniem.

## References

- Wymaganie: `context/foundation/prd.md` § `### Account management`, FR-016; rozstrzygnięcie w `## Open Questions` #7
- Plaster: `context/foundation/roadmap.md` § `### S-11`, w tym wymóg wspólnego klucza blokady
- Wzorzec funkcji i dziesięć ustaleń przeglądu: `supabase/migrations/20260909121500_account_role_management.sql`
- Wzorzec wyspy i maszyny stanów: `src/lib/account-role-action.ts`, `src/components/admin/AccountRoleButton.tsx`
- Reguła o bramce i stanie wołającego: `context/foundation/lessons.md` § „Funkcja uprzywilejowana filtruje stan konta wołającego, nie tylko celu"

## Addendum 2026-09-14 — adaptacja fazy 1

**Blok `## Phase 1` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Faza dotknęła funkcji z `S-10`, czego plan nie przewidywał — i nie jest to rozszerzenie zakresu, tylko domknięcie.** `20260909121500:185` zapisało wprost: „Przy `S-11` dojdzie tu warunek na stan zablokowania, z tego samego powodu". Plan tego zdania nie przeczytał i zaplanował fazę 1 jako wyłącznie nowy kod.

**Zmierzona dziura, która to wymusiła** (dwaj administratorzy A i C):

1. A blokuje C → `ok`
2. A blokuje **siebie**, bez zgody → `ok` ← cicho
3. to samo przez zdjęcie własnej roli → `ok` ← cicho

Licznik z `S-10` widział 1 administratora, **użytecznych było 0**. Przyczyna: licznik pytał „kto **ma** rolę", a bramka pyta „kto **może działać**". Zablokowany administrator ma rolę i działać nie może, więc był liczony jako zabezpieczenie, którego nie ma — administracja stawała się nieosiągalna bez jednego ostrzeżenia. To ta sama klasa awarii, przed którą `S-10` broni kodem `LAST_ADMIN_NEEDS_CONFIRM`, a zapisana przy blokadzie doradczej gwarancja („ostrzeżenie pada dokładnie wtedy, gdy rola jest ostatnia") przestawała być prawdziwa.

**Doszła czwarta funkcja, `active_admin_count()`.** Ten sam licznik czytają teraz trzy funkcje, a `S-12` dołoży czwartą — `20260909121500:220` zapisało ten wymóg wprost. Przy dwóch miejscach powtórzenie predykatu było tańsze; przy czterech rozjazd nie rzuca błędem, tylko cicho gasi ostrzeżenie. **Bramki wołającego zostają rozpisane w miejscu** — to ustalenie F7 przeglądu `S-10`: dzielimy niezmiennik liczbowy, nie warunek dostępu. Funkcja nie dostaje grantu dla nikogo; woła ją wyłącznie `security definer` tego samego właściciela.

**Warunek `not v_target_blocked` w obu bramkach — decyzja, której plan nie zapisał.** Zdjęcie roli albo ponowna blokada konta **już zablokowanego** nie zmienia liczby użytecznych administratorów o nic, więc pytanie o zgodę byłoby ostrzeżeniem przed skutkiem, który nie nastąpi. Ta sama poprawka usuwa fałszywe ostrzeżenie z kolumny `is_last_admin` w przeglądzie.

**Kryterium 1.2 zapisane jako „diff wyłącznie nowa funkcja i nowa kolumna" jest nieaktualne w liczbie: funkcje są dwie** (`set_account_blocked`, `active_admin_count`) plus kolumna `is_blocked`. Poza tym diff typów jest czysty.

**Kryterium 1.3 mówi o „wszystkich trzech funkcjach"; skrypt kontrolny sprawdza cztery.** `active_admin_count()` ma przy tym **odwrotny wzorzec uprawnień** — `authenticated` jest przy niej prawem _odbieranym_, nie nadawanym, i werdykt ma na to osobną gałąź.

**`create or replace` zachowało granty `set_account_role` — zmierzone, nie założone**: skrypt kontrolny pokazuje `sr_auth = t` po migracji.

**Test SQL urósł z 23 do 30 przypadków.** Siedem doszło wyłącznie po to, żeby dziura opisana wyżej miała strażnika; bez nich licznik liczący wszystkich przechodzi cały plik na zielono.

**Znaleziony przy okazji błąd w samym teście, wart zapisania osobno:** werdykt liczył błędy przez `oczekiwano <> otrzymano`, a porównanie z `NULL` daje `NULL`, nie `true`. Przypadki czytające `accounts_overview()` zwracają `NULL`, gdy bramka odrzuci wołającego — więc **tabela pokazywała 18 czerwonych, a licznik raportował 13**. Przebieg, w którym padłyby wyłącznie takie przypadki, dostałby werdykt `OK`. Naprawione przez `IS DISTINCT FROM`. Błąd wyszedł **tylko dlatego, że uruchomiłem test mutacyjny** — na zielonym przebiegu jest niewidoczny.

**Test mutacyjny (kryterium 1.9), dwie mutacje:**

| Mutacja                                          | Czerwieni                                               |
| ------------------------------------------------ | ------------------------------------------------------- |
| Bramka wołającego zdjęta z `set_account_blocked` | 18 z 30, w tym wszystkie cztery o bramce (1, 2, 26, 27) |
| `active_admin_count()` liczy także zablokowanych | 8 z 30, w tym oba przypadki zmierzonej dziury (19, 20)  |

Po wycofaniu transakcji wraca 30/30.

**Obie mutacje leżą w repo jako skrypty, nie jako wynik w tym pliku** — `context/changes/admin-block-account/mutations/`. Plan ich nie przewidywał; przy `S-10` test mutacyjny był raportem, któremu trzeba było uwierzyć, a wynik raportu nie jest tym samym co możliwość jego powtórzenia. Każdy skrypt otwiera transakcję i nie domyka jej — zamyka ją `rollback` na końcu testu, więc mutacja nigdy nie zostaje w bazie.

## Addendum 2026-09-14 — adaptacja fazy 2

**Blok `## Phase 2` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Kryterium 2.3 nie jest przez ten zestaw wyrażalne — i to jest czwarty raz ten sam błąd planowania.** „Test integracyjny: żywy token nie przechodzi po zablokowaniu" wymaga **zablokowania konta**, czyli zapisu do `auth.users.banned_until`. Klucz publishable takiego prawa nie ma, a klucza `service_role` odrzuca strażnik w każdym zestawie integracyjnym — i musi odrzucać, bo omija RLS i unieważniłby każdy inny zestaw w repo. Kryterium powstało z tego, co chciałem udowodnić, a nie z tego, czym repo potrafi dowodzić. Dokładnie tak samo było przy `S-09` (1.5), `S-10` (1.5, 2.3, 3.3) i przy fazie 1 tego plastra.

**Pomiar przeniesiony, nie porzucony:** `context/changes/admin-block-account/measure-session-window.sh`. Zakłada konto, bierze żywy token, czyta nim dane, blokuje konto SQL-em, czyta **tym samym tokenem** ponownie i sprząta po sobie. Zmierzone:

|                                      | przed blokadą | po blokadzie             |
| ------------------------------------ | ------------- | ------------------------ |
| `rpc/usage_today` żywym tokenem      | 200           | **200**                  |
| nowe logowanie                       | —             | **odmowa `user_banned`** |
| `banned_until` w `GET /auth/v1/user` | —             | **obecne**               |

Okno tokenu liczone **z samego tokenu** (`exp - iat`): **60 minut**. To jest cała teza fazy 2 w jednej tabeli — dostawca zamyka drzwi, ale nie wyrzuca tego, kto jest w środku.

**Plan przeczył sam sobie co do zachowania `isBlocked` przy wejściu nieoczekiwanym.** `Contract` mówi „fail-closed", a kryterium sukcesu wprost przeciwnie: „`null` i wejścia nieoczekiwane dają `false`". Rozstrzygnięte **na korzyść kryterium**, bo koszty są niesymetryczne: fałszywe `true` wypycha zdrowe konto z **każdego** żądania i nie da się tego obejść z wnętrza produktu, a fałszywe `false` zostawia zablokowanemu co najwyżej godzinę sesji — czyli stan sprzed tego plastra — przy czym logowania i tak odmawia dostawca, który czyta kolumnę, nie tę funkcję. Bramka jest **drugą** warstwą i nie ma prawa być groźniejsza od problemu, który rozwiązuje. Uzasadnienie stoi też w samym module, nie tylko tutaj.

**Bramka odpowiada na `/api/*` JSON-em, nie przekierowaniem — czego plan nie zapisał.** Plan mówił tylko „wszystkie trasy poza `/auth/*`". Przekierowanie w odpowiedzi na `fetch()` z wyspy byłoby dla niej HTML-em ze statusem 200: `readApiError` nie znalazłby tam żadnego kodu i użytkownik zobaczyłby komunikat domyślny zamiast informacji o zawieszeniu. To reguła „jeden kontrakt błędu, dwa kształty odpowiedzi" z `CLAUDE.md`. Zmierzone: `DELETE /api/generations/…` zwraca **403** z ciałem `{"error":{"code":"ACCOUNT_BLOCKED",…}}`.

**Wyłączenie objęło także `/api/auth/`, nie tylko `/auth/`.** Powód jest inny niż przy stronach: zablokowany musi móc się **wylogować**. Odcięcie mu `POST /api/auth/signout` byłoby uwięzieniem go w sesji, a nie zablokowaniem. Zmierzone: ciasteczka 2976 → 0.

**Doszedł plik, którego plan nie przewidywał:** `src/lib/account-blocked.integration.test.ts`. Test jednostkowy karmi `isBlocked` atrapą, więc dowodzi tylko zgodności z wyobrażeniem autora o odpowiedzi GoTrue. Że stan blokady przyjeżdża jako pole `banned_until` na obiekcie `User` — to może potwierdzić wyłącznie prawdziwy serwer. Ten sam wzorzec, co `account-role.integration.test.ts` dla `isAdmin`.

**Weryfikacja ręczna przeprowadzona end-to-end w przeglądarce** (2.6–2.8), z pomiarem bazowym przed blokadą:

| Krok                                        | Wynik                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| `/generations` i `/dashboard` przed blokadą | 200 / 200                                                |
| `/generations` po blokadzie, ta sama sesja  | → `/auth/signin?error=ACCOUNT_BLOCKED`                   |
| komunikat na stronie logowania              | „Dostęp do tego konta został zawieszony."                |
| próba zalogowania zablokowanego             | ten sam komunikat, **nie** „Coś poszło nie tak"          |
| wylogowanie zablokowanego                   | działa, ciasteczka 2976 → 0                              |
| odblokowanie                                | dostęp wraca bez dodatkowego kroku, `/generations` → 200 |

Log serwera potwierdza ścieżkę mapowania: `{ scope: 'auth/signin', code: 'ACCOUNT_BLOCKED', providerCode: 'user_banned', providerStatus: 400 }`.

**Przy okazji trafiona pułapka z `CLAUDE.md`:** dev server wywalił się na `Invalid hook call` / `useState` z `null` — objaw nieświeżego cache'u Vite. `rm -rf node_modules/.vite` i restart, zgodnie z zapisaną regułą. Nie miało związku ze zmianą.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baza — funkcja blokady i stan w przeglądzie

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie — 21f66ce
- [x] 1.2 Typy zregenerowane; diff wyłącznie nowa funkcja i nowa kolumna — 21f66ce
- [x] 1.3 Skrypt kontrolny: werdykt OK dla wszystkich trzech funkcji — 21f66ce
- [x] 1.4 Test SQL: konto bez roli nie zablokuje nikogo, stan celu nietknięty — 21f66ce
- [x] 1.5 Test SQL: `is_blocked` false dla daty przeszłej, true dla przyszłej — 21f66ce
- [x] 1.6 Test SQL: ostatni administrator bez zgody odmawia, ze zgodą przechodzi — 21f66ce
- [x] 1.7 `npm run test:integration` kodem wyjścia 0 — 21f66ce
- [x] 1.8 `npx tsc --noEmit` bez błędów — 21f66ce

#### Manual

- [x] 1.9 Zdjęcie bramki czerwieni testy nieuprawnionego dostępu — 21f66ce

### Phase 2: Zablokowany użytkownik — komunikat i bramka

#### Automated

- [x] 2.1 Test jednostkowy `isBlocked` dla czterech klas wejścia
- [x] 2.2 Test jednostkowy: `user_banned` mapuje się na nowy kod, nie na INTERNAL
- [x] 2.3 Test integracyjny: żywy token nie przechodzi po zablokowaniu
- [x] 2.4 `npm test` kodem wyjścia 0
- [x] 2.5 `npx tsc --noEmit` i ESLint bez błędów

#### Manual

- [x] 2.6 Zablokowanie przy otwartej sesji wypycha przy następnym żądaniu
- [x] 2.7 Próba logowania zablokowanego: komunikat o zawieszeniu
- [x] 2.8 Brak pętli przekierowań na ścieżce auth

### Phase 3: Kontrakt — endpoint i moduł

#### Automated

- [ ] 3.1 Test jednostkowy schematu: rozłączność `role` i `blocked`
- [ ] 3.2 Test jednostkowy mapowania czterech kodów bazy
- [ ] 3.3 `npm test` kodem wyjścia 0
- [ ] 3.4 `npx tsc --noEmit` i ESLint bez błędów

#### Manual

- [ ] 3.5 `curl` zwykłym kontem na blokowanie zwraca 404, nie 403

### Phase 4: Interfejs — przycisk i znacznik

#### Automated

- [ ] 4.1 Test jednostkowy maszyny stanów blokady
- [ ] 4.2 `npx astro build` przechodzi
- [ ] 4.3 ESLint i `npx tsc --noEmit` bez błędów

#### Manual

- [ ] 4.4 Zablokowanie drugiego konta odcina mu dostęp i pokazuje komunikat
- [ ] 4.5 Odblokowanie przywraca dostęp bez dodatkowych kroków
- [ ] 4.6 Zablokowanie siebie: ostrzeżenie, potwierdzenie, komunikat
- [ ] 4.7 Tabela mieści się bez poziomego przewijania
- [ ] 4.8 Zwykłe konto nie widzi sekcji ani przycisków

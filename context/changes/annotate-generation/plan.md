# Własny tytuł zapisanej generacji — Implementation Plan

## Overview

Użytkownik nadaje zapisanej generacji własny tytuł i może go zmienić — jedyne „U" w CRUD
tego produktu. Aktualizacja dotyczy **metadanych** pozycji, nie wygenerowanego tekstu, więc
zakaz edycji z PRD `## Non-Goals` („the format contract governs the whole output or nothing")
zostaje nienaruszony.

Plaster `S-08` z roadmapy, zakotwiczony w `MS-01` (wymagania certyfikacyjne), nie w FR z PRD.
Jest jedynym plastrem niezależnym od nierozstrzygniętego dostawcy LLM, więc jedyną drogą do
dowiezienia działającego oprogramowania przed tamtą decyzją.

## Current State Analysis

**Co istnieje.** Kontrakt odpowiedzi API z `F-01`: koperta `{ data }` / `{ error }`, kody
domenowe ze statusami w `src/lib/api-errors.ts`, `validate()` w `src/lib/validation.ts`,
`jsonOk`/`jsonError` w `src/lib/api-response.ts`. Auth działa na produkcji, middleware wstawia
użytkownika do `context.locals.user`. Vitest z 47 testami jednostkowymi.

**Czego brakuje — wszystkiego, na czym ten plaster stoi.**

- `supabase/migrations/` nie istnieje; katalog `supabase/` ma sam `config.toml`. Zero tabel.
- W całym `src/` nie ma ani jednego `.from(...)` — Supabase jest używany wyłącznie do auth.
- Nie ma ekranu historii ani żadnej listy czegokolwiek.
- Nie ma żadnego endpointu nie-auth. Kontrakt z `F-01` jest przetestowany jednostkowo,
  ale **nieużyty w boju**.
- Nie ma testów integracyjnych ani sposobu na sprawdzenie polityki RLS.

**Świadome przekroczenie granic plastrów.** Ten plan tworzy tabelę generacji (zakres `S-03`)
i minimalną listę historii (zakres `S-05`). To decyzja podjęta wprost, nie dryf: bez tabeli
plan jest niewykonalny do czasu rozstrzygnięcia dostawcy LLM, a bez listy „U" istnieje
w API i nie istnieje dla użytkownika — co przy ocenie CRUD jest różnicą między zrobionym
a zapowiedzianym.

**Ograniczenia.**

- Klucz Supabase **musi** być publishable/anon. `service_role` omija RLS i cicho łamie
  izolację kont — bez błędu i bez testu, który by to złapał.
- Adapter Cloudflare v13 usunął `Astro.locals.runtime`; sięganie po nie zwraca `undefined`
  w runtime, a nie błąd typu.
- `npm run lint` na całym repo pada na CRLF niezależnie od tej zmiany — lintuj pliki,
  które ruszasz, nie katalogi.
- `npx supabase start` wymaga Dockera i ~7 GB RAM.

## Desired End State

Zalogowany użytkownik widzi listę własnych generacji, nadaje wybranej pozycji tytuł i zmienia
go. Próba dotknięcia cudzej pozycji jest nieodróżnialna od próby dotknięcia nieistniejącej.
Izolacja kont jest sprawdzana automatycznie, nie deklarowana.

**Jak to zweryfikować:** `npm test` i `npm run test:integration` przechodzą; drugie konto nie
zmienia cudzego tytułu; lista pokazuje wyłącznie własne pozycje.

### Key Discoveries:

- Kontrakt z `F-01` czeka na pierwszego konsumenta — `API_ERRORS` w
  [`api-errors.ts`](src/lib/api-errors.ts) jest `Record<ApiErrorCode, …>`, więc nowy kod
  `NOT_FOUND` bez wpisu jest błędem kompilacji, nie błędem w runtime.
- `validate()` w [`validation.ts`](src/lib/validation.ts) zwraca mapę pól i wymaga, żeby
  komunikaty pochodziły z definicji schematu — po polsku, nie z domyślnych tekstów Zoda.
- Konwencja migracji: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`, RLS włączony,
  polityki **granularne per operacja i per rola**. Katalog powstaje przy pierwszej migracji.
- `context.locals.user` jest `null` zarówno przy braku sesji, jak i przy niedostępnym Supabase,
  więc handler czytający go nie potrzebuje osobnego sprawdzenia `createClient()`.
- Ryzyko **R-05** z `context/foundation/test-plan.md` jest jedynym oznaczonym jako **krytyczne**
  i jedynym, którego nie da się pokryć testem jednostkowym — polityka żyje w bazie, nie w kodzie.

## What We're NOT Doing

- **Edycja wygenerowanego tekstu** — zakazana przez PRD `## Non-Goals`. Tytuł to osobne pole.
- **Regeneracja w miejscu** — wymagałaby przeredagowania Non-Goala; decyzja produktowa, nie ta zmiana.
- **Notatka jako drugie pole** — jedno pole wystarcza wymaganiu.
- **Zapis generacji z generowania** (`S-03`) — ten plan tworzy tabelę, ale nic do niej nie pisze
  poza testami; wypełnia ją dopiero `S-01`/`S-03`.
- **Pełny ekran historii** (`S-05`) — sortowanie, paginacja, otwieranie pozycji w całości.
- **Usuwanie** (`S-06`) — dlatego polityka `delete` nie powstaje w tej migracji.
- **Liczniki limitów** (`S-04`) — tabela nie dostaje kolumn pod FR-012/FR-013.
- **Tłumaczenie interfejsu auth** (`S-02`) — nowa lista jest po polsku, stare ekrany zostają.

## Implementation Approach

Pięć faz, w kolejności od gwarancji do jej użycia. Najpierw schemat i polityki, potem **test
polityki**, dopiero potem endpoint, który z niej korzysta, na końcu interfejs i zapis decyzji
w dokumentach.

Kolejność faz 2 i 3 jest celowo odwrócona wobec intuicji: gwarancją izolacji jest polityka RLS,
a nie endpoint. Gdyby test szedł po endpointcie, zielony wynik mógłby oznaczać poprawny endpoint
postawiony na dziurawej polityce — a to jest dokładnie ta klasa cichej awarii, którą test-plan
nazywa najgroźniejszą.

## Critical Implementation Details

**Klucz Supabase w testach integracyjnych.** Test musi używać klucza publishable/anon i dwóch
osobnych sesji użytkowników. Użycie `service_role` sprawi, że test przejdzie **zawsze** —
ten klucz omija RLS — czyli da fałszywą zieloną odpowiedź na jedyne krytyczne ryzyko projektu.
To nie jest teoretyczne: `context/deployment/deploy-plan.md` notuje ten sam błąd jako bramkę
ludzką utrzymywaną świadomie.

**Pusty tytuł ma dwa znaczenia i jedno zachowanie.** `title: ""` po `trim()` kasuje tytuł
(ustawia `NULL`), a nie zapisuje pusty string. Bez tego lista musiałaby rozróżniać „brak tytułu"
od „tytuł będący pustym stringiem" przy każdym renderowaniu.

**404 przychodzi z braku wiersza, nie z porównania właściciela.** Handler nie sprawdza, czyj
jest rekord — pyta bazę o aktualizację i dostaje zero wierszy, bo RLS odfiltrował cudze.
Porównywanie `user_id` w kodzie dałoby ten sam wynik dla poprawnej polityki i zamaskowało
błąd w niepoprawnej.

## Phase 1: Schemat i polityki RLS

### Overview

Pierwsza migracja w tym projekcie. Tworzy tabelę generacji z kolumną tytułu i granularnymi
politykami dostępu. Po tej fazie w bazie jest wszystko, czego potrzebuje reszta planu.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_generations.sql` (nowy — katalog też)

**Intent**: Utworzyć tabelę przechowującą generacje użytkownika wraz z opcjonalnym tytułem
nadanym ręcznie, i od pierwszej chwili zamknąć ją politykami RLS.

**Contract**: Tabela `generations` z kluczem głównym, referencją do użytkownika Supabase Auth
z kaskadowym usuwaniem, treścią wygenerowaną, tematem, formatem, długością, znacznikiem
utworzenia oraz nullowalną kolumną `title`. RLS **włączony w tej samej migracji co tabela** —
dołożenie polityk osobną migracją zostawia okno, w którym izolacja nie obowiązuje.

Polityki granularne per operacja i per rola, wyłącznie dla roli uwierzytelnionej, każda
ograniczona do wierszy własnych: `select`, `insert`, `update`. Polityki `delete` **nie ma** —
powstanie z `S-06`, zgodnie z zasadą, że uprawnienie pojawia się razem ze swoją funkcją.

Ograniczenie na `title`: długość po przycięciu w zakresie 1–80 znaków albo `NULL`. Ta sama
górna granica co dla tematu w FR-003 — jedna liczba w produkcie zamiast dwóch.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się na czystej bazie: `npx supabase db reset`
- Nazwa pliku pasuje do konwencji `YYYYMMDDHHmmss_short_description.sql`
- RLS jest włączony na tabeli, a polityki `select`/`insert`/`update` istnieją; polityki `delete` nie ma

#### Manual Verification:

- Przegląd polityk: każda ogranicza się do wierszy własnych i do roli uwierzytelnionej, żadna nie jest szersza niż jej operacja wymaga

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na
potwierdzenie od człowieka.

---

## Phase 2: Harness testów integracyjnych i test izolacji (R-05)

### Overview

Pierwszy test integracyjny w projekcie. Sprawdza **samą politykę RLS**, jeszcze bez endpointu:
dwa konta, drugie próbuje zmienić wiersz pierwszego. Domyka R-05 z test-planu.

### Changes Required:

#### 1. Konfiguracja i skrypt

**File**: `vitest.integration.config.ts` (nowy), `package.json`

**Intent**: Oddzielić testy integracyjne od jednostkowych, żeby `npm test` pozostał szybki
i niezależny od Dockera.

**Contract**: Osobna konfiguracja z wzorcem `src/**/*.integration.test.ts`, wykluczonym
z konfiguracji jednostkowej. Skrypt `test:integration`. Dłuższy limit czasu — start bazy
i dwa logowania nie mieszczą się w domyślnym.

#### 2. Test izolacji

**File**: `src/lib/generations.integration.test.ts` (nowy)

**Intent**: Udowodnić, że konto B nie zmieni tytułu wiersza konta A — i że nie dowie się
przy tym, że taki wiersz istnieje.

**Contract**: Test zakłada dwa konta przez klienta z kluczem **publishable/anon**, wstawia
wiersz jako A, próbuje aktualizacji jako B i oczekuje zera zmienionych wierszy. Kontrola
pozytywna w tym samym pliku: A zmienia własny wiersz i to działa — bez niej zielony wynik
mógłby oznaczać, że aktualizacja nie działa w ogóle.

Użycie klucza `service_role` w tym teście unieważnia go całkowicie: ten klucz omija RLS,
więc test przeszedłby także przy polityce dopuszczającej wszystkich.

### Success Criteria:

#### Automated Verification:

- Testy integracyjne przechodzą: `npm run test:integration`
- Testy jednostkowe nadal przechodzą i nie wymagają Dockera: `npm test`
- Lint na nowych plikach przechodzi

#### Manual Verification:

- Celowe rozszerzenie polityk `select` i `update` do wszystkich wierszy powoduje **czerwony** wynik testu; po cofnięciu znowu zielony

---

## Phase 3: Endpoint aktualizacji tytułu

### Overview

Pierwszy endpoint nie-auth w tym repo — i pierwszy prawdziwy konsument kontraktu z `F-01`.

### Changes Required:

#### 1. Nowy kod błędu

**File**: `src/types.ts`, `src/lib/api-errors.ts`

**Intent**: Dodać `NOT_FOUND`, żeby brak wiersza — z powodu nieistnienia albo z powodu RLS —
miał jeden kod i jeden komunikat po polsku.

**Contract**: `NOT_FOUND` w unii `ApiErrorCode` i wpis w `API_ERRORS` ze statusem 404.
Komunikat nie może sugerować, że rekord istnieje, ale należy do kogoś innego.

#### 2. Endpoint

**File**: `src/pages/api/generations/[id].ts` (nowy)

**Intent**: Przyjąć nowy tytuł, zwalidować go, zapisać i oddać zaktualizowany rekord —
albo odmówić w sposób nieujawniający cudzych danych.

**Contract**: Metoda `PATCH`. Brak sesji → `UNAUTHORIZED`. Ciało walidowane schematem zod
współlokowanym z endpointem: `title` jako tekst, po `trim()` 1–80 znaków, pusty oznacza
wyczyszczenie tytułu do `NULL`. Komunikaty pól po polsku, w definicji schematu.

Sukces zwraca zaktualizowany rekord przez `jsonOk`. Zero zmienionych wierszy → `jsonError`
z `NOT_FOUND`; handler **nie porównuje** właściciela w kodzie — polega na RLS, którego
faza 2 dowiodła. Błąd bazy → `toApiErrorCode` plus `logApiError`; do loga nie trafia ciało
żądania ani identyfikator użytkownika.

#### 3. Testy jednostkowe

**File**: `src/pages/api/generations/title-schema.test.ts` (nowy)

**Intent**: Pokryć granice walidacji bez dotykania bazy.

**Contract**: Tytuł o długości 1 i 80 przechodzi; 81 odrzucony; sam biały znak traktowany jak
pusty, czyli jako wyczyszczenie; brak pola odrzucony; wartość nie będąca tekstem odrzucona.
Każdy komunikat po polsku.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Testy integracyjne przechodzą: `npm run test:integration`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Handler nie porównuje właściciela w kodzie: `grep -n "user_id" src/pages/api/generations/[id].ts` nie zwraca porównania w warunku

#### Manual Verification:

- Zmiana tytułu własnej pozycji zwraca 200 i zaktualizowany rekord
- Zmiana tytułu cudzej pozycji zwraca 404 z komunikatem nieujawniającym istnienia rekordu
- Tytuł dłuższy niż 80 znaków zwraca 400 z komunikatem wskazującym pole
- Pusty tytuł czyści nazwę zamiast zapisywać pusty tekst

---

## Phase 4: Minimalna lista historii z edycją tytułu

### Overview

Tyle ekranu, ile trzeba, żeby użytkownik zobaczył swoje pozycje i nazwał jedną z nich.
Bez tego „U" istnieje w API i nie istnieje dla użytkownika.

### Changes Required:

#### 1. Strona listy

**File**: `src/pages/generations.astro` (nowy), `src/middleware.ts`

**Intent**: Pokazać zalogowanemu użytkownikowi jego generacje i dać wejście do zmiany tytułu.

**Contract**: Trasa dopisana do `PROTECTED_ROUTES` w middleware — per-page auth checks nie są
tu wzorcem. Strona renderuje po stronie serwera listę własnych pozycji: tytuł, a gdy go nie ma,
początek wygenerowanego tekstu. Pusta historia ma własny stan, nie pustą listę. Wszystko po polsku.

#### 2. Wyspa edycji

**File**: `src/components/generations/TitleEditor.tsx` (nowy)

**Intent**: Pozwolić zmienić tytuł bez przeładowania strony, wołając endpoint z fazy 3.

**Contract**: Wyspa React — interaktywność jest tu wymagana, więc wyjątek od reguły „Astro do
statyki" obowiązuje. Komponent pokazuje stan zapisywania, komunikat błędu z pola `fields.title`
odpowiedzi, i stan po sukcesie. Kasowanie tytułu musi być widoczne jako osobna, zrozumiała
akcja — inaczej „zapisz pusty" zaskakuje. Klasy łączone przez `cn()`.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test` oraz `npm run test:integration`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Trasa jest chroniona: żądanie anonimowe do `/generations` zwraca przekierowanie, nie 200

#### Manual Verification:

- Zalogowany użytkownik widzi wyłącznie własne pozycje
- Nadanie tytułu jest widoczne od razu i po odświeżeniu strony
- Zmiana istniejącego tytułu działa
- Wyczyszczenie tytułu przywraca wyświetlanie początku tekstu
- Pusta historia pokazuje zrozumiały stan, nie pustą ramkę
- Zbyt długi tytuł pokazuje komunikat przy polu, nie ogólny błąd

---

## Phase 5: Aktualizacja test-planu i roadmapy

### Overview

Zapisanie dwóch faktów, które ta zmiana wytworzyła: R-05 przestaje być luką, a `S-03` i `S-05`
mają węższy zakres niż w chwili planowania kamienia milowego.

### Changes Required:

#### 1. Test-plan

**File**: `context/foundation/test-plan.md`

**Intent**: Przenieść R-05 z luki na pokryte i opisać zestaw, który je pokrywa.

**Contract**: Wiersz R-05 w rejestrze ryzyk wskazuje plik testu integracyjnego i status
„pokryte". Nowa sekcja zestawu w tej samej formie co pozostałe: ryzyko, co jest testowane,
czego test nie dowodzi. Sekcja „Czego świadomie nie testujemy" traci zdanie o braku testów
integracyjnych.

#### 2. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Zapisać zwężenie zakresu `S-03` i `S-05`, żeby ich przyszłe plany nie zaczęły
budować tego, co już stoi.

**Contract**: Outcome i Risk pozycji `S-03` odnotowują, że tabela i polityki `select`/`insert`/
`update` już istnieją, a plaster dokłada wyłącznie zapis z generowania. To samo dla `S-05`
wobec minimalnej listy. Prerequisites i Change ID bez zmian.

#### 3. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Zapisać dwie konwencje, które ta zmiana ustanowiła jako pierwsza.

**Contract**: Podział testów na jednostkowe (`npm test`, bez Dockera) i integracyjne
(`npm run test:integration`, wymaga `npx supabase start`), oraz zasada, że testy RLS muszą
używać klucza publishable — `service_role` daje fałszywy zielony wynik. Kilka zdań, bez
wklejonego kodu.

### Success Criteria:

#### Automated Verification:

- R-05 nie figuruje już jako luka: `grep -n "R-05" context/foundation/test-plan.md` pokazuje status pokryte
- Prettier przechodzi na zmienionych dokumentach

#### Manual Verification:

- Czytelnik `S-03` rozumie, że tabela już istnieje, bez otwierania tego planu

---

## Testing Strategy

### Unit Tests:

- Granice schematu tytułu: 1, 80, 81 znaków, sam biały znak, brak pola, typ inny niż tekst
- Komunikaty pól po polsku, pochodzące ze schematu
- Nowy kod `NOT_FOUND` ma komunikat i status, tak jak każdy inny (pokrywa istniejący test kompletności słownika)

### Integration Tests:

- Konto B nie zmienia wiersza konta A — zero zmienionych wierszy
- Kontrola pozytywna: konto A zmienia własny wiersz
- Konto B nie widzi wiersza konta A przy odczycie

### Manual Testing Steps:

1. Zaloguj się, wejdź na `/generations`, sprawdź stan pustej historii
2. Wstaw wiersz testowy, nadaj mu tytuł, odśwież stronę
3. Zmień tytuł, potem wyczyść go i sprawdź, że wraca początek tekstu
4. Wpisz tytuł dłuższy niż 80 znaków — oczekuj komunikatu przy polu
5. Zaloguj się na drugie konto i spróbuj wejść na pozycję pierwszego po jej identyfikatorze

## Performance Considerations

Bez istotnych. Lista jest ograniczona do wierszy jednego użytkownika, a docelowy użytkownik
to jedna osoba z dziennym limitem generacji. Paginacja należy do `S-05` i wchodzi wtedy,
gdy pojawi się jej powód.

## Migration Notes

Pierwsza migracja w projekcie — od tej chwili rollback przestaje być symetryczny: **kod się
cofa, migracje nie**. Cofnięcie deployu przed tę zmianę zostawia tabelę w bazie; to bezpieczne,
bo nic jej nie czyta poza usuniętym kodem, ale przestaje być bezpieczne przy pierwszej zmianie
kształtu tabeli.

Rollback samej migracji wymaga migracji odwrotnej, nie `git revert`.

## References

- Roadmapa: `context/foundation/roadmap.md` — pozycja **S-08**, kotwica **MS-01**
- Plan testów i rejestr ryzyk: `context/foundation/test-plan.md` — **R-05**
- Kontrakt odpowiedzi API: `context/changes/api-error-contract/plan.md`
- Bramki ludzkie i pułapka `service_role`: `context/deployment/deploy-plan.md`
- Wzorzec kontraktu: `src/lib/api-errors.ts:15`, `src/lib/validation.ts:22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat i polityki RLS

#### Automated

- [x] 1.1 Migracja aplikuje się na czystej bazie: `npx supabase db reset` — 34edbec
- [x] 1.2 Nazwa pliku pasuje do konwencji `YYYYMMDDHHmmss_short_description.sql` — 34edbec
- [x] 1.3 RLS włączony; polityki select/insert/update istnieją, delete nie — 34edbec

#### Manual

- [ ] 1.4 Przegląd polityk — każda ograniczona do wierszy własnych i roli uwierzytelnionej

### Phase 2: Harness testów integracyjnych i test izolacji (R-05)

#### Automated

- [x] 2.1 Testy integracyjne przechodzą: `npm run test:integration`
- [x] 2.2 Testy jednostkowe przechodzą bez Dockera: `npm test`
- [x] 2.3 Lint na nowych plikach przechodzi

#### Manual

- [x] 2.4 Rozszerzenie polityk select i update daje czerwony wynik; po cofnięciu zielony

### Phase 3: Endpoint aktualizacji tytułu

#### Automated

- [ ] 3.1 Testy jednostkowe przechodzą: `npm test`
- [ ] 3.2 Testy integracyjne przechodzą: `npm run test:integration`
- [ ] 3.3 Typy przechodzą: `npx astro check`
- [ ] 3.4 Lint na zmienionych plikach przechodzi
- [ ] 3.5 Handler nie porównuje właściciela w kodzie

#### Manual

- [ ] 3.6 Zmiana własnego tytułu zwraca 200 i zaktualizowany rekord
- [ ] 3.7 Zmiana cudzego tytułu zwraca 404 nieujawniające istnienia rekordu
- [ ] 3.8 Tytuł ponad 80 znaków zwraca 400 z komunikatem przy polu
- [ ] 3.9 Pusty tytuł czyści nazwę zamiast zapisywać pusty tekst

### Phase 4: Minimalna lista historii z edycją tytułu

#### Automated

- [ ] 4.1 Testy przechodzą: `npm test` oraz `npm run test:integration`
- [ ] 4.2 Typy przechodzą: `npx astro check`
- [ ] 4.3 Lint na zmienionych plikach przechodzi
- [ ] 4.4 Żądanie anonimowe do `/generations` zwraca przekierowanie

#### Manual

- [ ] 4.5 Zalogowany widzi wyłącznie własne pozycje
- [ ] 4.6 Nadanie tytułu widoczne od razu i po odświeżeniu
- [ ] 4.7 Zmiana istniejącego tytułu działa
- [ ] 4.8 Wyczyszczenie tytułu przywraca początek tekstu
- [ ] 4.9 Pusta historia pokazuje zrozumiały stan
- [ ] 4.10 Zbyt długi tytuł pokazuje komunikat przy polu

### Phase 5: Aktualizacja test-planu i roadmapy

#### Automated

- [ ] 5.1 R-05 ma w test-planie status pokryte
- [ ] 5.2 Prettier przechodzi na zmienionych dokumentach

#### Manual

- [ ] 5.3 Czytelnik `S-03` rozumie, że tabela już istnieje, bez otwierania tego planu

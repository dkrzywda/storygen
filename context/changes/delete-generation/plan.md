# Usuwanie pozycji z własnej historii — Implementation Plan

## Overview

Dodać politykę RLS `delete`, endpoint `DELETE /api/generations/[id]` i dwustopniowy przycisk w historii, tak aby użytkownik trwale usuwał własną pozycję, a żadne konto nie mogło usunąć cudzej. Realizuje FR-011 (`must-have`) i plaster **S-06** z roadmapy.

## Current State Analysis

**Tabela istnieje i ma włączony RLS**, ale **polityki `delete` celowo nie ma**. To nie przeoczenie — plan `S-08` wymienia to w „What We're NOT Doing" i ma odhaczone kryterium weryfikacji „polityki `delete` nie ma — 34edbec", pod zasadą, że uprawnienie pojawia się razem ze swoją funkcją. Skutek: dziś baza odrzuca **każde** usunięcie.

**Ten brak jest obecnie częścią gwarancji R-05** — jedynego ryzyka oznaczonego w `test-plan.md` jako krytyczne. Plik testu ma przypadek `it("nikt nie usuwa wierszy — polityki delete nie ma")`, a `test-plan.md` pisze wprost: „brak polityki `delete` sprawia, że nikt nie usuwa wierszy". Dodanie polityki **zabiera tę gwarancję** i musi ją zastąpić dowodem izolacji, inaczej plaster osłabia model dostępu, zamiast go rozszerzyć.

**Wzorce, na których to stanie, są gotowe:**

- `src/pages/api/generations/[id].ts` — kontrola UUID przed zapytaniem (identyfikator spoza formatu dawałby 500 zamiast uczciwego 404), reguła „zero wierszy → `NOT_FOUND`", brak porównania właściciela w kodzie
- `src/components/generations/GenerationList.astro` — wspólna lista dla historii, rankingu i ulubionych
- `src/components/generations/RatingControls.tsx` — wyspa z optymistyczną zmianą i cofnięciem
- `src/lib/api-errors.ts` — `API_ERRORS`, `toApiErrorCode`, `logApiError`

**Żaden nowy kod błędu nie jest potrzebny.** `UNAUTHORIZED`, `NOT_FOUND`, `NOT_CONFIGURED` i `INTERNAL` już są w `API_ERRORS`, a reguła „zero wierszy → 404" pokrywa jednocześnie „nie istnieje" i „nie jest Twoje" — celowo, bo rozróżnienie potwierdzałoby istnienie cudzego rekordu. Endpoint nie przyjmuje ciała żądania, więc nie ma czego walidować Zodem.

**Rozbieżność z roadmapą, zapisana świadomie.** Roadmapa oznacza S-06 jako `Ready for /10x-plan: no — Czeka na S-05`, a S-05 jest nadal `proposed`, bo FR-010 („otwiera dowolną w całości") nie jest zrobione. Usuwanie nie zależy jednak od otwierania w całości, tylko od istnienia listy — a lista działa od S-03. Ruszamy przed formalnym domknięciem zależności; to jest decyzja, nie przeoczenie.

## Desired End State

Zalogowany użytkownik na `/generations` widzi przy każdej pozycji akcję usunięcia. Kliknięcie zamienia ją w pytanie o potwierdzenie; potwierdzenie trwale usuwa wiersz i strona pokazuje listę bez tej pozycji. Anulowanie nie robi nic. Konto B nie jest w stanie usunąć wiersza konta A ani przez interfejs, ani wołając endpoint wprost — i ten fakt jest **udowodniony testem integracyjnym**, nie założony. W panelu (ranking, ulubione) akcji usuwania nie ma.

### Key Discoveries:

- Polityka `delete` nie istnieje i jej brak jest zweryfikowanym kryterium `S-08` (`context/archive/2026-09-03-annotate-generation/plan.md:131`)
- Przypadek `src/lib/generations.integration.test.ts:159` twierdzi, że nikt nie usuwa — po tej zmianie zrobi się czerwony
- `context/foundation/test-plan.md:127` opiera część gwarancji R-05 na braku polityki
- **Postgres wymaga polityki `SELECT` także przy `DELETE ... WHERE`** — instrukcja czyta wiersze, zanim je usunie. Zmierzone w tym repo 2026-09-03 dla `UPDATE`; ta sama pułapka dotyczy `DELETE`
- FR-011 to jedno zdanie w PRD, bez historyjki użytkownika, bez wymagań niefunkcjonalnych i **bez słowa o potwierdzaniu, koszu, cofaniu czy retencji** — nic z tego nie wolno domyślić z dokumentów
- Migracja z `S-08` niesie `on delete cascade` na `user_id`, więc usunięcie konta i tak usuwa wiersze — to poziom klucza obcego, nie funkcja produktu

## What We're NOT Doing

- **Miękkiego usuwania** — brak kolumny `deleted_at`, brak kosza, brak cofania po fakcie. Usunięcie jest trwałe (decyzja autora 2026-09-07)
- **Usuwania z rankingu** — ranking jest tablicą wyników do czytania, nie widokiem zarządzania kolekcją. Historia i ulubione akcję dostają (rewizja z 2026-09-07, patrz „Rewizje planu")
- **Usuwania zbiorczego** ani zaznaczania wielu pozycji
- **Modala** jako nowego wzorca w repo — potwierdzenie jest dwustopniowym przyciskiem inline
- **Usuwania konta użytkownika** — inny zakres, inne wymaganie
- **FR-010 (otwieranie pozycji w całości)** — to plaster `S-05`, tu nietykany
- **Wypchnięcia migracji na produkcję** — osobna, ręczna czynność; dwie migracje (`20260903125113`, `20260907125000`) i tak czekają niewypchnięte

## Rewizje planu

**2026-09-07, w trakcie fazy 1 — decyzja nr 3 rozszerzona.** Plan zakładał przycisk
usuwania **tylko w historii**. Autor, patrząc na zakładkę Ulubione, zgłosił brak akcji
usuwania i wybrał zakres **historia i ulubione**; ranking zostaje bez niej. Uzasadnienie:
oba te widoki służą zarządzaniu własną kolekcją, a ranking jest tablicą wyników do
czytania. Zmiana dotyczy kontraktu fazy 3, jej kryterium ręcznego oraz tytułu wiersza 3.7
w `## Progress` — tytuł został zmieniony razem z kryterium, bo w starym brzmieniu
twierdziłby coś nieprawdziwego.

Konsekwencja techniczna jest niewielka, bo flaga `deletable` na wspólnej liście została
zaprojektowana właśnie po to, żeby o obecności tej akcji decydował widok, nie komponent.

## Implementation Approach

Kolejność faz jest wymuszona przez zależności, nie wybrana: bez polityki endpoint zwracałby 404 na własny wiersz użytkownika, a bez endpointu przycisk nie ma czego wołać. Dowód izolacji ląduje w fazie 1, razem z polityką — czyli w tej samej fazie, która narusza dzisiejszą gwarancję R-05, żeby między fazami nie było okna bez dowodu.

Po usunięciu strona się przeładowuje. Lista jest renderowana serwerowo przez Astro, a przycisk jest wyspą Reacta — wyspa nie może zgasić rodzeństwa wyrenderowanego przez Astro bez przeniesienia całego markupu wiersza do Reacta, co byłoby przebudową większą niż sam plaster. Przeładowanie daje przy okazji zgodność numeracji rankingu, która po usunięciu i tak się przesuwa.

## Critical Implementation Details

**Kolejność przypadków w teście integracyjnym.** Kontrola pozytywna („Alice usuwa własny wiersz") niszczy wiersz, na którym stoją pozostałe przypadki z `beforeAll`. Musi więc albo być ostatnim przypadkiem w pliku, albo zakładać własny wiersz. Vitest wykonuje `it` w kolejności deklaracji, więc pierwsze wystarczy — ale wtedy dopisanie czegokolwiek poniżej cicho psuje zestaw. Bezpieczniejszy jest własny wiersz.

**Pułapka Postgresa przy dowodzeniu polityki.** `DELETE ... WHERE` czyta istniejące wiersze, więc musi spełnić także politykę `SELECT`. Skutek praktyczny: rozszerzenie **samej** polityki `delete` do `using (true)` **nie zrobi** zestawu R-05 czerwonym, bo konto B nadal blokuje polityka odczytu. Czerwony wynik pojawia się dopiero przy rozszerzeniu obu. Nie czytaj zielonego zestawu jako dowodu na poprawność polityki `delete` w oderwaniu od `select` — i zapisz to w `test-plan.md`, tak jak zapisano to dla `UPDATE`.

**Uboczny skutek dodania polityki.** Docblock testu integracyjnego notuje dziś, że „brak polityki DELETE znaczy, że wierszy nie da się sprzątnąć po teście" i że kumulację czyści `npx supabase db reset`. Po tej zmianie testy mogą po sobie sprzątać — ta notatka staje się nieprawdziwa i trzeba ją poprawić razem z resztą.

---

## Phase 1: Baza i dowód izolacji

### Overview

Dodać granularną politykę `delete` i zastąpić dzisiejszą gwarancję „nikt nie usuwa" dowodem „nikt nie usuwa cudzego".

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_delete_policy.sql` (nowy; znacznik czasu stemplowany w chwili tworzenia, UTC, zgodnie z konwencją repo)

**Intent**: Pozwolić właścicielowi usunąć własny wiersz i tylko własny. Polityka jest osobna i granularna per operacja oraz per rola — konwencja repo, a polityka `select` z `S-08` tego nie pokrywa.

**Contract**: Jedna polityka, bez zmian w schemacie tabeli. Nazwa idzie za wzorcem `generations_<operacja>_own`:

```sql
create policy generations_delete_own
  on public.generations
  for delete
  to authenticated
  using (auth.uid() = user_id);
```

Komentarz w migracji ma powiedzieć, że to domknięcie świadomej luki z `20260903125113`, i wskazać `S-06` — inaczej czytelnik nie odróżni tej polityki od takiej, która powstała przypadkiem.

#### 2. Test izolacji usuwania

**File**: `src/lib/generations.integration.test.ts`

**Intent**: Zamienić przypadek twierdzący, że nikt nie usuwa, na zestaw dowodzący, że nikt nie usuwa **cudzego**. Bez tego plaster odbiera R-05 gwarancję i nie daje nic w zamian.

**Contract**: Trzy przypadki zamiast jednego. Bob usuwa wiersz Alice → `data` ma zero elementów, `error` jest `null` (RLS odfiltrowuje przed usunięciem, nie rzuca błędem — tak samo jak przy `update`). Alice nadal odczytuje swój wiersz po próbie Boba. Alice usuwa **własny** wiersz założony na potrzeby tego przypadku → dokładnie jeden element w `data`. Docblock modułu traci zdanie o braku polityki `delete` i o niemożności sprzątania po teście.

#### 3. Zapis w planie testów

**File**: `context/foundation/test-plan.md`

**Intent**: R-05 przestaje opierać się na braku polityki. Zapis musi to odzwierciedlać, inaczej dokument twierdzi coś, co przestało być prawdą.

**Contract**: W sekcji „Co jest testowane" zdanie „Dodatkowo: brak polityki `delete` sprawia, że nikt nie usuwa wierszy" ustępuje opisowi izolacji usuwania. Akapit „Czego test nie dowodzi" rozszerza pułapkę Postgresa na `DELETE`. Przy okazji poprawić nieprawdziwą już liczbę w „Jak to uruchomić" — dziś stoi „4 pliki, 68 testów", a zestaw jednostkowy ma 7 plików i 164 testy.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto: `npx supabase migration up --local`
- Polityka istnieje w bazie: zapytanie o `pg_policies` zwraca `generations_delete_own`
- Testy integracyjne przechodzą: `npm run test:integration` (wymaga `npx supabase start`)
- Testy jednostkowe przechodzą: `npm test`
- Prettier przechodzi na zmienionych dokumentach

#### Manual Verification:

- Zestaw R-05 faktycznie robi się **czerwony** po celowym rozszerzeniu polityk `delete` i `select` do `using (true)` — bez tego eksperymentu nie wiadomo, czy nowy przypadek cokolwiek dowodzi
- Zapis w `test-plan.md` czyta się spójnie z tym, co robi kod testu

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie człowieka, że weryfikacja ręczna wypadła pomyślnie.

---

## Phase 2: Endpoint

### Overview

Dodać handler `DELETE` do istniejącej trasy pozycji, dokładnie w konwencji, którą trzyma handler `PATCH`.

### Changes Required:

#### 1. Trasa pozycji

**File**: `src/pages/api/generations/[id].ts`

**Intent**: Usunąć wskazaną pozycję zalogowanego użytkownika. Handler nie sprawdza właściciela w kodzie — robi to polityka RLS, a „zero wierszy" jest jedynym sygnałem, jakiego endpoint potrzebuje.

**Contract**: `export const DELETE: APIRoute`, obok istniejącego `PATCH`, ten sam plik i te same cztery kroki: brak sesji → `UNAUTHORIZED`; identyfikator poza formatem UUID → `NOT_FOUND` (przed zapytaniem, bo baza rzuciłaby błędem składni); brak klienta Supabase → `NOT_CONFIGURED`; `delete().eq("id", id).select()`, a zero zwróconych wierszy → `NOT_FOUND`. Sukces oddaje `jsonOk` z identyfikatorem usuniętej pozycji, żeby interfejs mógł potwierdzić, co zniknęło. Bez ciała żądania i bez schematu Zoda. Błędy bazy przez `toApiErrorCode` i `logApiError` ze scope `api/generations/[id]`.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint na zmienionym pliku przechodzi
- Testy jednostkowe przechodzą: `npm test`

#### Manual Verification:

- Żądanie bez sesji zwraca 401 z komunikatem po polsku
- Identyfikator w złym formacie zwraca 404, nie 500
- Identyfikator nieistniejący oraz identyfikator cudzej pozycji zwracają **ten sam** 404
- Usunięcie własnej pozycji zwraca 200, a wiersz faktycznie zniknął z bazy
- Log przy awarii nie zawiera treści usuwanej generacji

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie człowieka.

---

## Phase 3: Interfejs

### Overview

Dwustopniowy przycisk w historii, niewidoczny w panelu.

### Changes Required:

#### 1. Wyspa usuwania

**File**: `src/components/generations/DeleteButton.tsx` (nowy)

**Intent**: Dać jedno miejsce, w którym usunięcie jest możliwe, i wymusić drugi świadomy klik, bo akcja jest nieodwracalna.

**Contract**: Props `{ id: string }`. Trzy stany: spoczynek (akcja „Usuń"), oczekiwanie na potwierdzenie („Na pewno? Tak / Anuluj"), wysyłanie (akcja zablokowana). Anulowanie wraca do spoczynku i nie woła serwera. Po sukcesie `window.location.reload()` — lista jest serwerowa, więc przeładowanie jest tym, co daje prawdziwy stan. Błąd pokazuje komunikat z odpowiedzi API, nigdy własny tekst techniczny, i wraca do spoczynku, żeby dało się spróbować ponownie.

#### 2. Wspólna lista

**File**: `src/components/generations/GenerationList.astro`

**Intent**: Wpuścić przycisk tylko tam, gdzie widok tego chce. Domyślnie wyłączony, żeby dodanie nowego widoku nie wnosiło nieodwracalnej akcji przez przypadek.

**Contract**: Nowa prop `deletable?: boolean` z domyślną wartością `false`, analogicznie do istniejącej `ranked`. Przycisk renderowany wyłącznie gdy `deletable`.

#### 3. Historia i ulubione

**File**: `src/pages/generations.astro`, `src/pages/dashboard.astro`

**Intent**: Włączyć akcję na dwóch ekranach, które służą zarządzaniu własną kolekcją, i zostawić ranking bez niej.

**Contract**: `generations.astro` przekazuje `deletable` do `GenerationList`. `dashboard.astro` renderuje tę listę dwa razy — flagę dostaje **wyłącznie** gałąź ulubionych, gałąź rankingu nie. Brak flagi przy rankingu jest znaczącym brakiem, nie zapomnieniem, i zasługuje na komentarz w kodzie, żeby nikt go nie „naprawił".

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint na zmienionych i nowych plikach przechodzi
- Testy jednostkowe przechodzą: `npm test`

#### Manual Verification:

- Pierwszy klik pokazuje pytanie o potwierdzenie, nie usuwa
- „Anuluj" wraca do stanu wyjściowego i nie woła serwera
- Potwierdzenie usuwa pozycję i po przeładowaniu nie ma jej na liście
- Ranking nie ma akcji usuwania, a ulubione ją mają
- Awaria żądania pokazuje komunikat po polsku, a pozycja zostaje na liście
- Usunięcie pozycji ocenionej usuwa ją także z rankingu i z ulubionych

---

## Testing Strategy

### Unit Tests:

Brak nowych testów jednostkowych i to jest decyzja, nie luka. Ten plaster nie wnosi ani jednej funkcji czystej: nie ma schematu do walidacji (endpoint nie przyjmuje ciała), nie ma transformacji danych, nie ma logiki biznesowej do pokrycia. Cała gwarancja leży w polityce RLS, a tę mierzy wyłącznie test integracyjny — test jednostkowy nie umie dotknąć bazy. Dopisywanie testu sprawdzającego, że handler wywołał `.delete()`, mierzyłoby atrapę, nie zachowanie.

### Integration Tests:

Zestaw R-05 w `src/lib/generations.integration.test.ts` rozszerzony o trzy przypadki usuwania (patrz faza 1). Wymaga `npx supabase start` i klucza publishable — `service_role` omija RLS, więc test przeszedłby także przy dziurawej polityce.

### Manual Testing Steps:

1. Zaloguj się, wygeneruj tekst, wejdź na `/generations`
2. Kliknij „Usuń" i sprawdź, że pozycja nadal jest, a pojawiło się pytanie
3. Kliknij „Anuluj", potwierdź w narzędziach sieciowych, że nie poszło żadne żądanie
4. Kliknij „Usuń", potwierdź, sprawdź, że po przeładowaniu pozycji nie ma
5. Oceń inną pozycję gwiazdkami i oznacz jako ulubioną, usuń ją, sprawdź panel — zniknęła z rankingu i z ulubionych
6. Wejdź na `/dashboard` i potwierdź brak akcji usuwania w obu zakładkach
7. Zawołaj `DELETE /api/generations/<uuid>` bez sesji i sprawdź 401
8. Zawołaj z sesją na cudzy identyfikator i sprawdź 404

## Performance Considerations

Brak wpływu. Usunięcie to jedno zapytanie po kluczu głównym, indeks `generations_user_id_created_at_idx` nie jest do tego potrzebny. Indeksy częściowe rankingu i ulubionych zmniejszają się razem z tabelą. Przeładowanie strony po usunięciu to jedno dodatkowe żądanie SSR — na liście rzędu dziesiątek pozycji bez znaczenia.

## Migration Notes

Migracja dodaje wyłącznie politykę, nie rusza schematu ani danych — jest więc bezpieczna dla istniejących wierszy.

**Cofanie jest niesymetryczne i trzeba to wiedzieć przed wdrożeniem.** `git revert` na kodzie **nie** zdejmuje polityki z bazy: po cofnięciu kodu baza nadal pozwala usuwać, tylko nie ma czym. Zdjęcie polityki wymaga migracji odwrotnej (`drop policy generations_delete_own on public.generations;`), nie rewertu.

**Produkcja nie ma jeszcze żadnej migracji z tego repo.** Ani `20260903125113`, ani `20260907125000` nie zostały wypchnięte — projekt nie jest zlinkowany z maszyny autora. Ta migracja dołącza do kolejki. Wdrożenie kodu bez nich zwróci błąd na panelu i na historii.

## References

- Roadmap: `context/foundation/roadmap.md` — plaster **S-06**
- PRD: `context/foundation/prd.md` — FR-011
- Zapisany brak polityki: `context/archive/2026-09-03-annotate-generation/plan.md:131`
- Ryzyko R-05 i pułapka Postgresa: `context/foundation/test-plan.md`
- Wzorzec handlera: `src/pages/api/generations/[id].ts` (`PATCH`)
- Wzorzec wyspy: `src/components/generations/RatingControls.tsx`
- Reguły: `context/foundation/lessons.md`

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` zrobione. Przy zamknięciu kroku dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków.

### Phase 1: Baza i dowód izolacji

#### Automated

- [x] 1.1 Migracja stosuje się czysto: `npx supabase migration up --local`
- [x] 1.2 Polityka `generations_delete_own` istnieje w `pg_policies`
- [x] 1.3 Testy integracyjne przechodzą: `npm run test:integration`
- [x] 1.4 Testy jednostkowe przechodzą: `npm test`
- [x] 1.5 Prettier przechodzi na zmienionych dokumentach

#### Manual

- [x] 1.6 Zestaw R-05 robi się czerwony po celowym rozszerzeniu polityk `delete` i `select`
- [x] 1.7 Zapis w `test-plan.md` zgadza się z tym, co robi kod testu

### Phase 2: Endpoint

#### Automated

- [ ] 2.1 Typy przechodzą: `npx astro check`
- [ ] 2.2 Lint na zmienionym pliku przechodzi
- [ ] 2.3 Testy jednostkowe przechodzą: `npm test`

#### Manual

- [ ] 2.4 Żądanie bez sesji zwraca 401 z komunikatem po polsku
- [ ] 2.5 Identyfikator w złym formacie zwraca 404, nie 500
- [ ] 2.6 Nieistniejący i cudzy identyfikator zwracają ten sam 404
- [ ] 2.7 Usunięcie własnej pozycji zwraca 200, a wiersz zniknął z bazy
- [ ] 2.8 Log przy awarii nie zawiera treści usuwanej generacji

### Phase 3: Interfejs

#### Automated

- [ ] 3.1 Typy przechodzą: `npx astro check`
- [ ] 3.2 Lint na zmienionych i nowych plikach przechodzi
- [ ] 3.3 Testy jednostkowe przechodzą: `npm test`

#### Manual

- [ ] 3.4 Pierwszy klik pokazuje pytanie, nie usuwa
- [ ] 3.5 „Anuluj" wraca do stanu wyjściowego i nie woła serwera
- [ ] 3.6 Potwierdzenie usuwa pozycję i po przeładowaniu jej nie ma
- [ ] 3.7 Ranking nie ma akcji usuwania, a ulubione ją mają
- [ ] 3.8 Awaria żądania pokazuje komunikat po polsku, pozycja zostaje
- [ ] 3.9 Usunięcie ocenionej pozycji usuwa ją z rankingu i z ulubionych

# Filtrowanie i szukanie w historii generacji — Implementation Plan

## Overview

Filtry w adresie — format, minimalna ocena, „tylko ulubione" i szukanie po temacie —
łączone przez AND na `/generations`. Pod spodem **jedna** warstwa zapytań, na której
zostają przepisane istniejące `fetchRanking` i `fetchFavourites`, oraz własny odczyt
pozycji dla okna, żeby filtr nie zamieniał istniejącej pozycji w 404.

## Current State Analysis

- **Historia to płaska lista bez żadnego zawężania.** `src/pages/generations.astro:20`
  woła `fetchHistory(supabase)` — `order created_at desc`, bez limitu, bez paginacji.
- **Filtrowanie po formacie i po ulubionych JUŻ ISTNIEJE — dwa razy.**
  `fetchRanking(supabase, format)` i `fetchFavourites(supabase)` w
  `src/lib/generations.ts`, każde z własnym indeksem częściowym
  (`generations_ranking_idx`, `generations_favourites_idx`). Trzecia ścieżka
  filtrowania dałaby trzy implementacje tego samego — dokładnie ta klasa rozjazdu,
  przed którą ostrzega komentarz nagłówkowy `GenerationList.astro`.
- **Lista nie pokazuje `topic`.** `GenerationList.astro` wyświetla tytuł albo
  70-znakowy podgląd treści (`preview()`); `topic` jest w `LIST_COLUMNS`, ale trafia
  tylko do okna pozycji w `generations.astro:70`.
- **Okno pozycji jest szukane w JUŻ POBRANEJ liście** — `generations.astro:36`,
  `items.find(...)`. Identyfikator jest porównywany w JavaScripcie, więc cudzy,
  nieistniejący i **niepoprawny składniowo** dają jednakowo 404. Plan S-05 wymagał
  tej nierozróżnialności wprost.
- **Indeksy `generations` prowadzą po `user_id`**, choć żadne zapytanie nie filtruje
  po nim w kodzie — RLS wstrzykuje ten warunek i planner z niego korzysta. Nowy
  indeks (gdyby był potrzebny) musi mieć ten sam kształt.
- **Brak `pg_trgm` i `unaccent`.** Szukanie po temacie będzie zwykłym `ilike`.
- **Skala jest dziś nieistotna:** największe konto ma 2 generacje. Wydajność nie jest
  problemem tej zmiany; problemem jest poprawność zawężania i to, żeby nie rozsadzić
  panelu przy okazji.

## Desired End State

Na `/generations` stoi pasek filtrów. Wybór formatu, minimalnej oceny i „tylko
ulubione" oraz wpisanie frazy zawężają listę, wszystko jednocześnie, a stan filtrów
siedzi w adresie — da się go odświeżyć, wkleić linkiem i wrócić do niego przyciskiem
Wstecz. Każda pozycja pokazuje temat, po którym się szuka. Gdy filtr nic nie
przepuści, komunikat mówi, co zawęziło wynik, i daje link czyszczący. Otwarcie
pozycji działa niezależnie od filtra, a po zamknięciu okna filtr nadal obowiązuje.

Panel (`/dashboard`) wygląda i działa dokładnie jak dziś, mimo że jego odczyty stoją
już na nowej warstwie.

Weryfikacja: `npm test` (parsowanie parametrów, ucieczka znaków, etykiety filtrów),
`npm run test:integration` (filtr nie omija RLS; odczyt po `id` nie wystawia cudzej
pozycji), oraz ręczne przejście przez kombinacje filtrów.

### Key Discoveries:

- **Filtr oceny scala się z rankingiem, jeśli znaczy „co najmniej N".**
  `minRating: 1` jest równoważne `rating is not null` — czyli warunkowi rankingu —
  bo constraint dopuszcza tylko 1–5. Indeks częściowy `WHERE (rating IS NOT NULL)`
  pozostaje użyteczny, bo `rating >= 1` implikuje jego predykat.
- **Ranking i historia różnią się PORZĄDKIEM, nie tylko filtrem.** Ranking:
  `rating desc, created_at desc`; historia i ulubione: `created_at desc`. Wspólna
  funkcja musi przyjmować porządek jako osobny parametr, inaczej scalenie zepsuje
  ranking (`src/lib/generations.ts`, `fetchRanking`).
- Wzorzec „wartość spoza zbioru schodzi do domyślnej, a nie do błędu" jest już
  zapisany i uzasadniony w `src/pages/dashboard.astro:45-47` — filtry idą tą samą drogą.
- `GenerationList.astro` przyjmuje `emptyTitle`/`emptyHint` jako propsy, więc
  mechanizm stanów pustych zależnych od filtra już istnieje i nie trzeba go budować.
- Zasada z `src/lib/generations.ts`: **żaden odczyt nie filtruje po `user_id`**.
  Roadmapa nazywa nowe odczyty nową okazją do jej złamania — ta zmiana dodaje dwa.

## What We're NOT Doing

- **Paginacji ani wirtualizacji listy.** Przy 2 pozycjach na konto to rozwiązywanie
  problemu, którego nie ma. Wraca, gdy historia urośnie.
- **Szukania odpornego na polskie znaki.** `ilike` nie znajdzie „żółw" po wpisaniu
  „zolw". Przyjęte ograniczenie — patrz Open Risks w briefie.
- **Szukania w treści generacji.** Tylko temat. Treść jest długa, a `ilike` po niej
  dawałby trafienia bez widocznego powodu.
- **Sortowania wybieranego przez użytkownika.** Porządek jest funkcją widoku
  (historia — najnowsze, ranking — najwyżej ocenione), nie osobnym filtrem.
- **Scalania ekranów.** Zakładki panelu zostają tam, gdzie są; scala się tylko
  warstwa zapytań pod nimi.
- **Migracji i nowych indeksów.** Istniejące trzy wystarczają dla tych zapytań przy
  tej skali.

## Implementation Approach

Kolejność: warstwa → powierzchnia → dowód. Faza 1 przepisuje odczyty panelu, więc
stoi osobno — regres w rankingu albo w ulubionych wyjdzie **przed** dodaniem
interfejsu, a nie razem z nim, kiedy nie da się odróżnić przyczyny.

Rozdzielenie na `generation-filters.ts` (funkcje czyste) i `generations.ts` (dostęp do
bazy) jest tym, co czyni parsowanie i ucieczkę znaków testowalnymi bez Dockera — ta
sama linia podziału, którą w `daily-generation-limits` wyznaczyło ustalenie F2.

## Critical Implementation Details

**`ilike` traktuje `%` i `_` jako wieloznaczniki, więc fraza musi przejść przez
ucieczkę.** Bez tego temat wpisany jako `100%_pewne` szuka czegoś innego, niż
użytkownik napisał, a wynik wygląda sensownie — jest tylko nie ten. Postgres używa
domyślnie odwrotnego ukośnika jako znaku ucieczki, więc kolejność podmian ma
znaczenie: najpierw `\`, potem `%` i `_`.

```ts
// Kolejnosc jest istotna: `\` MUSI byc pierwsze, inaczej ucieczka dodana dla `%`
// zostanie sama poddana ucieczce w drugim przebiegu.
value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
```

**Odczyt pozycji po `id` wprowadza pułapkę, której dziś nie ma.** Obecnie
identyfikator jest porównywany w JavaScripcie, więc niepoprawny składniowo po prostu
nie trafia i daje 404. Zapytanie do Postgresa z niepoprawnym uuid **rzuca błędem**
(`invalid input syntax for type uuid`), czyli dałoby 500. Plan S-05 wymagał, żeby
cudzy, nieistniejący i niepoprawny identyfikator były **nierozróżnialne** — bo
rozróżnienie potwierdza istnienie cudzego rekordu. Odczyt musi więc łapać błąd
i schodzić do tego samego 404, a nie propagować go dalej.

**Faza 1 dotyka dwóch dowiezionych ekranów, nie tylko historii.** `fetchRanking`
i `fetchFavourites` są wołane z `src/pages/dashboard.astro`. Przepisanie ich na
wspólną warstwę jest bezpieczne tylko wtedy, gdy porządek zostanie zachowany —
ranking bez `rating desc` przestaje być rankingiem, a nic w typach tego nie złapie.

---

## Phase 1: Warstwa filtrów i zapytań

### Overview

Powstaje moduł funkcji czystych do parsowania filtrów z adresu oraz jedna funkcja
odczytu, na której zostają przepisane wszystkie trzy widoki kolekcji. Nic nie zmienia
się na ekranie.

### Changes Required:

#### 1. Moduł filtrów

**File**: `src/lib/generation-filters.ts` (nowy)

**Intent**: Zamknąć w jednym miejscu wszystko, co da się rozstrzygnąć bez bazy:
odczyt filtrów z parametrów adresu, ucieczkę znaków dla `ilike`, złożenie parametrów
z powrotem w query string (dla linków „Otwórz" i „wyczyść") oraz polskie etykiety
aktywnych filtrów (dla stanu pustego).

**Contract**: Eksportuje typ `GenerationFilters` z polami opcjonalnymi `format`
(`GenerationFormat`), `minRating` (1–5), `favourite` (`true`), `query` (niepusty po
`trim`). Dalej: `parseFilters(params: URLSearchParams): GenerationFilters` —
**wartość spoza zbioru jest pomijana, nie jest błędem**, wzorem
`src/pages/dashboard.astro:45-47`; `escapeLike(value: string): string` — ucieczka
opisana w Critical Implementation Details; `filtersToQuery(filters): string` —
kanoniczny query string bez pustych kluczy; `hasAnyFilter(filters): boolean`;
`filterLabels(filters): string[]` — polskie nazwy aktywnych filtrów do wyliczenia
w komunikacie stanu pustego.

Nazwy parametrów: `format`, `rating`, `fav`, `q`. `q` jest obcinane do 80 znaków —
tyle, ile wynosi górna granica tematu z FR-003, więc dłuższa fraza nie może trafić.

#### 2. Wspólna funkcja odczytu

**File**: `src/lib/generations.ts`

**Intent**: Zastąpić trzy niezależne odczyty jednym, żeby dodanie kolumny albo filtra
nie wymagało pamiętania o trzech miejscach.

**Contract**: Nowa `fetchGenerations(supabase, options)` gdzie `options` to
`{ filters?: GenerationFilters; order?: "newest" | "ranked" }`. `newest` (domyślny)
sortuje po `created_at desc`; `ranked` po `rating desc, created_at desc`.
Filtry składane przez AND: `format` → `.eq`, `minRating` → `.gte`, `favourite` →
`.eq("is_favourite", true)`, `query` → `.ilike("topic", "%" + escapeLike(q) + "%")`.
Kolumny bez zmian — `LIST_COLUMNS`.

`fetchHistory`, `fetchRanking` i `fetchFavourites` **zostają jako eksporty** i stają
się cienkimi wywołaniami nowej funkcji: historia to brak filtrów i `newest`, ranking
to `{ format, minRating: 1 }` i `ranked`, ulubione to `{ favourite: true }` i
`newest`. Zachowanie ma być identyczne — `minRating: 1` jest równoważne
`rating is not null`, bo constraint dopuszcza tylko 1–5.

**Żaden z tych odczytów nie filtruje po `user_id`** i to się nie zmienia. Filtr
w kodzie dałby ten sam wynik dla poprawnej polityki i **zamaskował błędną**.

#### 3. Odczyt pojedynczej pozycji

**File**: `src/lib/generations.ts`

**Intent**: Dać oknu pozycji własne źródło, żeby zawężenie listy nie zamieniało
istniejącej pozycji w 404.

**Contract**: `fetchGenerationById(supabase, id): Promise<Row | null>` — te same
`LIST_COLUMNS`, `.eq("id", id)`, `maybeSingle()`. **Zwraca `null` także przy błędzie
bazy**, w szczególności przy niepoprawnym uuid — patrz Critical Implementation
Details. Bez filtra po `user_id`: cudzą pozycję odcina RLS, nie kod.

#### 4. Testy jednostkowe modułu filtrów

**File**: `src/lib/generation-filters.test.ts` (nowy)

**Intent**: Pokryć to, co w tej zmianie da się sprawdzić bez bazy — i tylko to.

**Contract**: `parseFilters`: pusty `URLSearchParams` daje pusty obiekt; poprawne
wartości wchodzą; `format=cos`, `rating=0`, `rating=6`, `rating=abc`, `fav=0` są
**pomijane bez błędu**; `q` z samych białych znaków jest pomijane; `q` dłuższe niż
80 znaków jest obcinane. `escapeLike`: `%`, `_`, `\` i ich kombinacje, w tym
`\%` (dowód, że kolejność podmian jest właściwa). `filtersToQuery`: pomija puste,
kolejność kluczy stabilna. `filterLabels`: zwraca etykiety tylko dla aktywnych.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Kontrola typów przechodzi: `npx astro check`
- Lint plików dotkniętych w tej fazie przechodzi
- Zestaw integracyjny nadal przechodzi: `npm run test:integration`

#### Manual Verification:

- Panel `/dashboard` — ranking dowcipów i historii ma tę samą kolejność co przed zmianą
- Panel `/dashboard?tab=favourites` pokazuje to samo co przed zmianą
- `/generations` pokazuje pełną historię, bez zmian

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się
i poczekaj na potwierdzenie weryfikacji ręcznej przed przejściem do następnej fazy.

---

## Phase 2: Powierzchnia — pasek filtrów, temat, okno i stany puste

### Overview

Filtry stają się widoczne i klikalne, lista pokazuje temat, okno pozycji dostaje
własny odczyt, a stan pusty mówi, co zawęziło wynik.

### Changes Required:

#### 1. Pasek filtrów

**File**: `src/components/generations/FilterBar.astro` (nowy)

**Intent**: Dać jedno miejsce na kontrolki filtrów, żeby `generations.astro` nie
puchło o kilkadziesiąt linii markupu.

**Contract**: Przyjmuje `filters: GenerationFilters`. Renderuje formularz `method="get"`
na `/generations` — bez JavaScriptu, więc filtry działają także bez wysp: `select`
formatu (wszystkie / dowcip / historia), `select` minimalnej oceny (dowolna / 1+…5+),
`checkbox` „tylko ulubione", pole tekstowe frazy z `maxlength="80"` i przycisk
zatwierdzenia. Aktywne filtry są zaznaczone w kontrolkach wartościami z `filters`.
Obok — link „Wyczyść filtry" na goły `/generations`, widoczny tylko gdy
`hasAnyFilter`.

Klasy z warstwy tokenów (`border-hairline`, `bg-panel`, `text-ink-*`, `brand`) —
bez nowych kolorów.

#### 2. Temat na liście

**File**: `src/components/generations/GenerationList.astro`

**Intent**: Pokazać to, po czym użytkownik szuka. Dziś temat jest niewidoczny, więc
wynik szukania po temacie się nie tłumaczy.

**Contract**: `Item` zyskuje `topic: string`; temat wchodzi do linii metadanych obok
formatu i daty (`Temat: …`), wzorem okna pozycji w `generations.astro:70`. Komponent
zyskuje też opcjonalny `query?: string` — kanoniczny query string bieżącego widoku —
dopisywany do linku „Otwórz", żeby zamknięcie okna wracało do tych samych filtrów.
Brak `query` (panel) zachowuje dzisiejsze zachowanie.

#### 3. Historia z filtrami

**File**: `src/pages/generations.astro`

**Intent**: Wpiąć parsowanie filtrów, pasek, odczyt pozycji dla okna i stany puste.

**Contract**: `parseFilters(Astro.url.searchParams)` → `fetchGenerations` z tymi
filtrami. Okno: **`fetchGenerationById`, nie `items.find`** — pozycja spoza filtra
nadal się otwiera. `notFound` (a więc i `Astro.response.status = 404`) zostaje, gdy
odczyt zwróci `null`; nierozróżnialność cudzego, nieistniejącego i niepoprawnego
identyfikatora jest zachowana. Link „Zamknij" i „Wróć do historii" prowadzą do
bieżących filtrów, nie na goły `/generations`.

Stany puste: gdy `hasAnyFilter` — tytuł mówi, że nic nie pasuje do filtrów,
a podpowiedź wylicza aktywne z `filterLabels` i wskazuje „Wyczyść filtry"; gdy brak
filtrów — dzisiejsze teksty bez zmian. To jest różnica między „nie masz generacji"
a „nie masz TAKICH generacji", i przy dwudziestu pozycjach pierwsze zdanie jest
po prostu nieprawdą.

### Success Criteria:

#### Automated Verification:

- Kontrola typów przechodzi: `npx astro check`
- Testy jednostkowe przechodzą: `npm test`
- Lint plików dotkniętych w tej fazie przechodzi

#### Manual Verification:

- Każdy filtr osobno zawęża listę, a wszystkie razem działają jednocześnie
- Filtry zostają w adresie: odświeżenie, Wstecz i wklejony link odtwarzają ten sam widok
- Otwarcie pozycji przy aktywnym filtrze działa, a zamknięcie okna wraca do filtrów
- Pozycja spoza aktywnego filtra otwiera się z linku `?open=` zamiast dawać 404
- Niepoprawny identyfikator w `?open=` daje 404, nie 500
- Filtr bez trafień pokazuje komunikat wyliczający aktywne filtry i link czyszczący
- Temat widoczny przy każdej pozycji, także w panelu
- Pasek filtrów działa po wyłączeniu JavaScriptu

**Implementation Note**: Zatrzymaj się po weryfikacji automatycznej i poczekaj
na potwierdzenie.

---

## Phase 3: Testy integracyjne — filtry a izolacja kont

### Overview

Dowód, że dwa nowe odczyty nie osłabiły R-05 — jedynego ryzyka oznaczonego
w rejestrze jako krytyczne.

### Changes Required:

#### 1. Przypadki filtrów i odczytu po id

**File**: `src/lib/generations.integration.test.ts`

**Intent**: Sprawdzić to, czego test jednostkowy dotknąć nie może: że zawężenie
zapytania nie stało się drogą do cudzych danych.

**Contract**: Rozszerzenie istniejącego zestawu R-05 — strażnik (klucz anon,
lokalny host) jest już na miejscu i zostaje bez zmian. Nowe przypadki: Bob
z **każdym** filtrem osobno (format, `minRating`, ulubione, fraza) i ze wszystkimi
razem nadal widzi zero wierszy Alicji; Alice z filtrem, który jej wiersz spełnia,
widzi go — kontrola pozytywna, bez której zielony wynik mógłby znaczyć „filtr nie
przepuszcza nikogo"; `fetchGenerationById` na identyfikatorze Alicji wywołane przez
Boba zwraca `null`; ten sam odczyt z niepoprawnym uuid zwraca `null`, a nie rzuca.

Fraza w teście musi zawierać `%` albo `_`, żeby przy okazji potwierdzić, że ucieczka
działa na prawdziwym zapytaniu, nie tylko w teście jednostkowym.

### Success Criteria:

#### Automated Verification:

- Zestaw integracyjny przechodzi: `npm run test:integration`
- Szybki zestaw pozostaje wolny od Dockera: `npm test`
- Kontrola typów przechodzi: `npx astro check`
- Lint plików dotkniętych w tej fazie przechodzi

#### Manual Verification:

- Eksperyment odwrotny: rozszerzenie polityki SELECT `generations` do `using (true)`
  robi nowe przypadki czerwonymi — bez tego zielony wynik nic nie dowodzi

**Implementation Note**: Zatrzymaj się po weryfikacji automatycznej i poczekaj
na potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- `parseFilters`: wartości poprawne, spoza zbioru, puste, za długie
- `escapeLike`: `%`, `_`, `\` i kombinacje, w tym `\%`
- `filtersToQuery` i `filterLabels`: pomijanie pustych, stabilna kolejność

### Integration Tests:

- Bob z każdym filtrem osobno i ze wszystkimi razem nie widzi wierszy Alicji
- Alice z pasującym filtrem widzi własny wiersz (kontrola pozytywna)
- `fetchGenerationById` nie wystawia cudzej pozycji ani nie rzuca na niepoprawnym uuid
- Fraza z `%` w prawdziwym zapytaniu

### Manual Testing Steps:

1. Panel — ranking i ulubione wyglądają jak przed zmianą (regres z fazy 1)
2. Każdy filtr osobno, potem wszystkie razem
3. Odświeżenie, Wstecz i wklejony link z filtrami
4. Otwarcie pozycji spoza filtra z linku `?open=`
5. `?open=nie-jest-uuidem` — oczekiwane 404
6. Filtr bez trafień — komunikat i link czyszczący
7. Pasek filtrów z wyłączonym JavaScriptem

## Performance Considerations

Największe konto ma dziś 2 generacje, więc `ilike` bez indeksu jest bez znaczenia.
Istniejące indeksy obsługują pozostałe filtry: `generations_user_id_created_at_idx`
dla historii, `generations_ranking_idx` dla rankingu (nadal użyteczny, bo
`rating >= 1` implikuje `rating is not null`), `generations_favourites_idx` dla
ulubionych. Przy wielokrotnie większej historii pierwszą właściwą odpowiedzią jest
paginacja, nie indeks na `topic` — bo koszt siedzi w hydracji dwóch wysp Reacta na
pozycję (`GenerationList.astro`), nie w zapytaniu.

## Migration Notes

Brak migracji i brak zmian w schemacie. Cofnięcie jest symetryczne: kod wraca, dane
zostają nietknięte.

## References

- Identyfikacja zmiany i kontekst wyboru: `context/changes/history-filters/change.md`
- Wzorzec „parametry adresu, wartość spoza zbioru schodzi do domyślnej":
  `src/pages/dashboard.astro:38-49`
- Zasada „żaden odczyt nie filtruje po `user_id`": `src/lib/generations.ts` (nagłówek)
- Wzorzec testu RLS pod kluczem anon: `src/lib/generations.integration.test.ts`
- Nierozróżnialność 404: `context/archive/2026-09-07-browse-generation-history/plan.md`

## Progress

> Konwencja: `- [ ]` do zrobienia, `- [x]` zrobione. Po wykonaniu kroku dopisz ` — <commit sha>`.
> Nie zmieniaj tytułów kroków.

### Phase 1: Warstwa filtrów i zapytań

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `npm test`
- [x] 1.2 Kontrola typów przechodzi: `npx astro check`
- [x] 1.3 Lint plików dotkniętych w tej fazie przechodzi
- [x] 1.4 Zestaw integracyjny nadal przechodzi: `npm run test:integration`

#### Manual

- [x] 1.5 Ranking dowcipów i historii ma tę samą kolejność co przed zmianą
- [x] 1.6 Zakładka ulubionych pokazuje to samo co przed zmianą
- [x] 1.7 `/generations` pokazuje pełną historię, bez zmian

### Phase 2: Powierzchnia — pasek filtrów, temat, okno i stany puste

#### Automated

- [ ] 2.1 Kontrola typów przechodzi: `npx astro check`
- [ ] 2.2 Testy jednostkowe przechodzą: `npm test`
- [ ] 2.3 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [ ] 2.4 Każdy filtr osobno zawęża listę, a wszystkie razem działają jednocześnie
- [ ] 2.5 Filtry zostają w adresie: odświeżenie, Wstecz i wklejony link
- [ ] 2.6 Otwarcie pozycji przy filtrze działa, a zamknięcie wraca do filtrów
- [ ] 2.7 Pozycja spoza filtra otwiera się z linku `?open=` zamiast dawać 404
- [ ] 2.8 Niepoprawny identyfikator w `?open=` daje 404, nie 500
- [ ] 2.9 Filtr bez trafień wylicza aktywne filtry i daje link czyszczący
- [ ] 2.10 Temat widoczny przy każdej pozycji, także w panelu
- [ ] 2.11 Pasek filtrów działa po wyłączeniu JavaScriptu

### Phase 3: Testy integracyjne — filtry a izolacja kont

#### Automated

- [ ] 3.1 Zestaw integracyjny przechodzi: `npm run test:integration`
- [ ] 3.2 Szybki zestaw pozostaje wolny od Dockera: `npm test`
- [ ] 3.3 Kontrola typów przechodzi: `npx astro check`
- [ ] 3.4 Lint plików dotkniętych w tej fazie przechodzi

#### Manual

- [ ] 3.5 Rozszerzenie polityki SELECT do `using (true)` robi nowe przypadki czerwonymi

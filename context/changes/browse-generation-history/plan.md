# Otwieranie pozycji historii w całości — Implementation Plan

## Overview

Dać użytkownikowi pełną treść zapisanej generacji — z tematem, metadanymi i kompletem akcji — w serwerowym oknie pod `/generations?open=<id>`, bez nowego odczytu z bazy. Cudza i nieistniejąca pozycja dają okno z komunikatem i status 404. Realizuje FR-010 (`must-have`) i plaster **S-05** z roadmapy; sortowanie i paginacja świadomie poza zakresem.

## Current State Analysis

**Lista istnieje od S-08 i pokazuje wyłącznie podgląd.** `GenerationList.astro` ucina treść do 70 znaków (`preview()`), a `TitleEditor` pokazuje tytuł albo ten podgląd. Nie ma dokąd wejść: żadna trasa nie renderuje jednej pozycji, żaden dokument nigdy nie proponował `/generations/[id]` jako strony — każde `[id]` w repo to trasa API (`PATCH`, `DELETE`).

**Lista już ma pełną treść każdej pozycji.** `fetchHistory` czyta `LIST_COLUMNS` z `content` w całości — podgląd jest ucinany dopiero w komponencie. To rozstrzyga architekturę: okno może wziąć treść z tego samego wyniku, więc **nie powstaje drugi punkt odczytu**. Ryzyko właściwe temu plastrowi z roadmapy („każdy nowy odczyt to nowa okazja do obejścia RLS filtrem w kodzie") nie jest mitygowane — po prostu nie zachodzi.

**Czego lista nie czyta:** kolumny `topic`. Temat wpisany przez użytkownika nie jest dziś pokazywany nigdzie w produkcie, choć jest zapisany. Okno jest naturalnym miejscem, żeby go pokazać — kosztem jednej kolumny w `LIST_COLUMNS`, w tym samym zapytaniu.

**Wzorce gotowe do użycia:**

- zakładki panelu przez parametry adresu (`dashboard.astro`) — ten sam mechanizm dla `?open=`
- `PROTECTED_ROUTES` dopasowuje `/generations` po prefiksie, więc `/generations?open=…` jest chronione bez zmian w middleware
- wyspy `TitleEditor`, `RatingControls`, `DeleteButton` — gotowe do osadzenia w oknie
- `readApiError` (S-06, F1) — jeden sposób czytania błędów we wszystkich wyspach
- `countWords` w `format-contract.ts`, `API_ERRORS.NOT_FOUND.message` w `api-errors.ts`

**Czego w repo nie ma:** żadnego modala ani okna dialogowego. To będzie pierwszy — dlatego mechanizm jest najprostszy z możliwych: natywny `<dialog>` renderowany serwerowo, podnoszony jednym skryptem do `showModal()`.

**Kopiowanie żyje w jednym miejscu, źle.** FR-008 jest zrealizowane jako 12 linii wewnątrz `GenerateForm.tsx` (`copyResult`, stan `copied`, `Check`/`Copy`). Okno potrzebuje tego samego zachowania, a dwie kopie rozjechałyby się przy pierwszej zmianie — ten sam argument, który w S-06 dał `readApiError`.

**`DeleteButton` po sukcesie robi `window.location.reload()`.** W oknie otwartym pod `?open=<id>` przeładowanie odpytałoby o pozycję, której już nie ma, i pokazało 404 zamiast listy. Przycisk potrzebuje jawnego celu po usunięciu.

## Desired End State

Na `/generations` każda karta ma link „Otwórz". Kliknięcie prowadzi na `/generations?open=<id>`: lista renderuje się z otwartym oknem zawierającym tytuł (albo temat), pełną treść z zachowanymi akapitami, temat, format, datę i liczbę słów, oraz komplet akcji — edycję tytułu, gwiazdki, ulubione, usuwanie i kopiowanie. Escape albo link zamknięcia wraca na `/generations` ze świeżą listą, więc ocena wystawiona w oknie jest od razu widoczna na karcie. Usunięcie z okna ląduje na `/generations` bez usuniętej pozycji. Adres z cudzym, nieistniejącym albo niepoprawnym identyfikatorem daje to samo okno z „Nie znaleziono takiej pozycji" i odpowiedź HTTP 404. Anonim na `/generations?open=…` jest przekierowany na logowanie. `src/lib/generations.ts` nie ma nowego zapytania.

### Key Discoveries:

- `GenerationList.astro` — `preview()` ucina do 70 znaków, ale `Item.content` niesie całość; okno nie potrzebuje nowego odczytu
- `src/lib/generations.ts` — `LIST_COLUMNS` nie zawiera `topic`; temat nie jest pokazywany nigdzie w produkcie
- `src/middleware.ts:5` — prefiks `/generations` obejmuje adres z parametrem bez żadnej zmiany
- `src/pages/api/generations/[id].ts` — kontrakt „cudze i nieistniejące dają ten sam `NOT_FOUND`", do odtworzenia w oknie
- `GenerateForm.tsx` — kopiowanie jako `copyResult()` + `copied` + `Check`/`Copy`, do wyciągnięcia
- `DeleteButton.tsx` — `window.location.reload()` po sukcesie; w oknie musi być nawigacja na `/generations`
- `context/archive/2026-09-07-delete-generation/plan-brief.md` — „gdyby usuwanie miało być dostępne dopiero z widoku pełnej treści, ta decyzja jest do odwrócenia"; decyzja autora 2026-09-07: usuwanie także w oknie
- FR-010 w PRD to jedno zdanie bez historyjki i kryteriów; „w całości" nie było nigdy zdefiniowane — definicja poniżej jest pierwsza

## What We're NOT Doing

- **Sortowania i paginacji** — roadmapa mówi „jeśli okażą się potrzebne"; przy kilku pozycjach nie są, a filtry historii autor odrzucił w tej serii (decyzja 2026-09-07). Osobny plaster, gdy dane to uzasadnią
- **Osobnej strony `/generations/[id]`** — autor wybrał okno modalne; adres pozycji istnieje mimo to (`?open=`)
- **Modala klienckiego** (wyspa Reacta z własnym focus-trapem) — natywny `<dialog>` daje focus-trap, Escape i tło za darmo
- **Nowego odczytu z bazy** — okno bierze pozycję z wyniku, który lista już ma
- **Zamykania okna kliknięciem w tło** — natywny `<dialog>` tego nie robi i nie dodajemy tego ręcznie; Escape i link wystarczą
- **Animacji otwarcia i zamknięcia** — otwarcie i zamknięcie to nawigacje
- **Edycji treści, regeneracji, eksportu** — Non-Goals PRD
- **Zmian w `TitleEditor`, `RatingControls`** — osadzane bez modyfikacji

## Implementation Approach

Dwie fazy, bo klocki z fazy 1 mają sens testowany osobno, zanim powstanie okno: kopiowanie w generatorze musi dalej działać po wyciągnięciu, a `afterDelete` nie może zmienić dzisiejszego zachowania na liście.

Okno jest **serwerowe**: `generations.astro` czyta `?open=`, szuka pozycji w już pobranej liście i renderuje `<dialog open>` z osadzonymi wyspami. Zamknięcie to nawigacja na `/generations`, więc lista pod spodem jest zawsze świeża — nie ma rozjazdu stanu między gwiazdkami w oknie a gwiazdkami na karcie, który dotknąłby każdego wariantu klienckiego. Ceną są nawigacje zamiast animacji; autor ją przyjął.

Odmowa jest **jedną ścieżką** dla trzech przypadków — cudzy, nieistniejący, niepoprawny identyfikator — bo wszystkie sprowadzają się do „nie ma w mojej liście". Nie ma czego walidować regexem: nic nie idzie do bazy. Status 404 jest ustawiany na odpowiedzi strony, a treść okna bierze komunikat z `API_ERRORS.NOT_FOUND`, tego samego, który oddaje API.

## Critical Implementation Details

**Kolejność w skrypcie podnoszącym `<dialog>`.** Element jest renderowany z atrybutem `open`, żeby działał bez JS. Podniesienie do trybu modalnego wymaga `dialog.close()` i zaraz potem `dialog.showModal()` — a `close()` **emituje zdarzenie `close`**. Jeśli nasłuch na `close` (który ma nawigować na `/generations`) zostanie podpięty **przed** podniesieniem, okno zamknie się i strona odpłynie w chwili załadowania. Nasłuch podpina się po `showModal()`. To jedyny fragment, który zasługuje na komentarz w kodzie proporcjonalny do jego długości.

**Skrypt jest inline i pod bramką.** Jeśli `showModal` nie istnieje (stara przeglądarka), okno zostaje w trybie `open` — widoczne, bez focus-trapu, z działającym linkiem zamknięcia. Degradacja, nie awaria.

**404 z widoczną listą.** `Astro.response.status = 404` na stronie, która renderuje też listę, jest nietypowe, ale zamierzone: odmowa z NFR ma być widoczna użytkownikowi i uczciwa w logach. Nie przekierowujemy, nie oddajemy 200.

---

## Phase 1: Klocki

### Overview

Wyciągnąć kopiowanie do wyspy i dać `DeleteButton` jawny cel po usunięciu — obie zmiany weryfikowalne na istniejących ekranach.

### Changes Required:

#### 1. Wyspa kopiowania

**File**: `src/components/generations/CopyButton.tsx` (nowy)

**Intent**: Jedno zachowanie kopiowania w produkcie. FR-008 ma dziś implementację zaszytą w formularzu generatora; okno potrzebuje tej samej, a dwie kopie rozjechałyby się przy pierwszej zmianie.

**Contract**: Props `{ text: string }`. Zachowanie identyczne z dzisiejszym `copyResult()` w `GenerateForm`: `navigator.clipboard.writeText`, stan „Skopiowano" z ikoną `Check` przez 2 s, potem powrót do „Kopiuj" z ikoną `Copy`. Awaria schowka pokazuje komunikat po polsku zamiast milczeć — dziś `copyResult` nie ma `catch`.

#### 2. Generator na wspólnej wyspie

**File**: `src/components/generate/GenerateForm.tsx`

**Intent**: Usunąć lokalną implementację kopiowania na rzecz `CopyButton`, żeby w repo została jedna.

**Contract**: Znikają `copyResult`, stan `copied` i jego `setTimeout`; w miejscu przycisku pojawia się `<CopyButton text={result.text} />`. Import `Check`/`Copy` z `lucide-react` zostaje tylko, jeśli coś innego go używa. Zachowanie widoczne dla użytkownika nie zmienia się.

#### 3. Cel po usunięciu

**File**: `src/components/generations/DeleteButton.tsx`

**Intent**: Pozwolić wywołującemu powiedzieć, gdzie iść po sukcesie. W oknie przeładowanie odpytałoby o pozycję, której już nie ma.

**Contract**: Nowa prop `afterDelete?: string`. Gdy podana — `window.location.assign(afterDelete)` po sukcesie; gdy nie — dotychczasowe `reload()`. Stan `deleted` i jego uzasadnienie zostają bez zmian. Lista nie przekazuje prop, więc jej zachowanie jest identyczne.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint na zmienionych i nowych plikach przechodzi
- Testy jednostkowe przechodzą: `npm test`
- Jedna implementacja kopiowania: `grep -rn "navigator.clipboard" src/` zwraca wyłącznie `CopyButton.tsx`

#### Manual Verification:

- Kopiowanie w generatorze działa jak dotąd: „Kopiuj" → „Skopiowano" na 2 s → „Kopiuj", tekst w schowku
- Usuwanie z historii działa jak dotąd — strona przeładowuje się, pozycji nie ma

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie człowieka.

---

## Phase 2: Okno i wejście

### Overview

Serwerowe okno pod `?open=<id>` z pełną treścią, metadanymi i akcjami; ścieżka 404; link „Otwórz" na kartach.

### Changes Required:

#### 1. Temat w kolumnach listy

**File**: `src/lib/generations.ts`

**Intent**: Okno pokazuje temat, którego lista dotąd nie czytała. To jedyna zmiana w tym module — jedna kolumna w tym samym zapytaniu, żaden nowy odczyt.

**Contract**: `LIST_COLUMNS` dostaje `topic`. Nic więcej: brak nowej funkcji, brak filtra, brak zmiany kolejności.

#### 2. Okno pozycji

**File**: `src/pages/generations.astro`

**Intent**: Gdy adres ma `?open=<id>`, wyrenderować pozycję w całości nad listą; gdy pozycji nie ma w liście — to samo okno z odmową i statusem 404.

**Contract**: Parametr `open` z `Astro.url.searchParams`. Pozycja szukana w wyniku `fetchHistory` po `id` — **bez zapytania do bazy i bez porównania właściciela w kodzie**; brak trafienia obejmuje cudze, nieistniejące i niepoprawne identyfikatory jednakowo. Trafienie: `<dialog open>` z nagłówkiem (tytuł albo temat), pełną treścią z `whitespace-pre-wrap`, linią metadanych (temat, format po polsku, data w `pl-PL`, liczba słów z `countWords`), wierszem akcji (`TitleEditor`, `RatingControls`, `DeleteButton` z `afterDelete="/generations"`, `CopyButton`) i linkiem zamknięcia na `/generations` z `autofocus`. Brak trafienia: `Astro.response.status = 404`, okno z `API_ERRORS.NOT_FOUND.message` i tym samym linkiem zamknięcia. Lista renderuje się pod spodem w obu przypadkach. Skrypt inline: jeśli `showModal` istnieje — `close()`, `showModal()`, **a dopiero potem** nasłuch `close` nawigujący na `/generations` (patrz Critical Implementation Details).

#### 3. Wejście z karty

**File**: `src/components/generations/GenerationList.astro`

**Intent**: Dać każdej karcie jawną drogę do pełnej treści, na wszystkich widokach korzystających z listy.

**Contract**: Link „Otwórz" na `/generations?open=<id>` w stopce karty, obok daty, przed przyciskiem usuwania, gdy ten jest. Bez flagi — link jest nieszkodliwy wszędzie i daje panelowi (ranking, ulubione) drogę do pełnej treści, której dziś nie ma.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Testy jednostkowe przechodzą: `npm test`
- Testy integracyjne przechodzą bez zmian: `npm run test:integration` (9/9)
- Brak nowego odczytu: `git diff --stat` na `src/lib/generations.ts` pokazuje zmianę w jednej linii (`LIST_COLUMNS`)
- Anonim na `/generations?open=00000000-0000-4000-8000-000000000000` dostaje 302 na `/auth/signin`

#### Manual Verification:

- `/generations?open=<własny id>` pokazuje okno z pełną treścią, tematem, formatem, datą i liczbą słów
- Treść historii zachowuje akapity
- Escape zamyka okno i wraca na `/generations`; link zamknięcia robi to samo
- Focus po otwarciu jest w oknie, Tab nie ucieka do listy pod spodem
- Ocena wystawiona w oknie jest widoczna na karcie po zamknięciu
- Zmiana tytułu w oknie jest widoczna na karcie po zamknięciu
- Kopiowanie z okna działa
- Usunięcie z okna ląduje na `/generations` bez tej pozycji i bez okna 404
- `?open=<cudzy id>` i `?open=nie-uuid` dają to samo okno „Nie znaleziono takiej pozycji" i status 404 w narzędziach sieciowych
- Link „Otwórz" jest na kartach w historii, w rankingu i w ulubionych, i prowadzi do właściwej pozycji

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie człowieka.

---

## Testing Strategy

### Unit Tests:

Brak nowych i to jest decyzja. Jedyna „logika" to `items.find` po identyfikatorze — test sprawdzałby standardową bibliotekę. `CopyButton` opiera się na `navigator.clipboard` i DOM, których zestaw jednostkowy nie ma; jego zachowanie jest kryterium ręcznym w obu fazach.

### Integration Tests:

Bez zmian. Zestaw R-05 dowodzi izolacji przy odczycie na warstwie danych, a ten plaster nie dodaje odczytu — kryterium automatyczne fazy 2 pilnuje, żeby tak zostało.

### Manual Testing Steps:

1. Otwórz `/generate`, wygeneruj tekst, skopiuj — sprawdź schowek i przejście „Skopiowano" → „Kopiuj" (faza 1)
2. Wejdź na `/generations`, usuń pozycję testową — strona przeładowana, pozycji brak (faza 1)
3. Kliknij „Otwórz" przy pozycji z historią (format `story`) — pełna treść z akapitami, metadane, akcje
4. Naciśnij Escape — jesteś na `/generations` bez okna
5. Otwórz ponownie, oceń na 4 gwiazdki, zmień tytuł, zamknij linkiem — karta pokazuje 4 gwiazdki i nowy tytuł
6. Otwórz, skopiuj — schowek ma pełną treść
7. Otwórz, usuń, potwierdź — jesteś na `/generations`, pozycji nie ma, okna 404 nie ma
8. Wpisz `/generations?open=nie-uuid` — okno „Nie znaleziono takiej pozycji", status 404 w narzędziach sieciowych
9. Weź id z `pg_policies`-owego konta testowego i wpisz `/generations?open=<ten id>` — identyczne okno i status
10. Wejdź na `/dashboard?tab=favourites` i `?tab=ranking` — „Otwórz" jest i prowadzi na `/generations?open=<id>`

## Performance Considerations

Brak wpływu. Okno korzysta z wyniku, który lista już ma; jedna kolumna więcej (`topic`, ≤80 znaków) w tym samym zapytaniu. Otwarcie i zamknięcie to po jednym żądaniu SSR, jak każda nawigacja w aplikacji.

## Migration Notes

Brak migracji — żadnej zmiany schematu ani danych. Cofnięcie to `git revert`, symetryczne. Kolejka niewypchniętych migracji na produkcję (`20260903125113`, `20260907125000`, `20260907135721`) pozostaje bez zmian i bez związku z tym plastrem.

## References

- Roadmap: `context/foundation/roadmap.md` — plaster **S-05**, zakres zwężony przez S-08
- PRD: `context/foundation/prd.md` — FR-010, FR-008, NFR o izolacji
- Zwężenie zakresu: `context/archive/2026-09-03-annotate-generation/plan.md:76`
- Decyzja do odwrócenia o usuwaniu z widoku pełnej treści: `context/archive/2026-09-07-delete-generation/plan-brief.md`
- Wzorzec zakładek przez parametry: `src/pages/dashboard.astro`
- Wzorzec kontraktu „cudze = nieistniejące": `src/pages/api/generations/[id].ts`
- Reguły: `context/foundation/lessons.md`

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` zrobione. Przy zamknięciu kroku dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków.

### Phase 1: Klocki

#### Automated

- [x] 1.1 Typy przechodzą: `npx astro check`
- [x] 1.2 Lint na zmienionych i nowych plikach przechodzi
- [x] 1.3 Testy jednostkowe przechodzą: `npm test`
- [x] 1.4 Jedna implementacja kopiowania: `grep "navigator.clipboard"` zwraca wyłącznie `CopyButton.tsx`

#### Manual

- [x] 1.5 Kopiowanie w generatorze działa jak dotąd
- [x] 1.6 Usuwanie z historii działa jak dotąd

### Phase 2: Okno i wejście

#### Automated

- [ ] 2.1 Typy przechodzą: `npx astro check`
- [ ] 2.2 Lint na zmienionych plikach przechodzi
- [ ] 2.3 Testy jednostkowe przechodzą: `npm test`
- [ ] 2.4 Testy integracyjne przechodzą bez zmian: `npm run test:integration`
- [ ] 2.5 Brak nowego odczytu: `generations.ts` zmieniony w jednej linii
- [ ] 2.6 Anonim na `/generations?open=…` dostaje 302

#### Manual

- [ ] 2.7 Okno pokazuje pełną treść, temat, format, datę i liczbę słów
- [ ] 2.8 Treść historii zachowuje akapity
- [ ] 2.9 Escape i link zamknięcia wracają na `/generations`
- [ ] 2.10 Focus po otwarciu jest w oknie, Tab nie ucieka do listy
- [ ] 2.11 Ocena i tytuł zmienione w oknie są widoczne na karcie po zamknięciu
- [ ] 2.12 Kopiowanie z okna działa
- [ ] 2.13 Usunięcie z okna ląduje na `/generations` bez pozycji i bez okna 404
- [ ] 2.14 Cudzy i niepoprawny identyfikator dają to samo okno i status 404
- [ ] 2.15 „Otwórz" jest na kartach w historii, rankingu i ulubionych

<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Otwieranie pozycji historii w całości (S-05)

- **Plan**: `context/changes/browse-generation-history/plan.md`
- **Scope**: pełny plan — fazy 1–2 (21/21 pozycji Progress odhaczonych, wszystkie z SHA)
- **Date**: 2026-09-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 7 observations
- **Commits**: `fdb164f` (p1), `6e3ab05` (p2), `e409ca9` (epilog)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Wszystkie 6 planowanych zmian i wszystkie 10 sprawdzanych zobowiązań kontraktu: **MATCH**. Zero braków, zero naruszeń „What We're NOT Doing". Verdykt `NEEDS ATTENTION` wynika z dwóch rzeczywistych ostrzeżeń, nie z niczego strukturalnego.

## Findings

### F1 — Komunikat o nieudanym kopiowaniu gaśnie po 2 sekundach

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/CopyButton.tsx:46-51,64-68
- **Detail**: Timer resetujący do `"idle"` po 2 s jest uruchamiany dla **obu** wyników — także dla `"failed"`. Komunikat „Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie." to **instrukcja do wykonania**, a nie potwierdzenie, i znika, zanim da się ją przeczytać i zastosować. Rodzeństwo robi to inaczej: `DeleteButton.tsx:103-107` i `RatingControls.tsx:111` trzymają błąd do następnej akcji użytkownika. To jedyna cicha rozbieżność wobec najbliższego wzorca w całym plastrze — reszta odejść (zdjęty `autofocus`, `removeAttribute`) jest zapisana wprost w planie i w kodzie.
- **Fix**: Uruchamiać timer resetujący **tylko przy sukcesie**; stan `"failed"` czyścić dopiero przy następnym kliknięciu.
- **Decision**: FIXED — timer resetujący uruchamiany wyłącznie przy sukcesie; stan `"failed"` czyszczony na początku następnego kliknięcia, więc komunikat-instrukcja zostaje na ekranie, dopóki użytkownik czegoś nie zrobi. Zgodne z `DeleteButton`/`RatingControls`.

### F2 — Zduplikowane `formatLabel`, `FORMAT_LABEL` i `dateFormat`, plus rozjechana liczba mnoga słów

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; zatrzymaj się i przemyśl
- **Dimension**: Pattern Consistency
- **Location**: src/pages/generations.astro:42-46,49-59,61 vs src/components/generations/GenerationList.astro:45-51
- **Detail**: `FORMAT_LABEL`, `formatLabel()` i `dateFormat` są skopiowane **dosłownie** między stronę i komponent listy; oba miejsca dodatkowo typują `format` jako `string` i zawężają go ponownie. To dokładnie ta klasa duplikacji, przed którą ostrzega komentarz nagłówkowy samego `GenerationList.astro:7-13` („trzy niezależne listy rozjechałyby się przy pierwszej zmianie") — i ta, którą ten plaster gdzie indziej **usuwał** (`CopyButton`, a wcześniej `readApiError`, `LIST_COLUMNS`). Następny widok dostanie trzecią kopię. Drugą połowę tego ustalenia widać już jako skutek: nowy helper `wordsLabel()` (`generations.astro:49-59`) daje w oknie „22 słowa", podczas gdy `GenerateForm.tsx:236` nadal pisze gołe `{result.words} słów` → „22 słów" dla tego samego tekstu. Produkt ma teraz dwie konwencje tej samej etykiety.
- **Fix A ⭐ Recommended**: Wydzielić `src/lib/generation-labels.ts` z `formatLabel`, `dateFormat` i `wordsLabel`; zaimportować w `generations.astro`, `GenerationList.astro` **oraz** `GenerateForm.tsx`
  - Strength: usuwa duplikację i domyka rozjazd liczby mnoga jednym ruchem; zgodne z konwencją CLAUDE.md („logika do `src/lib/`") i z trzema precedensami w tym repo.
  - Tradeoff: dotyka `GenerateForm.tsx`, czyli pliku spoza zakresu tego plastra — trzeci raz w tej serii.
  - Confidence: HIGH — wszystkie trzy funkcje są czyste i bezstanowe, bez zależności od Astro.
  - Blind spot: nie sprawdzono, czy `wordsLabel` powinien obowiązywać także w liczniku słów w formularzu przed wygenerowaniem.
- **Fix B**: Wydzielić tylko `formatLabel` i `dateFormat`; `wordsLabel` zostawić w oknie i rozjazd zapisać jako znany
  - Strength: nie wychodzi poza dwa pliki, które ten plaster już dotknął.
  - Tradeoff: zostawia w produkcie dwie konwencje tej samej etykiety — rzecz, którą przegląd i tak wykryje przy następnym plastrze.
  - Confidence: HIGH.
  - Blind spot: brak.
- **Decision**: FIXED — wariant A. Nowy `src/lib/generation-labels.ts` z `formatLabel`, `dateFormat` i `wordsLabel`; zaimportowany w `generations.astro`, `GenerationList.astro` **oraz** `GenerateForm.tsx`. Weryfikacja: `grep -rn "FORMAT_LABEL|new Intl.DateTimeFormat" src/` zwraca wyłącznie nowy plik lib; rozjazd liczby mnogiej zamknięty (generator używa tej samej funkcji co okno).

### F3 — Skrypt podnoszący okno: bramka i ścieżka wyjątku dają degradację odwrotną do obiecanej

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: src/pages/generations.astro:163-168
- **Detail**: Dwie sprawy w tym samym skrypcie. Po pierwsze bramką jest `dialog instanceof HTMLDialogElement`, a plan mówił o sprawdzeniu istnienia `showModal` — w przeglądarce bez `<dialog>` identyfikator `HTMLDialogElement` jest niezdefiniowany, więc wyrażenie rzuca `ReferenceError`, zamiast wyliczyć się do `false`. Po drugie, i ważniejsze: `removeAttribute("open")` wykonuje się **przed** `showModal()`. Jeśli `showModal()` rzuci, wyjątek jest nieprzechwycony, nasłuch `close` nigdy się nie podpina, a atrybut `open` jest już zdjęty — czyli **okno znika w całości**. Plan obiecywał degradację dokładnie odwrotną (`plan.md`, Critical Implementation Details: „okno zostaje w trybie `open` — widoczne, bez focus-trapu, z działającym linkiem zamknięcia"). Praktycznie każdy silnik, który definiuje `HTMLDialogElement`, ma `showModal`, więc wpływ jest niski — ale obietnica planu nie jest spełniona.
- **Fix**: Owinąć podniesienie w `try`/`catch` i w gałęzi błędu przywrócić `setAttribute("open", "")`, po czym wyjść bez podpinania nasłuchu — wtedy degradacja zgadza się z planem.
- **Decision**: FIXED — bramka `typeof HTMLDialogElement !== "undefined"` przed `instanceof` (goły identyfikator rzucał `ReferenceError`), `showModal()` w `try`/`catch`, a w `catch` przywrócenie `setAttribute("open", "")` i pominięcie nasłuchu. Degradacja zgadza się teraz z obietnicą planu: okno zostaje widoczne, bez focus-trapu.

### F4 — `location.assign` zostawia okno w historii przeglądarki

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/pages/generations.astro:166-168, src/components/generations/DeleteButton.tsx:75
- **Detail**: Zamknięcie okna używa `assign`, więc stos historii rośnie: `/generations` → `/generations?open=…` → `/generations`, a przycisk Wstecz **otwiera okno ponownie**. Gorszy przypadek dotyczy usuwania: po usunięciu z okna Wstecz ląduje na `?open=<usunięty id>` i pokazuje okno 404 dla pozycji, którą użytkownik właśnie skasował. `location.replace` odpowiada semantyce „zamknij" i „usuń" znacznie lepiej.
- **Fix**: Zamienić `assign` na `replace` w obu miejscach.
- **Decision**: FIXED — `location.replace` zamiast `assign` w skrypcie okna i w `DeleteButton`. Zmierzone: `history.length` nie zmienia się po zamknięciu okna (41 → 41), więc Wstecz nie otwiera go ponownie ani nie ląduje na `?open=<usunięty id>`.

### F5 — Typ `afterDelete` dopuszcza dowolny łańcuch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/DeleteButton.tsx:26,75
- **Detail**: `afterDelete?: string` idzie wprost do `window.location.assign`. Dziś oba wywołania podają literał, ale typ nie broni przyszłego wywołania, które przepuściłoby tam parametr adresu — i wtedy przycisk usuwania staje się otwartym przekierowaniem. Komentarz przy prop opisuje przeznaczenie, ale nie stawia granicy.
- **Fix**: Zawęzić typ do unii znanych tras (dziś `"/generations"`) albo dopisać w komentarzu wprost, że wartość musi być literałem i nigdy nie może pochodzić z adresu.
- **Decision**: FIXED — `afterDelete?: "/generations"` zamiast `string`. Kompilator broni granicy zamiast komentarza; poszerzenie unii wymaga teraz świadomej edycji typu.

### F6 — Bez JS okno renderuje się pod całą listą

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/pages/generations.astro:85-144
- **Detail**: `<dialog open>` bez JS jest niemodalny i pozycjonowany w swoim miejscu w dokumencie — a to miejsce jest **po** całej liście. Przy dłuższej historii „działa bez JS" znaczy „jest, ale poniżej ekranu". Degradacja jest prawdziwa, tylko słabsza, niż sugeruje komentarz w kodzie (`:151-152`).
- **Fix**: Wstawić blok `<dialog>` przed listą w drzewie dokumentu albo osłabić komentarz, żeby nie obiecywał więcej, niż daje.
- **Decision**: FIXED — blok `<dialog>` przeniesiony **przed** listę w drzewie dokumentu. Zmierzone: indeks elementu okna jest mniejszy od indeksu `<h1>`. Przy działającym JS bez różnicy (warstwa górna), bez JS okno jest na górze, nie pod listą.

### F7 — Escape zamyka okno także w trakcie pisania i w trakcie usuwania

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/pages/generations.astro:115,166 (interakcja z DeleteButton.tsx:62)
- **Detail**: Ścieżka Escape → `cancel` → `close` → nawigacja jest poprawna i zamierzona, ale ma dwa skutki uboczne. Escape wciśnięty podczas edycji tytułu w `TitleEditor` zamyka całe okno i **porzuca wpisany draft** bez ostrzeżenia. Escape w trakcie lecącego żądania `DELETE` nawiguje, gdy żądanie jeszcze idzie — SSR `/generations` może wyprzedzić zatwierdzenie i pokazać wiersz jeszcze raz. To natywne zachowanie `<dialog>` i mieści się w decyzji „Escape i link wystarczą", ale warto o tym wiedzieć.
- **Fix**: Zablokować zamykanie na `cancel`, gdy w oknie trwa edycja albo żądanie (`event.preventDefault()`), albo świadomie zaakceptować i zapisać jako znane.
- **Decision**: SKIPPED — zaakceptowane jako natywne zachowanie `<dialog>`, mieszczące się w decyzji planu „Escape i link wystarczą". Blokowanie zdarzenia `cancel` wymagałoby, żeby strona wiedziała o stanie wewnętrznym wysp (trwa edycja / trwa żądanie) — czyli dokładnie tej komunikacji między wyspami, której ten plaster unikał, wybierając okno serwerowe.

### F8 — `role="alert"` na `<h2>` zabiera mu rolę nagłówka

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/pages/generations.astro:133
- **Detail**: W gałęzi odmowy `role="alert"` siedzi na `<h2>`, więc **nadpisuje** rolę nagłówka. `aria-labelledby` nadal się rozwiązuje i okno ma etykietę, ale nagłówek wypada z konspektu dokumentu.
- **Fix**: Zostawić `<h2>` jako nagłówek, a `role="alert"` przenieść na otaczający `div`.
- **Decision**: FIXED — `role="alert"` przeniesiony z `<h2>` na otaczający `div`; nagłówek wraca do konspektu dokumentu, a `aria-labelledby` nadal się rozwiązuje.

### F9 — Timer w `CopyButton` planowany po `await`, już po sprzątaniu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/CopyButton.tsx:30-37,49
- **Detail**: Sprzątanie przy odmontowaniu czyści `timer.current`, ale `copy()` tworzy **nowy** timer dopiero po `await`. Jeśli okno zostanie odmontowane, gdy `writeText` jeszcze leci, sprzątanie już się wykonało, a linia 49 planuje `setStatus` na komponencie, którego nie ma. W React 18 to nieszkodliwe (bez ostrzeżenia, bez wycieku poza jeden timer 2 s), ale komentarz przy sprzątaniu obiecuje więcej, niż gwarantuje.
- **Fix**: Ref `mounted` sprawdzany po `await`, albo nie planować timera, gdy komponent jest odmontowany.
- **Decision**: FIXED — ref `mounted` ustawiany na `false` w sprzątaniu i sprawdzany **po** `await`, więc timer ani `setStatus` nie są planowane na odmontowanym komponencie. Komentarz przy sprzątaniu mówi teraz, czego dotyczy.

## Sprawdzone i uznane za poprawne (bez ustaleń)

- **Izolacja kont nietknięta.** `generations.ts` zmieniony w **jednej linii** (`topic` w `LIST_COLUMNS`); zero nowych zapytań, zero porównania właściciela w kodzie. Okno to `items.find` w wyniku już przefiltrowanym przez RLS. Ryzyko z roadmapy („każdy nowy odczyt to nowa okazja do obejścia RLS filtrem w kodzie") faktycznie nie zachodzi.
- **Brak XSS i brak otwartego przekierowania.** `openParam` używany wyłącznie w `items.find` i sprawdzeniach `null`; nigdy nie trafia do znaczników, atrybutów ani `href`. Żadnego `set:html` w sześciu plikach. Skrypt nawiguje na literał `/generations`. `<title>` przechodzi przez domyślne escapowanie Astro.
- **Nierozróżnialność odmowy.** Jedna gałąź `notFound` dla cudzego, nieistniejącego i niepoprawnego identyfikatora; brak regexa UUID, brak rozgałęzienia po przyczynie. Sprawdzone: 404 + komunikat + widoczna lista w każdym z trzech przypadków.
- **`Astro.response.status = 404` zachowa się tak samo na produkcji.** Weryfikacja wobec Astro 6.3.1: przekierowanie na stronę błędu następuje tylko przy `response.body === null`; ta strona renderuje ciało. Nie ma też `src/pages/404.astro`, z którym mogłoby to kolidować.
- **`wordsLabel` policzony poprawnie** dla 0, 1, 2–4, 5–11, 12–14, 21, 22–24, 25, 102–104, 112–114.
- **`Layout title` bezpieczny** — `title` nie może być pustym łańcuchem: `normalizeTitle` mapuje puste na `null`, a constraint `generations_title_length` odrzuca pusty; `topic` jest `not null`.
- **Brak wyścigu hydratacji.** `showModal()` ustawia focus na serwerowo wyrenderowanym linku „Zamknij"; `hydrateRoot` zachowuje DOM, więc focus i stan warstwy górnej przetrwają hydratację wysp.
- **Brak ścieżki do 404 po usunięciu.** Nawigacja następuje wyłącznie po `response.ok`, więc usunięcie jest zatwierdzone przed renderowaniem listy; stan `deleted` pokrywa okno między sukcesem a nawigacją.
- **Tokeny.** Żadnego zakodowanego koloru Tailwinda w dodanych i zmienionych liniach. `backdrop:bg-ink/40` to poprawne użycie tokenu w Tailwind 4.2.4 (starsze silniki dostają przezroczyste tło — degradacja, nie awaria).
- **Zakres.** Brak sortowania i paginacji, brak strony `/generations/[id]`, brak modala klienckiego, brak zamykania kliknięciem w tło, `TitleEditor` i `RatingControls` z zerowym diffem.
- **Success Criteria.** Wszystkie kryteria automatyczne obu faz przejechane od nowa: jedna implementacja kopiowania, `generations.ts` w jednej linii, eslint czysto (810 błędów `Delete ␍` okazało się w całości końcami linii po checkoutach — po normalizacji `git diff` na `src/` jest **pusty**), `astro check` 0 błędów, 164 testy jednostkowe, 9 integracyjnych, anonim `302`.

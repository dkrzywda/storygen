# Otwieranie pozycji historii w całości — Plan Brief

> Full plan: `context/changes/browse-generation-history/plan.md`

## What & Why

Lista historii pokazuje 70 znaków podglądu i nie ma dokąd wejść — użytkownik nie widzi całości tekstu, który wygenerował, ocenił i być może chce skopiować. FR-010 (`must-have`) obiecuje „otwiera dowolną z nich w całości"; ten plaster to pierwsza definicja, co „w całości" znaczy, bo PRD nigdy jej nie zapisał.

## Starting Point

Lista z S-08 działa i ma komplet akcji na karcie (tytuł, gwiazdki, ulubione, usuwanie z S-06). Pobiera pełną treść każdej pozycji, ale ucina ją w komponencie. Kolumny `topic` nie czyta — temat wpisany przez użytkownika nie jest pokazywany nigdzie. W repo nie ma żadnego okna dialogowego. Kopiowanie (FR-008) żyje jako 12 linii wewnątrz formularza generatora.

## Desired End State

Każda karta ma link „Otwórz" prowadzący na `/generations?open=<id>`. Lista renderuje się z otwartym oknem: pełna treść z akapitami, temat, format, data, liczba słów i komplet akcji plus kopiowanie. Escape albo link wracają na świeżą listę — ocena wystawiona w oknie jest od razu na karcie. Cudza, nieistniejąca i niepoprawna pozycja dają jedno okno z „Nie znaleziono takiej pozycji" i status 404.

## Key Decisions Made

| Decyzja                | Wybór                                                          | Dlaczego                                                                                                             |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Kształt                | Okno modalne (wybór autora, wbrew rekomendacji osobnej strony) | Kontekst listy zostaje pod spodem                                                                                    |
| Mechanizm okna         | Serwerowy, przez `?open=<id>`                                  | Ten sam wzór co zakładki panelu; zamknięcie daje świeżą listę, więc gwiazdki w oknie i na karcie się nie rozjeżdżają |
| Akcje w oknie          | Wszystkie z listy + kopiowanie                                 | Usuwanie ląduje tam, gdzie widzisz co kasujesz; kopiowanie domyka FR-008 poza generatorem                            |
| Sortowanie i paginacja | Poza zakresem                                                  | Roadmapa: „jeśli okażą się potrzebne" — przy kilku pozycjach nie są; filtry odrzucone w tej serii                    |
| Wejście z karty        | Link „Otwórz" w stopce, bez flagi                              | Nie koliduje z edycją tytułu ani gwiazdkami; ranking i ulubione też dostają drogę do pełnej treści                   |
| Odmowa                 | Okno z komunikatem, HTTP 404                                   | Ten sam komunikat i ta sama nierozróżnialność cudzego i nieistniejącego co w API; odmowa z NFR jest widoczna         |
| Źródło treści          | Wynik listy, bez nowego zapytania                              | Ryzyko „drugiego punktu odczytu" z roadmapy nie zachodzi; jedyna zmiana w `generations.ts` to kolumna `topic`        |
| Kopiowanie             | Wyciągnięte do wyspy `CopyButton`                              | Jedno zachowanie w produkcie, jak `readApiError` w S-06                                                              |

## Scope

**In scope:** wyspa `CopyButton` i przestawienie generatora na nią; prop `afterDelete` w `DeleteButton`; kolumna `topic` w `LIST_COLUMNS`; okno w `generations.astro` z akcjami i ścieżką 404; link „Otwórz" na wspólnej liście.

**Out of scope:** sortowanie i paginacja; osobna strona `/generations/[id]`; modal kliencki; nowy odczyt z bazy; zamykanie kliknięciem w tło; animacje; edycja treści, regeneracja, eksport (Non-Goals PRD); zmiany w `TitleEditor` i `RatingControls`.

## Architecture / Approach

Dwie fazy. Najpierw klocki weryfikowalne na istniejących ekranach — kopiowanie w generatorze po wyciągnięciu, `afterDelete` przy dzisiejszym zachowaniu listy. Potem okno: `generations.astro` czyta `?open=`, szuka pozycji w wyniku `fetchHistory` (bez zapytania, bez porównania właściciela w kodzie) i renderuje natywny `<dialog open>` z osadzonymi wyspami. Mały skrypt podnosi go do `showModal()` — natywny focus-trap, Escape i tło za darmo — a `close` nawiguje na `/generations`. Bez JS okno zostaje widoczne w trybie `open` z działającym linkiem zamknięcia.

## Phases at a Glance

| Faza              | Co dowozi                                                      | Główne ryzyko                                                                                        |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Klocki         | `CopyButton`, generator na nim, `afterDelete` w `DeleteButton` | Regresja kopiowania w generatorze albo usuwania na liście — oba są kryteriami ręcznymi tej fazy      |
| 2. Okno i wejście | `?open=<id>`, okno z akcjami, ścieżka 404, link „Otwórz"       | Kolejność w skrypcie: `close()` emituje `close`, więc nasłuch nawigujący musi wejść po `showModal()` |

**Prerequisites:** działający lokalny stack (dev server, Supabase w Dockerze); zalogowana sesja do weryfikacji ręcznej; co najmniej jedna zapisana historia (format `story`) do sprawdzenia akapitów.

**Estimated effort:** ~1 sesja, dwie fazy. Najmniejszy plaster po S-06 — bez migracji, bez nowego kodu błędu, bez nowego odczytu.

## Open Risks & Assumptions

- **Pierwsze `<dialog>` w repo.** Natywny element daje dużo za darmo, ale zachowanie `showModal()` po `open` (konieczne `close()` przed) i emisja `close` przy tym `close()` to pułapka zapisana w Critical Implementation Details planu.
- **Schowek wymaga bezpiecznego kontekstu.** `navigator.clipboard` działa na `localhost` i HTTPS; na produkcji `workers.dev` jest HTTPS, więc bez ryzyka — ale `CopyButton` ma pokazać komunikat, gdy schowek odmówi, zamiast milczeć.
- **404 z widoczną listą** jest nietypowe. Zamierzone: odmowa z NFR ma być widoczna i uczciwa w logach.
- **Założenie:** kilka do kilkudziesięciu pozycji w historii. Gdy będzie ich setki, paginacja wraca jako osobny plaster — nie jako rozszerzenie tego.

## Success Criteria (Summary)

- Użytkownik otwiera dowolną pozycję z karty i widzi ją w całości, z tematem i metadanymi, a wszystko, co zrobi w oknie, jest po zamknięciu widoczne na liście
- Cudza, nieistniejąca i niepoprawna pozycja odpowiadają identycznie — oknem z komunikatem i statusem 404 — a anonim jest przekierowany na logowanie
- `src/lib/generations.ts` nie zyskał żadnego zapytania; w repo jest jedna implementacja kopiowania

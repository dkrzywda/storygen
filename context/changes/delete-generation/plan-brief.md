# Usuwanie pozycji z własnej historii — Plan Brief

> Full plan: `context/changes/delete-generation/plan.md`

## What & Why

Użytkownik nie ma dziś żadnego sposobu usunięcia własnej generacji — historia rośnie liniowo i nie da się z niej nic zdjąć. FR-011 jest w PRD jako `must-have`, a plaster S-06 domyka „D" z pełnego CRUD, na którym stoi kotwica certyfikacyjna MS-01.

## Starting Point

Tabela `generations` istnieje z włączonym RLS i politykami `select`, `insert`, `update` — ale **bez polityki `delete`, i to celowo**. Plan S-08 wymienia jej brak w „What We're NOT Doing" i ma odhaczone kryterium weryfikacji, że polityki nie ma. Dziś baza odrzuca każde usunięcie, a `test-plan.md` opiera na tym część gwarancji R-05, jedynego ryzyka krytycznego.

## Desired End State

Na `/generations` przy każdej pozycji stoi akcja usunięcia z dwustopniowym potwierdzeniem. Potwierdzenie trwale usuwa wiersz, strona przeładowuje się i pokazuje listę bez niego. Konto B nie usunie wiersza konta A ani przez interfejs, ani wołając endpoint wprost — i to jest udowodnione testem integracyjnym, nie założone. W rankingu akcji usuwania nie ma.

## Key Decisions Made

| Decyzja                          | Wybór                                      | Dlaczego                                                                                             |
| -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Potwierdzanie                    | Dwustopniowy przycisk inline               | W repo nie ma ani jednego modala; TitleEditor już traktuje kasowanie jako osobną nazwaną akcję       |
| Sposób usunięcia                 | Twarde — DELETE wiersza                    | Zgodne z outcome plastra i konwencją polityk per operacja; PRD nie ma wymogu retencji                |
| Miejsce przycisku                | Historia i ulubione, przez flagę na liście | Oba widoki służą zarządzaniu kolekcją; ranking jest tablicą wyników do czytania (rewizja 2026-09-07) |
| Po usunięciu                     | Przeładowanie strony                       | Lista jest serwerowa — wyspa nie zgasi rodzeństwa z Astro bez przebudowy całej listy                 |
| Istniejący test „nikt nie usuwa" | Zamiana na test izolacji usuwania          | Dodanie polityki zabiera gwarancję R-05; musi ją zastąpić dowód, nie luka                            |
| Zależność od S-05                | Ruszamy, rozbieżność zapisana              | Usuwanie potrzebuje listy (jest od S-03), nie otwierania w całości                                   |

## Scope

**In scope:** polityka RLS `delete`; handler `DELETE /api/generations/[id]`; wyspa z dwustopniowym potwierdzeniem; flaga `deletable` na wspólnej liście; trzy przypadki integracyjne izolacji usuwania; aktualizacja `test-plan.md`.

**Out of scope:** miękkie usuwanie, kosz, cofanie, retencja; usuwanie z rankingu; usuwanie zbiorcze; modal jako wzorzec; usuwanie konta; FR-010 (otwieranie w całości); wypchnięcie migracji na produkcję.

## Architecture / Approach

Trzy warstwy w wymuszonej kolejności: baza → API → interfejs. Bez polityki endpoint zwracałby 404 na własny wiersz użytkownika; bez endpointu przycisk nie ma czego wołać. Dowód izolacji ląduje w fazie 1, razem z polityką, żeby między fazami nie istniało okno bez dowodu. Endpoint wchodzi do istniejącego pliku trasy obok `PATCH` i powtarza jego cztery kroki — kontrola UUID, brak klienta, zapytanie, zero wierszy → 404. Żaden nowy kod błędu nie jest potrzebny.

## Phases at a Glance

| Faza                     | Co dowozi                                                      | Główne ryzyko                                                                                 |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Baza i dowód izolacji | Polityka `delete`, trzy testy izolacji, poprawiony test-plan   | Zielony zestaw nie dowodzi polityki `delete` w oderwaniu od `select` — pułapka Postgresa      |
| 2. Endpoint              | `DELETE /api/generations/[id]`                                 | Cudza i nieistniejąca pozycja muszą dawać ten sam 404, inaczej endpoint wylicza cudze rekordy |
| 3. Interfejs             | Dwustopniowy przycisk w historii i ulubionych, flaga na liście | Flaga domyślnie wyłączona — inaczej nowy widok dostanie nieodwracalną akcję przez przypadek   |

**Prerequisites:** działający lokalny stack Supabase (`npx supabase start`, Docker); zalogowana sesja w aplikacji do weryfikacji ręcznej. Formalnie plaster czeka na S-05 — świadomie ruszamy przed jego domknięciem.

**Estimated effort:** ~1 sesja, trzy fazy. Roadmapa nazywa to najmniejszym plastrem kamienia milowego.

## Open Risks & Assumptions

- **Ryzyko dowodowe.** `DELETE ... WHERE` czyta wiersze, więc wymaga też polityki `SELECT`. Rozszerzenie samej polityki `delete` nie zrobi testów czerwonymi — dlatego weryfikacja ręczna fazy 1 każe celowo rozszerzyć obie i zobaczyć czerwony.
- **Kolejność w teście.** Kontrola pozytywna niszczy wiersz, na którym stoją pozostałe przypadki. Zakłada własny wiersz; inaczej dopisanie czegokolwiek poniżej cicho psuje zestaw.
- **Cofanie jest niesymetryczne.** `git revert` nie zdejmuje polityki z bazy — potrzebna migracja odwrotna.
- **Założenie o zależności.** Przyjmujemy, że S-06 nie potrzebuje FR-010. Gdyby usuwanie miało być dostępne dopiero z widoku pełnej treści, ta decyzja jest do odwrócenia.
- **Produkcja nie ma żadnej migracji z tego repo.** Ta dołącza do kolejki dwóch niewypchniętych.

## Success Criteria (Summary)

- Użytkownik usuwa własną pozycję z historii albo z ulubionych dwoma świadomymi klikami i po przeładowaniu jej nie widzi — także w rankingu
- Cudza i nieistniejąca pozycja odpowiadają identycznie, a próba usunięcia cudzej nie zmienia niczego — dowiedzione testem integracyjnym na kluczu publishable
- Ranking nie daje możliwości usuwania; zakładka Ulubione daje

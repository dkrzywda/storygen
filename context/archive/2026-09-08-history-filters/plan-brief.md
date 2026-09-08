# Filtrowanie i szukanie w historii generacji — Plan Brief

> Pełny plan: `context/changes/history-filters/plan.md`

## What & Why

Historia pod `/generations` jest płaską, nieprzeszukiwalną listą — `fetchHistory()`
bez filtrów, bez limitu i bez paginacji. Ta zmiana daje jej filtry (format, minimalna
ocena, „tylko ulubione") i szukanie po temacie, wszystko łączone przez AND i trzymane
w adresie. **Jest poza PRD**: FR-010 wymaga tylko przeglądania od najnowszej
i otwierania pozycji w całości, co dowiozło już S-05.

## Starting Point

Filtrowanie po formacie i po ulubionych **już istnieje w produkcie, dwa razy** —
jako `fetchRanking(format)` i `fetchFavourites()` w panelu, każde z własnym indeksem
częściowym. Historia to trzeci widok nad tą samą tabelą, dziś bez żadnego zawężania.
Lista nie pokazuje `topic`, a okno pozycji jest szukane w już pobranej liście, więc
zawężenie zamieniłoby istniejącą pozycję w 404. Największe konto ma 2 generacje.

## Desired End State

Na `/generations` stoi pasek filtrów działający bez JavaScriptu. Filtry są w adresie —
odświeżalne, linkowalne, dostępne przyciskiem Wstecz. Każda pozycja pokazuje temat,
po którym się szuka. Gdy filtr nic nie przepuści, komunikat wylicza aktywne filtry
i daje link czyszczący. Otwarcie pozycji działa niezależnie od filtra. Panel działa
dokładnie jak dziś, mimo że jego odczyty stoją już na nowej, wspólnej warstwie.

## Key Decisions Made

| Decyzja                  | Wybór                                                              | Dlaczego (jedno zdanie)                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Trzy ścieżki filtrowania | Jedna warstwa `fetchGenerations(filters, order)`, ekrany bez zmian | Trzecia kopia logiki rozjechałaby się przy pierwszym dodaniu kolumny — dokładnie to, przed czym ostrzega nagłówek `GenerationList.astro`     |
| Mechanizm filtrów        | Parametry adresu, render serwerowy                                 | Repo tak już robi w zakładkach panelu i uzasadnia to wprost: każdy filtr to inne zapytanie, więc wyspa musiałaby i tak wołać serwer          |
| Semantyka oceny          | „Co najmniej N"                                                    | `minRating: 1` jest równoważne `rating is not null`, czyli warunkowi rankingu — jedna funkcja obsługuje oba, a indeks częściowy nadal działa |
| Szukanie                 | `ilike` bez normalizacji                                           | Zero migracji; temat wpisywał ten sam użytkownik. Cena: „zolw" nie znajdzie „żółw"                                                           |
| Kombinowanie             | Wszystkie filtry przez AND                                         | To jedyna rzecz, której zakładki panelu nie potrafią — bez tego zmiana nie dodaje nic poza innym adresem                                     |
| Okno pozycji             | Własny odczyt po `id`, niezależny od filtra                        | Inaczej 404 zaczyna znaczyć „odfiltrowane", a nierozróżnialność cudzego/nieistniejącego/niepoprawnego z S-05 się psuje                       |
| Stan pusty               | Komunikat zależny od filtra plus „wyczyść"                         | „Nie masz generacji" jest kłamstwem, gdy masz dwadzieścia; `GenerationList` już przyjmuje te teksty jako propsy                              |
| Temat na liście          | Widoczny zawsze                                                    | Bez tego wynik szukania po temacie nie zawiera widocznego dopasowania                                                                        |
| Testy                    | Unit na filtrach plus integracyjny na RLS                          | R-05 to jedyne ryzyko krytyczne, a roadmapa nazywa nowe odczyty nową okazją do jego złamania                                                 |

## Scope

**In scope:** `generation-filters.ts` (parsowanie, ucieczka `ilike`, etykiety) ·
`fetchGenerations(filters, order)` z przepisaniem `fetchHistory`/`fetchRanking`/
`fetchFavourites` · `fetchGenerationById` dla okna · `FilterBar.astro` bez JS ·
temat w `GenerationList` · stany puste zależne od filtrów · testy jednostkowe
i integracyjne

**Out of scope:** paginacja i wirtualizacja · szukanie odporne na polskie znaki ·
szukanie w treści · sortowanie wybierane przez użytkownika · scalanie ekranów panelu
z historią · migracje i nowe indeksy

## Architecture / Approach

```
GET /generations?format=joke&rating=4&fav=1&q=koty
  parseFilters(searchParams)        (funkcja czysta, testowalna bez bazy)
      ↓
  fetchGenerations({ filters, order: "newest" })
      .eq(format) .gte(rating) .eq(is_favourite) .ilike(topic, %escapeLike(q)%)
      ↓  RLS wstrzykuje auth.uid() = user_id — kod NIE filtruje po user_id
  lista + FilterBar + stan pusty zależny od filtrów

  ?open=<id>  →  fetchGenerationById(id)     (osobny odczyt, obok listy)
                 null → 404  (cudzy | nieistniejący | niepoprawny uuid — jednakowo)
```

`fetchRanking` i `fetchFavourites` zostają jako eksporty i stają się cienkimi
wywołaniami `fetchGenerations` — panel nie wie o zmianie.

## Phases at a Glance

| Faza                         | Co dowozi                                                             | Główne ryzyko                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Warstwa filtrów i zapytań | Moduł funkcji czystych, wspólny odczyt, testy jednostkowe             | Przepisuje odczyty **działającego** panelu — ranking bez `rating desc` przestaje być rankingiem, a typy tego nie złapią |
| 2. Powierzchnia              | Pasek filtrów, temat na liście, okno przez własny odczyt, stany puste | Niepoprawny uuid w `?open=` dałby 500 zamiast 404 i osłabił gwarancję z S-05                                            |
| 3. Testy integracyjne        | Dowód, że filtry nie omijają RLS                                      | Zestaw bez kontroli pozytywnej byłby zielony także wtedy, gdyby filtr nie przepuszczał nikogo                           |

**Prerequisites:** S-05 i `generation-rating` (dowiezione) · Docker i `npx supabase start`
dla fazy 3

**Estimated effort:** ~1 sesja na trzy fazy; ciężar w fazie 2, faza 1 i 3 są krótkie.

## Open Risks & Assumptions

- **Szukanie nie jest odporne na polskie znaki.** `ilike` nie dopasuje „zolw" do
  „żółw". Świadomie przyjęte; poprawne rozwiązanie (`unaccent` z indeksem funkcyjnym
  na własnej owijce IMMUTABLE) zostało odrzucone jako migracja w zmianie, która nie
  miała jej mieć.
- **Faza 1 dotyka dwóch dowiezionych ekranów.** Regres w rankingu albo w ulubionych
  byłby regresem w czymś, czego ta zmiana nie zamawiała — stąd osobna faza i ręczna
  weryfikacja panelu przed dodaniem interfejsu.
- **Zmiana jest poza PRD** i powiększa ten sam dług, który roadmapa notuje jako
  nierozstrzygnięty przy `generation-rating`: czy takie pozycje należą do M-1.
- **Koszt renderu siedzi w hydracji, nie w zapytaniu.** Każda pozycja listy hydruje
  dwie wyspy Reacta (`TitleEditor`, `RatingControls`) i nie ma paginacji. Filtry
  zmniejszają N, ale widok bez filtra nadal hydruje 2N.

## Success Criteria (Summary)

- Filtry można łączyć, a stan filtrów przetrwa odświeżenie, Wstecz i wklejenie linku
- Otwarcie pozycji działa niezależnie od filtra, a niepoprawny identyfikator daje 404
- Panel po fazie 1 działa identycznie jak przed nią, a nowe odczyty nie widzą cudzych
  danych nawet przy dowolnej kombinacji filtrów

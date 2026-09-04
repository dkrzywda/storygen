# Własny tytuł zapisanej generacji — Plan Brief

> Pełny plan: `context/changes/annotate-generation/plan.md`
> Roadmapa: `context/foundation/roadmap.md` — pozycja **S-08**, kotwica **MS-01**

## What & Why

Użytkownik nadaje zapisanej generacji własny tytuł i może go zmienić — to jedyne „U" w CRUD
tego produktu. PRD zakazuje edycji wygenerowanego tekstu („the format contract governs the
whole output or nothing"), więc aktualizacja dotyczy metadanych pozycji, nie treści: zakaz
zostaje nienaruszony, a wymaganie certyfikacyjne domknięte. Dodatkowo jest to jedyny plaster
niezależny od nierozstrzygniętego dostawcy LLM, czyli jedyna droga do dowiezienia działającego
oprogramowania przed tamtą decyzją.

## Starting Point

Kontrakt odpowiedzi API z `F-01` istnieje i jest przetestowany jednostkowo, ale **nieużyty** —
w repo nie ma ani jednego endpointu nie-auth. Nie ma też tabeli generacji (`supabase/` to sam
`config.toml`), żadnego `.from(...)` w kodzie, ekranu historii ani testów integracyjnych.

## Desired End State

Zalogowany użytkownik wchodzi na listę własnych generacji, nadaje wybranej pozycji tytuł
i zmienia go; wyczyszczenie tytułu przywraca wyświetlanie początku tekstu. Próba dotknięcia
cudzej pozycji jest nieodróżnialna od próby dotknięcia nieistniejącej. Izolacja kont jest
sprawdzana automatycznie, nie deklarowana.

## Key Decisions Made

| Decyzja                | Wybór                                   | Dlaczego                                                                                                            |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sekwencja wobec `S-03` | Ten plan tworzy tabelę i polityki RLS   | Bez tego plan jest niewykonalny do rozstrzygnięcia dostawcy LLM; `S-03` zwęża się do „zapisz do istniejącej tabeli" |
| Model tytułu           | Jedno pole, opcjonalne, domyślnie puste | `S-03` nie zyskuje nowej odpowiedzialności przy zapisie; użytkownik nazywa tylko to, co chce odnaleźć               |
| Granice tytułu         | 1–80 znaków po `trim`, pusty czyści     | Ta sama liczba co dla tematu w FR-003; kasowanie mieści się w tym samym endpoincie                                  |
| Odpowiedź endpointu    | Zaktualizowany rekord w `{ data }`      | Pierwszy konsument koperty z `F-01` używa jej dokładnie tak, jak opisuje kontrakt                                   |
| Cudza pozycja          | 404, nieodróżnialne od nieistniejącej   | Nie potwierdza istnienia rekordu; wyliczanie identyfikatorów niczego nie mapuje                                     |
| Interfejs              | Minimalna lista powstaje tutaj          | Wymaganie mówi o akcjach użytkownika, nie o endpointach — bez ekranu „U" jest zapowiedziane, nie zrobione           |
| Weryfikacja izolacji   | Test integracyjny na lokalnym Supabase  | Polityki RLS żyją w bazie, nie w kodzie — test jednostkowy nie może ich dotknąć                                     |

## Scope

**In scope:** pierwsza migracja z tabelą generacji i politykami `select`/`insert`/`update` ·
harness testów integracyjnych · test izolacji kont (R-05) · kod `NOT_FOUND` · endpoint `PATCH` ·
minimalna lista historii z edycją tytułu · aktualizacja test-planu, roadmapy i `CLAUDE.md`

**Out of scope:** edycja wygenerowanego tekstu i regeneracja · notatka jako drugie pole ·
zapis z generowania (`S-03`) · pełny ekran historii (`S-05`) · usuwanie i polityka `delete`
(`S-06`) · liczniki limitów (`S-04`) · tłumaczenie starych ekranów auth (`S-02`)

## Architecture / Approach

Pięć faz w kolejności od gwarancji do jej użycia: schemat i polityki → **test polityki** →
endpoint, który z niej korzysta → interfejs → zapis decyzji w dokumentach. Kolejność faz 2 i 3
jest celowo odwrócona wobec intuicji: gwarancją izolacji jest polityka RLS, nie endpoint —
test po endpointcie mógłby świecić na zielono przy dziurawej polityce. Handler nie porównuje
właściciela w kodzie; pyta bazę i dostaje zero wierszy, bo RLS odfiltrował cudze.

## Phases at a Glance

| Faza                       | Co dowozi                                                         | Główne ryzyko                                                           |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Schemat i RLS           | Pierwsza migracja: tabela + polityki per operacja                 | Polityka szersza niż operacja wymaga — nic tego nie krzyknie            |
| 2. Harness + test izolacji | R-05 przechodzi z luki na pokryte                                 | Test z kluczem `service_role` przechodzi zawsze i daje fałszywy zielony |
| 3. Endpoint                | Pierwszy endpoint nie-auth, pierwszy konsument kontraktu z `F-01` | Pokusa porównania właściciela w kodzie zamiast polegania na RLS         |
| 4. Lista z edycją          | „U" widoczne dla użytkownika, nie tylko w API                     | Nagryza zakres `S-05` — trzeba zapisać, ile dokładnie                   |
| 5. Dokumenty               | Test-plan, roadmapa i `CLAUDE.md` zgodne ze stanem faktycznym     | Pominięcie sprawi, że plan `S-03` zacznie budować istniejącą tabelę     |

**Prerequisites:** Docker i ~7 GB RAM dla `npx supabase start` (faza 2 i dalsze). Poza tym nic —
`F-01` jest zaimplementowane, a żadna inna pozycja roadmapy nie jest wymagana.
**Estimated effort:** pięć faz, każda z osobnym punktem wstrzymania na weryfikację ręczną.

## Open Risks & Assumptions

- **Plan świadomie przekracza dwie granice z roadmapy** — tworzy tabelę (zakres `S-03`)
  i listę (zakres `S-05`). To decyzja, nie dryf, ale oznacza, że oba tamte plastry trzeba
  przepisać przed ich planowaniem; faza 5 to zapisuje.
- **Edycja tytułu może zostać uznana za zbyt cienkie „U"** przy ocenie certyfikacyjnej.
  Następnym krokiem byłaby regeneracja w miejscu — ale to wymaga przeredagowania Non-Goala
  w PRD, czyli decyzji produktowej, nie implementacyjnej.
- **Testy integracyjne wprowadzają zależność od Dockera.** Jeśli środowisko go nie ma,
  faza 2 blokuje cały plan, a R-05 zostaje niepokryte.
- **Tabela powstaje, zanim cokolwiek do niej pisze.** Do czasu `S-01`/`S-03` wypełniają ją
  wyłącznie testy — lista będzie pusta w normalnym użyciu.

## Success Criteria (Summary)

- Użytkownik nadaje i zmienia tytuł własnej pozycji, a wyczyszczenie przywraca początek tekstu
- Konto B nie zmienia ani nie widzi wiersza konta A — i dowodzi tego test, nie deklaracja
- Wymaganie certyfikacyjne „pełne CRUD" jest domknięte bez łamania zakazu edycji z PRD

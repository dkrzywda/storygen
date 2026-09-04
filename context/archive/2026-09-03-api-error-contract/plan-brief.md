# Kontrakt odpowiedzi API i warstwa komunikatów po polsku — Plan Brief

> Pełny plan: `context/changes/api-error-contract/plan.md`
> Roadmapa: `context/foundation/roadmap.md` — pozycja **F-01**, kamień milowy M-1

## What & Why

Aplikacja nie ma ustalonego kształtu odpowiedzi dla endpointów innych niż auth ani żadnego
mechanizmu zamiany błędów na komunikaty po polsku. Skutki są udowodnione, nie przypuszczane:
trzy niezależne przebiegi agenta dopisujące `/api/generate` wymyśliły trzy różne kształty
odpowiedzi, a na produkcji użytkownik zobaczył błąd bez treści, bo `error.message` z Supabase
bywa pusty. Generowanie dołoży do tego trzy kolejne tryby awarii — timeout, przekroczony limit,
odrzucony temat — więc mechanizm musi powstać wcześniej, inaczej będzie retrofitowany
w czterech miejscach zamiast w jednym.

## Starting Point

Trzy endpointy auth działają na produkcji i odbijają surowy `error.message` do URL-a; strony
auth renderują zawartość `?error=` bez żadnego filtra. `zod` nie jest zainstalowany mimo że
`tech-stack.md` go zakłada, nie ma runnera testów ani skryptu `test`, a `src/types.ts` jeszcze
nie istnieje.

## Desired End State

Jeden moduł zamienia dowolny błąd na parę (kod domenowy, polski komunikat); helper buduje
odpowiedź JSON z prawdziwym statusem HTTP wyprowadzonym z kodu; walidacja `zod` zwraca rozbicie
na pola. Trzy endpointy auth przestają cytować dostawcę, a `?error=` niesie kod zamiast prozy.
Wszystko jest pokryte testami uruchamianymi przez `npm test`.

## Key Decisions Made

| Decyzja                        | Wybór                                                | Dlaczego                                                                                                           | Źródło  |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| Kształt odpowiedzi             | JSON envelope dla nie-auth; redirect zostaje w auth  | FR-006 wymaga wyniku na tym samym ekranie, a NFR ciągłego postępu przez 15–30 s — redirect nie potrafi ani jednego | Plan    |
| Zakres wobec istniejącego auth | Mechanizm + podmiana surowego `error.message`        | Kasuje potwierdzone naruszenie PRD od razu, a `S-02` dostaje gotowy mechanizm zamiast budować go po drodze         | Plan    |
| Taksonomia błędów              | Własne kody domenowe + mapa na komunikaty PL         | Interfejs musi rozróżniać odrzucony temat od wyczerpanego limitu — po kodzie, nie po tekście                       | Plan    |
| Miejsce komunikatów            | Jeden słownik kod → komunikat, bez i18n              | Drugi język jest non-goalem w PRD, więc i18n to koszt bez odbiorcy; jeden plik da się zaudytować                   | Plan    |
| Odpowiedź walidacji            | Kod + rozbicie na pola                               | Formularz generowania ma trzy pola — bez rozbicia interfejs nie wie, które podkreślić                              | Plan    |
| Błąd nieznany lub pusty        | Jeden komunikat domyślny                             | Reguła z `lessons.md`: brak treści to normalny stan do obsłużenia, nie sytuacja niemożliwa                         | Lessons |
| Surowa treść błędu             | Log po stronie serwera, użytkownik dostaje zmapowany | Observability Cloudflare jest już włączona; bez logu mapowanie kasuje jedyny ślad diagnostyczny                    | Plan    |
| Runner testów                  | Vitest 4.1.11                                        | Vite 7.3.3 jest już w projekcie; Vitest dzieli z nim config i resolver zamiast stawiać drugi                       | Plan    |
| Statusy HTTP                   | Prawdziwe statusy + envelope                         | Status jest widoczny w observability bez zaglądania w ciało — log zyskuje drugi wymiar za darmo                    | Plan    |

## Scope

**In scope:** kody domenowe i słownik komunikatów PL · helper odpowiedzi z mapowaniem kodu na status ·
walidacja `zod` z rozbiciem na pola · log surowego błędu po stronie serwera · runner testów ·
podmiana `error.message` w trzech endpointach auth · rozwiązywanie `?error=` przez słownik ·
zapis kontraktu w `CLAUDE.md`

**Out of scope:** teksty interfejsu i walidacja po stronie klienta (`S-02`) · `404.astro` (`S-02`) ·
biblioteka i18n · kody dla generowania i limitów (dokłada je plaster, który ich potrzebuje) ·
moduł loggera z redakcją pól · naprawa CI i CRLF (zaparkowane)

## Architecture / Approach

Trzy rozdzielone odpowiedzialności. **Kod domenowy** jest stabilny i to na niego reaguje interfejs.
**Komunikat** jest wymienny i mieszka w jednym słowniku razem ze statusem HTTP — celowo w jednym
module, bo rozdzielenie ich gwarantuje, że przy dodaniu kodu w `S-01` ktoś zaktualizuje jedno,
a zapomni o drugim. **Status HTTP** jest wyprowadzany z kodu, nigdy wpisywany w handlerze.
Endpointy auth zachowują form-post i redirect; zmienia się tylko to, co niosą w `?error=`.

## Phases at a Glance

| Faza                     | Co dowozi                                                            | Główne ryzyko                                                                |
| ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Runner testów         | Vitest działa, `npm test` istnieje, alias `@/*` rozwiązuje się       | Alias niezgodny z `tsconfig` — wtedy testy z faz 2–3 nie zaimportują modułów |
| 2. Kontrakt i komunikaty | Kody, słownik, envelope, walidacja — czyste funkcje z testami        | Rozjazd między mapą komunikatów a mapą statusów przy dodawaniu kodów         |
| 3. Retrofit auth         | Trzy endpointy przestają cytować dostawcę; `?error=` niesie kod      | Faza dotyka plików, które ruszy też `S-02` — nie puszczać ich równolegle     |
| 4. Zapis w `CLAUDE.md`   | Trzy nieaktualne tripwire'y domknięte, kontrakt zapisany jako reguła | Zapis streszczający plan zamiast reguły — nieużyteczny dla kolejnego agenta  |

**Prerequisites:** brak — `F-01` nie ma zależności i jest jedyną pozycją roadmapy w stanie `ready`.
**Estimated effort:** cztery fazy, każda z osobnym punktem wstrzymania na weryfikację ręczną.

## Open Risks & Assumptions

- **Rozbieżność wobec `deploy-plan.md`.** Plan wdrożenia opisuje „pustą czerwoną ramkę", ale
  `ServerError.tsx:8` nie wyrenderuje niczego dla pustego stringa. Przyjęte założenie: komunikat
  był prawdziwy, ale wizualnie pusty, więc strażnik sprawdza „puste po `trim()`". Jeśli to
  założenie jest błędne, ramka miała inne źródło i trzeba je znaleźć osobno.
- **Zestaw kodów jest celowo niekompletny.** Siedem kodów pokrywa dzisiejsze potrzeby; `S-01`
  i `S-04` dołożą swoje. Jeśli okaże się, że enum wymaga przebudowy zamiast rozszerzenia,
  koszt spada na tamte plastry.
- **Odbicie tekstu z `?error=` zostało znalezione przy okazji**, nie było celem zmiany. Zamknięcie
  go jest darmowe przy przejściu na kody, ale nie było przedmiotem osobnego przeglądu bezpieczeństwa.

## Success Criteria (Summary)

- Użytkownik nigdy nie widzi komunikatu pochodzącego od Supabase ani pustej ramki — każdy tryb
  awarii kończy się czytelnym zdaniem po polsku
- Kolejny endpoint w `src/pages/api/` ma jeden oczywisty wzorzec do naśladowania, zapisany
  w `CLAUDE.md`, zamiast trzech konkurencyjnych
- `npm test` istnieje i chroni przed nawrotem obu incydentów zapisanych w `lessons.md`

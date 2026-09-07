# Dzienny limit na konto i sufit dzienny całej aplikacji — Plan Brief

> Pełny plan: `context/changes/daily-generation-limits/plan.md`

## What & Why

Storygen stoi pod publicznym adresem z **otwartą rejestracją z wyboru** i nie ma żadnego
ogranicznika kosztu — każde żądanie wydaje Neurony Cloudflare Workers AI, w nieograniczonej
liczbie. Ten plaster stawia dwie bramki przed wywołaniem modelu: własny limit 10 generacji na
dobę (FR-012, granica sprawiedliwości) i sufit 30 generacji na dobę dla całej aplikacji
(FR-013, rzeczywista granica kosztu). Oba są must-have; S-04 jest ostatnim plastrem z PRD
o statusie `proposed`.

## Starting Point

Neurony wydaje dokładnie jedno miejsce — `src/pages/api/generate.ts`, pierwsze wywołanie modelu
w linii 107. Nie istnieje żaden licznik: `supabase/migrations/` ma trzy migracje, a `generations`
jest jedyną tabelą aplikacji. Rejestr ryzyk już nazywa tę lukę: **R-07** w
`context/foundation/test-plan.md` — „Licznik limitu nie domyka się i sufit kosztu nie działa",
objaw „Generowanie działa dalej — awarią jest rachunek, nie błąd", status „luka, wchodzi z S-04".

## Desired End State

Panel pokazuje własne zużycie i zużycie całej aplikacji z godziną odnowienia; ekran generatora
pokazuje liczbę pozostałych generacji przy przycisku. Po wyczerpaniu którejkolwiek granicy
kliknięcie kończy się polskim komunikatem mówiącym, **która** granica została osiągnięta, a
model nie jest wołany ani razu. Awaria licznika blokuje generowanie zamiast je przepuszczać.

## Key Decisions Made

| Decyzja                   | Wybór                                              | Dlaczego (jedno zdanie)                                                                                                                  | Źródło    |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Sufit aplikacji (FR-013)  | 30/dobę                                            | 30 × ~302 Neurony (opowiadanie z ponowną próbą) ≈ 9 060 z 10 000 — jedyna liczba, która nie może przekroczyć darmowego przydziału        | change.md |
| Limit na konto (FR-012)   | 10/dobę                                            | Trzy konta wyczerpują sufit, więc próg na konto zostaje realną granicą sprawiedliwości przy otwartej rejestracji                         | change.md |
| Co liczy licznik          | Próby, w nowej tabeli, wiersz **przed** wywołaniem | Odmowa modelu, złamany kontrakt i timeout też wydają Neurony — licząc zapisane wyniki, sufit kosztu nie ograniczałby kosztu              | Plan      |
| Odczyt sufitu wbrew RLS   | Bezparametrowa funkcja `security definer`          | Najmniejszy możliwy wyjątek: na zewnątrz wychodzą trzy liczby, ani jeden wiersz — zamiast klucza `service_role` omijającego RLS wszędzie | Plan      |
| Brak parametrów w funkcji | Doba liczona wewnątrz SQL                          | Parametr z granicą doby pozwoliłby podać starą datę i obejść sufit przez publiczne API                                                   | Plan      |
| Granica doby              | `Europe/Warsaw`                                    | „Dziś" w panelu ma znaczyć to, co użytkownik myśli; przy UTC generacja z 00:30 wpadałaby do poprzedniej doby                             | Plan      |
| Awaria licznika           | Fail-closed — odmowa generowania                   | Sufit, który przy awarii przestaje obowiązywać, nie jest sufitem, a to jedyna bariera kosztowa w projekcie                               | Plan      |
| Ponowna próba a limit     | Jedna jednostka na żądanie                         | Sufit 30 był policzony jako 30 pozycji z ponowną próbą w cenie; użytkownik nie płaci za to, że model nie trafił w kontrakt               | Plan      |
| Kolejność i komunikaty    | Najpierw własny limit, dwa osobne kody (429)       | FR-012 i FR-013 wymagają wyjaśnienia, a „limit wyczerpany" bez powiedzenia czyj nie wyjaśnia nic                                         | Plan      |
| Kształt wiersza próby     | Tylko fakt próby, bez wyniku                       | Brak polityki UPDATE znaczy, że konto nie może obniżyć własnego zużycia — ta sama logika co celowy brak polityki DELETE w `generations`  | Plan      |
| Powierzchnia              | Panel (oba liczniki) **i** generator (pozostało N) | Informacja stoi tam, gdzie zapada decyzja — inaczej pierwszą wiadomością o limicie jest odmowa                                           | Plan      |
| Testy                     | Unit (decyzja) + integracyjny pod kluczem anon     | R-07 ma dwie twarze — złą arytmetykę i zbyt szeroką politykę; `service_role` dałby zielone światło przy dziurawej polityce               | Plan      |
| `tech-stack.md`           | Poprawka 50 → 30 w tym plastrze                    | `CLAUDE.md` ładuje ten plik w każdej sesji, więc fałszywe twierdzenie propaguje się do każdej przyszłej decyzji                          | Plan      |

## Scope

**In scope:** tabela `generation_attempts` z RLS i celowym brakiem polityk UPDATE/DELETE ·
funkcja `usage_today()` · dwa kody błędu (429) z polskimi komunikatami bezosobowymi ·
bramka w `/api/generate` przed pierwszym wywołaniem modelu · zużycie w panelu i na generatorze ·
testy jednostkowe i integracyjne domykające R-07 · poprawka `tech-stack.md`

**Out of scope:** limity per format (roadmapa odrzuca wprost) · zapisywanie wyniku próby ·
klucz `service_role` · płatne progi · retencja i sprzątanie tabeli prób · pomiar Neuronów ·
domknięcie wyścigu dwóch równoległych żądań

## Architecture / Approach

```
POST /api/generate
  auth → JSON → validate            (darmowe, bez zmian)
  ─────────── BRAMKA ───────────
  brak klienta Supabase   → NOT_CONFIGURED
  usage_today()  (RPC, security definer, bez parametrów)
      ↓ rzuca                → INTERNAL, brak generowania
  checkLimits(usage)  (funkcja czysta)
      ↓ własny ≥ 10          → DAILY_LIMIT_REACHED (429)
      ↓ aplikacja ≥ 30       → APP_LIMIT_REACHED   (429)
  recordAttempt()  → insert PRZED modelem; rzuca → INTERNAL
  ──────────────────────────────
  attempt() … ponowna próba … zapis wyniku   (bez zmian)
```

Odczyt do wyświetlania idzie tą samą funkcją z `dashboard.astro` i `GenerateScreen.astro`,
oba renderowane serwerowo.

## Phases at a Glance

| Faza                                    | Co dowozi                                                        | Główne ryzyko                                                                             |
| --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Migracja, RLS, funkcja definer       | Tabela prób z dwiema politykami i funkcja zwracająca trzy liczby | Błąd w `security definer` jest błędem w modelu bezpieczeństwa, nie w funkcji              |
| 2. Bramka i warstwa limitów             | Odmowa przed pierwszym Neuronem, zapis próby, testy jednostkowe  | Bramka wstawiona o jedną linię za późno wydaje Neurony przed sprawdzeniem                 |
| 3. Panel i generator                    | Zużycie widoczne przed kliknięciem                               | Licznik w wyspie rozjeżdża się po nieudanej generacji — świadome, opisane ograniczenie    |
| 4. Testy integracyjne, R-07, tech-stack | Dowód w bazie i domknięcie luki w rejestrze ryzyk                | Zestaw pod `service_role` byłby zielony także przy dziurawej polityce — musi iść pod anon |

**Prerequisites:** S-03 (`done`) · Docker i `npx supabase start` dla fazy 4 · liczby 30 i 10
(ustalone 2026-09-07, zapisane w `change.md`)

**Estimated effort:** ~2 sesje na cztery fazy; faza 1 i 4 są krótkie, ciężar leży w fazie 2.

## Open Risks & Assumptions

- **Wyścig dwóch równoległych żądań tego samego konta.** Odczyt i zapis to dwie operacje, więc
  dwa żądania mogą oba zobaczyć „9 z 10" i oba przejść. Przy jednym realnym użytkowniku to
  przekroczenie o jedną pozycję, nie wyciek kosztu. Domknięcie wymagałoby transakcji.
- **Liczby 33/151 Neuronów nie są zmierzone** — pochodzą z `tech-stack.md`. Sufit 30 ma z tego
  powodu zapas, ale jeśli rzeczywisty koszt opowiadania jest wyższy, zapas topnieje.
- **Fail-closed odbiera generowanie w trybie nieskonfigurowanym.** Dziś przy `supabase === null`
  aplikacja generuje bez zapisu; po tej zmianie odmawia. Celowa strata funkcji.
- **Wyjątek od RLS istnieje od tej zmiany.** Do tej pory izolacja kont stała wyłącznie na
  politykach. Od teraz jest jeden obiekt bazy, dla którego one nie obowiązują — jego poprawność
  jest przedmiotem testu integracyjnego, nie założeniem.
- **Licznik na generatorze zawyża się po nieudanej generacji** do odświeżenia strony.

## Success Criteria (Summary)

- Po dziesiątej generacji w dobie jedenaste kliknięcie daje polski komunikat wyjaśniający, a
  w logach Workera nie ma wpisu błędu — bo odmowa to spodziewana ścieżka, nie awaria
- Panel i generator pokazują to samo zużycie i tę samą godzinę odnowienia
- R-07 przestaje być luką: rozszerzenie polityki SELECT nowej tabeli robi zestaw integracyjny
  czerwonym, a `service_role` nie jest w nim użyty ani razu

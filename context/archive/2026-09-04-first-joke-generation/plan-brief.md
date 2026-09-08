# Generowanie dowcipu na temat użytkownika — Plan Brief

> Pełny plan: `context/changes/first-joke-generation/plan.md`
> Roadmapa: `context/foundation/roadmap.md` — pozycja **S-01**, gwiazda przewodnia M-1

## What & Why

Użytkownik wpisuje temat, wybiera długość, dostaje dowcip spełniający kontrakt formatu na tym
samym ekranie i kopiuje go jednym działaniem. To pierwsze kryterium sukcesu z PRD przepisane
wprost — i jedyne miejsce w produkcie, gdzie żyje logika biznesowa odróżniająca Storygena od
otwartego czatu: wyjście łamiące kontrakt jest produkowane ponownie raz, a drugie niepowodzenie
kończy się czytelnym błędem, nie tekstem poza kontraktem.

## Starting Point

Kontrakt odpowiedzi API z `F-01` działa i jest przetestowany w boju (`S-08` był jego pierwszym
konsumentem). Tabela `generations` istnieje. Nie istnieje natomiast **nic** z generowania:
`wrangler.jsonc` nie ma bindingu AI, w kodzie nie ma żadnego wywołania modelu, promptu,
walidatora ani ekranu.

## Desired End State

Zalogowany użytkownik generuje dowcip na własny temat w jednym z trzech presetów długości,
widzi ciągły postęp przez cały czas oczekiwania, dostaje tekst mieszczący się w limicie słów
i kopiuje go jednym kliknięciem. Temat spoza 3–80 znaków jest odrzucany przed wysłaniem;
temat, którego model odmówi, kończy się polskim komunikatem kierującym do zmiany tematu.

## Key Decisions Made

| Decyzja              | Wybór                                                            | Dlaczego                                                                                                                            |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Postęp               | Wskaźnik, bez strumieniowania                                    | Walidacja kontraktu wymaga całości tekstu, więc strumień nie pokazałby nic zatwierdzonego; koperta z `F-01` nie przenosi strumienia |
| Model w dev          | Prawdziwy binding, zdalnie                                       | Jakość polszczyzny i opóźnienie to główne ryzyko — atrapa nie zmierzy ani jednego, ani drugiego                                     |
| Kiedy mierzyć jakość | Osobna faza 1, przed walidatorem                                 | Walidator projektowany pod rzeczywiste zachowanie modelu; zła jakość ujawnia się przy najniższym koszcie zmiany                     |
| Walidator            | Mechanicznie: długość i czystość                                 | Puenty nie da się sprawdzić bez drugiego wywołania modelu, które wywróciłoby NFR — wymusza ją prompt                                |
| Ponowna próba        | Prompt wzbogacony o powód odrzucenia                             | Identyczna powtórka przy systematycznym przekraczaniu limitu jest loterią kosztującą czas i neurony                                 |
| Budżet czasu         | Dzielony między dwie próby                                       | Obietnica NFR dotrzymana także w najgorszym przypadku; inaczej odrzucenie plus powtórka dają dwukrotność                            |
| Presety              | Skalują limit słów w kontrakcie                                  | Wybór użytkownika ma realny skutek, a walidator dostaje jedną liczbę zamiast dwóch reguł                                            |
| Nowe kody            | `TOPIC_REJECTED`, `FORMAT_CONTRACT_FAILED`, `GENERATION_TIMEOUT` | Trzy sytuacje wymagają trzech różnych reakcji użytkownika; FR-007 wymaga podania powodu                                             |
| Temat niedozwolony   | Poleganie na odmowie modelu                                      | PRD `## Non-Goals` wyklucza moderację treści — własna lista byłaby wejściem w odrzucony zakres                                      |
| Zapis do historii    | Nie — zakres `S-03`                                              | Zapis niesie własne pytanie projektowe (udana generacja, nieudany zapis); mieszanie domen awarii utrudnia obie                      |
| Wywołanie dostawcy   | Wąski moduł, binding tylko tam                                   | `tech-stack.md` zapisał to jako **warunek** portowalności otwartych wag                                                             |

## Scope

**In scope:** binding AI w `wrangler.jsonc` · wąski moduł dostawcy · pomiar jakości jako bramka ·
walidator kontraktu i presety · prompt pierwszy i powtórkowy · endpoint `/api/generate`
z trzema nowymi kodami · ekran generowania z postępem i kopiowaniem · aktualizacja `CLAUDE.md`,
test-planu i roadmapy

**Out of scope:** zapis do historii (`S-03`) · format „opowiadanie" (`S-07`) · limity dzienne
(`S-04`) · strumieniowanie tekstu · własna moderacja tematów · mechaniczne sprawdzanie puenty ·
tłumaczenie starych ekranów auth (`S-02`)

## Architecture / Approach

Trzy rozdzielone odpowiedzialności. **Moduł dostawcy** wie tylko, jak wysłać prompt i zwrócić
tekst w budżecie czasu — to jedyne miejsce znające Workers AI. **Walidator** wie tylko, czy
tekst spełnia kontrakt, i zwraca powód odrzucenia w formie nadającej się do wstawienia
w prompt. **Endpoint** orkiestruje: próba, ocena, ewentualna powtórka z powodem, mapowanie
awarii na kody domenowe. Żaden nie wie o pozostałych więcej, niż musi — dzięki czemu walidator
i prompt da się testować bez modelu, a podmiana dostawcy jest zmianą w jednym pliku.

## Phases at a Glance

| Faza                | Co dowozi                                                         | Główne ryzyko                                                 |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Binding i pomiar | Działający binding i **odpowiedź, czy model daje radę po polsku** | To bramka — negatywny wynik zmienia kształt faz 2–4           |
| 2. Kontrakt formatu | Walidator i presety jako czyste funkcje z testami                 | Limity presetów zbyt bliskie sobie — wybór staje się pozorny  |
| 3. Endpoint         | `/api/generate` z regułą powtórki i trzema kodami                 | Rozpoznanie odmowy modelu jest heurystyczne, nie kodem błędu  |
| 4. Ekran            | Generowanie widoczne dla użytkownika, z kopiowaniem               | Zmiana `PROTECTED_ROUTES` nie działa bez restartu dev — cicho |
| 5. Dokumenty        | `CLAUDE.md`, R-06, notatki w roadmapie                            | Pominięcie sprawi, że osłabienie gwarancji zniknie z zapisu   |

**Prerequisites:** konto Cloudflare z dostępem do Workers AI i `wrangler login` (faza 1 i dalsze).
`F-01` domknięte — jest.
**Estimated effort:** pięć faz, każda z osobnym punktem wstrzymania; faza 1 kończy się twoją decyzją, nie testem.

## Open Risks & Assumptions

- **Cały plan zakłada, że bramka z fazy 1 przejdzie.** Jeśli Llama 3.3 70B nie utrzyma dowcipu
  z puentą w limicie słów po polsku, fazy 2–4 zmieniają kształt: przepisanie promptu, zmiana
  modelu, albo powrót do PRD z pytaniem, czy kontrakt formatu jest osiągalny na darmowym tierze.
- **Gwarancja jest słabsza, niż brzmi PRD.** Walidator egzekwuje długość i czystość, nie
  obecność puenty. To świadoma decyzja (drugie wywołanie modelu wywróciłoby NFR), ale przy
  ocenie „logiki biznesowej" trzeba ją umieć obronić.
- **Lokalna weryfikacja nie sprawdza budżetu platformy.** `astro dev` nie egzekwuje limitu
  10 ms CPU — pierwsze wdrożone generowanie pozostaje prawdziwym testem.
- **Podział budżetu czasu może się okazać za ciasny.** Jeśli pojedyncza próba regularnie
  przekracza połowę z 15 s, wybór jest binarny: rezygnacja z reguły powtórki (zmiana PRD) albo
  podniesienie budżetu (zmiana NFR). Plan nie rozstrzyga tego z góry, bo brakuje liczby.

## Success Criteria (Summary)

- Użytkownik przechodzi od pustego pola tematu do skopiowanego dowcipu w jednej sesji, bez dokumentacji
- Wygenerowany tekst mieści się w limicie słów wybranego presetu, a wyjście łamiące kontrakt nigdy nie trafia na ekran
- Każdy tryb awarii — odrzucony temat, złamany kontrakt, przekroczony czas — kończy się czytelnym zdaniem po polsku

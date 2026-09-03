---
project: "Storygen"
version: 1
status: draft
created: 2026-09-03
updated: 2026-09-03
prd_version: 1
main_goal: learn
top_blocker: decisions
milestone_id: full-path-mvp
milestone_seq: 1
milestone_status: open
---

# Roadmap: Storygen

> Wyprowadzone z `context/foundation/prd.md` (v1) + inwentaryzacji kodu z 2026-09-03.
> Edytuj w miejscu; archiwizuj, gdy dokument zostanie zastąpiony.
> Plastry poniżej są ułożone w kolejności zależności. Tabela „At a glance" jest indeksem.
> Nagłówki `##` i nazwy pól są po angielsku celowo — to kontrakt, po którym gripują skille
> `/10x-plan`, `/10x-implement` i `/10x-archive`. Treść jest po polsku, jak reszta dokumentów
> operacyjnych w tym repo.

## Milestone

**M-1: MVP — pełna ścieżka od rejestracji do historii** — Status: open

- **Intent:** Dowieźć wszystkie trzynaście wymagań must-have z PRD, tak żeby zadeklarowany
  cel edukacyjny — przejście całej ścieżki technicznej auth → generowanie → zapis → deploy —
  był faktycznie przejściem, a nie deklaracją. Kamień milowy zamyka się na wyniku, nie na dacie.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** każdy `F-NN` i `S-NN` poniżej ma Status `done`.
- **Scope anchors:** FR-001 … FR-013 (wszystkie trzynaście, wszystkie must-have), US-01,
  oraz wymagania niefunkcjonalne bramkujące wydanie: izolacja kont, komunikaty po polsku,
  odczuwalne 15 s / 30 s z ciągłym postępem.

## Vision recap

Storygen generuje krótki tekst — dowcip albo opowiadanie — na temat podany przez
użytkownika, i **wymusza kontrakt formatu**: dowcip mieści się w około sześćdziesięciu
słowach i kończy puentą, opowiadanie w około czterystu i ma początek, rozwinięcie
i zakończenie. Wyjście, które kontraktu nie spełnia, jest produkowane ponownie raz;
drugie niepowodzenie to czytelny błąd, nie tekst łamiący kontrakt. To jest różnica
między tym produktem a otwartym czatem — i jedyna rzecz, której otwarty czat nie robi.

Druga, wprost zapisana w PRD wartość jest edukacyjna: przejść pełną ścieżkę techniczną
od rejestracji, przez generowanie i zapis, po działający publiczny adres. Dlatego
kryteria sukcesu są techniczne, nie produktowe — nie ma tu retencji ani powrotów
do zmierzenia, bo docelowy użytkownik to jedna osoba: autor.

## North star

**S-01: użytkownik wpisuje temat, dostaje dowcip zgodny z kontraktem formatu i kopiuje go
jednym działaniem** — to pierwsze kryterium sukcesu z PRD przepisane wprost, i pierwszy
plaster, który dotyka jedynej technologii nieobecnej w repo (dostawcy LLM), co przy celu
sekwencjonowania `learn` decyduje o remisach.

> „Gwiazda przewodnia" (_north star_) znaczy tu: najmniejszy przepływ od końca do końca,
> którego udane dowiezienie dowodzi, że główna teza produktu się broni — dlatego stoi tak
> wcześnie, jak pozwalają jego zależności, bo cała reszta ma znaczenie tylko wtedy, gdy on
> działa.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                               | Prerequisites | PRD refs                                      | Status   |
| ---- | ---------------------------- | ------------------------------------------------------------------ | ------------- | --------------------------------------------- | -------- |
| F-01 | `api-error-contract`         | (foundation) jeden kształt odpowiedzi API i mapowanie błędów na PL | —             | FR-007, NFR (komunikaty po polsku)            | ready    |
| S-01 | `first-joke-generation`      | wpisać temat, dostać dowcip w kontrakcie formatu i skopiować go    | F-01          | FR-003, FR-005, FR-006, FR-007, FR-008, US-01 | blocked  |
| S-02 | `polish-auth-surface`        | przejść rejestrację, logowanie i błędy w całości po polsku         | F-01          | FR-001, FR-002, NFR (komunikaty po polsku)    | proposed |
| S-03 | `generation-history-storage` | mieć każdą udaną generację zapisaną na koncie bez akcji „zapisz"   | S-01          | FR-009, US-01                                 | proposed |
| S-04 | `daily-generation-limits`    | dostać czytelną odmowę po wyczerpaniu limitu, zamiast wyniku       | S-03          | FR-012, FR-013, US-01                         | blocked  |
| S-05 | `browse-generation-history`  | przeglądać własne generacje od najnowszej i otwierać je w całości  | S-03          | FR-010, NFR (izolacja kont)                   | proposed |
| S-06 | `delete-generation`          | usunąć pozycję z własnej historii                                  | S-05          | FR-011                                        | proposed |
| S-07 | `story-format-generation`    | wybrać format „opowiadanie" i dostać tekst z początkiem i końcem   | S-01          | FR-004                                        | proposed |

## Streams

Pomoc nawigacyjna — grupuje pozycje dzielące łańcuch zależności. Kolejność kanoniczna nadal
mieszka w grafie zależności poniżej; ta tabela to proponowana kolejność czytania w poprzek
równoległych torów.

| Stream | Theme                           | Chain                                      | Note                                                                                              |
| ------ | ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A      | Rdzeń: kontrakt → tekst → zapis | `F-01` → `S-01` → `S-03` → `S-05` → `S-06` | Główny tor; przy celu `learn` niesie całą ścieżkę techniczną, której przejście jest tu wartością. |
| B      | Powierzchnia po polsku          | `S-02`                                     | Dołącza do strumienia A przy `F-01`; dalej biegnie równolegle do `S-01`.                          |
| C      | Sufit kosztu                    | `S-04`                                     | Dołącza do A przy `S-03` — dzieli z nim migracje i wzorzec RLS.                                   |
| D      | Drugi format                    | `S-07`                                     | Dołącza do A przy `S-01`; ta sama integracja, ostrzejszy kontrakt formatu.                        |

## Baseline

Co już stoi w kodzie na dzień `2026-09-03` (zinwentaryzowane w repo, potwierdzone przez autora).
Fundamenty poniżej zakładają, że to istnieje, i **nie** budują tego ponownie.

- **Frontend:** present — Astro 6.3 SSR + wyspy React 19, Tailwind 4, shadcn/ui (`src/components/`).
- **Backend / API:** partial — trasy SSR działają, ale jedyne endpointy to
  `src/pages/api/auth/{signin,signup,signout}.ts`. Brak `zod`, brak ustalonego kształtu
  odpowiedzi dla endpointów nie-auth.
- **Data:** absent — klient Supabase podpięty (`src/lib/supabase.ts`, nullable z założenia),
  ale `supabase/` ma tylko `config.toml`. Zero migracji, zero tabel, ani jednego `.from(...)`.
- **Auth:** present — e-mail + hasło przez Supabase, sterowane middleware
  (`src/middleware.ts`, `PROTECTED_ROUTES`), zweryfikowane end-to-end na produkcji 2026-08-24.
- **Deploy / infra:** partial — żyje pod `https://storygen.storygen.workers.dev` (Cloudflare
  Workers, free tier). Deploy wyłącznie ręczny; `.github/workflows/ci.yml` wyzwala się na
  `master`, a gałąź to `main`, więc CI nie uruchamia się nigdy.
- **Observability:** partial — observability Cloudflare włączona; brak logowania i śledzenia
  błędów na poziomie aplikacji.
- **Dostawca LLM:** absent — żadnego SDK dostawcy w `package.json`. To jedyna integracja,
  od której PRD zależy, a której starter nie niesie.

## Foundations

### F-01: Kontrakt odpowiedzi API i warstwa komunikatów po polsku

- **Outcome:** (foundation) jeden, zapisany kształt odpowiedzi dla endpointów nie-auth,
  walidacja wejścia na granicy API, oraz jeden mechanizm mapowania błędów na komunikaty po
  polsku — z komunikatem domyślnym dla błędów nieznanych i pustych.
- **Change ID:** `api-error-contract`
- **PRD refs:** FR-007, NFR (każdy tryb awarii raportowany po polsku, bez wewnętrznej treści błędu)
- **Unlocks:** `S-01` (generowanie wnosi trzy własne tryby awarii — timeout, przekroczony
  limit, odrzucony temat — do mechanizmu, który dziś nie istnieje), `S-02`, `S-04`;
  domyka blokującą niewiadomą „jaki kształt odpowiedzi mają endpointy nie-auth" zapisaną
  jako tripwire w `CLAUDE.md`.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez tego każdy nowy endpoint wymyśla własny kształt — trzy niezależne przebiegi
  agenta już to zrobiły, każdy zwracając `Response.json(...)` obok redirectowego wzorca
  z `/api/auth/*`. Drugie ryzyko jest udowodnione na produkcji: `error.message` z SDK bywa
  puste i użytkownik dostaje pustą czerwoną ramkę (`lessons.md`, wpis o pustym komunikacie).
  Sekwencjonowane pierwsze, bo dokładanie tego po generowaniu znaczy retrofit czterech
  trybów awarii zamiast jednego.
- **Status:** ready

## Slices

### S-01: Użytkownik generuje dowcip na własny temat i kopiuje go

- **Outcome:** użytkownik wpisuje temat, wybiera format „dowcip" i długość, uruchamia
  generowanie i czyta wynik na tym samym ekranie, a jednym działaniem kopiuje go do schowka.
- **Change ID:** `first-joke-generation`
- **PRD refs:** FR-003, FR-005, FR-006, FR-007, FR-008, US-01, NFR (15 s / 30 s, ciągły postęp)
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - Który dostawca i model? Wybór przesądza koszt, odczuwalne opóźnienie (NFR pinuje 15 s / 30 s)
    i to, czy limity z FR-012/FR-013 mają sensowne liczby. `shape-notes.md` notuje to wprost jako
    nierozstrzygnięte. — Owner: autor. Block: yes.
  - Jak zdefiniowany jest „temat niedozwolony"? `## Business Logic` zobowiązuje się do odmowy,
    ale granicy kategorii nie definiuje. Kontrola długości 3–80 znaków da się zaplanować bez
    tego; odmowa treściowa nie. — Owner: autor. Block: no.
  - Trzy presety długości czy suwak? FR-005 koduje presety, więc plan może ruszyć — ale jeśli
    zmieniasz, zmień przed planowaniem, nie po. — Owner: autor. Block: no.
- **Risk:** To jest gwiazda przewodnia i jedyny plaster, który dotyka nowej integracji, więc
  niesie całe ryzyko techniczne kamienia milowego naraz: klucz dostawcy musi wejść przez
  `wrangler secret put`, nigdy przez `vars` w `wrangler.jsonc` (ten plik jest commitowany, a
  wyciek klucza łamie guardrail z `## Success Criteria`); walidator kontraktu formatu i reguła
  jednej ponownej próby to jedyna nietrywialna logika w aplikacji. Drugie ryzyko jest
  kosztowe i wynika z kolejności: między dowiezieniem `S-01` a `S-04` generowanie stoi pod
  publicznym adresem z otwartą rejestracją i bez żadnego sufitu. Jeśli to nie do przyjęcia,
  przestaw `S-04` przed `S-03` albo trzymaj rejestrację zamkniętą do czasu `S-04`.
- **Status:** blocked

### S-02: Użytkownik przechodzi rejestrację i logowanie w całości po polsku

- **Outcome:** użytkownik rejestruje się, loguje, wylogowuje i trafia pod nieznany adres,
  nie widząc ani jednego angielskiego napisu ani surowej treści błędu z Supabase.
- **Change ID:** `polish-auth-surface`
- **PRD refs:** FR-001, FR-002, NFR (interfejs i komunikaty wyłącznie po polsku)
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** FR-001 i FR-002 działają na produkcji od 2026-08-24, ale nie spełniają PRD —
  `deploy-plan.md` potwierdza na żywym adresie trzy naruszenia: interfejs po angielsku,
  surowe komunikaty Supabase odbite do URL-a (`?error=Invalid login credentials`) i pustą
  ramkę przy błędzie bez treści. Ten plaster domyka je do stanu zgodnego z PRD i obejmuje
  też `src/pages/404.astro`, którego dziś nie ma, przez co nieznana ścieżka zwraca 404
  z pustym ciałem. Może iść równolegle do `S-01` — dzieli z nim tylko `F-01`.
- **Status:** proposed

### S-03: Udana generacja zapisuje się na koncie użytkownika

- **Outcome:** każda udana generacja ląduje na koncie użytkownika bez żadnej akcji „zapisz"
  i jest tam po wylogowaniu i ponownym zalogowaniu.
- **Change ID:** `generation-history-storage`
- **PRD refs:** FR-009, US-01, NFR (żadna generacja nie jest czytelna dla innego konta)
- **Prerequisites:** S-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To pierwsza migracja w tym repo — `supabase/migrations/` jeszcze nie istnieje.
  RLS musi powstać w tej samej migracji co tabela: dołożenie polityk później zostawia okno,
  w którym gwarancja izolacji kont nie obowiązuje, a nic w kodzie tego nie wykryje. Drugi,
  udowodniony sposób cichego złamania tej samej gwarancji: użycie klucza `service_role`
  zamiast publishable — omija RLS bez błędu i bez testu, który by to złapał
  (`deploy-plan.md`, § Bramki ludzkie). Od tego plastra rollback przestaje być symetryczny:
  kod się cofa, migracje nie.
- **Status:** proposed

### S-04: Użytkownik po wyczerpaniu limitu dostaje wyjaśnienie zamiast wyniku

- **Outcome:** użytkownik, który wyczerpał własny dzienny limit — albo trafił na wyczerpany
  sufit dzienny całej aplikacji — widzi wyjaśniający komunikat po polsku, a generowanie
  nie jest w ogóle podejmowane.
- **Change ID:** `daily-generation-limits`
- **PRD refs:** FR-012, FR-013, US-01
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Jakie są liczby — ile generacji na konto na dobę, ile w sumie na całą aplikację — i czy
    limit na konto ma się różnić dla dowcipu i opowiadania? PRD zostawia oba bez liczby.
    Bez tego nie da się zaplanować ani mechaniki (jeden licznik czy dwa), ani odmowy. —
    Owner: autor. Block: yes.
- **Risk:** To jedyna bariera kosztowa w całym projekcie — rejestracja jest otwarta z wyboru,
  a aplikacja stoi pod publicznym adresem. Sekwencjonowane zaraz po `S-03`, bo liczniki
  potrzebują tej samej warstwy danych; może zostać przestawione **przed** `S-03`, jeśli
  wolisz nie mieć ani jednego dnia generowania bez sufitu — kosztem osobnej migracji
  zamiast wspólnej. Uwaga na środowisko: adapter Cloudflare v13 usunął
  `Astro.locals.runtime`, więc odczyt liczników przez niego zwróci `undefined` w runtime,
  a nie błąd typu (`infrastructure.md`, § rejestr ryzyk).
- **Status:** blocked

### S-05: Użytkownik przegląda własną historię i otwiera pozycje

- **Outcome:** użytkownik widzi własne generacje od najnowszej i otwiera dowolną z nich
  w całości; próba sięgnięcia po cudzą jest odrzucana.
- **Change ID:** `browse-generation-history`
- **PRD refs:** FR-010, NFR (żadna generacja nie jest czytelna dla innego konta)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To pierwszy ekran, na którym izolacja kont jest widoczna, a nie tylko
  zadeklarowana — i pierwszy, na którym da się ją realnie sprawdzić drugim kontem. Jeśli
  polityki RLS z `S-03` są za szerokie, wyjdzie to tutaj albo nigdy.
- **Status:** proposed

### S-06: Użytkownik usuwa pozycję z własnej historii

- **Outcome:** użytkownik usuwa wybraną generację ze swojej historii i nie widzi jej ponownie.
- **Change ID:** `delete-generation`
- **PRD refs:** FR-011
- **Prerequisites:** S-05
- **Parallel with:** S-04, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Najmniejszy plaster w kamieniu milowym i jedyny nieodwracalny z punktu widzenia
  użytkownika. Wymaga własnej polityki RLS na `delete` — konwencja repo mówi o politykach
  granularnych per operacja i per rola, więc polityka `select` z `S-05` tego nie pokryje.
- **Status:** proposed

### S-07: Użytkownik generuje opowiadanie zamiast dowcipu

- **Outcome:** użytkownik wybiera format „opowiadanie" i dostaje tekst z początkiem,
  rozwinięciem i zakończeniem, mieszczący się w kontrakcie długości tego formatu.
- **Change ID:** `story-format-generation`
- **PRD refs:** FR-004
- **Prerequisites:** S-01
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** PRD trzyma ten format na uzasadnieniu technicznym, nie personalnym, i mówi to
  wprost: dłuższa forma trudniej utrzymuje strukturę, więc mocniej sprawdza kontrakt formatu
  niż dowcip. Tu też najpierw uderzy NFR opóźnienia — to jedyny plaster celujący w budżet
  30 s zamiast 15 s, i jedyny, w którym reguła „jedna ponowna próba" może wypchnąć łączny
  czas poza to, co użytkownik zaakceptuje.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                           |
| ---------- | ---------------------------- | ------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| F-01       | `api-error-contract`         | Ustal kontrakt odpowiedzi API i warstwę komunikatów po polsku | yes                   | `/10x-plan api-error-contract`                  |
| S-01       | `first-joke-generation`      | Generowanie dowcipu na temat użytkownika z kopiowaniem wyniku | no                    | Blokada: nierozstrzygnięty dostawca i model LLM |
| S-02       | `polish-auth-surface`        | Rejestracja, logowanie i błędy w całości po polsku            | no                    | Czeka na F-01                                   |
| S-03       | `generation-history-storage` | Zapis generacji na konto — pierwsza migracja i RLS            | no                    | Czeka na S-01                                   |
| S-04       | `daily-generation-limits`    | Dzienny limit na konto i sufit dzienny całej aplikacji        | no                    | Blokada: brak liczb dla FR-012/FR-013           |
| S-05       | `browse-generation-history`  | Przeglądanie własnej historii generacji                       | no                    | Czeka na S-03                                   |
| S-06       | `delete-generation`          | Usuwanie pozycji z historii                                   | no                    | Czeka na S-05                                   |
| S-07       | `story-format-generation`    | Format „opowiadanie" — drugi kontrakt formatu                 | no                    | Czeka na S-01                                   |

## Open Roadmap Questions

1. **Który dostawca i model LLM?** Wybór przesądza koszt, odczuwalne opóźnienie (NFR pinuje
   15 s dla krótkich i 30 s dla długich generacji) oraz to, czy limity z FR-012/FR-013 mają
   sensowne liczby. `shape-notes.md` notuje to jako nierozstrzygnięte od 2026-08-11. —
   Owner: autor. Block: `S-01`, `S-03`, `S-07` (przez `S-01`), pośrednio `S-04`.
2. **Jakie są liczby limitów i czy limit na konto ma się różnić dla dowcipu i opowiadania?**
   PRD `## Open Questions` #1. Opowiadanie kosztuje więcej niż dowcip, a żadne z FR-012
   i FR-013 nie ma przypisanej liczby. — Owner: autor. Block: `S-04`.
3. **Jak zdefiniowany jest „temat niedozwolony"?** PRD `## Open Questions` #3. Sekcja
   `## Business Logic` zobowiązuje się do odmowy bez wyznaczenia granicy kategorii. Nie blokuje planowania
   `S-01` (kontrola długości 3–80 znaków stoi osobno), ale blokuje ścieżkę odmowy treściowej
   z FR-007. — Owner: autor. Block: częściowo `S-01`, `S-07`.
4. **Trzy presety długości czy suwak liczby słów?** PRD `## Open Questions` #2. FR-005 koduje
   presety, więc planowanie może ruszyć — ale zmiana po zaplanowaniu `S-01` to przeróbka.
   — Owner: autor. Block: nie blokuje.
5. **Czym weryfikować walidator kontraktu formatu i regułę jednej ponownej próby?** W repo nie
   ma runnera testów ani skryptu `test`, a to jedyna nietrywialna logika w aplikacji —
   dokładnie ta, której nie da się rzetelnie sprawdzić ręcznie. Wybór runnera to otwarta
   decyzja, nie istniejąca konwencja. — Owner: autor. Block: nie blokuje planowania, ale
   bramkuje wiarygodność weryfikacji `S-01` i `S-07`.
6. **Czy jest twardy termin?** PRD `## Open Questions` #4 — pole `hard_deadline` jest `null`
   przez brak odpowiedzi, nie przez decyzję. — Owner: autor. Block: nie blokuje.
7. **Czy `target_scale.users: small` jest poprawne?** PRD `## Open Questions` #5. Na tym
   założeniu stoi płaski model użytkownika, brak moderacji i kształt obu limitów. —
   Owner: autor. Block: nie blokuje, ale jego zmiana unieważnia `S-04` i `## Access Control`.
8. **Czy dziesięć z trzynastu FR ma przejść rundę kwestionowania przed implementacją?**
   PRD `## Open Questions` #6 — FR-001, FR-002 i FR-005 … FR-011, FR-013 nie mają zapisanego
   kontrargumentu. — Owner: autor. Block: nie blokuje.

## Parked

- **Logowanie przez zewnętrznego dostawcę tożsamości, magic linki, 2FA, reset hasła mailem** —
  PRD `## Non-Goals`: każde to druga integracja zewnętrzna, czego zabrania kryterium zakresu.
  Konsekwencja zapisana świadomie: zapomniane hasło unieruchamia konto.
- **Udostępnianie i linki publiczne** — PRD `## Non-Goals`; trzyma produkt jednodostępowym.
- **Eksport do PDF/DOCX, wysyłka mailem, integracje z mediami społecznościowymi** —
  PRD `## Non-Goals`; schowek pokrywa zadeklarowaną potrzebę.
- **Edycja i regeneracja fragmentu, wersjonowanie wyniku** — PRD `## Non-Goals`; kontrakt
  formatu rządzi całym wyjściem albo niczym.
- **Personalizacja: własne szablony instrukcji, wybór modelu przez użytkownika, wybór gatunku** —
  PRD `## Non-Goals`.
- **Więcej niż jeden język, płatności i plany, moderacja treści, panel administracyjny,
  zgłaszanie nadużyć, obrazy i audio, tryb offline, aplikacja mobilna, rozszerzenie
  przeglądarki, analityka produktowa i testy A/B** — PRD `## Non-Goals`.
- **CI: naprawa triggera `master` → `main` i job deployu** — nie ma śladu w PRD i nie odblokowuje
  żadnego plastra; deploy ręczny działa. Kolejność i uzasadnienie: `deploy-plan.md`, § Dług, p. 4
  (trigger osobnym commitem, potwierdzić przebieg, dopiero potem job deployu).
- **`secrets.required` w `wrangler.jsonc`, bump `compatibility_date` (Node-compat v1 → v2),
  token API o zawężonym zakresie** — `deploy-plan.md`, § Dług, p. 2, 5, 6. Praca
  infrastrukturalna bez śladu w PRD; wciągnij do kamienia milowego dopiero, jeśli któryś
  plaster się o to potknie.
- **CRLF psujący `npm run lint` na całym repo** — tripwire w `CLAUDE.md` z obejściem
  (lintuj pliki, które ruszyłeś). Nie blokuje żadnego plastra, ale każdy plaster płaci tym
  obejściem, więc warto wrócić, gdy któryś kamień milowy będzie miał na to miejsce.

## Milestone History

(Pusta — to pierwszy kamień milowy.)

## Done

(Pusta. `/10x-archive` dopisuje tu wpis i przestawia Status pozycji na `done`, gdy zmiana
o pasującym `Change ID` zostaje zarchiwizowana. Nie wypełniać z góry.)

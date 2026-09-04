---
project: "Storygen"
version: 1
status: draft
created: 2026-09-03
updated: 2026-09-04
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
- **Source materials:** `context/foundation/prd.md` (v1) + wymagania certyfikacyjne MVP
  (moduły 1–3), dołączone 2026-09-03 jako drugie źródło.
- **Done when:** każdy `F-NN` i `S-NN` poniżej ma Status `done`.
- **Scope anchors:** FR-001 … FR-013 (wszystkie trzynaście, wszystkie must-have), US-01,
  oraz wymagania niefunkcjonalne bramkujące wydanie: izolacja kont, komunikaty po polsku,
  odczuwalne 15 s / 30 s z ciągłym postępem.
- **Kotwice z wymagań certyfikacyjnych** (dla pozycji, które nie mają odpowiednika w PRD):
  - MS-01: pełne CRUD — tworzenie, odczyt, **aktualizacja** i usuwanie, w sposób sensowny
    dla domeny. PRD pokrywa C/R/D (FR-009, FR-010, FR-011); aktualizacji nie ma, bo
    `## Non-Goals` zakazuje edycji wygenerowanego tekstu. `S-08` domyka „U" na metadanych
    pozycji, nie na treści — zakaz zostaje nienaruszony.
  - MS-02: logika biznesowa — pokryta kontraktem formatu (`S-01`, `S-07`).
  - MS-03: co najmniej jeden zestaw testów adresujący konkretne ryzyko z dokumentu
    test-planu — dokument: `context/foundation/test-plan.md`.
  - MS-04: dostęp powiązany z użytkownikiem, który widzi wyłącznie swoje zasoby —
    pokryte przez istniejące auth plus RLS w `S-03` i `S-05`.

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
| F-01 | `api-error-contract`         | (foundation) jeden kształt odpowiedzi API i mapowanie błędów na PL | —             | FR-007, NFR (komunikaty po polsku)            | done     |
| S-01 | `first-joke-generation`      | wpisać temat, dostać dowcip w kontrakcie formatu i skopiować go    | F-01          | FR-003, FR-005, FR-006, FR-007, FR-008, US-01 | in-progress |
| S-02 | `polish-auth-surface`        | przejść rejestrację, logowanie i błędy w całości po polsku         | F-01          | FR-001, FR-002, NFR (komunikaty po polsku)    | proposed |
| S-03 | `generation-history-storage` | mieć każdą udaną generację zapisaną na koncie bez akcji „zapisz"   | S-01          | FR-009, US-01                                 | proposed |
| S-04 | `daily-generation-limits`    | dostać czytelną odmowę po wyczerpaniu limitu, zamiast wyniku       | S-03          | FR-012, FR-013, US-01                         | proposed |
| S-05 | `browse-generation-history`  | przeglądać własne generacje od najnowszej i otwierać je w całości  | S-03          | FR-010, NFR (izolacja kont)                   | proposed |
| S-06 | `delete-generation`          | usunąć pozycję z własnej historii                                  | S-05          | FR-011                                        | proposed |
| S-07 | `story-format-generation`    | wybrać format „opowiadanie" i dostać tekst z początkiem i końcem   | S-01          | FR-004                                        | proposed |
| S-08 | `annotate-generation`        | nadać własny tytuł zapisanej generacji i później go zmienić        | F-01          | MS-01                                         | done     |

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
| E      | Metadane pozycji                | `S-08`                                     | Dołącza do A przy `F-01`; jedyny tor niezależny od dostawcy LLM.                                  |

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
- **Dostawca LLM:** wybrany 2026-09-03, jeszcze niepodłączony — Cloudflare Workers AI
  (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) przez binding, bez klucza API. To jedyna integracja,
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
- **Status:** done

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
  - ~~Który dostawca i model?~~ Rozstrzygnięte 2026-09-03: Cloudflare Workers AI,
    `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, przez binding (bez klucza API). Szczegóły
    i pozostałe ryzyko jakościowe w `## Open Roadmap Questions` #1. — Block: no.
  - Czy Llama 3.3 70B utrzyma kontrakt formatu po polsku — dowcip z puentą w 60 słowach?
    Nie zweryfikowane. To nie blokuje planowania (interfejs do dostawcy jest ten sam
    niezależnie od odpowiedzi), ale jest głównym ryzykiem dowiezienia tego plastra.
    Zmierz promptem, zanim napiszesz walidator. — Owner: autor. Block: no.
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
- **Status:** in-progress

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
- **Zakres zwężony 2026-09-03 przez `S-08`:** tabela `generations` i polityki RLS
  `select`/`insert`/`update` **już istnieją** (migracja `20260903125113_create_generations.sql`).
  Ten plaster dokłada wyłącznie zapis z generowania — nie tworzy tabeli i nie projektuje
  schematu. Kolumny `topic`, `format`, `length_preset`, `content` czekają gotowe.
- **Risk:** ~~To pierwsza migracja w tym repo~~ — nieaktualne, patrz wyżej. Historyczne
  uzasadnienie zostaje, bo nadal obowiązuje przy każdej kolejnej migracji:
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
  - ~~Jakie są liczby limitów?~~ Odpowiedziane 2026-09-03 przez wybór dostawcy: darmowy
    tier to 10 000 neuronów dziennie ≈ 300 dowcipów albo 66 opowiadań. Proponowany sufit
    FR-013: **50 generacji dziennie na całą aplikację**. Rozróżnienie per format zbędne —
    sufit neuronowy sam wycenia opowiadanie ~4,5× drożej niż dowcip. Liczba dla FR-012
    (na konto) do dobrania w planie; przy jednym realnym użytkowniku wystarczy ułamek. —
    Block: no.
- **Risk:** To jedyna bariera kosztowa w całym projekcie — rejestracja jest otwarta z wyboru,
  a aplikacja stoi pod publicznym adresem. Sekwencjonowane zaraz po `S-03`, bo liczniki
  potrzebują tej samej warstwy danych; może zostać przestawione **przed** `S-03`, jeśli
  wolisz nie mieć ani jednego dnia generowania bez sufitu — kosztem osobnej migracji
  zamiast wspólnej. Uwaga na środowisko: adapter Cloudflare v13 usunął
  `Astro.locals.runtime`, więc odczyt liczników przez niego zwróci `undefined` w runtime,
  a nie błąd typu (`infrastructure.md`, § rejestr ryzyk).
- **Status:** proposed

### S-05: Użytkownik przegląda własną historię i otwiera pozycje

- **Outcome:** użytkownik widzi własne generacje od najnowszej i otwiera dowolną z nich
  w całości; próba sięgnięcia po cudzą jest odrzucana.
- **Change ID:** `browse-generation-history`
- **PRD refs:** FR-010, NFR (żadna generacja nie jest czytelna dla innego konta)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-07
- **Blockers:** —
- **Unknowns:** —
- **Zakres zwężony 2026-09-03 przez `S-08`:** minimalna lista własnych pozycji już istnieje
  (`src/pages/generations.astro`) — pokazuje tytuł albo początek tekstu, ma stan pustej
  historii i jest w `PROTECTED_ROUTES`. Ten plaster dokłada to, czego tam nie ma: otwieranie
  pozycji w całości, sortowanie i paginację, jeśli okażą się potrzebne.
- **Risk:** ~~To pierwszy ekran, na którym izolacja kont jest widoczna~~ — nieaktualne:
  izolację widać już na liście z `S-08` i pokrywa ją test integracyjny (R-05 w test-planie).
  Zostaje ryzyko właściwe temu plastrowi: otwarcie pozycji w całości wprowadza drugi punkt
  odczytu, a każdy nowy odczyt to nowa okazja do obejścia RLS filtrem w kodzie.
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

### S-08: Użytkownik nadaje własny tytuł zapisanej generacji

- **Outcome:** użytkownik nadaje pozycji w historii własny tytuł i może go później zmienić,
  dzięki czemu odnajduje swoje teksty po tym, jak je nazwał, a nie po pierwszych słowach.
- **Change ID:** `annotate-generation`
- **PRD refs:** MS-01 (kotwica z wymagań certyfikacyjnych — patrz `## Milestone`)
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-04, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To jedyny plaster bez śladu w PRD — powstał, bo wymagania certyfikacyjne żądają
  pełnego CRUD, a PRD `## Non-Goals` zakazuje edycji wygenerowanego tekstu („the format
  contract governs the whole output or nothing"). Rozwiązanie omija konflikt, zamiast go
  rozstrzygać: aktualizacja dotyczy **metadanych** pozycji, nie treści, więc zakaz zostaje
  nienaruszony i teza produktu też. Jeśli oceniający uzna edycję tytułu za zbyt cienkie „U",
  następnym krokiem jest regeneracja w miejscu — ale ta wymaga przeredagowania Non-Goala,
  więc jest decyzją produktową, nie implementacyjną. Nie zależy od dostawcy LLM, więc da się
  ją zaplanować i dowieźć niezależnie od blokady na `S-01`.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ---------------------------- | ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| F-01       | `api-error-contract`         | Ustal kontrakt odpowiedzi API i warstwę komunikatów po polsku | yes                   | `/10x-plan api-error-contract`                               |
| S-01       | `first-joke-generation`      | Generowanie dowcipu na temat użytkownika z kopiowaniem wyniku | yes                   | Plan gotowy — `/10x-implement first-joke-generation phase 1` |
| S-02       | `polish-auth-surface`        | Rejestracja, logowanie i błędy w całości po polsku            | no                    | Czeka na F-01                                                |
| S-03       | `generation-history-storage` | Zapis generacji na konto — pierwsza migracja i RLS            | no                    | Czeka na S-01                                                |
| S-04       | `daily-generation-limits`    | Dzienny limit na konto i sufit dzienny całej aplikacji        | no                    | Blokada: brak liczb dla FR-012/FR-013                        |
| S-05       | `browse-generation-history`  | Przeglądanie własnej historii generacji                       | no                    | Czeka na S-03                                                |
| S-06       | `delete-generation`          | Usuwanie pozycji z historii                                   | no                    | Czeka na S-05                                                |
| S-07       | `story-format-generation`    | Format „opowiadanie" — drugi kontrakt formatu                 | no                    | Czeka na S-01                                                |
| S-08       | `annotate-generation`        | Własny tytuł zapisanej generacji                              | yes                   | Plan gotowy — `/10x-implement annotate-generation phase 1`   |

## Open Roadmap Questions

1. ~~**Który dostawca i model LLM?**~~ **ROZSTRZYGNIĘTE 2026-09-03: Cloudflare Workers AI,
   model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** Otwarte wagi, ta sama platforma co
   deploy, **binding zamiast klucza API** — dzięki temu guardrail z `## Success Criteria`
   („poświadczenia nigdy nie są obserwowalne z produktu") spełnia się strukturalnie, a nie
   przez dyscyplinę. Darmowy tier: 10 000 neuronów dziennie, bez karty.
   Pozostałe ryzyko, **niezweryfikowane**: jakość polskiego dowcipu z puentą w 60 słowach.
   Jeśli kontrakt formatu będzie pękał, reguła jednej ponownej próby odpali się częściej,
   podwajając zużycie neuronów i czas wobec NFR 15 s. Wagi są otwarte, więc przesiadka na
   inny model albo hosting jest zmianą w jednym module — pod warunkiem, że `S-01` schowa
   wywołanie dostawcy za wąskim interfejsem, tak jak `F-01` zrobił z błędami.
   Uwaga wdrożeniowa: adapter Cloudflare v13 usunął `Astro.locals.runtime`, więc do bindingu
   sięga się przez `import { env } from "cloudflare:workers"` (patrz `infrastructure.md`).
2. ~~**Jakie są liczby limitów?**~~ **ODPOWIEDZIANE 2026-09-03 przez wybór z #1.** Zużycie
   przy ~300 tokenach promptu: dowcip ~33 neurony, opowiadanie ~151. Darmowy dzienny limit
   10 000 neuronów to **~300 dowcipów albo ~66 opowiadań na dobę dla całej aplikacji**.
   Proponowany sufit FR-013: **50 generacji dziennie** — mieści się w darmowym tierze nawet
   przy samych opowiadaniach, z zapasem na ponowne próby. FR-012 (na konto): przy jednym
   realnym użytkowniku wystarczy ułamek tego; liczba do dobrania w planie `S-04`.
   Rozróżnienie limitu per format **nie jest potrzebne** — sufit neuronowy sam w sobie
   wycenia opowiadanie drożej niż dowcip.
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

- **F-01: (foundation) jeden, zapisany kształt odpowiedzi dla endpointów nie-auth, walidacja wejścia na granicy API, oraz jeden mechanizm mapowania błędów na komunikaty po polsku** — Archived 2026-09-04 → `context/archive/2026-09-03-api-error-contract/`. Lesson: —.
- **S-08: użytkownik nadaje pozycji w historii własny tytuł i może go później zmienić** — Archived 2026-09-04 → `context/archive/2026-09-03-annotate-generation/`. Lesson: —.

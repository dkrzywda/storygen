# Generowanie dowcipu na temat użytkownika — Implementation Plan

## Overview

Użytkownik wpisuje temat, wybiera długość, uruchamia generowanie i czyta dowcip na tym samym
ekranie, a jednym działaniem kopiuje go do schowka. To gwiazda przewodnia kamienia milowego
M-1 — pierwsze kryterium sukcesu z PRD przepisane wprost — i pierwsza integracja zewnętrzna
w tym projekcie.

To także jedyne miejsce w produkcie, gdzie żyje logika biznesowa: kontrakt formatu, który
odróżnia Storygena od otwartego czatu. Wyjście niespełniające kontraktu jest produkowane
ponownie raz; drugie niepowodzenie kończy się czytelnym błędem, nie tekstem łamiącym kontrakt.

## Current State Analysis

**Co istnieje.** Kontrakt odpowiedzi API z `F-01` (zarchiwizowany): koperta `{ data }` /
`{ error }`, dziewięć kodów domenowych ze statusami w `src/lib/api-errors.ts`, `validate()`
w `src/lib/validation.ts`, `jsonOk`/`jsonError` w `src/lib/api-response.ts`, log surowego
błędu przez `logApiError`. Auth działa, middleware wstawia użytkownika do `context.locals.user`.
Tabela `generations` istnieje z kolumnami `topic`, `format`, `length_preset`, `content`
(z `S-08`). Vitest: 68 testów jednostkowych, 6 integracyjnych.

**Czego brakuje.**

- `wrangler.jsonc` nie ma sekcji `ai` — bindingu nie ma w ogóle.
- Nie ma żadnego wywołania modelu, żadnego promptu, żadnego walidatora.
- Nie ma ekranu generowania; `src/pages/index.astro` to nadal powitanie startera.
- Kontrakt z `F-01` nie zna kodów dla odrzuconego tematu, złamanego kontraktu formatu
  ani przekroczonego czasu.

**Ograniczenia — trzy, które się nawzajem napinają.**

- **NFR: 15 s dla krótkich, 30 s dla długich**, z ciągłym widocznym postępem. Reguła jednej
  ponownej próby oznacza, że w najgorszym razie dwie próby muszą zmieścić się w tym budżecie.
- **Limit 10 ms CPU na darmowym planie Workers.** Czekanie na `fetch` nie zużywa CPU, ale
  parsowanie i walidacja wyjścia już tak. Rejestr ryzyk w `infrastructure.md` wskazuje ten
  limit jako realny dla formatu „opowiadanie" (`S-07`); mechanizm powstaje jednak tutaj.
- **`astro dev` nie egzekwuje limitów CPU ani subrequestów.** `infrastructure.md` mówi wprost:
  lokalny sukces daje fałszywą pewność, a pierwsze wdrożone generowanie jest prawdziwym testem.

## Desired End State

Zalogowany użytkownik wchodzi na ekran generowania, wpisuje temat, wybiera jeden z trzech
presetów długości, klika i po kilku–kilkunastu sekundach — z widocznym postępem przez cały
czas — dostaje dowcip mieszczący się w limicie słów swojego presetu. Kopiuje go jednym
kliknięciem. Temat spoza zakresu 3–80 znaków jest odrzucany, zanim cokolwiek zostanie wysłane.
Temat, którego model odmówi, kończy się czytelnym polskim komunikatem, a nie błędem technicznym.

**Jak to zweryfikować:** `npm test` i `npm run test:integration` przechodzą; wygenerowany
dowcip mieści się w limicie słów; przekroczenie budżetu czasu daje komunikat, nie zawieszenie;
przycisk kopiowania wstawia tekst do schowka.

### Key Discoveries:

- **Binding AI trzeba dodać do `wrangler.jsonc`**, a sięgać po niego przez
  `import { env } from "cloudflare:workers"` — adapter v13 usunął `Astro.locals.runtime`
  i sięgnięcie po nie daje `undefined` w runtime, **nie błąd typu**. To udokumentowany tripwire.
- **`API_ERRORS` jest `Record<ApiErrorCode, …>`** — nowy kod bez wpisu w słowniku jest błędem
  kompilacji, nie błędem w runtime. Trzy nowe kody dostają wpisy automatycznie wymuszone.
- **`validate()` wymaga polskich komunikatów w definicji schematu** — domyślne teksty Zoda są
  po angielsku i nie mogą trafić na powierzchnię produktu (`lessons.md`).
- **Wzorzec wąskiego modułu jest już w repo**: `F-01` schował mapowanie błędów za
  `src/lib/api-errors.ts` i to właśnie ta izolacja pozwoliła podmienić zachowanie bez ruszania
  endpointów. Ten sam wzorzec stosujemy do dostawcy.
- **Tabela `generations` czeka gotowa**, ale ten plan do niej nie pisze — zapis należy do `S-03`.

## What We're NOT Doing

- **Zapis do historii** (`S-03`) — tabela istnieje, ale ten plaster jej nie dotyka. Zapis niesie
  własne pytanie projektowe (co, gdy generowanie się uda, a zapis padnie) i zasługuje na własny plaster.
- **Format „opowiadanie"** (`S-07`) — walidator i presety powstają w kształcie, który go
  obsłuży, ale drugi format wchodzi osobno.
- **Limity dzienne** (`S-04`) — nic nie liczy generacji. Do czasu `S-04` sufit z FR-013 nie istnieje w kodzie.
- **Strumieniowanie tekstu** — świadomie odrzucone: walidacja kontraktu wymaga całości wyjścia,
  a koperta z `F-01` nie przenosi strumienia.
- **Własna moderacja tematów** — PRD `## Non-Goals` wyklucza moderację treści. Polegamy na
  odmowie modelu i mapujemy ją na kod.
- **Sprawdzanie obecności puenty** — mechanicznie niewykonalne bez drugiego wywołania modelu,
  które wywróciłoby NFR. Puentę wymusza prompt.
- **Tłumaczenie starych ekranów auth** (`S-02`) — nowy ekran jest po polsku, stare zostają.

## Implementation Approach

Pięć faz, z **bramką jakościową na samym początku**. Faza 1 podpina binding i każe ocenić
kilkanaście prawdziwych wyjść, zanim powstanie jakikolwiek walidator. Powód jest praktyczny:
walidator ma być zaprojektowany pod rzeczywiste zachowanie modelu, a nie pod wyobrażenie o nim.
Jeśli bramka nie przejdzie, tańsze jest przepisanie promptu albo zmiana modelu niż przeróbka
walidatora, endpointu i interfejsu naraz.

Dalej: kontrakt formatu jako czyste funkcje (testowalne bez modelu), potem endpoint, który
z nich korzysta, potem ekran, na końcu dokumenty.

Rozdział odpowiedzialności: **moduł dostawcy** wie tylko, jak wysłać prompt i zwrócić tekst;
**walidator** wie tylko, czy tekst spełnia kontrakt; **endpoint** orkiestruje próbę, ocenę
i ewentualną powtórkę. Żaden z nich nie wie o pozostałych dwóch więcej, niż musi.

## Critical Implementation Details

**Budżet czasu dzieli się między próby, nie mnoży.** NFR obiecuje 15 s dla krótkiej generacji.
Reguła jednej ponownej próby oznacza dwie próby, więc każda dostaje mniej więcej połowę budżetu
minus narzut. Bez tego podziału odrzucona pierwsza próba plus druga dają 30 s — dwukrotność
obietnicy — i użytkownik dowiaduje się o tym, czekając.

**Powód odrzucenia wraca do modelu.** Druga próba nie jest identycznym strzałem: prompt niesie
informację, co poszło nie tak („poprzednia wersja miała 95 słów, zmieść się w 40"). Identyczna
powtórka przy systematycznym przekraczaniu limitu jest loterią, która kosztuje czas i neurony.

**Odmowa modelu to nie awaria.** Model może odmówić wygenerowania na temat, który uzna za
niedozwolony. To jest **spodziewana ścieżka**, mapowana na `TOPIC_REJECTED` z własnym polskim
komunikatem — nie na `INTERNAL` i nie na `PROVIDER_UNAVAILABLE`. Rozpoznanie odmowy jest
heurystyczne (model odpowiada tekstem, nie kodem), więc heurystyka musi być zapisana w jednym
miejscu i pokryta testem.

**Lokalny sukces nie kończy sprawy.** `astro dev` nie egzekwuje limitu 10 ms CPU. Wszystko, co
ten plan zweryfikuje lokalnie, jest weryfikacją logiki, nie budżetu platformy. Pierwsze wdrożone
generowanie pozostaje prawdziwym testem — i to jest powód, dla którego faza 5 zapisuje ten fakt
w dokumentach, zamiast zostawiać go w tej rozmowie.

## Phase 1: Binding i pomiar jakości

### Overview

Podpięcie Workers AI i **ocena, czy model w ogóle nadaje się do zadania**. Faza kończy się
twoją decyzją, nie zielonym testem: czy Llama 3.3 70B pisze po polsku dowcip z puentą
w limicie słów.

### Changes Required:

#### 1. Binding

**File**: `wrangler.jsonc`

**Intent**: Udostępnić Workers AI aplikacji przez binding, bez żadnego klucza API — to jest
mechanizm, dzięki któremu guardrail z `## Success Criteria` spełnia się strukturalnie.

**Contract**: Sekcja `ai` z nazwą bindingu. Żadnych wpisów w `vars` — plik jest commitowany,
a każdy sekret w nim to naruszenie guardrailu.

#### 2. Moduł dostawcy

**File**: `src/lib/llm.ts` (nowy)

**Intent**: Jedyne miejsce w kodzie, które wie o Workers AI. Przyjmuje prompt i budżet czasu,
zwraca tekst albo błąd. Reszta aplikacji nie wie, jaki model jest pod spodem.

**Contract**: Funkcja przyjmująca prompt i limit czasu w milisekundach, zwracająca tekst
albo rzucająca rozpoznawalny błąd przy przekroczeniu czasu. Binding pobierany przez
`import { env } from "cloudflare:workers"` — **nie** przez `Astro.locals.runtime`, który
adapter v13 usunął i który zwraca `undefined` bez błędu typu.

Nazwa modelu jako stała w tym module, nie rozsypana po kodzie — podmiana dostawcy ma być
zmianą w jednym pliku, bo to warunek portowalności zapisany w `tech-stack.md`.

#### 3. Ścieżka pomiarowa

**File**: `src/pages/api/dev/llm-probe.ts` (nowy, tymczasowy)

**Intent**: Wysłać surowy prompt i pokazać nieprzetworzone wyjście, żeby dało się ocenić
jakość zanim powstanie cokolwiek innego.

**Contract**: Endpoint dostępny wyłącznie dla zalogowanego użytkownika, przyjmujący temat
i zwracający surowy tekst modelu wraz z liczbą słów i czasem odpowiedzi. **Usuwany w fazie 3** —
to rusztowanie, nie funkcja produktu; zapisz to w kodzie komentarzem, żeby nie został.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Wywołanie ścieżki pomiarowej zwraca niepusty tekst i czas odpowiedzi

#### Manual Verification:

- Kilkanaście wyjść na różne tematy ocenionych ręcznie: czy tekst jest po polsku, czy jest dowcipem, czy ma puentę
- Zanotowana rozpiętość liczby słów — ile wyjść mieści się w 60, ile przekracza
- Zanotowany czas odpowiedzi — czy pojedyncza próba mieści się w połowie budżetu 15 s
- **Decyzja: czy kontrakt formatu jest osiągalny na tym modelu**, czy trzeba zmienić prompt albo model

**Implementation Note**: To jest bramka. Jeśli decyzja wypadnie negatywnie, zatrzymaj się
i wróć do planu — fazy 2–4 zakładają, że model daje radę.

---

## Phase 2: Kontrakt formatu

### Overview

Walidator i presety jako czyste funkcje, bez I/O i bez modelu. Wszystko testowalne
`npm test`, bez Dockera i bez neuronów.

### Changes Required:

#### 1. Presety długości

**File**: `src/lib/format-contract.ts` (nowy)

**Intent**: Zamienić wybór użytkownika na konkretny limit słów, tak żeby preset miał realny
skutek, a nie był sugestią dla modelu.

**Contract**: Trzy presety mapowane na limity słów w ramach sufitu formatu. Dla dowcipu sufit
z PRD (60 słów) pozostaje sufitem — najdłuższy preset go dotyka, krótsze są wyraźnie niższe.
Struktura ma pomieścić drugi format bez przebudowy, bo `S-07` doda opowiadanie z sufitem 400.

#### 2. Walidator

**File**: `src/lib/format-contract.ts`

**Intent**: Orzec, czy wyjście modelu spełnia kontrakt — mechanicznie, bez drugiego wywołania modelu.

**Contract**: Sprawdzenia: liczba słów w limicie presetu; tekst niepusty po przycięciu;
brak markdownu i prefiksów typu „Oto dowcip:" albo „Dowcip:". Wynik niesie **powód odrzucenia**
w formie nadającej się do wstawienia do promptu ponownej próby — to jest kontrakt, na którym
opiera się faza 3.

Obecność puenty **nie jest sprawdzana**: mechanicznie się nie da, a drugie wywołanie modelu
jako sędziego wywróciłoby NFR. Wymusza ją prompt. To świadome osłabienie gwarancji wobec
brzmienia PRD i musi zostać zapisane w dokumentach (faza 5).

#### 3. Testy

**File**: `src/lib/format-contract.test.ts` (nowy)

**Intent**: Pokryć granice i przypadki, które w praktyce pękają.

**Contract**: Liczba słów dokładnie na limicie i jeden ponad; tekst z wielokrotnymi spacjami
i znakami nowej linii; wyjście z prefiksem; wyjście z markdownem; wyjście puste i złożone
z białych znaków; każdy preset osobno. Dodatkowo: powód odrzucenia jest niepusty i zawiera liczby.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy przechodzą: `npx astro check`
- Lint na nowych plikach przechodzi

#### Manual Verification:

- Przegląd limitów presetów: czy różnica między krótkim a długim jest odczuwalna dla użytkownika

---

## Phase 3: Endpoint generowania

### Overview

Orkiestracja: walidacja tematu, wywołanie modelu w budżecie czasu, ocena kontraktu, ewentualna
powtórka z promptem wzmocnionym o powód, mapowanie awarii na kody domenowe.

### Changes Required:

#### 1. Nowe kody błędów

**File**: `src/types.ts`, `src/lib/api-errors.ts`

**Intent**: Dać interfejsowi możliwość rozróżnienia trzech sytuacji, które wymagają od
użytkownika trzech różnych reakcji.

**Contract**: `TOPIC_REJECTED` (model odmówił — użytkownik ma zmienić temat),
`FORMAT_CONTRACT_FAILED` (obie próby złamały kontrakt — użytkownik ma spróbować ponownie),
`GENERATION_TIMEOUT` (nie zdążyliśmy — użytkownik ma spróbować ponownie). Każdy z własnym
polskim komunikatem i statusem. `Record<ApiErrorCode, …>` wymusi komplet wpisów.

#### 2. Prompt

**File**: `src/lib/prompt.ts` (nowy)

**Intent**: Zbudować prompt dla pierwszej próby i dla powtórki, tak żeby powtórka niosła powód
odrzucenia.

**Contract**: Funkcja budująca prompt z tematu, formatu i limitu słów; druga funkcja
wzbogacająca go o powód odrzucenia z fazy 2. Prompt wymusza język polski, limit słów i puentę —
puenta jest tu, bo walidator jej nie sprawdza.

#### 3. Endpoint

**File**: `src/pages/api/generate.ts` (nowy)

**Intent**: Wystawić generowanie jako endpoint zgodny z kontraktem z `F-01` i wykonać regułę
jednej ponownej próby w ramach budżetu czasu.

**Contract**: Metoda `POST`. Brak sesji → `UNAUTHORIZED`. Ciało walidowane schematem zod:
temat 3–80 znaków po przycięciu (FR-003), format, preset długości; komunikaty pól po polsku
w definicji schematu. Odpowiedź sukcesu: wygenerowany tekst w kopercie `{ data }`.

Przebieg: pierwsza próba w połowie budżetu → ocena kontraktu → jeśli odrzucona, druga próba
z promptem wzbogaconym o powód, w pozostałej połowie → jeśli znowu odrzucona,
`FORMAT_CONTRACT_FAILED`. Przekroczenie budżetu → `GENERATION_TIMEOUT`. Odmowa modelu →
`TOPIC_REJECTED`. Każda awaria loguje surową treść przez `logApiError`, **bez tematu wpisanego
przez użytkownika** — to ciało żądania, którego reguła zabrania logować.

#### 4. Usunięcie rusztowania

**File**: `src/pages/api/dev/llm-probe.ts`

**Intent**: Skasować ścieżkę pomiarową z fazy 1, żeby nie została w produkcie jako niechroniony
sposób wywołania modelu.

**Contract**: Plik usunięty; katalog `src/pages/api/dev/` znika, jeśli był jedyny.

#### 5. Testy

**File**: `src/lib/prompt.test.ts` (nowy)

**Intent**: Pokryć budowanie promptu i wzbogacanie go o powód — bez dotykania modelu.

**Contract**: Prompt zawiera temat, limit słów i wymóg polszczyzny; prompt powtórki dodatkowo
zawiera powód odrzucenia; temat użytkownika trafia do promptu bez modyfikacji, ale nie wychodzi
poza niego.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Testy integracyjne przechodzą: `npm run test:integration`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Ścieżka pomiarowa nie istnieje: `test ! -e src/pages/api/dev/llm-probe.ts`

#### Manual Verification:

- Poprawny temat zwraca 200 i tekst mieszczący się w limicie presetu
- Temat krótszy niż 3 znaki zwraca 400 z komunikatem przy polu
- Temat dłuższy niż 80 znaków zwraca 400 z komunikatem przy polu
- Żądanie bez sesji zwraca 401
- Log serwera przy awarii **nie zawiera** tematu wpisanego przez użytkownika

---

## Phase 4: Ekran generowania

### Overview

Formularz, ciągły widoczny postęp przez cały czas oczekiwania, wynik na tym samym ekranie
i kopiowanie jednym działaniem.

### Changes Required:

#### 1. Trasa

**File**: `src/pages/generate.astro` (nowy), `src/middleware.ts`

**Intent**: Dać użytkownikowi miejsce, w którym generuje — chronione, po polsku.

**Contract**: Trasa dopisana do `PROTECTED_ROUTES`. Strona renderuje wyspę formularza;
statyczna otoczka po stronie Astro, interaktywność w React — zgodnie z konwencją repo.
Zmiana `PROTECTED_ROUTES` **wymaga restartu serwera dev**, żeby zadziałała; bez tego trasa
zostaje otwarta, cicho i bez błędu.

#### 2. Wyspa generowania

**File**: `src/components/generate/GenerateForm.tsx` (nowy)

**Intent**: Przeprowadzić użytkownika przez temat, preset, oczekiwanie i wynik bez przeładowania strony.

**Contract**: Pole tematu z licznikiem znaków (3–80), wybór presetu, przycisk uruchamiający.
W trakcie oczekiwania: **ciągły widoczny postęp** — animacja plus upływający czas, tak żeby
użytkownik nigdy nie był niepewny, czy żądanie żyje. To jest wymóg NFR, nie ozdoba.

Po sukcesie: tekst na tym samym ekranie plus przycisk kopiowania działający **jednym
kliknięciem, bez zaznaczania tekstu** (FR-008). Po błędzie: komunikat z `fields` gdy dotyczy
pola, inaczej `error.message`; przy `TOPIC_REJECTED` komunikat ma kierować do zmiany tematu,
przy pozostałych do ponowienia. Klasy łączone przez `cn()`.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test` oraz `npm run test:integration`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi
- Żądanie anonimowe do `/generate` zwraca przekierowanie

#### Manual Verification:

- Wygenerowany dowcip pojawia się na tym samym ekranie, bez przeładowania
- Postęp jest widoczny przez **cały** czas oczekiwania — brak momentu, w którym nic się nie dzieje
- Kopiowanie działa jednym kliknięciem i nie wymaga zaznaczania tekstu
- Zmiana presetu daje odczuwalnie inną długość wyniku
- Zbyt krótki i zbyt długi temat pokazują komunikat przy polu
- Odmowa modelu na drażliwy temat pokazuje komunikat kierujący do zmiany tematu

---

## Phase 5: Dokumenty

### Overview

Zapisanie trzech rzeczy, które ta zmiana ustanawia albo osłabia — żeby nie zostały w rozmowie.

### Changes Required:

#### 1. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Zapisać, jak sięgać po binding i gdzie żyje wywołanie modelu.

**Contract**: Binding AI przez `import { env } from "cloudflare:workers"`; nazwa modelu i całe
wywołanie wyłącznie w `@src/lib/llm.ts`; żaden inny plik nie dotyka `env.AI`. Kilka zdań,
bez wklejonego kodu.

#### 2. Test-plan

**File**: `context/foundation/test-plan.md`

**Intent**: Przenieść R-06 (wyjście łamie kontrakt formatu) z luki na pokryte i zapisać,
czego pokrycie **nie** obejmuje.

**Contract**: Wiersz R-06 wskazuje `src/lib/format-contract.test.ts`. Nowa sekcja zestawu
w tej samej formie co pozostałe, z akapitem „czego test nie dowodzi": walidator sprawdza
długość i czystość, **nie obecność puenty** — tę wymusza wyłącznie prompt, więc gwarancja
jest słabsza, niż brzmi PRD `## Business Logic`.

#### 3. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Odnotować wynik bramki jakościowej i to, że `S-07` dziedziczy gotowy mechanizm.

**Contract**: W `S-01` zapisany wynik pomiaru z fazy 1 (czy model utrzymuje kontrakt i przy
jakiej rozpiętości słów). W `S-07` pole odnotowujące, że walidator, presety i reguła powtórki
już istnieją, a plaster dokłada wyłącznie drugi format. Otwarte pytanie #3 (temat niedozwolony)
zamknięte na rzecz polegania na odmowie modelu.

### Success Criteria:

#### Automated Verification:

- R-06 nie figuruje już jako luka: `grep -n "R-06" context/foundation/test-plan.md` pokazuje status pokryte
- Prettier przechodzi na zmienionych dokumentach

#### Manual Verification:

- Czytelnik `S-07` rozumie, co dziedziczy, bez otwierania tego planu
- Osłabienie gwarancji wobec PRD jest zapisane na tyle jasno, że nie zaskoczy przy ocenie

---

## Testing Strategy

### Unit Tests:

- Walidator: liczba słów dokładnie na limicie i jeden ponad, dla każdego presetu
- Walidator: prefiksy, markdown, wielokrotne spacje, tekst pusty i z białych znaków
- Walidator: powód odrzucenia jest niepusty i nadaje się do wstawienia w prompt
- Prompt: zawiera temat, limit i wymóg polszczyzny; wersja powtórki zawiera powód
- Słownik: trzy nowe kody mają niepuste polskie komunikaty i statusy (pokryte istniejącym testem kompletności)

### Integration Tests:

Brak nowych. Ten plaster nie dotyka bazy — istniejący zestaw R-05 zostaje bez zmian.

### Manual Testing Steps:

1. Wygeneruj dowcip na neutralny temat w każdym z trzech presetów; policz słowa
2. Wygeneruj na temat, który model prawdopodobnie odrzuci; sprawdź komunikat
3. Wpisz temat 2-znakowy i 81-znakowy; sprawdź komunikaty przy polu
4. Obserwuj wskaźnik postępu przez całe oczekiwanie — czy jest moment ciszy
5. Skopiuj wynik i wklej gdzie indziej

## Performance Considerations

Budżet czasu jest dzielony między dwie próby, więc pojedyncza próba ma około połowy tego, co
obiecuje NFR. Jeśli pomiar z fazy 1 pokaże, że pojedyncza generacja regularnie przekracza tę
połowę, wybór jest binarny i trzeba go podjąć świadomie: albo rezygnacja z reguły powtórki
(zmiana PRD), albo podniesienie budżetu (zmiana NFR). Plan nie rozstrzyga tego z góry, bo
rozstrzygnięcie zależy od liczby, której jeszcze nie mamy.

Limit 10 ms CPU dotyczy przetwarzania, nie oczekiwania. Dla dowcipu (~60 słów) zliczenie słów
i sprawdzenie prefiksów jest tanie. Ryzyko rośnie przy `S-07` i tam należy je zmierzyć —
`infrastructure.md` przewiduje sprawdzenie rozkładu czasu CPU w observability po pierwszych
wdrożonych generacjach.

## Migration Notes

Brak migracji bazy — ten plaster nie dotyka schematu. Rollback jest symetryczny: cofnięcie
kodu cofa całość.

Jedna zmiana infrastrukturalna jest nieodwracalna przez `git revert`: dodanie bindingu do
`wrangler.jsonc` wymaga wdrożenia, żeby zadziałało na produkcji. Cofnięcie kodu bez ponownego
wdrożenia zostawi Workera z bindingiem, który do niczego nie służy — to nieszkodliwe, ale warto
o tym wiedzieć.

## References

- Roadmapa: `context/foundation/roadmap.md` — pozycja **S-01**, gwiazda przewodnia
- Decyzja o dostawcy z matematyką darmowego tieru: `context/foundation/tech-stack.md`
- Rejestr ryzyk (CPU, `Astro.locals.runtime`, fałszywa pewność z dev): `context/foundation/infrastructure.md`
- Kontrakt odpowiedzi API: `context/archive/2026-09-03-api-error-contract/plan.md`
- Wzorzec wąskiego modułu: `src/lib/api-errors.ts`
- Plan testów i rejestr ryzyk: `context/foundation/test-plan.md` — **R-06**

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Binding i pomiar jakości

#### Automated

- [x] 1.1 Typy przechodzą: `npx astro check` — 4000e29
- [x] 1.2 Lint na zmienionych plikach przechodzi — 4000e29
- [x] 1.3 Ścieżka pomiarowa zwraca niepusty tekst i czas odpowiedzi — 4000e29

#### Manual

- [x] 1.4 Kilkanaście wyjść ocenionych ręcznie — polszczyzna, dowcip, puenta — 4000e29
- [x] 1.5 Zanotowana rozpiętość liczby słów — 4000e29
- [x] 1.6 Zanotowany czas odpowiedzi wobec połowy budżetu 15 s — 4000e29
- [x] 1.7 Decyzja: czy kontrakt formatu jest osiągalny na tym modelu — 4000e29

### Phase 2: Kontrakt formatu

#### Automated

- [x] 2.1 Testy przechodzą: `npm test` — 5a600d4
- [x] 2.2 Typy przechodzą: `npx astro check` — 5a600d4
- [x] 2.3 Lint na nowych plikach przechodzi — 5a600d4

#### Manual

- [ ] 2.4 Przegląd limitów presetów — czy różnica jest odczuwalna

### Phase 3: Endpoint generowania

#### Automated

- [x] 3.1 Testy jednostkowe przechodzą: `npm test` — 0a2558a
- [x] 3.2 Testy integracyjne przechodzą: `npm run test:integration` — 0a2558a
- [x] 3.3 Typy przechodzą: `npx astro check` — 0a2558a
- [x] 3.4 Lint na zmienionych plikach przechodzi — 0a2558a
- [x] 3.5 Ścieżka pomiarowa nie istnieje — 0a2558a

#### Manual

- [ ] 3.6 Poprawny temat zwraca 200 i tekst w limicie presetu
- [ ] 3.7 Temat krótszy niż 3 znaki zwraca 400 z komunikatem przy polu
- [ ] 3.8 Temat dłuższy niż 80 znaków zwraca 400 z komunikatem przy polu
- [ ] 3.9 Żądanie bez sesji zwraca 401
- [ ] 3.10 Log przy awarii nie zawiera tematu użytkownika

### Phase 4: Ekran generowania

#### Automated

- [x] 4.1 Testy przechodzą: `npm test` oraz `npm run test:integration` — 0a6c571
- [x] 4.2 Typy przechodzą: `npx astro check` — 0a6c571
- [x] 4.3 Lint na zmienionych plikach przechodzi — 0a6c571
- [x] 4.4 Żądanie anonimowe do `/generate` zwraca przekierowanie — 0a6c571

#### Manual

- [ ] 4.5 Wynik pojawia się na tym samym ekranie, bez przeładowania
- [ ] 4.6 Postęp widoczny przez cały czas oczekiwania
- [ ] 4.7 Kopiowanie działa jednym kliknięciem, bez zaznaczania
- [ ] 4.8 Zmiana presetu daje odczuwalnie inną długość
- [ ] 4.9 Za krótki i za długi temat pokazują komunikat przy polu
- [ ] 4.10 Odmowa modelu kieruje do zmiany tematu

### Phase 5: Dokumenty

#### Automated

- [x] 5.1 R-06 ma w test-planie status pokryte
- [x] 5.2 Prettier przechodzi na zmienionych dokumentach

#### Manual

- [ ] 5.3 Czytelnik `S-07` rozumie, co dziedziczy
- [ ] 5.4 Osłabienie gwarancji wobec PRD zapisane jasno

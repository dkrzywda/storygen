# Kontrakt odpowiedzi API i warstwa komunikatów po polsku — Implementation Plan

## Overview

Ustalamy jeden kształt odpowiedzi dla endpointów nie-auth, walidację wejścia na granicy API
i jeden mechanizm zamiany błędów na komunikaty po polsku — zanim generowanie dołoży do tego
timeout, przekroczony limit i odrzucony temat. Fundament `F-01` z roadmapy; odblokowuje
`S-01` (gwiazda przewodnia), `S-02` i `S-04`.

Powód, dla którego to idzie pierwsze, jest udowodniony, nie przypuszczany: trzy niezależne
przebiegi agenta dopisujące `/api/generate` wymyśliły trzy różne kształty odpowiedzi, a na
produkcji 2026-08-24 użytkownik zobaczył błąd bez treści, bo `error.message` z Supabase bywa
pusty. Oba incydenty są zapisane w `context/foundation/lessons.md`.

## Current State Analysis

**Co istnieje.** Trzy endpointy auth (`src/pages/api/auth/{signin,signup,signout}.ts`) czytają
`request.formData()` i odpowiadają `context.redirect()`. Strony `src/pages/auth/{signin,signup}.astro`
czytają `?error=` z URL-a i przekazują tekst do `<ServerError>`. Klient Supabase jest nullowalny
z założenia (`src/lib/supabase.ts:6`) i każde miejsce wywołania musi obsłużyć `null`.

**Czego brakuje.**

- Żadnego kształtu odpowiedzi dla endpointów nie-auth — tripwire w `CLAUDE.md` mówi wprost, że
  decyzja nie zapadła.
- `zod` nie jest zainstalowany, mimo że `tech-stack.md` i reguły startera zakładają walidację
  na granicach API.
- Brak runnera testów i skryptu `test`.
- `src/types.ts` nie istnieje; konwencja mówi, że powstaje przy pierwszym użyciu.

**Ograniczenia.**

- Wszystko jest SSR (`output: "server"`); żaden plik nie eksportuje `prerender` i nie wolno go dodać.
- ESLint działa w trybie `strictTypeChecked` + `stylisticTypeChecked` na prawdziwym projekcie TS,
  więc jest wolny i typoświadomy. `no-console` to **ostrzeżenie**, nieużyte zmienne to **błąd**,
  chyba że mają prefiks `_`.
- `npm run lint` na całym repo pada na CRLF niezależnie od tej zmiany — lintuj pliki, które ruszasz.

## Desired End State

Po zakończeniu planu w repo istnieje jeden moduł, który zamienia dowolny błąd na parę
(kod domenowy, komunikat po polsku), jeden helper budujący odpowiedź JSON z prawdziwym statusem
HTTP, oraz walidacja wejścia oparta o `zod` zwracająca rozbicie na pola. Trzy endpointy auth
przestają odbijać cudze komunikaty. Wszystko to jest pokryte testami uruchamianymi przez `npm test`.

**Jak to zweryfikować:** `npm test` przechodzi; `npx astro check` przechodzi; ręczne logowanie
błędnym hasłem pokazuje polski komunikat; wpisanie dowolnego tekstu w `?error=` nie renderuje
tego tekstu na stronie.

### Key Discoveries:

- Surowy komunikat dostawcy trafia do URL-a — [`signin.ts:17`](src/pages/api/auth/signin.ts:17)
  i [`signup.ts:17`](src/pages/api/auth/signup.ts:17) robią `?error=${encodeURIComponent(error.message)}`.
- **`?error=` renderuje dowolny tekst z URL-a.** [`signin.astro:5`](src/pages/auth/signin.astro:5)
  czyta parametr i podaje go prosto do `<ServerError>`. Znaczy to, że link
  `/auth/signin?error=Twoje+konto+wygasło,+zadzwoń+pod...` wyświetli ten tekst w firmowo
  wyglądającej ramce błędu. To nie było celem zmiany, ale zamknięcie tego jest darmowym
  produktem ubocznym przejścia na kody.
- **Rozbieżność wobec `deploy-plan.md`.** Plan wdrożenia opisuje „pustą czerwoną ramkę", ale
  [`ServerError.tsx:8`](src/components/auth/ServerError.tsx:8) robi `if (!message) return null` —
  pusty string nie wyrenderuje niczego. Żeby ramka się pokazała, komunikat musiał być prawdziwy,
  ale wizualnie pusty (spacja, znak niedrukowalny). Stąd strażnik sprawdza **puste po `trim()`**,
  nie samą falsy-ność.
- Komunikat o braku konfiguracji istnieje już w dwóch wersjach: po angielsku, zahardkodowany
  w endpointach, i po polsku w [`config-status.ts:14`](src/lib/config-status.ts:14). Słownik ma
  ujednolicić to na wersję polską.
- Wzorzec deklaratywnej konfiguracji już jest — `envField` w [`astro.config.mjs:17`](astro.config.mjs:17).
- Vite jest przypięty na 7.3.3 przez override z `@astrojs/cloudflare`; Vitest 4.1.11 deklaruje
  `vite: ^6 || ^7 || ^8`, więc dzieli konfigurację i resolver z buildem zamiast stawiać drugi.

## What We're NOT Doing

- **Tłumaczenie interfejsu** — etykiety, nagłówki, przyciski, walidacja po stronie klienta
  w `src/components/auth/*` zostają po angielsku. To jest `S-02`.
- **`src/pages/404.astro`** — też `S-02`.
- **Biblioteka i18n** — PRD wyklucza drugi język jako non-goal.
- **Kody dla generowania** (`TOPIC_REJECTED`, `GENERATION_TIMEOUT`, `RATE_LIMITED`) — dokłada je
  plaster, który ich pierwszy potrzebuje. Enum ma być rozszerzalny, nie kompletny z góry.
- **Moduł loggera z redakcją pól** — to warstwa observability, której roadmapa nie przypisała
  do żadnej pozycji.
- **Naprawa CI, `secrets.required`, bump `compatibility_date`** — zaparkowane w roadmapie.
- **Naprawa CRLF** — zaparkowana; lintujemy pliki, które ruszamy.

## Implementation Approach

Cztery fazy, każda weryfikowalna osobno i każda zostawiająca repo w stanie działającym.
Najpierw runner (żeby kolejne fazy miały czym dowodzić, że działają), potem sam kontrakt
jako czyste funkcje bez I/O, potem podmiana w trzech endpointach, na końcu zapisanie decyzji
w `CLAUDE.md`, żeby kolejny agent nie wymyślił czwartego kształtu.

Rozdział odpowiedzialności: **kod domenowy** jest stabilny i to na niego reaguje interfejs;
**komunikat** jest wymienny i mieszka w jednym słowniku; **status HTTP** jest wyprowadzany
z kodu, nie ustawiany ręcznie w handlerze.

## Critical Implementation Details

**Kolejność w Fazie 2.** Słownik komunikatów i mapa kodów na statusy muszą powstać jako jedna
struktura albo dwie trzymane obok siebie w tym samym pliku. Rozdzielenie ich na dwa moduły
gwarantuje, że przy dodaniu kodu w `S-01` ktoś zaktualizuje jedno, a zapomni o drugim —
i dostanie 500 dla błędu walidacji, bez żadnego ostrzeżenia z typów.

**Czego nie logować.** Log surowego błędu ma nieść kod i komunikat od dostawcy. Nie wolno w nim
umieszczać ciała żądania: przy `S-01` będzie ono zawierało temat wpisany przez użytkownika,
a przy auth zawiera e-mail i hasło.

**`?error=` musi przestać nieść prozę.** Po Fazie 3 parametr niesie kod, a strona rozwiązuje
go przez słownik. Kod nierozpoznany daje komunikat domyślny, nie treść parametru — to jest
warunek zamknięcia opisanego wyżej odbicia tekstu z URL-a, a nie kosmetyka.

## Phase 1: Runner testów

### Overview

Vitest zainstalowany, skonfigurowany i przechodzący na jednym prawdziwym teście. Faza dowodzi,
że runner widzi alias `@/*` — bez tego wszystkie testy z kolejnych faz nie zaimportują swoich modułów.

### Changes Required:

#### 1. Zależność i skrypty

**File**: `package.json`

**Intent**: Dodać Vitest jako zależność deweloperską i wystawić skrypty uruchamiające testy
jednorazowo oraz w trybie obserwowania.

**Contract**: `devDependencies.vitest` przypięty na 4.1.11. Skrypty: `test` uruchamia przebieg
jednorazowy, `test:watch` tryb ciągły. Nazwa `test` jest wymagana — pozostałe fazy i przyszłe
CI odwołują się do `npm test`.

#### 2. Konfiguracja runnera

**File**: `vitest.config.ts` (nowy)

**Intent**: Wskazać runnerowi, gdzie szukać testów i jak rozwiązywać alias `@/*`, żeby importy
w testach zachowywały się tak samo jak w aplikacji.

**Contract**: Alias `@` wskazuje na `./src`, lustrzanie wobec `paths` w `tsconfig.json:11`.
Środowisko `node` — moduły z Fazy 2 i 3 są czystymi funkcjami bez DOM. Wzorzec plików
testowych: `src/**/*.test.ts`.

#### 3. Test dymny

**File**: `src/lib/utils.test.ts` (nowy)

**Intent**: Jeden prawdziwy test na istniejącej funkcji `cn()`, żeby faza kończyła się zielonym
przebiegiem, a nie samą konfiguracją.

**Contract**: Test importuje przez `@/lib/utils`, nie przez ścieżkę względną — to jest właściwy
przedmiot tej fazy, bo dowodzi, że alias działa.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi: `npx eslint vitest.config.ts src/lib/utils.test.ts`

#### Manual Verification:

- Celowo zepsuty assert daje czerwony wynik, a nie cichy sukces; po cofnięciu zmiany znowu zielony

**Implementation Note**: Po przejściu automatycznej weryfikacji zatrzymaj się i poczekaj na
potwierdzenie od człowieka, zanim ruszysz do następnej fazy.

---

## Phase 2: Kontrakt i komunikaty

### Overview

Powstaje rdzeń: kody domenowe, słownik komunikatów po polsku, mapowanie dowolnego błędu na kod,
helper budujący odpowiedź JSON z prawdziwym statusem, oraz walidacja `zod` z rozbiciem na pola.
Wszystko to są czyste funkcje — żaden endpoint jeszcze ich nie używa, więc faza nie może niczego zepsuć.

### Changes Required:

#### 1. Zależność

**File**: `package.json`

**Intent**: Zainstalować `zod`, którego brak jest osobnym tripwire'em w `CLAUDE.md`.

**Contract**: `dependencies.zod` — zależność produkcyjna, nie deweloperska; walidacja działa w runtime na Workerze.

#### 2. Typy współdzielone

**File**: `src/types.ts` (nowy)

**Intent**: Zadeklarować kształt odpowiedzi API jako typ, żeby endpointy nie mogły go
niezależnie od siebie interpretować.

**Contract**: Unia kodów domenowych `ApiErrorCode`; ciało błędu z polami `code`, `message`
i opcjonalnym `fields` (mapa nazwa pola → komunikat); odpowiedź sukcesu opakowana w `data`.
Zestaw kodów na teraz — dokładnie tyle, ile Faza 3 i istniejący kod potrzebują:

| Kod                        | Status | Kiedy                                                 |
| -------------------------- | ------ | ----------------------------------------------------- |
| `VALIDATION_FAILED`        | 400    | wejście odrzucone przez schemat                       |
| `INVALID_CREDENTIALS`      | 401    | błędny e-mail lub hasło                               |
| `EMAIL_NOT_CONFIRMED`      | 403    | konto istnieje, e-mail niepotwierdzony                |
| `EMAIL_ALREADY_REGISTERED` | 409    | rejestracja na zajęty adres                           |
| `PROVIDER_UNAVAILABLE`     | 502    | dostawca odpowiedział błędem 5xx lub nie odpowiedział |
| `NOT_CONFIGURED`           | 503    | brak wymaganej konfiguracji (dziś: Supabase)          |
| `INTERNAL`                 | 500    | wszystko nierozpoznane, w tym błąd bez treści         |

Kolejne plastry **dokładają** kody; ta tabela nie jest kompletnym zbiorem docelowym.

#### 3. Słownik, statusy i mapowanie

**File**: `src/lib/api-errors.ts` (nowy)

**Intent**: Jedno miejsce, które trzyma polski komunikat i status HTTP dla każdego kodu, oraz
zamienia nieznany błąd (z Supabase, z dostawcy LLM, z własnego kodu) na kod domenowy.

**Contract**: Trzy rzeczy w jednym module, celowo nierozdzielone (patrz „Critical Implementation
Details"): mapa `kod → { status, message }`; funkcja rozpoznająca błąd i zwracająca kod; funkcja
rozwiązująca kod przekazany jako tekst (np. z query stringa) na komunikat, z komunikatem
domyślnym dla wartości nierozpoznanej.

Strażnik pustej treści jest częścią kontraktu: komunikat od dostawcy uznaje się za brakujący,
gdy po `trim()` jest pusty — wtedy kod to `INTERNAL`, a użytkownik dostaje komunikat domyślny.
Traktuj brak treści jako normalny stan, nie jako sytuację niemożliwą.

#### 4. Budowanie odpowiedzi

**File**: `src/lib/api-response.ts` (nowy)

**Intent**: Dać endpointom jeden sposób zwracania sukcesu i błędu, żeby status HTTP wynikał
z kodu domenowego, a nie był wpisywany ręcznie przy każdym `return`.

**Contract**: Helper sukcesu zwraca 200 z ciałem `{ data }`. Helper błędu przyjmuje kod
(i opcjonalnie rozbicie na pola), a status i komunikat bierze ze słownika. Handler nigdy nie
podaje statusu ani tekstu samodzielnie.

#### 5. Walidacja wejścia

**File**: `src/lib/validation.ts` (nowy)

**Intent**: Zamienić porażkę schematu `zod` na `VALIDATION_FAILED` z mapą pól, nie przepuszczając
angielskich komunikatów Zoda na powierzchnię produktu.

**Contract**: Funkcja przyjmuje schemat i dane, zwraca albo dane sparsowane, albo strukturę
błędu z `fields`. Komunikaty per pole pochodzą **z definicji schematu** (autor schematu podaje
polski tekst), nigdy z domyślnych komunikatów Zoda. Schematy są współlokowane z endpointami,
które ich używają — ten moduł niesie tylko mechanizm.

#### 6. Testy

**File**: `src/lib/api-errors.test.ts`, `src/lib/validation.test.ts` (nowe)

**Intent**: Zabezpieczyć dokładnie te dwa zachowania, które wynikły z incydentów: pusty komunikat
i nierozpoznany błąd.

**Contract**: Pokrycie obejmuje — komunikat pusty, komunikat złożony z samych białych znaków,
błąd nieznanego kształtu, każdy kod ze słownika ma niepusty polski komunikat i status, kod
nierozpoznany w rozwiązywaniu z tekstu daje komunikat domyślny, porażka schematu daje
`VALIDATION_FAILED` z niepustą mapą pól.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy przechodzą: `npx astro check`
- Lint na nowych plikach przechodzi: `npx eslint src/types.ts src/lib/api-errors.ts src/lib/api-response.ts src/lib/validation.ts src/lib/*.test.ts`

#### Manual Verification:

- Przegląd słownika: każdy komunikat jest po polsku, żaden nie cytuje dostawcy ani nie zawiera treści technicznej

---

## Phase 3: Retrofit trzech endpointów auth

### Overview

Endpointy auth przestają odbijać cudze komunikaty, a `?error=` przestaje nieść prozę z URL-a.
Kształt pozostaje niezmieniony — form-post plus redirect, zgodnie z istniejącą architekturą.

### Changes Required:

#### 1. Endpointy

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: Zamienić przekazywanie `error.message` na mapowanie przez moduł z Fazy 2 i wysłać
w redirekcie kod, nie tekst. Zahardkodowane angielskie `"Supabase is not configured"` zastąpić
kodem `NOT_CONFIGURED`.

**Contract**: Redirect ma postać `?error=<KOD>`, gdzie `<KOD>` jest wartością z `ApiErrorCode`.
Endpointy zachowują `formData()` i `context.redirect()` — nie przechodzą na JSON. Surowy błąd
trafia do loga po stronie serwera; ciało żądania (e-mail, hasło) do loga nie trafia.

#### 2. Strony auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Rozwiązać kod z query stringa na komunikat przez słownik, zamiast renderować
zawartość parametru.

**Contract**: Frontmatter strony zamienia `searchParams.get("error")` na wynik rozwiązania kodu;
wartość nierozpoznana albo pusta daje odpowiednio komunikat domyślny albo `null`. `<ServerError>`
i wszystkie teksty interfejsu pozostają nietknięte — to granica wobec `S-02`.

#### 3. Test odbicia z URL-a

**File**: `src/lib/api-errors.test.ts` (rozszerzenie)

**Intent**: Utrwalić, że dowolny tekst podany jako kod nie wraca do użytkownika.

**Contract**: Przypadek testowy podający tekst, który nie jest żadnym kodem, oczekuje komunikatu
domyślnego — nigdy wartości wejściowej.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy przechodzą: `npx astro check`
- Lint na zmienionych plikach przechodzi: `npx eslint src/pages/api/auth src/pages/auth`
- W trzech endpointach nie występuje już `error.message`: `grep -rn "error.message" src/pages/api/auth/` nie zwraca nic

#### Manual Verification:

- Logowanie błędnym hasłem pokazuje polski komunikat, a URL niesie kod, nie zdanie
- Rejestracja na zajęty adres pokazuje polski komunikat
- Wejście na `/auth/signin?error=Dowolny+tekst+wpisany+ręcznie` **nie** renderuje tego tekstu
- Przy niedostępnym Supabase widać polski komunikat o braku konfiguracji, nie angielski

---

## Phase 4: Zapis kontraktu w CLAUDE.md

### Overview

Domknięcie trzech tripwire'ów, które ta zmiana unieważnia. Bez tego kolejny agent przeczyta,
że kształt odpowiedzi jest nierozstrzygnięty, i wymyśli czwarty.

### Changes Required:

#### 1. Reguły projektu

**File**: `CLAUDE.md`

**Intent**: Zastąpić trzy nieaktualne zapisy stanem faktycznym i dopisać kontrakt, którego mają
się trzymać przyszłe endpointy.

**Contract**: W sekcji `## Tripwires` znika punkt o nierozstrzygniętym kształcie odpowiedzi
i punkt o braku `zod`. W sekcji `## Commands` znika zdanie „No test runner is configured"
i pojawia się `npm test`. W `## Architecture` albo `## Conventions` ląduje krótki zapis:
endpointy nie-auth zwracają JSON z prawdziwym statusem HTTP, endpointy auth pozostają przy
form-post i redirectcie z kodem, komunikaty użytkownika pochodzą wyłącznie ze słownika.

Zapis ma być regułą, nie streszczeniem planu — kilka zdań, wskazanie plików przez `@`-ścieżki,
zero wklejonego kodu.

### Success Criteria:

#### Automated Verification:

- Nieaktualne zapisy zniknęły: `grep -n "response shape for non-auth\|Zod is not installed\|No test runner is configured" CLAUDE.md` nie zwraca nic
- Lint przechodzi na zmienionym pliku: `npx prettier --check CLAUDE.md`

#### Manual Verification:

- Przeczytanie sekcji: reguła da się zastosować bez otwierania tego planu

---

## Testing Strategy

### Unit Tests:

- Mapowanie błędu na kod: pusty komunikat, sam biały znak, błąd nieznanego kształtu, `null`
- Kompletność słownika: każdy kod ma niepusty komunikat i status
- Rozwiązywanie kodu z tekstu: kod znany, kod nieznany, pusty, wartość nie będąca kodem
- Walidacja: porażka schematu daje `VALIDATION_FAILED` z mapą pól; sukces zwraca dane sparsowane

### Integration Tests:

Brak — w repo nie ma i nie wprowadza się tu narzędzia do testów integracyjnych. Ścieżkę
end-to-end pokrywa weryfikacja ręczna Fazy 3.

### Manual Testing Steps:

1. Zaloguj się błędnym hasłem — oczekuj polskiego komunikatu i kodu w URL-u
2. Zarejestruj się na adres już zajęty — oczekuj polskiego komunikatu
3. Wejdź na `/auth/signin?error=Zadzwoń+pod+ten+numer` — oczekuj, że tekst się **nie** pojawi
4. Usuń lokalnie zmienną `SUPABASE_URL` i spróbuj się zalogować — oczekuj polskiego komunikatu o konfiguracji

## Performance Considerations

Brak istotnych. Mapowanie błędu to odczyt ze stałej mapy; walidacja `zod` działa na trzech
polach formularza. Limit 10 ms CPU na Workerze nie jest tu zagrożony — dotknie go dopiero
`S-01`, gdzie dochodzi oczekiwanie na dostawcę.

## Migration Notes

Bez migracji danych — `supabase/migrations/` nadal nie istnieje po tej zmianie. Rollback jest
symetryczny: cofnięcie kodu cofa całość, bo nic nie jest zapisywane poza kodem.

Jedna niezgodność w locie: link do `/auth/signin?error=<stary tekst>` wysłany albo zakładkowany
przed tą zmianą przestanie pokazywać tamten tekst i pokaże komunikat domyślny. To jest zamierzone.

## References

- Roadmapa: `context/foundation/roadmap.md` — pozycja **F-01**, kamień milowy M-1
- Reguły wyniesione z incydentów: `context/foundation/lessons.md` — oba wpisy dotyczą tej zmiany
- Ślad audytowy pierwszego wdrożenia: `context/deployment/deploy-plan.md` — § Dług, punkt 1
- Wzorzec istniejących endpointów: `src/pages/api/auth/signin.ts:1`
- Wzorzec polskiego komunikatu w repo: `src/lib/config-status.ts:14`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner testów

#### Automated

- [x] 1.1 Testy przechodzą: `npm test` — 245e477
- [x] 1.2 Typy przechodzą: `npx astro check` — 245e477
- [x] 1.3 Lint na zmienionych plikach przechodzi — 245e477

#### Manual

- [x] 1.4 Celowo zepsuty assert daje czerwony wynik, po cofnięciu znowu zielony — 245e477

### Phase 2: Kontrakt i komunikaty

#### Automated

- [x] 2.1 Testy przechodzą: `npm test` — a60146d
- [x] 2.2 Typy przechodzą: `npx astro check` — a60146d
- [x] 2.3 Lint na nowych plikach przechodzi — a60146d

#### Manual

- [x] 2.4 Przegląd słownika — każdy komunikat po polsku, żaden nie cytuje dostawcy — a60146d

### Phase 3: Retrofit trzech endpointów auth

#### Automated

- [x] 3.1 Testy przechodzą: `npm test` — c59250c
- [x] 3.2 Typy przechodzą: `npx astro check` — c59250c
- [x] 3.3 Lint na zmienionych plikach przechodzi — c59250c
- [x] 3.4 `grep -rn "error.message" src/pages/api/auth/` nie zwraca nic — c59250c

#### Manual

- [x] 3.5 Logowanie błędnym hasłem — polski komunikat, kod w URL-u — c59250c
- [x] 3.6 Rejestracja na zajęty adres — polski komunikat — c59250c
- [x] 3.7 Dowolny tekst w `?error=` nie renderuje się — c59250c
- [x] 3.8 Brak konfiguracji Supabase — polski komunikat, nie angielski — c59250c

### Phase 4: Zapis kontraktu w CLAUDE.md

#### Automated

- [x] 4.1 Nieaktualne zapisy zniknęły z CLAUDE.md — 55593b0
- [x] 4.2 `npx prettier --check CLAUDE.md` przechodzi — 55593b0

#### Manual

- [x] 4.3 Reguła da się zastosować bez otwierania tego planu — 55593b0

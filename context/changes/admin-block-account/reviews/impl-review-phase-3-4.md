<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin blokuje i odblokowuje konto

- **Plan**: `context/changes/admin-block-account/plan.md`
- **Scope**: Fazy 3–4 z 4 (commity `267c20a`, `4982810`, `a6bff3b`)
- **Date**: 2026-09-14
- **Verdict**: APPROVED
- **Findings**: 0 krytycznych, 1 ostrzeżenie, 8 obserwacji

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

**Kryteria automatyczne przebiegnięte niezależnie:** `npm test` 339 exit 0; `npx tsc --noEmit` exit 0; ESLint na dziewięciu dotkniętych plikach oraz na `dashboard.astro` exit 0; `npx astro build` exit 0.

**Po triażu (stan na koniec):** `npm test` **343** exit 0, `npx tsc --noEmit` exit 0, ESLint exit 0. **`npx astro build` NIE DA SIĘ w tej chwili powtórzyć** — pada na `Authentication error [code: 10000]` przy wywołaniu Cloudflare API (`/workers/subdomain/edge-preview`), bo build sięga po zdalny bindings dla `AI`. **Sprawdzone, że to nie skutek poprawek**: build pada identycznie po `git stash`, na commicie `a6bff3b`, który przechodził czterdzieści minut wcześniej. Wygasła sesja `wrangler`; wymaga zalogowania przez autora i ponownego przebiegu.

**Granice `## What We're NOT Doing` — wszystkie siedem dotrzymanych**, sprawdzone niezależnie: brak blokady terminowej (kontrakt API zna wyłącznie `blocked: boolean`), brak podłogi (pyta, nie zabrania), brak audytu, `src/lib/limits.ts` nietknięty w obu commitach.

**Czego nie udało się złamać — z dowodem, bo o to pytano wprost.** Schematu nie da się obejść tak, żeby endpoint wykonał niezamówioną operację: klucze nadmiarowe i zagnieżdżone są ścinane; `{role:"admin", blocked:null}` odrzucane na `blocked`, **bez** degradacji do gałęzi roli; `{role:"superadmin", blocked:true}` odrzucane na `role`, bez degradacji do gałęzi blokady. `z.NEVER` zatrzymuje przetwarzanie w obu miejscach (każde poprzedzone `ctx.addIssue`). Błąd F1 przeglądu `S-10` **nie** został powtórzony: `knownLastAdmin` wchodzi do kontekstu maszyny stanów, a `reset()` go nie kasuje. Nie udało się doprowadzić wyspy do trwale zablokowanego przycisku ani do podwójnego wysłania.

## Findings

### F1 — Test „odrzuca ciało, które nie jest obiektem" nie może sczerwienieć, a komunikat idzie po angielsku

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `src/lib/account-blocked-patch.ts:46`, `src/lib/account-blocked-patch.test.ts:133`
- **Detail**: **Zmierzone** (przez tymczasowy plik testowy, uruchomiony i skasowany) — pięć wariantów ciała niebędącego obiektem daje komunikat wewnętrzny po angielsku: `null` → `"Invalid input: expected object, received null"`, analogicznie dla `string`, `number`, `array`, `boolean`. Trafia to prosto w `jsonError("VALIDATION_FAILED", parsed.fields)` (`[id].ts:50`), czyli na drut. CLAUDE.md wymaga komunikatów pól **po polsku**, a NFR PRD zabrania wynoszenia wewnętrznej treści błędu na powierzchnię produktu.

  **To NIE jest regres tej zmiany** — sprawdzone: usunięty `account-role-patch.ts` miał ten sam kształt (`z.object({…})` bez komunikatu dla całego obiektu), a `generation-patch.ts` ma tę samą lukę. **Dziś nic tego nie renderuje**: komunikat ląduje pod kluczem `_`, a `TitleEditor` i `GenerateForm` czytają wyłącznie pola nazwane (`title`, `topic`); obie wyspy administratora biorą z `readApiError` tylko `{code, message}`.

  Ostrzejsza połowa jest jednak nowa i moja: przypadek testowy **deklaruje** pokrycie tej sytuacji, a `expect(result.fields[FORM_FIELD_KEY]).toBeDefined()` przechodzi tak samo dla angielskiego. `lessons.md` § „Zielone czytaj z tego, co zmieniłoby się przy porażce" — sprawdzenie niewrażliwe na awarię, którą ma wykrywać, nie jest sprawdzeniem.

- **Fix**: Dodać komunikat na poziomie obiektu — `z.object({ … }, { error: "Treść żądania musi być obiektem." })` (daje `path: []`, czyli ląduje pod `_`) — i zmienić asercję z `toBeDefined()` na porównanie z tym tekstem.
- **Decision**: FIXED — schemat dostal komunikat dla calego ciala po polsku („Treść żądania musi być obiektem."). Zmierzone przed wpisaniem, ze `z.object(..., { error })` daje `path: []`, czyli laduje pod `_`, i ze poprawny obiekt nadal przechodzi. Test przepisany na `it.each` z piecioma wariantami (tablica, null, string, liczba, boolean) i asercja na TRESC zamiast `toBeDefined()`. Mutacja (zdjecie komunikatu) czerwieni wszystkie piec; wczesniej test nie umial sczerwieniec od zadnej awarii.

### F2 — Stan `blockedSelf` nie mówi, że reszta tabeli przeczy stanowi

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: `src/components/admin/AccountBlockButton.tsx:146-161`
- **Detail**: Wzorzec z `S-10` niesie w stanie końcowym zdanie „Reszta tej tabeli pokazuje jeszcze stan sprzed zmiany i żadna operacja w niej już nie zadziała." (`AccountRoleButton.tsx:168-170`) — to naprawa **F5** tamtego przeglądu. Mój odpowiednik kończy się na „odblokować Cię może tylko inny administrator"; **zmierzone**: zero wystąpień zdania o tabeli. Sytuacja jest ta sama — po zablokowaniu siebie wiersz nie pokazuje znacznika, przycisk roli nadal mówi „Odbierz rolę", a każdy przycisk w tabeli jest martwy.

  **Waga jest niższa niż przy roli i mówię to wprost**: tam kliknięcie dawało mylące „Nie znaleziono takiej pozycji", tutaj bramka z fazy 2 odpowiada `403 ACCOUNT_BLOCKED`, czyli prawdziwym „Dostęp do tego konta został zawieszony." Ekran nie kłamie, jest tylko mniej uprzejmy. Rzecz w tym, że nagłówek komponentu (`:22-24`) deklaruje przepisanie „razem z ustaleniami przeglądów, które tamten komponent ukształtowały" — a akurat to ustalenie przepisane nie jest i nigdzie nie ma notatki dlaczego. `lessons.md` § „Milczenie reguły to nie zgoda": zła jest tylko cicha decyzja.

- **Fix**: Albo dopisać zdanie, albo dopisać komentarz, że tu nie jest potrzebne, bo bramka blokady daje uczciwy komunikat sama.
- **Decision**: FIXED — stan `blockedSelf` niesie zdanie o nieaktualnej tabeli, przeniesione z F5 przegladu calosci S-10. Komentarz obok zapisuje roznice wobec oryginalu: przy zdjeciu roli odmowa mowila mylace „Nie znaleziono takiej pozycji", a tutaj bramka blokady mowi wprost o zawieszeniu dostepu — wiec ekran nie klamie, ale tabela nadal przeczy stanowi konta.

### F3 — Dwa powołania na numery ustaleń przeglądu `S-10` są błędne

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: `src/components/admin/AccountBlockButton.tsx:39`, `:55` (oraz `AccountRoleButton.tsx:36`, `:57`)
- **Detail**: **Sprawdzone wobec zarchiwizowanego raportu** `context/archive/2026-09-09-admin-grant-role/reviews/impl-review.md`: stanu końcowego przed `reload()` dotyczy **F4** („Brak stanu końcowego przed `reload()`"), a nie F5 („Po degradacji siebie reszta tabeli przeczy stanowi"). Wejścia flagi do kontekstu dotyczy **F3** („`forceConfirmLast` przeżywał «Anuluj» i błąd"), a nie F1 („Brakujące addendum fazy 3"). Oba błędy są **odziedziczone** z `AccountRoleButton`, nie wymyślone tutaj — czyli poprawka dotyczy dwóch plików. Zachowanie jest poprawne; mylące są wyłącznie odsyłacze, a odsyłacz prowadzący do niewłaściwego ustalenia jest gorszy niż jego brak.
- **Fix**: Poprawić numery w obu komponentach.
- **Decision**: FIXED — i bylo gorzej, niz zglosil przeglad. W `AccountRoleButton` numery byly ZAMIENIONE MIEJSCAMI: naglowek pliku mowil F5 tam, gdzie chodzi o F4 („Brak stanu koncowego przed `reload()`"), a komentarz przy stanie `demoted` mowil F4 tam, gdzie chodzi o F5 („Po degradacji siebie reszta tabeli przeczy stanowi"). Poprawione w obu plikach, kazdy odsylacz dostal takze TYTUL ustalenia, zeby zly numer dalo sie zauwazyc bez siegania do archiwum.

### F4 — Faza 4 podwoiła liczbę wysp, czego dotyczyło świadomie pominięte F10 przeglądu `S-10`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Architecture
- **Location**: `src/pages/dashboard.astro:289-307`
- **Detail**: Przegląd `S-10` miał F10 — „`client:load` przy suficie 200 wierszy" — pominięte świadomie z uzasadnieniem: _„Produkcja ma jedno konto; zmiana dyrektywy hydracji bez pomiaru byłaby optymalizacją na oko. Wrócić, jeśli liczba kont kiedykolwiek zbliży się do sufitu."_ Faza 4 stawia **drugą** wyspę w każdym wierszu, czyli podwaja liczbę z tamtego ustalenia: do 400 korzeni hydracji przy suficie. **Zmierzone w buildzie**: `AccountBlockButton` to osobny chunk 4380 B, obok `AccountRoleButton` 4918 B — obie wyspy są niemal bliźniacze, co jest ceną decyzji „powtórzenie, a nie wspólny komponent".

  Uzasadnienie pominięcia nadal się broni (produkcja ma dwa konta), ale arytmetyka, na której stało, zmieniła się i nikt tego nie odnotował. Przy `S-12` dojdzie trzecia wyspa.

- **Fix**: Dopisać jedno zdanie do addendum fazy 4, że F10 przeglądu `S-10` dotyczy teraz podwojonej liczby — żeby powrót do tamtej decyzji miał od czego wystartować.
- **Decision**: RECORDED — dopisane do addendum fazy 4. Dyrektywa hydracji bez zmian, ale zapisana jest nowa arytmetyka: do 400 korzeni zamiast 200 i osobny chunk 4380 B obok 4918 B. Uzasadnienie pominiecia F10 przegladu S-10 nadal sie broni (produkcja ma dwa konta); zapis istnieje po to, zeby powrot do tamtej decyzji mial od czego wystartowac.

### F5 — Wyścig dwóch wysp w jednym wierszu gasi wynik jednej z nich

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Architecture
- **Location**: `src/components/admin/AccountBlockButton.tsx:137`, `src/components/admin/AccountRoleButton.tsx:149`
- **Detail**: Faza 4 po raz pierwszy stawia dwie niezależne wyspy w jednej komórce; obie po sukcesie na **cudzym** koncie wołają `window.location.reload()`. Gdy obie są w locie, ta, która skończy pierwsza, przeładuje stronę i użytkownik nie dowie się, czy druga operacja przeszła.

  **Czego to nie psuje**: danych. `pg_advisory_xact_lock(hashtext('account_role_gate'))` serializuje obie funkcje na tym samym kluczu, więc licznik administratorów i trafność ostrzeżenia zostają nienaruszone. Ginie wyłącznie informacja zwrotna. Prawdopodobieństwo niskie — trzeba kliknąć oba przyciski w oknie jednego żądania.

- **Fix**: Przyjąć jako ryzyko i zapisać — klasa jest nowa, a przy `S-12` do tego samego wiersza dojdzie trzecia wyspa.
- **Decision**: ACCEPTED — przyjete jako ryzyko i zapisane w addendum fazy 4. Danych nie psuje: blokada doradcza serializuje obie funkcje na tym samym kluczu, wiec ginie wylacznie informacja zwrotna. Do przemyslenia razem z trzecia wyspa przy S-12, a nie po kawalku.

### F6 — Addendum fazy 3 twierdzi więcej, niż zrobiono, i prostuje to cztery akapity niżej

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `context/changes/admin-block-account/plan.md` — addendum fazy 3
- **Detail**: Zdanie „wszystkie przypadki starego testu przeniesione" jest o jeden przypadek za mocne. Bez odpowiednika został _„zostawia confirmLast jako undefined, gdy pola nie ma"_ — zniknął **celowo**, bo normalizacja `?? false` przeniosła się z handlera do schematu, więc `undefined` już nie zostaje. Sam addendum wyjaśnia to cztery akapity niżej („zniknął przypadek testowy pilnujący… i to jest poprawa, nie utrata"), więc czytelnik dostaje prawdę — ale dwa zdania w tym samym dokumencie mówią co innego. To ta sama klasa co zdanie „reszta komentarzy przeniesiona bez zmian", które przegląd faz 1–2 wyłapał jako F2.
- **Fix**: Zamienić na „przeniesione poza jednym, który przestał być wyrażalny (patrz niżej)".
- **Decision**: FIXED — zdanie „wszystkie przypadki starego testu przeniesione" zastapione przez „przeniesione poza jednym, ktory przestal byc wyrazalny", z odeslaniem do akapitu nizej i adnotacja, ze poprzednie brzmienie bylo o ten jeden za mocne.

### F7 — Kontrakt fazy 4 mówił o etykiecie liczonej we frontmatterze; znacznik jest literałem w szablonie

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `src/pages/dashboard.astro:276`
- **Detail**: Plan zapisał: „Etykieta liczona we frontmatterze, w tym samym `try` co odczyt". Implementacja nie liczy żadnej etykiety — znacznik to stały tekst sterowany booleanem `account.isBlocked`. **Intencja kontraktu jest zachowana**, i to nie przypadkiem: ryzyko z `lessons.md` § „Degradacja odczytu nie chroni renderowania" bierze się z `Intl.*` i parsowania w szablonie, a tu nie ma ani jednego, więc nie ma czego wywrócić. Literalnie jednak kontrakt jest niespełniony i nigdzie tego nie odnotowano.
- **Fix**: Jedno zdanie w addendum fazy 4: etykieta okazała się niepotrzebna, bo znacznik nie wymaga formatowania.
- **Decision**: RECORDED — dopisane do addendum fazy 4: etykieta okazala sie niepotrzebna, bo znacznik nie wymaga formatowania, a ryzyko z lekcji o degradacji bierze sie z `Intl.*` i parsowania w szablonie, ktorych tu nie ma.

### F8 — F3 poprzedniego przeglądu domknięte w kodzie, ale nie w planie

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `context/changes/admin-block-account/plan.md` — addendum fazy 4
- **Detail**: Triaż faz 1–2 zapisał przy F3: „domknięcie przy fazie 4". Merytorycznie domknięte — `account-block-action.ts:85-101` nazywa F3 po imieniu, rozróżnia „niezmiennik w bazie" od „uprzejmości w widoku", mówi wprost, że pytanie omija zwykły `PATCH` z curl-a, i uzasadnia to odwracalnością; powtórzone w nagłówku testu. Rekomendowany Fix A mówił jednak o akapicie w **addendum**, a addendum fazy 4 nie wspomina o F3 ani słowem. Czytelnik samego planu widzi zapowiedź domknięcia i nie dostaje potwierdzenia. Zauważyłem to sam przy zamykaniu fazy 4 i nie wróciłem.
- **Fix**: Jedno zdanie w addendum fazy 4 z odesłaniem do modułu.
- **Decision**: RECORDED — dopisane do addendum fazy 4. Triaz faz 1-2 zapowiadal domkniecie F3 „przy fazie 4"; teraz plan to potwierdza i streszcza rozroznienie: niezmiennik w bazie, uprzejmosc w widoku.

### F9 — Nagłówki dwóch plików opisują połowę zawartości

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/accounts/[id].ts:10`, `src/lib/admin-accounts.test.ts:7`
- **Detail**: Nagłówek endpointu nadal brzmi „Zmiana roli konta (FR-018, S-10)", choć od `S-11` obsługuje dwie operacje; nagłówek testu mówi o mapowaniu kodów z `set_account_role()`, choć funkcję celowo przemianowano na operacyjnie neutralną. Dokładnie ta sama klasa, którą sam naprawiłem w tej zmianie dwa razy — komunikat `LAST_ADMIN_CONFIRM_REQUIRED` (F4 poprzedniego przeglądu) i nagłówek kolumny „Zmiana roli" → „Działania na koncie". Trzecie wystąpienie tego samego wzorca w jednym plastrze.
- **Fix**: Poprawić oba nagłówki.
- **Decision**: FIXED — naglowek endpointu obejmuje obie operacje, naglowek testu obie funkcje. Oba niosa notatke, ze to TRZECIE wystapienie tej samej klasy w tym plastrze (po komunikacie LAST_ADMIN_CONFIRM_REQUIRED i naglowku kolumny w tabeli).

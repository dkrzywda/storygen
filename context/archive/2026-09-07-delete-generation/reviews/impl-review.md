<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Usuwanie pozycji z własnej historii (S-06)

- **Plan**: `context/changes/delete-generation/plan.md`
- **Scope**: pełny plan — fazy 1–3 (24/24 pozycji Progress odhaczonych, wszystkie z SHA)
- **Date**: 2026-09-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations
- **Commits**: `21873df`, `2be05c7`, `4639868`, `b500b85`, `f06e0f3` + commit poprawek po przeglądzie (patrz historia gita)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Wyspa usuwania zakłada, że każda odpowiedź błędu ma kontrakt JSON

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/DeleteButton.tsx:36
- **Detail**: `const body: ApiErrorBody = await response.json()` zakłada, że każda odpowiedź nie-2xx niesie `{ error: { message } }`. Dwie ścieżki to łamią na tym konkretnym endpointcie. Pierwsza: ochrona CSRF Astro odrzuca `DELETE` bez `Origin` odpowiedzią **403 z czystym tekstem** — co ten sam plan zmierzył i zapisał w `plan.md:72-77`. `response.json()` wtedy rzuca, łapie to zewnętrzny `catch`, a użytkownik dostaje „Nie udało się połączyć z serwerem" — diagnozę sieciową dla żądania, które **dotarło** do serwera i zostało odrzucone. Strona błędu 5xx z Cloudflare zachowa się identycznie. Druga, gorsza: jeśli ciało się sparsuje, ale `error.message` jest puste, `setError` dostaje `""`, guard `{error && …}` gasi akapit, a `setStatus("idle")` zwija potwierdzenie — czyli użytkownik klika „Tak, usuń", pytanie znika i **nie pojawia się nic**. To dokładnie awaria zapisana w `lessons.md` jako „Komunikat błędu od zewnętrznej usługi może być pusty" (pusta czerwona ramka), osiągnięta z innej strony: nie przez brak treści z SDK, a przez brak koperty kontraktu. Skrót jest odziedziczony — `RatingControls.tsx:39` robi to samo, a `TitleEditor.tsx:38` nie ma nawet `try` — więc to problem repo, nie regresja tego plastra.
- **Fix A ⭐ Recommended**: Wspólny helper `readApiError(response)` w `src/lib/`, użyty przez wszystkie trzy wyspy
  - Strength: trzy wyspy powtarzają dziś ten sam skrót; jedno miejsce czyni regułę „nic z transportu nie trafia na ekran" wykonalną grepem, zamiast trzeciej kopii.
  - Tradeoff: dotyka dwóch plików spoza tego plastra, więc wychodzi za jego zakres.
  - Confidence: HIGH — wzorzec `API_ERRORS` i `messageForCode` już istnieje i jest do tego stworzony.
  - Blind spot: nie sprawdzono, czy `TitleEditor` nie polega gdzieś na dzisiejszym braku `try`.
- **Fix B**: Załatać tylko `DeleteButton` — `await response.json().catch(() => null)` plus fallback na `API_ERRORS.INTERNAL.message`
  - Strength: mieści się w zakresie plastra, zamyka najgorszy przypadek (cicha pustka) natychmiast.
  - Tradeoff: utrwala trzecią kopię tego samego skrótu; dwie pozostałe wyspy zostają z błędem.
  - Confidence: HIGH — zmiana w jednej funkcji.
  - Blind spot: brak.
- **Decision**: FIXED — wariant A. `readApiError(response)` w `src/lib/api-errors.ts`, użyty przez WSZYSTKIE cztery wyspy: DeleteButton, RatingControls, TitleEditor oraz GenerateForm (przegląd nazwał trzy; czwarta miała ten sam skrót i pominięcie jej podważyłoby wymuszalność grepem). Weryfikacja: `grep -rn "ApiErrorBody = await response.json()" src/` nie zwraca żadnej wyspy.

### F2 — Focus ginie przy przejściu do potwierdzenia, a zmiana stanu nie jest ogłaszana

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/DeleteButton.tsx:50-92
- **Detail**: Gałąź spoczynku i gałąź potwierdzenia renderują **rozłączne** drzewa przycisków. Po aktywacji „Usuń" element z focusem jest odmontowany, więc focus spada na `<body>` — kolejny `Tab` u osoby korzystającej z klawiatury albo czytnika ekranu startuje od góry dokumentu, nie od „Tak, usuń". Nic tej zmiany nie ogłasza: brak `role="alert"`, `aria-live` i `aria-expanded`, więc użytkownik czytnika słyszy ciszę i nie wie, że pytanie się pojawiło ani gdzie jest. To jedyna nieodwracalna akcja w produkcie (`plan.md:39` — bez kosza, bez cofania), więc niedostępność kroku potwierdzenia jest luką funkcjonalną, nie kosmetyką. Ścieżka myszką jest dobrze zaprojektowana i warto ją zachować: „Anuluj" stoi na końcu grupy wyrównanej do prawej, więc przypadkowy drugi klik trafia w anulowanie, nie w potwierdzenie.
- **Fix**: `role="alert"` na kontenerze potwierdzenia i jawne przeniesienie focusu na „Anuluj" przy wejściu w stan `confirming` (ref + useEffect, celowo na bezpieczny cel).
  - Strength: obie zmiany są lokalne w jednym komponencie; „Anuluj" jako domyślny cel focusu jest spójny z tym, co już robi układ dla myszki.
  - Tradeoff: pierwszy `ref`/`useEffect` w tej wyspie; nieznacznie więcej kodu.
  - Confidence: MEDIUM — nie testowano z czytnikiem ekranu, tylko z drzewa dostępności.
  - Blind spot: nie sprawdzono, czy `role="alert"` nie zdubluje ogłoszenia z akapitem błędu.
- **Decision**: FIXED — `role="alert"` na kontenerze potwierdzenia i na akapicie błędu (nigdy nie renderują się jednocześnie, więc bez podwójnego ogłoszenia), focus przenoszony przez `ref`+`useEffect` na „Anuluj”, tekst pytania nazywa konsekwencję („Tego nie da się odwrócić”). Sprawdzone statycznie; weryfikacja z czytnikiem ekranu nie była wykonana.

### F3 — Roadmapa mówi `proposed` o plastrze domkniętym i wypchniętym

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:84 oraz blok `### S-06`
- **Detail**: `change.md` ma `implemented`, wszystkie 24 pozycje Progress mają SHA, epilog `b500b85` wypchnięty — a w `origin/main` roadmapa nadal twierdzi, że S-06 jest `proposed`. Przestawienie na `in-progress` leży wyłącznie w drzewie roboczym, w żadnym commicie. To dokładnie ta szkoda, którą `lessons.md` zapisuje jako „roadmapa kłamała o własnym stanie". Trzy razy z rzędu w rytuale faz wybrano indeksowanie tylko zbioru fazy, więc plik zostawał brudny za każdym razem. Uwaga: drugą połowę tego ustalenia (`test-plan.md` niezacommitowany) już zamknięto commitem `f06e0f3` w trakcie tego przeglądu.
- **Fix**: Przywrócić `roadmap.md` do stanu z HEAD i pozwolić `/10x-archive` przestawić S-06 wprost na `done` — skill zaindeksuje wtedy swoją własną edycję do commita archiwizacyjnego.
  - Strength: stan przejściowy `in-progress` i tak jest nadpisywany przez `done`, więc nic nie ginie; archiwizacja przestaje wymagać ręcznego commita.
  - Tradeoff: brak.
  - Confidence: HIGH — udokumentowana ścieżka `/10x-archive`, sprawdzona bramka `ROADMAP_PREDIRTY`.
  - Blind spot: brak.
- **Decision**: ACCEPTED — rozwiązane przez `/10x-archive`: `roadmap.md` przywrócony do HEAD, żeby skill mógł przestawić S-06 wprost na `done` i zaindeksować to do commita archiwizacyjnego. Połowa dotycząca `test-plan.md` zamknięta wcześniej commitem `f06e0f3`.

### F4 — Dryf: liczby zestawu integracyjnego w test-planie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:163
- **Detail**: Faza 1 miała w kontrakcie poprawić nieaktualne liczby w sekcji „Jak to uruchomić". Poprawiła zestaw **jednostkowy** (4 pliki/68 → 7/164) i przeoczyła linię o zestawie **integracyjnym** sześć linii niżej, która twierdziła „1 plik, 6 testów", gdy plaster podniósł go do 8. Pozycja Progress 1.7 („Zapis w test-plan.md zgadza się z tym, co robi kod testu") była odhaczona z SHA `21873df`, wskazując na pracę, której w tamtym commicie nie było. To ten sam wzorzec, przed którym plan ostrzegał: dokument twierdzi coś, co przestało być prawdą.
- **Fix**: Poprawić liczbę na 8 i zbić `updated` we frontmatterze.
- **Decision**: FIXED — commit `f06e0f3`, obie liczby sprawdzone wobec faktycznego uruchomienia (`npm test` 7/164, `npm run test:integration` 1/8)

### F5 — Ścieżka sukcesu nie ma trybu awarii: nieudane przeładowanie zostawia wiersz, którego już nie ma

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/components/generations/DeleteButton.tsx:43
- **Detail**: `window.location.reload()` jest **jedyną** rzeczą, która odzwierciedla usunięcie, a `status` celowo zostaje na `"deleting"`, bo dokument ma zostać podmieniony. Jeśli przeładowanie nie dojdzie — brak sieci, błąd SSR (`generations.astro:13` degraduje niedostępne Supabase do pustej listy, nie do błędu), uśpiona karta — wiersz zostaje widoczny z przyciskiem zablokowanym na „Usuwam…", choć w bazie go już nie ma. Interfejs kłamie w stronę zachęcającą do drugiej próby, a ta zwróci celowy `NOT_FOUND`, więc użytkownik zobaczy „Nie znaleziono takiej pozycji" dla czegoś, na co patrzy.
- **Fix**: Przed przeładowaniem wprowadzić stan terminalny czytający się jako zakończony (np. wyszarzone „Usunięto" bez aktywnego przycisku), żeby zawieszone odświeżenie degradowało się do „już nie ma, strona jest nieświeża", a nie do „wciąż jest, spróbuj znowu".
- **Decision**: FIXED — stan terminalny `deleted` renderujący wyszarzone „Usunięto” bez aktywnego przycisku, ustawiany przed `window.location.reload()`.

### F6 — Zestaw dowodzi izolacji właściciel–właściciel, ale nie dotyka roli `anon`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: src/lib/generations.integration.test.ts:156-206
- **Detail**: Trzy nowe przypadki są dobrze zbudowane — kontrola pozytywna zakłada własny wiersz, więc kruchość kolejności zniknęła. Czego żaden nie pokrywa, to połowa `to authenticated` w polityce: każdy klient w pliku jest zarejestrowanym użytkownikiem. Gdyby przyszła migracja rozszerzyła politykę do `to public` albo klauzula roli zniknęła, zestaw **zostałby zielony**, bo oba konta są uwierzytelnione. Bramka `UNAUTHORIZED` w endpointcie czyni to obroną w głąb, nie dziurą — ale cały sens tego pliku, wedle jego własnego docblocka, to dowodzenie **polityki**, nie handlera.
- **Fix**: Dodać jeden przypadek z gołym klientem bez `signUp`, sprawdzający, że `delete().eq("id", aliceRowId).select()` zwraca zero wierszy. Trzy linie, a przypina klauzulę roli, której nic innego nie przypina.
- **Decision**: FIXED, z korektą uzasadnienia. Przypadek „anonim nie usuwa niczego” dodany, ale ZMIERZONE 2026-09-07: rozszerzenie samej polityki `delete` do `to public using (true)` NIE robi go czerwonym — anonima nadal blokuje SELECT. Czerwony dopiero przy obu. Ma więc ten sam zasięg dowodowy co reszta pliku, nie „przypina klauzuli roli osobno”, jak twierdził przegląd. Dodatkowo: pierwsza wersja celowała w `aliceRowId` i przy zepsutych politykach usuwała współdzielony wiersz jako pierwsza, przez co „Bob nie usuwa cudzego” przechodził FAŁSZYWIE — poprawione na własny wiersz, po czym eksperyment pokazuje 4 czerwone zamiast 3.

### F7 — Przycisk potwierdzenia: zakodowane `text-white` i brak stanu hover

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/components/generations/DeleteButton.tsx:76
- **Detail**: Dwa powiązane problemy w jednej linii. Po pierwsze `text-white` to zakodowana klasa Tailwinda, a komentarz bloku tokenów w `global.css:113-127` twierdzi wprost, że ekrany „NIE używają już zakodowanych klas Tailwinda (text-white, …)" — wymieniając `text-white` jako pierwszą. W praktyce kod przeczy własnemu komentarzowi: cztery miejsca w `src/` (poza `ui/button.tsx`) łączą tło akcentu z `text-white`, bo **nie ma tokenu koloru pierwszoplanowego** dla `brand`/`danger`. Po drugie przycisk ma `transition-opacity` tam, gdzie całe repo używa `transition-colors`, i **żadnego stanu `hover:`** — czyli jedyna nieodwracalna kontrolka nie daje sprzężenia zwrotnego, że jest aktywna. Przyczyna jest ta sama: `global.css:143-145` definiuje `danger`, `danger-soft` i `danger-line`, ale nie `danger-strong`, do którego można by przejść.
- **Fix**: Dodać `--color-danger-strong` obok istniejących tokenów danger i jeden token koloru pierwszoplanowego (np. `--color-on-accent`), potem użyć `hover:bg-danger-strong text-on-accent transition-colors`, lustrzanie do `bg-brand hover:bg-brand-strong`.
  - Strength: domyka lukę w warstwie tokenów, którą ta wyspa tylko obnażyła, i czyni komentarz w `global.css` znów prawdziwym.
  - Tradeoff: przemiatanie czterech istniejących miejsc wychodzi poza zakres plastra; alternatywą jest sprostowanie komentarza.
  - Confidence: HIGH — sprawdzone grepem: tokenów `danger-strong` i `on-accent` nie ma.
  - Blind spot: brak.
- **Decision**: FIXED (hover) / SKIPPED (przemiatanie `text-white`). Dodany `--color-danger-strong`, przycisk ma `hover:bg-danger-strong transition-colors`. Cztery istniejące miejsca z `text-white` na tle akcentu i rozjechany komentarz w `global.css` zostają — to sprawa warstwy tokenów, nie tego plastra.

### F8 — Opis ekranu historii nie wspomina o usuwaniu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: src/pages/generations.astro:22-24
- **Detail**: Zdanie prowadzące mówi „Nadaj im tytuły, oceń gwiazdkami i oznacz ulubione." To teraz główny ekran niosący trwałe usuwanie, a wyliczenie tego, co ekran robi, nie zostało rozszerzone — jedyna nieodwracalna możliwość jest jedyną niewymienioną. `dashboard.astro:52` jest ogólny i niczego nie wymaga, więc niespójność jest tylko tutaj.
- **Fix**: Rozszerzyć zdanie, np. „…oznacz ulubione, a niepotrzebne trwale usuń".
- **Decision**: FIXED — „…oznacz ulubione, a niepotrzebne trwale usuń”.

### F9 — Dwa zastane błędy lintu w zmienionym pliku testu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny wybór; zatrzymaj się i przemyśl
- **Dimension**: Success Criteria
- **Location**: src/lib/generations.integration.test.ts:33-34
- **Detail**: `npx eslint` zgłasza dwa `no-unnecessary-condition` na `process.env.SUPABASE_URL ?? "…"` i `process.env.SUPABASE_KEY ?? "…"`. Dowiedziono, że są **zastane**: `git diff -U0` na całym plastrze ma hunki w liniach 24–27, 156–157, 160–161 i 164+, nigdy 33–34, a wersja przed plastrem ma tam identyczne dwie linie. Przyczyną jest regeneracja `worker-configuration.d.ts` w tej sesji — typy Cloudflare deklarują `process.env.X` jako nie-opcjonalne. Napięcie jest realne: `??` jest **funkcjonalnie konieczne**, bo bez zmiennych środowiskowych test musi mieć wartość domyślną, więc usunięcie go dla lintera zepsułoby test. Kryteria 2.2 i 3.2 nazywały konkretne pliki i ten się w nich nie znajdował, dlatego wymiar Success Criteria pozostaje PASS.
- **Fix A ⭐ Recommended**: Zostawić kod i wyciszyć regułę punktowo z komentarzem wyjaśniającym, że typy kłamią o `process.env`
  - Strength: zachowuje działające zachowanie, zapisuje **dlaczego** wyciszenie istnieje, odblokowuje lint na tym pliku.
  - Tradeoff: dwa komentarze wyciszające w pliku testu.
  - Confidence: MEDIUM — nie sprawdzono, czy `wrangler types` nie zmieni tego typowania przy następnej regeneracji.
  - Blind spot: nie ustalono, czy `astro sync` czy `wrangler types` jest źródłem tego typu.
- **Fix B**: Nie ruszać — udokumentować jako znany szum lintu poza zakresem plastra
  - Strength: zero zmian w pliku dowodzącym najważniejszej gwarancji w projekcie.
  - Tradeoff: `npx eslint` na tym pliku zostaje czerwony i będzie mylił każdego następnego.
  - Confidence: HIGH.
  - Blind spot: brak.
- **Decision**: FIXED — wariant A. Punktowe `eslint-disable`/`enable` wokół dwóch linii z komentarzem, że typy Cloudflare kłamią o `process.env` i `??` musi zostać. `npx eslint` na pliku: czysto.

## Sprawdzone i uznane za poprawne (bez ustaleń)

- **Polityka DELETE** — per operacja, per rola, `to authenticated`, `using (auth.uid() = user_id)`; identyczna w kształcie i nazewnictwie (`generations_<op>_own`) z trzema politykami z `20260903125113`. Brak `with check` jest poprawny — polityki `DELETE` w Postgresie nie mają tej klauzuli. Komentarz wyjaśnia _dlaczego_ i odsyła do świadomej luki oraz do S-06.
- **Handler DELETE** — odtwarza kolejność bramek `PATCH` dokładnie: sesja → kształt UUID → klient → zapytanie → zero wierszy to 404; błędy bazy przez `toApiErrorCode` i `logApiError` z tym samym scope. Dwa świadome odejścia, oba na plus: `.select("id")` zamiast gołego `.select()` (usunięta treść nigdy nie wraca w odpowiedzi) i `jsonOk({ id })` zamiast całego wiersza.
- **Brak powierzchni wstrzyknięcia i brak luki autoryzacyjnej** — `id` ograniczony wyrażeniem regularnym przed zapytaniem, zapytanie parametryzowane, a handler **celowo nie** porównuje właściciela w kodzie, więc RLS zostaje jedynym źródłem izolacji i błędna polityka nie może zostać zamaskowana filtrem aplikacyjnym.
- **Brak dziury CSRF** — `/api/generations/*` nie jest w `PROTECTED_ROUTES`, więc API odpowiada kontraktem JSON, nie przekierowaniem. Międzydomenowy `fetch` z metodą `DELETE` wymusza preflight, którego nikt nie obsługuje, a ochrona Astro odrzuca żądania bez nagłówków.
- **Brak wyścigu przy podwójnym kliknięciu** — `setStatus("deleting")` wykonuje się synchronicznie przed pierwszym `await`, więc React zdąży wystawić `disabled`; a zdublowany `DELETE` zwróciłby nieszkodliwe 404. Układ stawia „Anuluj", nie „Tak, usuń", w miejscu, gdzie było „Usuń".
- **Flaga `deletable`** — domyślnie `false`, lustrzanie do istniejącej `ranked`, z zapisanym uzasadnieniem domyślnej wartości; trzy zamierzone miejsca wywołania, a gałąź rankingu nosi komentarz „to pominięcie jest znaczące, nie naprawiaj go".
- **Zakres** — żadnego naruszenia „What We're NOT Doing": brak `deleted_at` w `src/` i `supabase/`, brak usuwania zbiorczego, brak modala, brak usuwania konta, FR-010 nietknięte, migracje niewypchnięte.
- **Success Criteria** — wszystkie kryteria automatyczne przejechane od nowa po restarcie środowiska: migracje zastosowane, polityka obecna w `pg_policies`, 8/8 integracyjnych, 164/164 jednostkowych, `astro check` 0 błędów, `prettier --check` czysto. Wszystkie kryteria ręczne mają dowód w rozmowie, w tym eksperyment obalający dla 1.6.

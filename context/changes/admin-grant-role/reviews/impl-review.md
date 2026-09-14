<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin nadaje i odbiera rolę administratora — całość

- **Plan**: `context/changes/admin-grant-role/plan.md`
- **Scope**: cały plan (fazy 1–3); faza 1 miała własny przegląd — `reviews/impl-review-phase-1.md`
- **Date**: 2026-09-14
- **Verdict**: NEEDS ATTENTION → wszystkie ustalenia rozstrzygnięte
- **Findings**: 0 krytycznych, 6 ostrzeżeń, 4 obserwacje

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Weryfikacja kryteriów sukcesu (odtworzona 2026-09-14, wszystkie trzy fazy)

| Kryterium                     | Wynik                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 migracja na czystej bazie | 9 migracji, exit 0                                                                                                                 |
| 1.3 skrypt kontrolny          | werdykt OK; `ov_anon=f`, `ov_service=f`, `ov_auth=t`, `sr_anon=f`, `sr_service=f`, `sr_auth=t`; oba `definer`, oba z `search_path` |
| 1.5 test SQL                  | 20/20, 0 błędów                                                                                                                    |
| 1.6 testy integracyjne        | 55, exit 0                                                                                                                         |
| 2.4 + 3.3 testy jednostkowe   | 268, exit 0                                                                                                                        |
| 1.7 + 2.5 + 3.2 `tsc`, ESLint | exit 0                                                                                                                             |
| 3.1 `astro build`             | exit 0                                                                                                                             |

Środowiskowo: `npm run test:integration` wymaga `npx supabase db reset`, gdy dobowy sufit aplikacji został w danym dniu zużyty wcześniejszymi przebiegami — zdarzyło się to trzy razy w trakcie tego przeglądu.

## Czego przegląd NIE znalazł (zapisane wprost)

- **Ciągłość kontraktu — bez ustaleń.** Pięć kodów zwracanych przez `set_account_role` ma pełne pokrycie w `mapRoleChangeCode`, `default → INTERNAL` jest fail-closed, a każdy kod wyjściowy ma wpis w `API_ERRORS` (sprawdzane strukturalnie testem, nie po nazwie). Dziesięć kolumn `returns table` odpowiada dokładnie temu, co czyta `fetchAccountsOverview`; `database.types.ts` jest przegenerowany, więc zmiana nazwy w SQL byłaby błędem kompilacji, nie cichą regresją.
- **Bramka od kliknięcia do SQL — bez ustaleń.** Jedna granica, w bazie, czytana z `auth.users` dla `auth.uid()`. Wywołanie RPC z pominięciem endpointu trafia w tę samą bramkę. `isAdmin` występuje w kodzie produkcyjnym wyłącznie w `dashboard.astro` i steruje wyłącznie renderowaniem.
- **Bezpieczeństwo renderowania w Astro — bez ustaleń.** Całe formatowanie (`registeredLabel`, `roleLabel`, `new Date`) we frontmatterze, w tym samym `try` co odczyt. Szablon emituje wyłącznie gotowe napisy i liczby.
- **Podwójne kliknięcie — bez ustaleń.** `setStatus("sending")` w synchronicznej części obsługi zdarzenia, gałąź potwierdzenia przeżywa `sending`, oba przyciski `disabled`.
- **`## What We're NOT Doing` — nic nie naruszone.** Sprawdzone siedem zakazów wobec pełnego diffu faz 2 i 3.

## Findings

### F1 — Brakujące addendum fazy 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: `context/changes/admin-grant-role/plan.md:219`, `:348`
- **Detail**: Fazy 1 i 2 zapisały swoje odstępstwa w addendach; faza 3 nie. Plan czytany samodzielnie obiecuje „test jednostkowy **wyspy**" w kontrakcie i w tytule pozycji Progress, a testowana jest funkcja czysta. Zweryfikowane: zero wystąpień `account-role-action` w całym planie. Trzecie rozejście planu z implementacją w tym plastrze.
- **Decision**: FIXED. Dopisane `## Addendum 2026-09-14 — adaptacja fazy 3`, z dowodami niedostępności testów komponentów (`vitest.config.ts:13-14`, brak jsdom w `package-lock.json`), z zapisem, że tytuł 3.3 pozostaje niedokładny, i z odnotowaniem wewnętrznej sprzeczności planu (`:203` vs kryterium 3.5).

### F2 — Uzasadnienie potwierdzenia „sobie" mocniejsze niż fakt

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/lib/account-role-action.ts:60`
- **Detail**: Komentarz twierdził, że oba powody pytania są „o nieodwracalności dla klikającego". Dla przypadku „sobie, ale nie ostatnia" to nieprawda — inny administrator rolę przywróci. Dodatkowo: bariera „sobie" nie ma odpowiednika w bazie (`is_self` występuje w migracji raz, jako kolumna przeglądu; wewnątrz `set_account_role` zero razy), więc omija ją zwykły `PATCH` — wbrew zasadzie z `plan.md:62`.
- **Decision**: FIXED. Komentarz rozdziela teraz barierę realną (ostatnia rola, stoi w bazie) od uprzejmości (sobie, tylko w widoku, omijalna, świadomie). Przeniesienie do bazy odrzucone i uzasadnione: zasada z `:62` chroni przed działaniem cudzym, a tu chronimy klikającego przed nim samym przy operacji odwracalnej.

### F3 — `forceConfirmLast` przeżywał „Anuluj" i błąd

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/components/admin/AccountRoleButton.tsx:38`, `:80`
- **Detail**: Flaga była ustawiana po odpowiedzi 409 i **nigdy nie zerowana** — zweryfikowane: dwa wystąpienia w pliku, deklaracja i jedno przypisanie. Karmiła wyłącznie ciało żądania, nie kontekst decyzji. Skutek: klik → ostrzeżenie „stracisz dostęp" → 409 → ostrzeżenie o ostatniej roli → **„Anuluj"** → kolejny klik pyta słabszym ostrzeżeniem, a wysyła `confirmLast: true`. Zgoda udzielona na inne zdanie, niż to, co się stało; jawne „Anuluj" przeniesione po cichu na następną próbę.
- **Decision**: FIXED. Flaga (przemianowana na `knownLastAdmin`) wchodzi teraz do **kontekstu** maszyny stanów, więc ostrzeżenie i wysyłana zgoda opisują ten sam stan. Celowo **nie** jest zerowana przy „Anuluj": to fakt o koncie, nie o próbie — zerowanie przywróciłoby dokładnie ten błąd. Uzasadnienie zapisane przy `reset()`.

### F4 — Brak stanu końcowego przed `reload()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/components/admin/AccountRoleButton.tsx:101`
- **Detail**: `DeleteButton`, z którego ten komponent przepisano, ma stan `deleted` **wyłącznie** dla przypadku nieudanego przeładowania, i ma na to komentarz nazywający to ustaleniem swojego przeglądu (`DeleteButton.tsx:34-41`). Przepisano układ, pominięto ustalenie. Gdy przeładowanie nie dojdzie, przycisk zostaje na zawsze w „Zapisuję…", choć rola w bazie jest już zmieniona.
- **Decision**: FIXED. Dodany stan `done` ustawiany **przed** `reload()`, z komunikatem i przyciskiem „Odśwież panel”.

### F5 — Po degradacji siebie reszta tabeli przeczy stanowi

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/components/admin/AccountRoleButton.tsx:109`, `src/pages/dashboard.astro:237`
- **Detail**: Wyspa zmienia tylko własną komórkę. Po zdjęciu sobie roli kolumna „Rola" w tym samym wierszu nadal pokazuje „administrator", a przyciski przy pozostałych wierszach zostają aktywne — kliknięcie któregokolwiek da „Nie znaleziono takiej pozycji" dla konta widocznego na ekranie.
- **Decision**: FIXED. Komunikat stanu `demoted` mówi teraz wprost, że reszta tabeli pokazuje stan sprzed zmiany i żadna operacja w niej nie zadziała. Wygaszanie cudzych wierszy z tej wyspy odrzucone jako droższe od powiedzenia tego wprost.

### F6 — „Nie ma jeszcze żadnych kont" jest fałszywe w jedynym stanie, w jakim pada

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/pages/dashboard.astro:218`
- **Detail**: Bramka przepuszcza wołającego tylko gdy `me.deleted_at is null`, a listowany zbiór filtruje `u.deleted_at is null` — administrator, który przeszedł bramkę, **zawsze** widzi co najmniej własny wiersz. Zero wierszy oznacza więc odmowę bazy (nieodświeżony token w żądaniu PostgREST, rola zdjęta między `getUser()` a RPC), nigdy braku kont.
- **Decision**: FIXED. Komunikat mówi teraz, że lista zawsze zawiera własne konto, więc pustka znaczy odrzucony odczyt, i podpowiada odświeżenie albo ponowne logowanie. Poprawiony też komentarz „TRZY STANY" wyżej, który powtarzał obalone twierdzenie.

### F7 — Osierocone ostrzeżenie po nieudanym wysłaniu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/components/admin/AccountRoleButton.tsx:85`
- **Detail**: Po błędzie innym niż 409 `status` wracał na `idle`, ale `warning` zostawał w stanie — opisywał próbę, której już nie ma.
- **Decision**: FIXED przy okazji F3. Ścieżka błędu i ścieżka sieciowa zerują teraz `warning`.

### F8 — Komentarz przy fladze opisywał scenariusz szerszy niż osiągalny

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/components/admin/AccountRoleButton.tsx:32`
- **Detail**: Komentarz tłumaczył flagę zmianą roli „w drugiej karcie" dla dowolnego wiersza. Z bramki wynika węższa prawda: wołający musi być adminem, więc jest liczony; gdy cel jest kimś innym i ma rolę, adminów jest co najmniej dwóch i 409 paść nie może. Ścieżka jest osiągalna wyłącznie dla własnego wiersza.
- **Decision**: FIXED. Komentarz opisuje teraz dokładny, wąski przebieg.

### F9 — Nieaktualna flaga w drugą stronę daje nadmiarowe ostrzeżenie

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `src/lib/account-role-action.ts:72`
- **Detail**: Gdy strona wyrenderowała `isLastAdmin: true`, a w międzyczasie doszedł drugi administrator, ekran nadal ostrzega, że to ostatnia rola. Baza zignoruje `confirmLast`, operacja przejdzie, skutek będzie łagodniejszy niż zapowiedziany.
- **Decision**: SKIPPED. Ostrzeżenie myli się w stronę nadmiernej ostrożności — mówi, że skutek jest cięższy, niż będzie. Naprawa wymagałaby odczytu stanu przed pokazaniem pytania, czyli dodatkowego wywołania na każde kliknięcie, dla poprawy komunikatu, który i tak nikogo nie wprowadza w niebezpieczeństwo.

### F10 — `client:load` przy suficie 200 wierszy

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: `src/pages/dashboard.astro:252`
- **Detail**: Każdy wiersz hydruje osobną wyspę natychmiast. Przy dzisiejszych dwóch kontach bez znaczenia; przy suficie `row_limit = 200` to 200 hydracji na wejściu w panel, na ścieżce nieinteraktywnej do czasu kliknięcia. `client:visible` dałby ten sam efekt bez kosztu wstępnego.
- **Decision**: SKIPPED, zapisane jako świadome. Produkcja ma jedno konto; zmiana dyrektywy hydracji bez pomiaru byłaby optymalizacją na oko. Wrócić, jeśli liczba kont kiedykolwiek zbliży się do sufitu.

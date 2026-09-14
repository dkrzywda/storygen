<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin blokuje i odblokowuje konto

- **Plan**: `context/changes/admin-block-account/plan.md`
- **Scope**: Fazy 1–2 z 4 (17 z 30 pozycji Progress)
- **Date**: 2026-09-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 krytycznych, 6 ostrzeżeń, 4 obserwacje

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

**Kryteria automatyczne przebiegnięte niezależnie w trakcie przeglądu:** migracja stosuje się na czystej bazie; skrypt kontrolny `werdykt OK`; test SQL 30/30 `bledow 0`; `npm test` exit 0 (289); `npm run test:integration` exit 0 (59); `tsc --noEmit` exit 0; ESLint na dotkniętych plikach exit 0.

**Granice `## What We're NOT Doing` — wszystkie siedem dotrzymanych**, sprawdzone niezależnie przez oba przeglądy: brak unieważniania sesji po stronie dostawcy, brak blokady terminowej, brak podłogi, brak usuwania kont, brak zmian w liczeniu sufitów, brak wspólnej funkcji stanu konta, brak audytu i kanału kontaktu.

## Findings

### F1 — Kontrola `search_path` przepuszcza niepustą ścieżkę

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `context/changes/admin-block-account/verify-blocking.sql:55-64`
- **Detail**: Kontrola brzmi `proconfig::text like '%search_path=%'`, więc czerwieni się wyłącznie przy **braku** `set search_path`. **Zmierzone** przez utworzenie funkcji próbnej z `set search_path = public`: `proconfig` = `{search_path=public}`, kontrola `LIKE` mówi `true` (przechodzi), kontrola dokładna `proconfig @> array['search_path=']` mówi `false`. Czyli sprawdzenie jest niewrażliwe dokładnie na tę awarię, przed którą `search_path = ''` broni w `security definer`. To `lessons.md` § „Zielone czytaj z tego, co zmieniłoby się przy porażce", złamane w skrypcie, którego jedynym zadaniem jest weryfikacja. Same funkcje mają poprawne `search_path = ''` — luka jest w dowodzie, nie w kodzie.
- **Fix**: Zamienić `like '%search_path=%'` na `proconfig @> array['search_path=']` we wszystkich czterech kolumnach `*_path`.
- **Decision**: FIXED — porownanie dokladne przez `proconfig @> array`. Pierwsza proba porownywala z `search_path=` i zaczerwienila CZYSTY stan; zmierzone, ze Postgres CYTUJE pusty lancuch, wiec element brzmi `search_path=""`. Dowod czulosci w obie strony: funkcja z `search_path = public` czerwieni werdykt, stan czysty daje OK.

### F2 — Odtworzone funkcje zgubiły komentarze uzasadniające, w tym pomiar

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; warto się zatrzymać
- **Dimension**: Plan Adherence
- **Location**: `supabase/migrations/20260914120000_account_blocking.sql:96-190`, `:311-313`
- **Detail**: `drop` + `create` na `accounts_overview()` zgubiło: cztery komentarze przy kolumnach (`id` — „adres e-mail celowo NIE jest selektorem: jest zmienny, jest PII"; `role`; `is_self`; `is_last_admin` — „LICZONE W BAZIE, NIE W WIDOKU, ustalenie F3 przeglądu S-09"), cały blok `BRAMKA` wraz z **pomiarem** („Zmierzone 2026-09-08: `auth.jwt() #>> '{app_metadata,role}'` zwraca NULL dla tokenu wystawionego PRZED nadaniem roli, bo claimy zamarzają w chwili wystawienia"), uzasadnienie `deleted_at` wołającego („Tokeny żyją po `deleted_at`, więc okno jest realne, nie teoretyczne") oraz dwa zdania z `comment on function`. Dodatkowo z nagłówka `set_account_role` zniknęły dwa uzasadnienia: „ZWRACA KOD, NIE BOOLEAN I NIE WYJĄTEK" oraz „VOLATILE, czyli BEZ `stable`" — przy nagłówku, który deklaruje wprost „Reszta ciała i komentarzy jest przeniesiona **bez zmian**". Dla ciała to prawda, dla nagłówka nie. **Zmierzone**: pomiar o zamarzających claimach istnieje już tylko w dwóch migracjach **nadpisanych** (`20260909072831`, `20260909121500`) — czyli w plikach, które nie definiują już niczego. To dokładnie drugie ostrze reguły `lessons.md` § „Funkcja uprzywilejowana filtruje stan konta wołającego", którą ten sam plik cytuje.
- **Fix**: Przenieść brakujące komentarze do `20260914120000` (kolumny, blok `BRAMKA` z pomiarem, uzasadnienie `deleted_at`, dwa zdania nagłówka `set_account_role`) i albo urealnić zdanie „przeniesiona bez zmian", albo je usunąć.
- **Decision**: FIXED — przywrocone komentarze przy czterech kolumnach, caly blok BRAMKA z pomiarem z 2026-09-08 o zamarzajacych claimach, uzasadnienie `deleted_at` wolajacego, dwa zdania w `comment on function` oraz dwa uzasadnienia z naglowka `set_account_role` (kod zamiast wyjatku, volatile zamiast stable). Zdanie „reszta przeniesiona bez zmian" urealnione i opatrzone notatka, ze bylo nieprawdziwe.

### F3 — Brak potwierdzenia przy blokowaniu siebie, wbrew kontraktowi planu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; warto się zatrzymać
- **Dimension**: Plan Adherence
- **Location**: `supabase/migrations/20260914120000_account_blocking.sql:264` vs `context/changes/admin-block-account/plan.md:90`
- **Detail**: Plan zapisał dwa niezależne wyzwalacze: „blokowanie konta, które jest administratorem, gdy jest ostatnim — **albo gdy celem jest wołający**". Zaimplementowany jest tylko pierwszy: `if p_blocked and v_target_role = 'admin' and not v_target_blocked`. Administrator przy dwóch aktywnych adminach blokujący samego siebie dostaje `ok` bez pytania. Decyzja **jest** uzasadniona w kodzie (`:188-190`: „to uprzejmość wobec klikającego, nie granica bezpieczeństwa, a operacja jest odwracalna przez drugiego administratora"), ale **nie ma jej w addendum**, a plan przenosi to pytanie do fazy 4, czyli do widoku — w miejsce, które `20260909121500` odrzuca dla ochrony ostatniej roli („ochrona stoi w bazie, bo w widoku omijałoby ją wywołanie RPC wprost"). Rozróżnienie jest obronne (samoblokada przy innych adminach jest odwracalna, zdjęcie ostatniej roli nie), ale nigdzie nie zapisane jako świadome.
- **Fix A ⭐ Recommended**: Zostawić kod, dopisać do addendum fazy 1 akapit nazywający różnicę: potwierdzenie przy ostatnim adminie to niezmiennik (nieodwracalny skutek, więc w bazie), potwierdzenie przy sobie to uprzejmość UI (skutek odwracalny przez innego admina, więc w widoku).
  - Strength: Zachowuje rozróżnienie, które jest merytorycznie słuszne, i usuwa jedyną jego wadę — ciszę.
  - Tradeoff: Kontrakt fazy 1 zostaje rozminięty z planem; czytelnik planu musi dojść do addendum.
  - Confidence: HIGH — odwracalność jest sprawdzalna: przy dwóch adminach drugi odblokuje pierwszego, co pokrywa test SQL (przypadki 14–15).
  - Blind spot: Nie sprawdzałem, czy faza 4 faktycznie zaimplementuje to pytanie — jeśli nie, zniknie zupełnie.
- **Fix B**: Dołożyć `or p_account = auth.uid()` do warunku potwierdzenia w `set_account_blocked`.
  - Strength: Spełnia kontrakt planu dosłownie; ochrona stoi w bazie, więc nie da się jej ominąć wywołaniem RPC.
  - Tradeoff: Każda samoblokada wymaga dwóch wywołań, także gdy jest błaha i odwracalna; trzeba dołożyć przypadek testowy i przemyśleć, czy `LAST_ADMIN_NEEDS_CONFIRM` to właściwy kod dla tej sytuacji (patrz F4).
  - Confidence: MEDIUM — zmiana jest prosta, ale miesza dwa różne powody pytania pod jednym kodem.
  - Blind spot: Wpływ na maszynę stanów fazy 4, której jeszcze nie ma.
- **Decision**: SKIPPED — rozroznienie (niezmiennik w bazie, uprzejmosc w widoku) zostaje jako jest; do domkniecia przy fazie 4, ktora ma to pytanie zaimplementowac.

### F4 — `LAST_ADMIN_NEEDS_CONFIRM` z blokowania trafi na komunikat o zdejmowaniu roli

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260914120000_account_blocking.sql:264-270`, `src/lib/api-errors.ts:86-95`
- **Detail**: `set_account_blocked` zwraca ten sam kod co `set_account_role`, a jedyny odpowiadający mu komunikat brzmi (**zweryfikowane dosłownie**): „To ostatnia rola administratora. Po jej **zdjęciu** administracja przestanie być dostępna z poziomu aplikacji. Potwierdź, jeśli chcesz to zrobić." Gdy faza 3 zmapuje kod z blokowania tą samą drogą — a plan `:175` zapowiada dokładnie to — administrator **blokujący** ostatniego admina zobaczy zdanie o zdejmowaniu roli. Nic nie rzuci błędem. Dziś nie boli, bo endpointu nie ma; faza 3 jest następna, więc decyzja jest teraz najtańsza.
- **Fix**: Przeredagować komunikat tak, żeby nazywał **skutek** niezależnie od czasownika („Po tej operacji administracja przestanie być dostępna z poziomu aplikacji…"), zamiast mnożyć kody.
- **Decision**: FIXED — komunikat nazywa SKUTEK, nie czasownik: „To ostatni czynny administrator. Po tej operacji administracja przestanie byc dostepna z poziomu aplikacji." Wybor jednego kodu na jeden skutek, zamiast dwoch kodow na dwa czasowniki, uzasadniony przy wpisie.

### F5 — Werdykt skryptu pomiarowego nie czyta wartości, która zmieniłaby się przy porażce, i nie podaje tożsamości środowiska

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `context/changes/admin-block-account/measure-session-window.sh:37, 96, 100, 118-125`
- **Detail**: Werdykt opiera się wyłącznie na dwóch kodach HTTP (`PRZED_RPC` i `PO_RPC`). `PO_BAN` jest liczone i wypisywane, ale **nie wchodzi do warunku** — więc gdyby `update` nie zadziałał, skrypt wypisałby ten sam triumfalny wniosek dla pomiaru, w którym blokada nigdy nie nastąpiła. To nie jest hipotetyczne: baza wybierana jest inaczej niż API — strażnik sprawdza host z `$URL` (ruch HTTP), a zapis idzie do `docker ps … | head -1`, czyli pierwszego z brzegu kontenera. Przy dwóch projektach Supabase to dwie różne bazy. Do tego wypis **nie zawiera żadnej tożsamości środowiska** — ani `$URL`, ani identyfikatora kontenera — co jest wprost `lessons.md` § „Weryfikacja bez tożsamości środowiska nie jest dowodem". Powiązane: prawdziwa wartość `banned_until` z GoTrue jest w skrypcie tylko **wypisywana**, nigdy sprawdzana, a `isBlocked` przy wartości nieparsowalnej przepuszcza — więc format, od którego zależy cała bramka, nie jest asercją nigdzie.
- **Fix**: Wypisywać `$URL` i identyfikator kontenera jako pierwszą linię wyniku; dołożyć `[ "$PO_BAN" != "(puste)" ]` do warunku werdyktu z osobną gałęzią „blokada nie została zapisana — pomiar nieważny"; przepuścić odczytane `banned_until` przez `Date.parse` i zaczerwienić przy `NaN`.
- **Decision**: SKIPPED — skrypt pomiarowy zostaje bez tozsamosci srodowiska i bez `PO_BAN` w warunku werdyktu.

### F6 — Middleware nie ma żadnego pokrycia automatycznego, a kryterium 2.3 jest odhaczone

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny wybór; warto się zatrzymać
- **Dimension**: Success Criteria
- **Location**: `src/middleware.ts:59-73`, `context/changes/admin-block-account/plan.md:388` vs `:326`
- **Detail**: Progress mówi `- [x] 2.3 Test integracyjny: żywy token nie przechodzi po zablokowaniu`, a addendum dwie sekcje wyżej mówi wprost: „Kryterium 2.3 **nie jest przez ten zestaw wyrażalne**". Skrypt zastępczy dowodzi w dodatku zdania **przeciwnego** do treści kryterium — że token **przechodzi** na poziomie dostawcy — i ani razu nie dotyka `src/middleware.ts`. W efekcie kod stojący na ścieżce **każdego** żądania nie ma ani jednego testu: nic nie sprawdza, że `/auth/` jest wyjęte, że `/api/*` dostaje JSON, ani że zablokowany jest przekierowany. Wszystko to zmierzyłem ręcznie w przeglądarce, ale ręczny pomiar nie broni przed regresją. Czytelnik `## Progress` widzi wyłącznie checkbox.
- **Fix**: Wyciągnąć decyzję bramki z middleware do funkcji czystej — `blockGateDecision(pathname, user): "pass" | "json" | "redirect"` — i pokryć ją testem jednostkowym. Kryterium staje się wtedy wyrażalne bez Dockera i bez klucza `service_role`, a to ten sam zabieg, który plan stosuje w fazie 4 do maszyny stanów wyspy (`account-role-action.ts` jako wzorzec).
- **Decision**: FIXED — decyzja bramki wyciagnieta do funkcji czystej `blockGateDecision(pathname, account, now)` w `@/lib/account-blocked`; middleware wykonuje wylacznie jej werdykt. 25 nowych przypadkow testowych, w tym przypadek roznicujacy na koncowy ukosnik wyjatku. Mutacja (wyjatek bez ukosnika) czerwieni dokladnie te 4 przypadki; po przywroceniu 38/38. Zachowanie end-to-end sprawdzone ponownie w przegladarce po refaktorze.

### F7 — Komentarze przeceniają zasięg bramki: PostgREST zostaje otwarty do wygaśnięcia tokenu

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260914120000_account_blocking.sql:10-11`, `src/lib/account-blocked.ts:4-9`
- **Detail**: Komentarze twierdzą, że okno 60 minut „zamyka bramka w middleware". Bramka stoi jednak wyłącznie na ścieżce żądań przez Workera; token zablokowanego pozostaje ważnym JWT dla PostgREST, a polityki RLS opierają się na `auth.uid()`, który nie konsultuje `auth.users`. Dowodem jest **własny skrypt pomiarowy**: `rpc/usage_today` odpowiada `200` po blokadzie. Zablokowany może więc przez resztę życia tokenu czytać i pisać własne generacje z pominięciem middleware. **Domknąłem pomiarem otwarte pytanie przeglądu**: odświeżenie tokenu przez zablokowane konto jest **odmawiane** — `400`, `{"error_code":"user_banned","msg":"Invalid Refresh Token: User Banned"}` — więc okno jest ograniczone do ≤60 minut, a nie nieskończone. Plan świadomie to zaakceptował („Żadnego unieważniania sesji po stronie dostawcy"), więc to nie jest odstępstwo — nieścisłe jest tylko twierdzenie w komentarzach.
- **Fix**: Zawęzić zdanie w obu miejscach do „zamyka okno **na powierzchni produktu**" i dopisać jednym zdaniem, że dostęp bezpośredni do PostgREST wygasa wraz z tokenem, bo odświeżenie jest odmawiane (z datą pomiaru).
- **Decision**: SKIPPED — twierdzenie w komentarzach zostaje. Okno dostepu bezposredniego zmierzone jako OGRANICZONE: odswiezenie tokenu zablokowanemu jest odmawiane (400 user_banned, „Invalid Refresh Token: User Banned").

### F8 — Bramka wołającego stoi przed blokadą doradczą

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260914120000_account_blocking.sql:221-237`, `:339-377`
- **Detail**: Sprawdzone wprost: `active_admin_count()` jest wołane **wyłącznie pod blokadą** w obu funkcjach zapisujących (lock `:237` → licznik `:265`; lock `:377` → licznik `:402`) — tu usterki nie ma. Węższa asymetria: `if not exists (… me …)` stoi **przed** `pg_advisory_xact_lock`. Admini A i B, obaj użyteczni; B przechodzi bramkę i czeka na lock, A w tym czasie blokuje B; B dostaje lock i po potwierdzeniu zapisuje, będąc już zablokowanym. Okno to milisekundy, wymaga dwóch adminów działających naraz, a skutek (zero adminów za zgodą) jest przez PRD v4 OQ9 dopuszczony.
- **Fix**: Jeśli domykać — powtórzyć `exists (… me …)` **po** wzięciu locka, z komentarzem, że to celowa duplikacja (inaczej następny czytelnik ją „uprości").
- **Decision**: SKIPPED — okno milisekund, wymaga dwoch adminow naraz, a skutek dopuszczony przez PRD v4 OQ9.

### F9 — Wyjęcie `/api/auth/` pozwala zablokowanemu założyć nowe konto

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Architecture
- **Location**: `src/middleware.ts:27`
- **Detail**: `/api/auth/signup` jest wyjęte spod bramki razem z `signout`, więc zablokowany może z tej samej przeglądarki założyć **nowe** konto i dalej korzystać z produktu. To konsekwencja otwartej rejestracji z PRD, nie błąd tej zmiany — ale FR-016 mówi „nie może korzystać z produktu", więc warto, żeby to była decyzja zapisana, a nie odkryta. Drugie, drobniejsze: prefiks `/auth/` wyjmie spod bramki każdą **przyszłą** stronę w tym katalogu.
- **Fix**: Dopisać do `## What We're NOT Doing` jedno zdanie: blokada dotyczy konta, nie osoby, a przy otwartej rejestracji nic tego nie zmieni bez powiązania tożsamości — co jest poza zakresem PRD.
- **Decision**: SKIPPED — konsekwencja otwartej rejestracji z PRD, nie tej zmiany.

### F10 — Zestaw integracyjny nie daje się uruchomić dwa razy pod rząd

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `src/lib/limits.integration.test.ts:164-168`
- **Detail**: Zestaw potrzebuje 16 wolnych miejsc w dobowym suficie aplikacji (30), a jeden przebieg zostawia 15 — więc każde kolejne uruchomienie wymaga `npx supabase db reset`. W tej sesji kosztowało to cztery cykle i raz dało czerwony wynik, który wyglądał jak regresja zmiany, a nią nie był. Znalezione przy weryfikacji kryteriów, nie zgłoszone przez żaden z przeglądów.
- **Fix**: Poza zakresem tego plastra — kandydat na osobną zmianę (sprzątanie prób po zestawie albo własne okno doby dla testów).
- **Decision**: SKIPPED — poza zakresem plastra; kandydat na osobna zmiane.

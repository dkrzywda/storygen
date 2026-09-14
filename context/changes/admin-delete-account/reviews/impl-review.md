<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin usuwa konto

- **Plan**: context/changes/admin-delete-account/plan.md
- **Scope**: Fazy 1–4 (cały plaster S-12), commity `ce1942e`, `c107395`, `a9fc919`, `fa39099`
- **Date**: 2026-09-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Weryfikacja kryteriów (uruchomiona ponownie, nie przepisana z planu)

| Sprawdzenie                       | Wynik                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm test`                        | exit **0** — 397/397                                                                                           |
| `npm run test:integration`        | exit **0** — 59/59                                                                                             |
| `npx tsc --noEmit`                | exit **0**                                                                                                     |
| `npx eslint` (10 plików plastra)  | exit **0**                                                                                                     |
| `verify-deletion.sql`             | werdykt **OK**, pięć funkcji                                                                                   |
| `test-delete-account.sql`         | **21/21**, `rollback`                                                                                          |
| diff `database.types.ts`          | wyłącznie nowa funkcja                                                                                         |
| `npx supabase db reset`           | **nie uruchomione** — skasowałoby lokalne konta; migracja zastosowana, weryfikowana na czystej bazie w fazie 1 |
| `npx astro build` / `astro check` | **zablokowane środowiskowo** (Cloudflare `code: 10000` / `400`), kryteria 3.2 i 4.5                            |

## Findings

### F1 — Konto twardo usunięte nadal wykonuje zapis uprzywilejowany

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260914120000_account_blocking.sql:250-263 oraz :381-416
- **Detail**: `delete_account` powtarza bramkę wołającego **po** wzięciu blokady doradczej (`20260914160000:140`, `:164-167`) — to była świadoma naprawa z addendum fazy 1. Obie starsze funkcje dzielące ten sam klucz blokady sprawdzają wołającego **wyłącznie przed** nią. S-12 dokłada przesłankę, której wcześniej nie było: wiersz wołającego może zostać **twardo usunięty**, gdy jego własne żądanie czeka na blokadę.

  **Zmierzone 2026-09-14 dwiema sesjami** (nie wywnioskowane): sesja A woła `delete_account(B)`, sesja B woła `set_account_role(A,'user',confirm_last := true)` i przechodzi bramkę, gdy B jeszcze istnieje. Po commicie A sesja B budzi się, nie sprawdza się ponownie i zwraca `ok`. Stan końcowy: `B istnieje: false`, `rola A: user`, czynnych adminów **3 → 1**. Gdyby administratorami byli wyłącznie A i B, wynikiem byłoby zero.

  Stan zerowy sam w sobie jest dopuszczony przez PRD (`## Open Questions` #9) i odzyskiwalny poza produktem, a okno jest wąskie — dlatego WARNING, nie CRITICAL. Realnym problemem jest to, że **zapis wykonuje konto, które już nie istnieje**, oraz że czytelnik zobaczy powtórzoną bramkę w `delete_account` i uzna ją za wzorzec domu, myląc się co do dwóch z trzech funkcji.

- **Fix A ⭐ Recommended**: Zapisać asymetrię wprost w nagłówku `20260914160000` i otworzyć osobną zmianę na powtórzenie bramki w obu starszych funkcjach.
  - Strength: Plan S-12 jawnie deklaruje „Żadnej zmiany w `set_account_role` ani `set_account_blocked`" — łatanie ich tutaj łamie własną granicę plastra i wchodzi w migrację już wdrożoną na produkcji.
  - Tradeoff: Okno zostaje otwarte do czasu następnej zmiany.
  - Confidence: HIGH — granica zakresu jest w planie zapisana dosłownie.
  - Blind spot: Nie mierzyłem `set_account_blocked` — tylko `set_account_role`; zakładam identyczne okno na podstawie układu kodu.
- **Fix B**: Dołożyć powtórzoną bramkę do obu funkcji teraz, nową migracją.
  - Strength: Zamyka okno od razu i czyni powtórzoną bramkę faktycznym wzorcem wszystkich trzech funkcji.
  - Tradeoff: Świadome rozszerzenie zakresu S-12; wymaga własnych testów wyścigu i kolejnego ręcznego wdrożenia na produkcję.
  - Confidence: MEDIUM — mechanizm znany, ale druga funkcja niemierzona.
  - Blind spot: Powtórzona bramka w `set_account_role` zmienia zachowanie przy samo-degradacji, którą S-10 celowo dopuszcza.
- **Decision**: ZAPISANE + ODLOZONE — Fix A. Asymetria opisana w naglowku `20260914160000`; naprawa obu starszych funkcji idzie osobna zmiana `admin-lock-regate`.

### F2 — Gałąź pustego wyniku przeczy własnemu komentarzowi i gubi ślad w logu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/admin-accounts.ts:236-243
- **Detail**: Komentarz mówi, że pusta tablica znaczy rozjazd kontraktu i że „`INTERNAL` przez `mapAccountActionCode` jest wtedy uczciwszy niż udawanie sukcesu". Kod zwraca `FORBIDDEN`, a `mapAccountActionCode` mapuje je na `NOT_FOUND` → **404**, przez co gałąź logująca w `[id].ts:168-170` nie odpala się nigdy. Sprawdzenie nie potrafi zaczerwienić awarii, dla której powstało — klasa z `lessons.md` § „Zielone czytaj z tego, co zmieniłoby się przy porażce". Obie siostrzane funkcje zwracają skalar, więc nie mają tej gałęzi i nie ma tu wzorca do skopiowania.
- **Fix**: Zwrócić wartość wpadającą w `default` mapowania (np. nowy człon `"NO_ROW"` w `AccountActionCode`, celowo niemapowany), żeby endpoint zalogował rozjazd tak samo jak każdy inny nieznany kod.
- **Decision**: FIXED — nowy czlon `NO_ROW`, celowo niemapowany, wpada w `default` na `INTERNAL`.

### F3 — Liczba „co faktycznie zniszczono" jest praktycznie niewidoczna

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/admin/AccountActions.tsx:259-263
- **Detail**: `plan.md:42` obiecuje: „Po sukcesie ekran mówi, ile generacji faktycznie zniszczono — liczbą z bazy, nie z renderu". Kod ustawia stan końcowy i **w następnej linii** woła `window.location.reload()`. Zmierzone `MutationObserver`-em: stan `deleted` faktycznie się renderuje (`Usunięto konto wraz z 7 zapisanymi tekstami.`), ale żyje jedną klatkę — administrator w praktyce widzi wyłącznie liczbę **przewidywaną** z ostrzeżenia, czyli ze snapshotu przeglądu.

  Addendum fazy 4 opisało mechanizm, ale postawiło fałszywą równoważność z rolą i blokadą: tam stan końcowy nie niesie niczego, czego nie pokaże przeładowana tabela; **tutaj niesie jedyną liczbę, dla której baza w ogóle liczy przed usunięciem** (`20260914160000:194-197`). Rozjazd między przewidywaniem a faktem — jedyny powód istnienia tego licznika — nie trafia nigdy na ekran.

- **Fix A ⭐ Recommended**: Dla `ktora === "usuniecie"` nie przeładowywać — gałąź `deleted` już rysuje przycisk „Odśwież panel", więc użytkownik decyduje, kiedy odświeżyć.
  - Strength: Najmniejsza zmiana; wykorzystuje przycisk, który już istnieje, i zostawia liczbę na ekranie do przeczytania.
  - Tradeoff: Reszta tabeli jest przez chwilę nieaktualna — ale gałąź `deleted` może to powiedzieć tym samym zdaniem, którego używają `demoted` i `blockedSelf` (`:310-314`).
  - Confidence: HIGH — wzorzec i komponent już w repo istnieją.
  - Blind spot: Nie sprawdziłem, czy usunięty wiersz zostaje wtedy widoczny w tabeli aż do odświeżenia.
- **Fix B**: Przenieść liczbę przez przeładowanie (`sessionStorage` + baner nad tabelą).
  - Strength: Tabela jest od razu świeża, a komunikat i tak widoczny.
  - Tradeoff: Nowy mechanizm stanu między ładowaniami, którego repo dziś nie ma.
  - Confidence: MEDIUM — działa, ale dokłada wzorzec do utrzymania.
  - Blind spot: `sessionStorage` bywa niedostępny; wymaga obsługi wyjątku.
- **Decision**: FIXED via Fix A — usuniecie nie przeladowuje; zmierzone: 0 nawigacji, komunikat z liczba z bazy stoi po 3 s.

### F4 — Zwrócona liczba może zaniżyć to, co zniszczyła kaskada

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260914160000_account_deletion.sql:194-205
- **Detail**: `count(*)` i `delete` to dwie instrukcje, każda z własnym snapshotem pod READ COMMITTED. Konto będące celem może zatwierdzić nową generację między nimi; kaskada zniszczy wiersz, którego licznik nie widział. Liczba sprzedawana jako „co się stało" jest wtedy dolnym ograniczeniem.
- **Fix**: Policzyć jako produkt uboczny zniszczenia — `with usuniete as (delete from public.generations where user_id = p_account returning 1) select count(*) into v_generations from usuniete;` przed `delete from auth.users`.
- **Decision**: ODLOZONE — zmienia migracje juz zacommitowana i czekajaca na wdrozenie; idzie z F1 w zmianie `admin-lock-regate`.

### F5 — Martwy eksport i klucz błędu niezgodny z resztą repo

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/account-delete-params.ts:30, :75; src/pages/api/accounts/[id].ts:142
- **Detail**: `FORM_KEY` jest deklarowany i reeksportowany jako `DELETE_PARAMS_FORM_KEY`, a `grep` po `src/` nie znajduje importera. Repo ma już kanoniczne `FORM_FIELD_KEY` w `@/lib/validation:18`. Osobno: endpoint kluczuje błąd jako `{ confirmDestroy: … }`, podczas gdy każdy inny błąd walidacji całego żądania w repo używa `{ _: … }` — w tym samym pliku, osiemdziesiąt linii wyżej (`[id].ts:59`).
- **Fix**: Usunąć `FORM_KEY`/`DELETE_PARAMS_FORM_KEY`, a błąd kluczować przez `FORM_FIELD_KEY` z `@/lib/validation`.
- **Decision**: FIXED — martwy eksport usuniety, blad kluczowany przez `FORM_FIELD_KEY`.

### F6 — Komentarz mówi „dwa przyciski", komórka rysuje trzy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:284-290, :289
- **Detail**: Komentarz komórki nadal opisuje dwa przyciski i nazywa „Odbierz rolę" najszerszym, choć od fazy 4 przyciski są trzy — a jego ostatnie zdanie odsyła do addendum fazy 4, więc powołuje się na pomiar, którego sam nie uwzględnia. To ta sama klasa („nazwa opisuje połowę zawartości"), którą addendum fazy 2 deklaruje jako naprawioną z wyprzedzeniem. Osobno: `<div class="flex flex-col items-end gap-1">` opakowuje wyspę, której własny korzeń (`AccountActions.tsx:429`) ma identyczne klasy — decyzja o układzie stoi w dwóch plikach naraz.
- **Fix**: Zaktualizować komentarz do trzech przycisków i usunąć zewnętrzny `div`, zostawiając układ wyłącznie w wyspie.
- **Decision**: FIXED — komentarz o trzech przyciskach, zdublowany wrapper usuniety; zmierzone: 1 wyspa/wiersz, 0 px zapasu, brak przewijania.

### F7 — Tożsamość środowiska w skrypcie kontrolnym słabo różnicuje

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/changes/admin-delete-account/verify-deletion.sql:91
- **Detail**: Skrypt poprawnie odrzuca `current_database()` i stawia tożsamość jako pierwszą kolumnę, ale używa `host(inet_server_addr())` — przez pooler Supabase to adres **poolera**, wspólny dla wszystkich projektów w regionie. Dwa projekty w `aws-1-eu-west-1` wypisałyby ten sam ciąg, czyli dokładnie klasa awarii, dla której ta reguła powstała.
- **Fix**: Dołożyć `(select system_identifier from pg_control_system())` jako pierwszą kolumnę — unikalny i stabilny per klaster — zostawiając adres jako drugą.
- **Decision**: FIXED — `system_identifier` jako pierwsza kolumna; werdykt skryptu nadal OK.

### F8 — `create function` bez ostrzeżenia o częściowym wklejeniu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260914160000_account_deletion.sql:54
- **Detail**: Migracja używa gołego `create function`, a udokumentowana droga wdrożenia to ręczne wklejenie do edytora SQL dostawcy. Sąsiednia migracja niesie baner ostrzegający, że częściowo wklejony plik zostawia funkcję z domyślnymi grantami `anon`/`service_role` **bez zgłoszenia błędu**; nowy plik ma dokładnie tę własność i tego ostrzeżenia nie ma.
- **Fix**: Przenieść baner z `20260914120000:89-92` do nagłówka bloku `revoke`/`grant` w nowej migracji.
- **Decision**: FIXED — baner o czesciowym wklejeniu przeniesiony z sasiedniej migracji.

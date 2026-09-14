# Wynik wdrożenia S-12 na produkcję — 2026-09-14

**Migracja `20260914160000_account_deletion.sql` jest na produkcji, zweryfikowana w osobnej sesji.**

## Przebieg

| Krok                                                   | Wynik                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 0 — rozpoznanie                                        | `OK — mozna wklejac krok 1`; S-11 obecne (`jest_licznik: true`, `kolumn_w_przegladzie: 11`), S-12 nieobecne             |
| 1 — wdrożenie, **próba pierwsza**                      | Edytor zaraportował sukces. **W bazie nie zostało nic.**                                                                |
| — diagnoza                                             | `s12_w_rejestrze: false`, `jest_usuwanie: false`, `jest_licznik: true` — ta sama produkcja, migracja nie weszła         |
| 1 — wdrożenie, **próba druga** (bez jawnej transakcji) | `WYGLADA DOBRZE`; `jest_usuwanie: true`, `s12_w_rejestrze: true`, granty poprawne                                       |
| 2 — kontrola, **nowa sesja**                           | `werdykt: OK`; pięć funkcji, `da_def`/`da_path` `true`, `da_anon`/`da_srv` `false`, `da_auth` `true`, `ac_auth` `false` |

Stan produkcji przy wdrożeniu: 2 konta, 1 administrator, 11 generacji.

## Co poszło nie tak za pierwszym razem

Skrypt był owinięty w jawne `begin; … commit;`. Edytor SQL dostawcy zaraportował
`Success. No rows returned` — czyli **dokładnie to, co raportuje udany `create function`** —
a w bazie nie zostało ani funkcji, ani wpisu w rejestrze. Ponieważ obie rzeczy były w jednej
transakcji, żyły albo ginęły razem, i zginęły razem: transakcja nigdy się nie zatwierdziła.

Poprzedzający sygnał, którego nie docenilismy: przy próbie użycia `pg_control_system()`
ten sam edytor zgłosił błąd składni w **„LINE 1"** dla linii, która w pliku jest sześćdziesiąta.
To znaczyło, że nie wykonuje całego pliku tak, jak się wydaje.

**Naprawa:** zdjęcie jawnej transakcji i zakończenie skryptu `SELECT`-em z werdyktem zamiast
`commit`-em. Migracja niczego nie upuszcza, więc nie ma stanu pośredniego gorszego niż stan
sprzed wdrożenia — jedyne ryzyko częściowego wykonania to funkcja bez końcowych `revoke`,
i właśnie to sprawdza werdykt.

## Pułapka złapana po drodze

Pierwsza wersja werdyktu używała `has_function_privilege` z sygnaturą **tekstową**. Dla
nieistniejącej funkcji ta forma **rzuca błędem** zamiast zwrócić `null`, więc `coalesce` nigdy
nie dostaje szansy — werdykt wywaliłby się dokładnie w przypadku, który miał raportować.
Zmierzone, poprawione na `to_regprocedure`, potwierdzone mutacją: przy podmienionej nazwie
funkcji werdykt czerwieni się na `BLAD: funkcja nie powstala`.

## Czego ten wynik NIE obejmuje

**Aplikacji na produkcji nie ma.** Baza ma zdolność usuwania konta, ale przycisku i endpointu
nie będzie, dopóki nie zostanie wdrożony Worker — a `astro build` wymaga `npx wrangler login`
na konto gmail. Kolejność jest bezpieczna: migracja jest czysto dokładająca i nikt jej nie
zawoła, póki interfejs tam nie trafi.

**Wyścig F1 nie jest dziś na produkcji osiągalny** — wymaga dwóch administratorów, a jest
jeden. Stanie się osiągalny, gdy rola trafi na drugie konto; wtedy `admin-lock-regate`
przestaje być odłożone.

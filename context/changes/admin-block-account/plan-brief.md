# Admin blokuje i odblokowuje konto — Plan Brief

> Full plan: `context/changes/admin-block-account/plan.md`

## What & Why

Administrator blokuje konto i później je odblokowuje — `FR-016`, plaster `S-11` kamienia `M-3`. Zablokowany jest odrzucany przy logowaniu, co PRD rozstrzygnęło w `## Open Questions` #7.

Drugie, ważniejsze zadanie tego plastra wyszło dopiero z pomiaru: **sama odmowa logowania nie wystarcza**. Zmierzone, że po zablokowaniu trwająca sesja działa jeszcze przez godzinę i konto może w tym czasie generować — a FR-016 mówi, że zablokowane konto „nie może korzystać z produktu".

## Starting Point

Dostawca auth **już ma** pojęcie konta zawieszonego i sam odmawia logowania: `400`, `error_code: user_banned`. Aplikacja tę odmowę jednak **gubi** — `user_banned` nie występuje w żadnej z map w `api-errors.ts`, więc wpada w `INTERNAL` i zablokowany widzi „Coś poszło nie tak", czyli dokładnie tę ogólną awarię, której FR-016 zabrania. Mechanizm zapisu i jego pułapki są gotowe po `S-10`.

## Desired End State

Przy każdym koncie stoi przycisk blokady, a zablokowane konto jest oznaczone pod adresem. Zablokowany przy logowaniu dostaje komunikat o zawieszeniu dostępu. Jeśli miał otwartą sesję, przy **następnym żądaniu** zostaje z niej wypchnięty. Żywy token, który przed blokadą czytał dane, po blokadzie nie przechodzi.

## Key Decisions Made

| Decyzja               | Wybór                                     | Dlaczego                                                                                                                 | Źródło      |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Co widzi zablokowany  | Odmowa przy logowaniu                     | Warstwa tożsamości ma już ten stan; produkt pożycza istniejący mechanizm                                                 | PRD v4 §OQ7 |
| Trwająca sesja        | Bramka w middleware                       | `banned_until` przychodzi za darmo w `getUser()`, które middleware już woła; zamyka okno 60 minut do zera                | Plan        |
| Co widzi wypchnięty   | Przekierowanie na logowanie z komunikatem | Jedna ścieżka zamiast dwóch; strona logowania ma już słownik komunikatów po kodzie                                       | Plan        |
| Zakres bramki         | Wszystkie trasy poza `/auth/*`            | Strona główna z generatorem nie jest chroniona, więc ograniczenie do `PROTECTED_ROUTES` zostawiłoby lukę tam, gdzie boli | Plan        |
| Kogo wolno zablokować | Każdego, w tym siebie i ostatniego admina | Brak podłóg, spójnie z decyzją o rolach; pytamy, nie zabraniamy                                                          | Plan        |
| Czas blokady          | Bezterminowo, do odblokowania             | FR-016 mówi „blokuje i **później** odblokowuje" — dwa stany, nie trzeci wymiar                                           | Plan        |
| Kształt SQL           | Osobna `set_account_blocked`              | Jedna funkcja na operację, wzorem `set_account_role`; wspólna przepisywałaby kod wdrożony godzinę temu                   | Plan        |
| Wspólny klucz blokady | `account_role_gate`                       | Roadmapa zapisuje to jako wymóg — klucz chroni **liczbę administratorów**, nie tylko zmianę roli                         | Roadmapa    |
| Potwierdzenie         | Przy sobie i przy ostatnim adminie        | Ten sam warunek co przy rolach; maszyna stanów już istnieje                                                              | Plan        |
| Stan w tabeli         | Znacznik pod adresem                      | Zmierzone: tabela ma **0 px zapasu**, nowa kolumna przywróci przewijanie                                                 | Plan        |
| Komunikat             | Mówi o zawieszeniu, bez kontaktu          | Produkt nie ma kanału kontaktu; `## Non-Goals` wyklucza zgłaszanie nadużyć                                               | Plan        |

## Scope

**W zakresie:** funkcja `set_account_blocked`; kolumna `is_blocked` w przeglądzie; mapowanie `user_banned` na własny kod; bramka w middleware; rozszerzenie `PATCH /api/accounts/[id]`; wyspa i znacznik; skrypt kontrolny i test SQL.

**Poza zakresem:** unieważnianie sesji po stronie dostawcy (wymaga `service_role`); blokada terminowa; jakakolwiek podłoga; usuwanie kont (`S-12`); audyt; kanał kontaktu; zmiana liczenia sufitów.

## Architecture / Approach

Dwa niezależne mechanizmy, nie jeden. Dostawca pilnuje **drzwi wejściowych** — odmawia logowania. Middleware pilnuje tego, **kto jest już w środku** — czyta `banned_until` z odpowiedzi `getUser()`, którą i tak pobiera, i wypycha zablokowanego przy pierwszym żądaniu.

Droga zapisu bez zmian wobec `S-10`: wyspa → `PATCH /api/accounts/[id]` → moduł → RPC → `auth.users.banned_until`.

## Phases at a Glance

| Faza                      | Co dowozi                                                     | Główne ryzyko                                                                              |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Baza                   | `set_account_blocked` i `is_blocked`, mierzalne bez endpointu | `drop function` kasuje granty; `banned_until` w przeszłości nie znaczy „zablokowany"       |
| 2. Zablokowany użytkownik | Komunikat i bramka — zamyka okno 60 minut                     | Dotyka ścieżki, przez którą idzie **każde** żądanie; brak wyjątku dla `/auth/*` daje pętlę |
| 3. Kontrakt               | Endpoint, moduł, typy                                         | Rozłączność `role` i `blocked` w jednym ciele żądania                                      |
| 4. Interfejs              | Przycisk, znacznik, uczciwe zablokowanie siebie               | Tabela ma 0 px zapasu                                                                      |

**Prerequisites:** `S-10` wdrożone i zarchiwizowane (jest), Docker do testów, dostęp do konsoli dostawcy jako droga powrotna po zablokowaniu siebie.

**Estimated effort:** cztery sesje, po jednej na fazę.

## Open Risks & Assumptions

- **Bramka w middleware dotyka każdego żądania.** Pomyłka nie psuje jednej sekcji, tylko wypycha wszystkich. To jedyna faza, w której błąd ma zasięg całego produktu.
- **Okno 60 minut zmierzone dla tej konfiguracji.** Czas życia tokenu jest ustawieniem projektu; gdyby wzrósł, rośnie też okno, które bramka zamyka — ale bramka działa niezależnie od jego długości.
- **`banned_until` to znacznik czasu, nie flaga.** Każde sprawdzenie musi porównywać z `now()`; „niepuste = zablokowane" zablokowałoby konta, którym blokada minęła.
- **Zablokowanie siebie to jednokierunkowe drzwi** — nie zalogujesz się wcale, a droga powrotna wiedzie przez konsolę dostawcy.
- **Nie wiadomo, co usunęło migrację `S-09` z produkcji.** Dopóki to się nie powtórzy, traktujemy jako zdarzenie jednorazowe — ale kontrola po wdrożeniu idzie odtąd osobnym wklejeniem.

## Success Criteria (Summary)

- Zablokowane konto nie zaloguje się i **nie dokończy trwającej sesji** — przy następnym żądaniu jest wypychane
- Zablokowany dowiaduje się, że dostęp zawieszono, zamiast widzieć ogólną awarię
- Odblokowanie przywraca dostęp bez żadnego dodatkowego kroku

# Admin nadaje i odbiera rolę administratora — Plan Brief

> Full plan: `context/changes/admin-grant-role/plan.md`

## What & Why

Administrator nadaje innemu kontu rolę administratora i odbiera ją — z panelu, bez ręcznego SQL-a. Realizuje `FR-018` z PRD v4 i plaster `S-10` kamienia `M-3`.

Drugie, cichsze zadanie tego plastra: jest **pierwszym zapisem do `auth.users` z wnętrza aplikacji**, a wybrany tu mechanizm odziedziczą `S-11` (blokowanie) i `S-12` (usuwanie). Decyzje o bramce, o kształcie odmowy i o kodach zwracanych z bazy są decyzjami całego kamienia.

## Starting Point

Rola już istnieje (`isAdmin()` z `F-02`, fail-closed) i już jest sprawdzana na każdym żądaniu. Ale **nadaje się ją ręcznie**: jedyny zapis do `auth.users` w repo to jednorazowy `update` w migracji seeda z 8 września, dopasowujący po adresie e-mail. Tak nadano rolę administratora i tak samo trzeba by ją nadać każdemu następnemu koncie. Przegląd kont z `S-09` jest read-only z konstrukcji — funkcja jest `stable`, a w takiej Postgres zapisu zabrania — i nie zwraca żadnego identyfikatora, więc nie ma dziś czym zaadresować konta docelowego.

## Desired End State

W sekcji Administracja przy każdym koncie widać jego rolę i przycisk, który tę rolę zmienia. Na koncie obcym działa od razu. Kliknięcie, które zdjęłoby **ostatnią** rolę administratora, najpierw pokazuje ostrzeżenie, że administracja przestanie być dostępna z produktu — dopiero drugie kliknięcie ją zdejmuje. Konto, któremu rolę nadano, ma ją przy następnym żądaniu, bez ponownego logowania. Konto bez roli, wołające funkcję wprost, nie zmienia niczego i nie dowiaduje się, że operacja istnieje.

## Key Decisions Made

| Decyzja                   | Wybór                                    | Dlaczego                                                                                                                       | Źródło      |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Adresowanie celu          | UUID konta, dołożony do przeglądu        | Zgodne ze wzorcem `generations/[id].ts`; adres e-mail jest zmienny i PRD celowo rozdziela go od roszczenia o uprawnienia       | Plan        |
| Mechanizm zapisu          | Funkcja `security definer`, volatile     | Precedens `record_attempt_if_allowed`; zero nowych sekretów; bramki nie obejdzie wywołanie RPC wprost                          | Plan        |
| Kształt odmowy            | Kod z bazy, `FORBIDDEN` → 404 na wyjściu | Łączy kod z bramki limitów z nieujawnianiem z FR-015; 403 potwierdzałoby istnienie operacji                                    | Plan        |
| Ostatnia rola             | Baza odmawia bez jawnego potwierdzenia   | Ochrona w widoku byłaby pomijalna wywołaniem RPC wprost                                                                        | Plan        |
| Podłoga na liczbę adminów | Brak — wolno zdjąć ostatnią              | Decyzja autora; konsekwencja przyjęta i zapisana w PRD                                                                         | PRD v4 §OQ9 |
| Interfejs                 | Wyspa React na wiersz                    | `CLAUDE.md`: wyspy tylko tam, gdzie interakcja konieczna; tabela zostaje serwerowa                                             | Plan        |
| Endpoint                  | `PATCH /api/accounts/[id]`               | Symetryczny dla nadania i odebrania, jak `PATCH generations/[id]`                                                              | Plan        |
| Kolumny przeglądu         | `id`, `role`, `is_self`, `is_last_admin` | Wszystkie liczone w bazie — ustalenie F3 z przeglądu `S-09`: liczba, na której stoi komunikat, przychodzi z tym samym odczytem | Plan        |
| Powtórzenie roli          | Idempotentnie, `ok`                      | Podwójne kliknięcie nie produkuje fałszywego błędu; brak wyścigu                                                               | Plan        |
| Degradacja siebie         | Komunikat i przejście                    | Ciche zniknięcie sekcji wygląda identycznie jak awaria                                                                         | Plan        |
| Audyt zmian rol           | Nie w tym plastrze                       | PRD nie wymaga; `## Non-Goals` parkuje analitykę. Zapisane jako świadome pominięcie                                            | Plan        |
| Odświeżenie panelu        | Przeładowanie po sukcesie                | Jedno źródło prawdy; flagi liczone w bazie nie mogą kłamać po podmianie w kliencie                                             | Plan        |

## Scope

**W zakresie:** rozszerzenie `accounts_overview()` o cztery kolumny; nowa funkcja `set_account_role()`; endpoint `PATCH /api/accounts/[id]`; nowy kod błędu w kontrakcie F-01; wyspa React z dwuetapowym potwierdzeniem; skrypt kontrolny z tożsamością środowiska; testy jednostkowe i integracyjne.

**Poza zakresem:** blokowanie i usuwanie kont (`S-11`, `S-12`); audyt zmian rol; klucz `service_role`; podłoga na liczbę adminów; jakakolwiek zmiana polityki RLS na `generations`; czyszczenie 61 kont testowych w lokalnej bazie.

## Architecture / Approach

Bramka mieszka w bazie, w środku funkcji `security definer`, i czyta rolę wołającego **z `auth.users`**, nie z tokenu — tak jak `accounts_overview()`, i z tego samego zmierzonego powodu. Aplikacja sprawdza rolę tylko po to, by nie rysować przycisku; sprawdzenie w kodzie byłoby obejściem o jedno wywołanie RPC. Funkcja zwraca **kod**, nie boolean i nie wyjątek, bo wołający musi wiedzieć, która granica zadziałała: brak uprawnień to inna sytuacja niż brak potwierdzenia przy ostatniej roli.

Droga danych: wyspa → `PATCH /api/accounts/[id]` → `setAccountRole()` → RPC `set_account_role()` → `auth.users.raw_app_meta_data`. Odczyt niezmieniony: `dashboard.astro` → `fetchAccountsOverview()` → RPC `accounts_overview()`.

## Phases at a Glance

| Faza         | Co dowozi                                                         | Główne ryzyko                                                                                                  |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Baza      | Rozszerzony przegląd i `set_account_role()`, mierzalne bez widoku | `drop function` kasuje granty — pominięcie `revoke` odda funkcję `anon` i `service_role` **bez żadnego błędu** |
| 2. Kontrakt  | Endpoint, typy, moduł, nowy kod błędu                             | Dwa źródła prawdy o tym, kto jest adminem, rozjechałyby się cicho                                              |
| 3. Interfejs | Przycisk, ostrzeżenie, uczciwa degradacja siebie                  | Ciche zniknięcie sekcji po degradacji nie do odróżnienia od awarii                                             |

**Prerequisites:** `F-02` wdrożone (jest), `S-09` wdrożone (jest), Docker dla testów integracyjnych, dostęp do konsoli dostawcy jako droga powrotna po degradacji siebie.

**Estimated effort:** trzy sesje, po jednej na fazę.

## Open Risks & Assumptions

- **Zapis do `auth.users` obchodzi warstwę tożsamości.** Funkcja pisze do `raw_app_meta_data` bezpośrednio, a nie przez API dostawcy. Dla samej roli to bezpieczne (pole jest wyłącznie serwerowe, a seed z `F-02` robi dokładnie to samo), ale przy `S-11` dotknie kolumn, które dostawca wypełnia sam — i tam trzeba to zmierzyć, nie założyć.
- **Świeżość roli jest wnioskiem z lektury SDK, nie pomiarem.** `_getUser` robi `GET /user` w obu gałęziach (`GoTrueClient.js:2480`, `:2496`), więc rola powinna działać bez ponownego logowania. Faza 2 ma test, który to mierzy — dopóki nie przejdzie, jest to założenie.
- **Brak podłogi to jednokierunkowe drzwi.** Produkcja ma jedno konto z rolą; zdjęcie jej kończy administrację, a droga powrotna jest poza produktem.
- **Okno błędu przy migracji na produkcji.** `drop function` na `accounts_overview()` tworzy moment, w którym panel admina zwraca błąd odczytu. Sekcja degraduje się osobno, więc reszta panelu działa.

## Success Criteria (Summary)

- Administrator nadaje i odbiera rolę z panelu; obdarowane konto ma ją bez ponownego logowania
- Zdjęcie ostatniej roli wymaga potwierdzenia i mówi, co się stanie — a nie da się tego pominąć wywołaniem RPC wprost
- Konto bez roli nie zmienia niczego i nie dowiaduje się, że operacja istnieje

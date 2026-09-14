# Admin usuwa konto — Plan Brief

> Full plan: `context/changes/admin-delete-account/plan.md`

## What & Why

Administrator usuwa konto, wiedząc **przed** wykonaniem, ile zapisanych generacji zniknie razem z nim. Realizuje `FR-017` i plaster `S-12` kamienia `M-3`.

To jedyna nieodwracalna operacja w całym produkcie i jedyna rzecz odróżniająca ten plaster od dwóch poprzednich. Wszystko inne, co administrator robi cudzemu kontu, da się cofnąć: rolę przywróci inny administrator, blokadę zdejmie inny administrator. Usunięcia nie cofnie nikt.

## Starting Point

Ścieżka zapisu jest gotowa po `S-10` i `S-11`: wyspa → endpoint → moduł → RPC → `auth.users`. Liczba generacji konta **już jest** w przeglądzie i na ekranie. Nie ma natomiast żadnej funkcji usuwającej — `delete from auth.users` nie występuje w repo ani razu.

Wiersz tabeli ma dziś dwie wyspy React, obie wołające `reload()` po sukcesie. Przegląd `S-11` przyjął wynikający z tego wyścig jako ryzyko, z adnotacją: „do przemyślenia razem z trzecią wyspą przy `S-12`, a nie po kawałku".

## Desired End State

Przy każdym cudzym wierszu stoi przycisk usunięcia. Pierwsze kliknięcie nie wysyła żądania — odsłania pytanie nazywające liczbę generacji, które znikną. Po usunięciu ekran mówi, ile faktycznie zniszczono, liczbą **z bazy**, nie z renderu. Własnego konta usunąć się nie da. Żywa sesja usuniętego konta przy następnym żądaniu ląduje na logowaniu.

## Key Decisions Made

| Decyzja                | Wybór                           | Dlaczego                                                                                                  | Źródło        |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| Usunięcie siebie       | **Zabronione w bazie**          | Każde inne działanie na sobie jest odwracalne przez innego administratora; to jedno nie jest przez nikogo | Plan          |
| Ostatni czynny admin   | Pyta, jak przy roli i blokadzie | Czwarty czytelnik `active_admin_count()` zachowuje się jak trzy poprzednie                                | Plan          |
| Erozja dobowego sufitu | Przyjąć i zapisać               | PRD rozstrzygnęło to przy FR-017 jako przyjętą konsekwencję                                               | PRD           |
| Metoda HTTP            | `DELETE /api/accounts/[id]`     | `PATCH` znaczy „zmień pole", a to jest zniszczenie zasobu                                                 | Plan          |
| Potwierdzenie          | Dwa kroki inline, z liczbą      | Wzorzec `DeleteButton` i obu wysp administratora; zero nowych pojęć                                       | Plan          |
| Wyspy w wierszu        | **Scalić w jedną**              | Zamyka przyjęte ryzyko wyścigu i zbija hydrację z 3 korzeni na wiersz do 1                                | Przegląd S-11 |
| Dowód zniszczenia      | Funkcja zwraca liczbę           | Liczba z renderu bywa nieaktualna; ekran ma mówić, co się stało                                           | Plan          |
| Zgoda na zniszczenie   | Osobny parametr funkcji         | Guardrail PRD przestaje być uprzejmością widoku, staje się własnością bazy                                | Plan          |
| Miękkie usunięcie      | **Odrzucone**                   | Zmierzone: GoTrue wydaje token kontu z `deleted_at` — nie odbiera dostępu                                 | Pomiar        |

## Scope

**W zakresie:** funkcja `delete_account` z trzema bramkami i zwrotem liczby zniszczonych; `DELETE /api/accounts/[id]`; dwa nowe kody błędu; scalenie wiersza w jedną wyspę; przycisk usunięcia; skrypt kontrolny i test SQL.

**Poza zakresem:** stan odwracalny przed usunięciem (jest nim blokada); miękkie usunięcie; ratowanie dobowego sufitu; usuwanie pojedynczych generacji na cudzym koncie; audyt; zmiana dyrektywy hydracji; zmiany w `set_account_role` i `set_account_blocked`.

## Architecture / Approach

Bez zmian wobec `S-11`, poza dwiema rzeczami. **Zgoda na zniszczenie jest parametrem funkcji**, nie stanem interfejsu — bez niej baza odmawia każdemu, więc guardrailu nie da się ominąć wywołaniem RPC wprost. To odwrotna decyzja niż przy blokowaniu siebie w `S-11`, i różnica jest umyślna: tam skutek był odwracalny, tutaj nie jest. **Funkcja zwraca kod razem z liczbą zniszczonych generacji**, policzoną w tej samej transakcji i koniecznie przed `delete` — po kaskadzie nie ma czego liczyć.

## Phases at a Glance

| Faza             | Co dowozi                                                   | Główne ryzyko                                                                              |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Baza          | `delete_account` z trzema bramkami, mierzalna bez endpointu | Kolejność wewnątrz funkcji jest wymuszona przez skutki, nie dowolna                        |
| 2. Kontrakt      | `DELETE`, moduł, dwa nowe kody                              | Astro odrzuca `DELETE` bez `Origin` **przed** middleware — 403 CSRF udaje bramkę uprawnień |
| 3. Scalenie wysp | Jeden korzeń hydracji na wiersz, **bez nowej akcji**        | Refaktor musi przenieść wszystkie ustalenia przeglądów `S-10` i `S-11`                     |
| 4. Interfejs     | Przycisk, pytanie z liczbą, komunikat z liczbą z bazy       | Tabela ma 0 px zapasu                                                                      |

**Prerequisites:** `S-11` **wdrożone na produkcję** — `delete_account` woła `active_admin_count()`, która powstaje w migracji `20260914120000`. Docker do testów.

**Estimated effort:** cztery sesje, po jednej na fazę.

## Open Risks & Assumptions

- **Nieodwracalność jest cechą, nie usterką.** Nie ma kosza, nie ma cofnięcia, nie ma drogi powrotnej poza konsolą dostawcy — a ta nie przywróci generacji.
- **`DELETE` z funkcji `security definer` zmierzony lokalnie, nie na produkcji.** `auth.users` należy do `supabase_auth_admin`; lokalnie właściciel funkcji ma prawo usunięcia, na produkcji niesprawdzone. Poprzednim razem migracja zniknęła z produkcji bez ustalonej przyczyny.
- **Kaskada omija RLS.** Usunięcie konta robi dokładnie to, czego `generation_attempts` zabrania kontu robić samemu („nie może skasować dowodu próby"). To zapisana konsekwencja, nie luka.
- **PostgREST zostaje otwarty na odczyty** do wygaśnięcia tokenu usuniętego konta. Ekspozycja pusta — `auth.uid()` wskazuje na nic — a generowanie odrzuca klucz obcy (zmierzone).
- **Faza 3 przepisuje działający kod dwóch poprzednich plastrów.** Dlatego jest osobna i jej kryterium brzmi „zachowanie identyczne".

## Success Criteria (Summary)

- Administrator nie usunie konta, nie zobaczywszy wcześniej, ile generacji zniknie
- Usunięte konto znika z przeglądu, jego generacje z bazy, a jego sesja z produktu przy następnym żądaniu
- Własnego konta nie da się usunąć ani z interfejsu, ani wywołaniem RPC wprost

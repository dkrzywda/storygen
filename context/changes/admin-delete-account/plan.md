# Admin usuwa konto — Implementation Plan

## Overview

Administrator usuwa konto, wiedząc **przed** wykonaniem, ile zapisanych generacji zniknie razem z nim. Realizuje `FR-017` z PRD v4 i plaster `S-12` z kamienia `M-3`.

To jedyna nieodwracalna operacja w całym produkcie. Wszystko inne, co administrator robi cudzemu kontu, da się cofnąć: rolę przywróci inny administrator, blokadę zdejmie inny administrator. Usunięcia nie cofnie nikt — i to jest jedyna rzecz, która odróżnia ten plaster od dwóch poprzednich.

## Current State Analysis

**Ścieżka zapisu istnieje i została zmierzona.** Funkcja `security definer` wołana **jako rola `authenticated`** usuwa wiersz z `auth.users`, mimo że tabela należy do `supabase_auth_admin`. Zmierzone 2026-09-14 na bazie lokalnej, funkcją utworzoną dokładnie tak, jak zrobi to migracja. `UPDATE` był udowodniony przez `S-10` i `S-11`; `DELETE` **nie był** i wymagał osobnego pomiaru.

**Wszystkie dziesięć kluczy obcych do `auth.users` kasuje kaskadowo.** W repo zdefiniowane są dwa (`generations`, `generation_attempts` — `20260903125113:18`, `20260907192600:17`); pozostałe osiem to wewnętrzne tabele GoTrue (`identities`, `sessions`, `mfa_factors`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`, `webauthn_challenges`, `webauthn_credentials`), których w plikach nie ma — zmierzone w katalogu bazy. Nic nie blokuje usunięcia.

**Zmierzony skutek usunięcia** (konto z 3 generacjami i 4 próbami, transakcja wycofana):

|                                         | przed | po    |
| --------------------------------------- | ----- | ----- |
| generacje konta                         | 3     | **0** |
| próby konta                             | 4     | **0** |
| **łącznie prób w bazie (dobowy sufit)** | 4     | **0** |

**Miękkie usunięcie odpada — rozstrzygnięte pomiarem, nie rozumowaniem.** GoTrue **nie odmawia logowania** kontu z ustawionym `deleted_at`: zmierzone wywołaniem `POST /auth/v1/token` przed i po ustawieniu kolumny — w obu przypadkach wydał `access_token`. Konto „usunięte" miękko dalej korzystałoby z produktu, mimo że wszystkie nasze funkcje SQL filtrują `deleted_at` i uznają je za nieistniejące. To zamyka wariant, który wyglądał na łagodniejszy.

**Żywa sesja usuniętego konta zamyka się sama — częściowo.** Zmierzone tym samym tokenem przed i po twardym usunięciu:

| Wywołanie                       | Przed | Po      |
| ------------------------------- | ----- | ------- |
| `GET /auth/v1/user`             | 200   | **403** |
| `POST /rest/v1/rpc/usage_today` | 200   | **200** |

`getUser()` pada, więc middleware ustawia `locals.user = null` i każda trasa chroniona przekierowuje na logowanie — **bez nowej bramki**. PostgREST sprawdza jednak wyłącznie podpis tokenu, nie istnienie konta, więc odczyty przez niego przechodzą do wygaśnięcia tokenu. Ekspozycja jest pusta: `auth.uid()` wskazuje na nieistniejące konto, więc `usage_today()` zwraca zera. **Generowanie jest niemożliwe** — zmierzone: `record_attempt_if_allowed` kończy się naruszeniem klucza obcego.

**Liczba do ostrzeżenia już istnieje.** `accounts_overview()` zwraca kolumnę `generations` (`20260914120000:147`), `AccountOverviewRow.generations` ją niesie, a `dashboard.astro:280` już ją rysuje. Nie trzeba jej budować — trzeba jej użyć.

**Wiersz tabeli ma dziś dwie wyspy React**, obie `client:load` (`dashboard.astro:291`, `:299`). Przegląd `S-11` przyjął jako ryzyko, że obie po sukcesie wołają `window.location.reload()` i wynik jednej ginie, z adnotacją: _„do przemyślenia razem z trzecią wyspą przy `S-12`, a nie po kawałku"_.

**`generation_attempts` celowo nie ma polityki DELETE** (`20260907192600:62-66`): _„konto NIE MOZE obnizyc wlasnego zuzycia ani skasowac dowodu proby (…) brak polityki jest stanem docelowym"_. Kaskada klucza obcego jest wykonywana przez silnik i **nie podlega RLS**, więc usunięcie konta robi dokładnie to, czego tej tabeli zabroniono. To nie jest luka do załatania — to zapisana konsekwencja, którą plan wymienia z nazwy.

## Desired End State

Administrator widzi przy każdym wierszu przycisk usunięcia. Pierwsze kliknięcie nie wysyła żądania — odsłania pytanie, które **nazywa liczbę generacji**, jakie znikną. Drugie kliknięcie usuwa. Po sukcesie ekran mówi, ile generacji faktycznie zniszczono — liczbą **z bazy**, nie z renderu.

Własnego konta usunąć się nie da: funkcja odmawia, a interfejs nie rysuje przy nim przycisku. Usunięcie ostatniego czynnego administratora wymaga jawnej zgody, tak jak zdjęcie mu roli i zablokowanie go.

Weryfikacja: konto usunięte znika z przeglądu, jego generacje znikają z bazy, a jego żywa sesja przy następnym żądaniu ląduje na logowaniu.

### Key Discoveries

- **`DELETE` z funkcji `security definer` działa** — zmierzone wywołaniem jako rola `authenticated`; `UPDATE` był udowodniony, `DELETE` nie.
- **Dziesięć kluczy obcych, wszystkie `CASCADE`** — dwa w repo, osiem wewnętrznych GoTrue zmierzonych w katalogu.
- **Miękkie usunięcie nie odbiera dostępu** — GoTrue wydaje token kontu z `deleted_at`.
- **Po twardym usunięciu `getUser()` zwraca 403**, więc produkt zamyka się bez nowej bramki; PostgREST zostaje otwarty na odczyty, ale generowanie odrzuca klucz obcy.
- **Usunięcie zwalnia udział w dobowym suficie** — zmierzone: sufit stopniał o 4 z 4 prób konta.
- **Liczba generacji jest już w przeglądzie i na ekranie** (`accounts_overview():147`, `dashboard.astro:280`).
- **Astro odrzuca `DELETE` bez nagłówka `Origin` PRZED middleware** — 403 CSRF zamiast kontraktu błędów (zapisane w planie `S-06`; dotyczy każdego nowego handlera `DELETE`).
- **Wzorzec operacji niszczącej już istnieje** — `src/components/generations/DeleteButton.tsx`: dwa kroki inline, focus na „Anuluj", stan końcowy `deleted`, `location.replace` zamiast `assign`.

## What We're NOT Doing

- **Żadnego stanu odwracalnego przed usunięciem.** Blokada (`FR-016`) jest tym stanem — PRD `## Open Questions` #8. Produkt niesie dwa stany konta, nie trzy.
- **Żadnego miękkiego usunięcia.** Zmierzone, że nie odbiera dostępu; wariant zamknięty, nie odłożony.
- **Żadnego ratowania dobowego sufitu.** Kaskada kasuje próby i sufit przestaje zapisywać realny wydatek dnia — PRD zapisało to jako przyjętą konsekwencję przy `FR-017`. Plan ją wymienia, nie naprawia. Uczciwy licznik to osobna zmiana, jeśli kiedykolwiek.
- **Żadnego usuwania pojedynczych generacji na cudzym koncie.** `## Non-Goals` PRD: administrator może usunąć _konto_, nie sięgać do środka.
- **Żadnego audytu** kto kogo usunął — nadal poza zakresem, jak przy `S-10` i `S-11`.
- **Żadnej zmiany dyrektywy hydracji.** Faza 3 zbija liczbę wysp z trzech do jednej; `client:load` zostaje, bo zmiana dyrektywy bez pomiaru to optymalizacja na oko (F10 przeglądu `S-10`).
- **Żadnej zmiany w `set_account_role` ani `set_account_blocked`.** Ten plaster dokłada czwartego czytelnika `active_admin_count()`, nie przepisuje trzech poprzednich.

## Implementation Approach

Ścieżka zapisu bez zmian wobec `S-10` i `S-11`: wyspa → endpoint → moduł → RPC → `auth.users`. Nowa funkcja kopiuje z `set_account_blocked` listę ról w `revoke`, `search_path`, predykaty na stanie wołającego i **ten sam klucz blokady doradczej** — roadmapa zapisuje to przy `S-12` jako wymóg, bo klucz chroni liczbę administratorów.

Dwie rzeczy są tu nowe wobec obu poprzednich plastrów.

**Zgoda na zniszczenie jest parametrem funkcji, nie stanem interfejsu.** Bez `p_confirm_destroy` funkcja odmawia każdemu, także administratorowi. Guardrail PRD („nic nie niszczy zapisanych generacji bez uprzedzenia") przestaje przez to być uprzejmością widoku i staje się własnością bazy — nie do ominięcia wywołaniem RPC wprost. To odwrotna decyzja niż przy blokowaniu siebie w `S-11`, i różnica jest umyślna: tam skutek był odwracalny przez innego administratora, tutaj nie jest odwracalny przez nikogo.

**Funkcja zwraca kod RAZEM z liczbą zniszczonych generacji**, policzoną w tej samej transakcji. Liczba z renderu bywa nieaktualna — konto mogło generować między odczytem przeglądu a kliknięciem — a ekran ma powiedzieć, co się stało, nie co przewidywał.

Kolejność faz rozdziela dwa ryzyka, które łatwo pomylić. **Faza 3 jest czystym refaktorem**: scala trzy wyspy w jedną, nie dokładając żadnej nowej akcji, i jej kryterium sukcesu brzmi „zachowanie identyczne". Dopiero faza 4 dokłada usuwanie. Zrobione razem, regres refaktoru byłby nieodróżnialny od błędu nowej funkcji.

## Critical Implementation Details

**Astro odrzuca `DELETE` bez nagłówka `Origin`, i robi to PRZED middleware.** `curl -X DELETE` bez nagłówków dostanie 403 CSRF, a nie kod z kontraktu błędów — zapisane w planie `S-06` jako pułapka dotycząca każdego przyszłego handlera `DELETE`. Weryfikacja ręczna musi to uwzględnić, inaczej „403" zostanie odczytane jako działająca bramka uprawnień, którą wcale nie jest.

**Kaskada omija RLS.** Usunięcie generacji i prób przy kasowaniu konta nie wymaga żadnej nowej polityki `DELETE` na `generations` ani na `generation_attempts` — wykonuje ją silnik. Dokładanie takiej polityki byłoby otwarciem drogi, której dziś nie ma.

**Liczbę generacji trzeba policzyć PRZED `delete`.** Po kaskadzie nie ma czego liczyć. Kolejność wewnątrz funkcji jest więc wymuszona, nie dowolna.

## Phase 1: Baza — funkcja usunięcia konta

### Overview

Jedna migracja dodaje `delete_account`. Po fazie usunięcie da się wykonać i zmierzyć bez istnienia endpointu.

### Changes Required

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_account_deletion.sql`

**Intent**: Dodać jedyny mechanizm usuwania konta w produkcie, z bramkami, które czynią guardrail PRD własnością bazy, a nie interfejsu.

**Contract**: `public.delete_account(p_account uuid, p_confirm_destroy boolean default false, p_confirm_last boolean default false)` — `plpgsql`, `security definer`, `set search_path = ''`, volatile. Zwraca `table (code text, destroyed_generations integer)`; przy każdym kodzie odmowy liczba jest `0`.

Kolejność wewnątrz funkcji, wymuszona przez skutki:

1. **Bramka roli wołającego** — `auth.uid()`, `deleted_at is null`, `banned_until is null or <= now()`, rola `admin`. Kod `FORBIDDEN`. Przed odczytem celu, żeby nie ujawnić jego istnienia (FR-015).
2. **Odmowa usunięcia siebie** — `p_account = auth.uid()` → kod `SELF_DELETE_FORBIDDEN`. W bazie, nie w widoku: każde inne działanie na sobie w tym produkcie jest odwracalne, to jedno nie jest.
3. **Brak zgody na zniszczenie** — `not coalesce(p_confirm_destroy, false)` → kod `DESTROY_CONFIRM_REQUIRED`.
4. `perform pg_advisory_xact_lock(hashtext('account_role_gate'))` — **ten sam klucz** co `set_account_role` i `set_account_blocked`; roadmapa i `20260914120000:406-409` wymagają tego wprost.
5. **Odczyt celu** z `deleted_at is null` → brak wiersza to `NOT_FOUND`.
6. **Ochrona ostatniego czynnego administratora** — gdy cel jest czynnym administratorem i `public.active_admin_count() <= 1`, a `p_confirm_last` jest fałszem → `LAST_ADMIN_NEEDS_CONFIRM`. Czwarty czytelnik tego licznika; nie powtarzać predykatu (`20260914120000:44-48`).
7. **Policzenie generacji celu** — `count(*)` z `public.generations`. **Przed** usunięciem; po kaskadzie nie ma czego liczyć.
8. `delete from auth.users where id = p_account and deleted_at is null` — kaskada zabiera resztę.

Uprawnienia skopiowane z `20260914120000:503-507`, nie odtworzone z pamięci: `revoke execute … from public, anon, service_role`, `grant execute … to authenticated`.

#### 2. Skrypt kontrolny i test SQL

**File**: `context/changes/admin-delete-account/verify-deletion.sql`, `context/changes/admin-delete-account/test-delete-account.sql`

**Intent**: Dowód, że funkcja istnieje z właściwymi własnościami i że każda bramka faktycznie broni.

**Contract**: Skrypt kontrolny jeden `SELECT`, tożsamość środowiska w pierwszej kolumnie, werdykt w ostatniej; sprawdza `provolatile`, `prosecdef`, `proconfig` porównaniem **dokładnym** (`proconfig @> array['search_path=""']`, ustalenie F1 przeglądu `S-11`) oraz `has_function_privilege` dla `anon`, `service_role` i `authenticated` — dla **wszystkich pięciu** funkcji uprzywilejowanych.

Test SQL w wycofanej transakcji, numery przypadków liczone, nie wpisane; porównania przez `IS DISTINCT FROM`, bo `NULL` w porównaniu nie liczy się jako błąd (ustalenie przeglądu faz 1–2 `S-11`). Przypadki obowiązkowo różnicujące: usunięcie **siebie** odmawia także z obiema zgodami; brak `p_confirm_destroy` odmawia administratorowi; ostatni czynny administrator bez `p_confirm_last` odmawia, z nim przechodzi; **liczba zwrócona równa się liczbie generacji sprzed usunięcia**; po odmowie stan celu jest nietknięty.

### Success Criteria

#### Automated Verification

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Skrypt kontrolny: werdykt `OK` dla wszystkich pięciu funkcji
- Test SQL: konto bez roli nie usunie nikogo, stan celu nietknięty
- Test SQL: usunięcie **siebie** odmawia nawet z obiema zgodami
- Test SQL: brak `p_confirm_destroy` odmawia administratorowi
- Test SQL: ostatni czynny administrator bez zgody odmawia, ze zgodą przechodzi
- Test SQL: zwrócona liczba równa się liczbie generacji konta sprzed usunięcia
- Typy zregenerowane; diff wyłącznie nowa funkcja
- `npm run test:integration` kodem wyjścia 0
- `npx tsc --noEmit` bez błędów

#### Manual Verification

- Zdjęcie każdej z trzech bramek czerwieni odpowiadające jej przypadki testowe

---

## Phase 2: Kontrakt — endpoint, moduł, typy

### Overview

Droga z aplikacji do funkcji, wzorem `S-10` i `S-11`, ale osobną metodą HTTP.

### Changes Required

#### 1. Moduł i typy

**File**: `src/lib/admin-accounts.ts`, `src/types.ts`, `src/lib/api-errors.ts`

**Intent**: Wystawić usuwanie tą samą drogą co dwie poprzednie operacje i dać interfejsowi liczbę, którą ma pokazać.

**Contract**: `deleteAccount(supabase, accountId, confirmDestroy, confirmLast)` zwraca `{ code: AccountActionCode | "SELF_DELETE_FORBIDDEN" | "DESTROY_CONFIRM_REQUIRED"; destroyedGenerations: number }` — rzuca przy błędzie bazy, odmowę oddaje jako kod. `mapAccountActionCode` rozszerzone o dwa nowe kody; pozostaje fail-closed (`INTERNAL` dla nieznanego).

`ApiErrorCode` zyskuje dwa wpisy: odmowa usunięcia własnego konta (status **409** — żądanie jest poprawne, ale koliduje z regułą, której wołający mógł nie znać) oraz brak zgody na zniszczenie (**409**, z tego samego powodu co `LAST_ADMIN_CONFIRM_REQUIRED`). Komunikaty po polsku, bez odsyłania do kontaktu, którego produkt nie ma.

#### 2. Endpoint

**File**: `src/pages/api/accounts/[id].ts`

**Intent**: Wystawić usuwanie jako `DELETE`, bo `PATCH` znaczy „zmień pole", a to jest zniszczenie zasobu.

**Contract**: Nowy handler `DELETE` obok istniejącego `PATCH`, ta sama kolejność bramek co w `PATCH` i w `src/pages/api/generations/[id].ts`: sesja → format UUID → klient → wywołanie. Zgody idą **parametrami zapytania** (`?confirmDestroy=true&confirmLast=true`), bo `DELETE` nie niesie ciała w sposób, na który da się liczyć; walidacja przez Zod w `src/lib/`, nie pod `src/pages/`. Odpowiedź sukcesu: `{ id, destroyedGenerations }` — endpoint mówi, **co** zniszczył.

### Success Criteria

#### Automated Verification

- Test jednostkowy schematu parametrów: brak zgody, zgoda, wartości spoza zbioru
- Test jednostkowy mapowania nowych kodów na kody API
- `npm test` kodem wyjścia 0
- `npx tsc --noEmit` i ESLint bez błędów

#### Manual Verification

- `DELETE` zwykłym kontem zwraca 404, nie 403
- `DELETE` bez nagłówka `Origin` zwraca 403 CSRF — potwierdzenie, że to pułapka Astro, a nie bramka uprawnień

---

## Phase 3: Scalenie wiersza w jedną wyspę — czysty refaktor

### Overview

Trzy wyspy w wierszu to wyścig o `reload()` i trzy korzenie hydracji. Ta faza scala dwie istniejące w jedną, **nie dokładając żadnej nowej akcji**. Po fazie zachowanie ma być nieodróżnialne od dzisiejszego.

### Changes Required

#### 1. Wspólna wyspa

**File**: `src/components/admin/AccountActions.tsx`, `src/pages/dashboard.astro`

**Intent**: Jeden korzeń hydracji na wiersz, jeden stan interakcji, jeden stan końcowy — zamiast dwóch komponentów ścigających się o przeładowanie.

**Contract**: `AccountActions` przyjmuje cały wiersz i renderuje oba dotychczasowe przyciski. **Maszyny stanów zostają osobne** — `@/lib/account-role-action` i `@/lib/account-block-action` nie są scalane; scala się wyłącznie renderowanie i stan interakcji. Wyspa trzyma jedną wartość „która akcja jest w toku", więc dwie operacje nie mogą biec naraz i nie ma czego gubić przy `reload()`.

Wszystkie ustalenia, które ukształtowały oba komponenty, muszą przeżyć scalenie i to jest główne ryzyko tej fazy: `knownLastAdmin` wchodzi do **kontekstu** maszyny stanów i nie kasuje go powrót do spoczynku (F3 przeglądu całości `S-10`); focus na „Anuluj"; gałąź potwierdzenia przeżywa wysyłanie; stan końcowy **przed** przeładowaniem (F4); zdanie o nieaktualnej reszcie tabeli w stanach, które odbierają wołającemu dostęp (F5). `AccountRoleButton.tsx` i `AccountBlockButton.tsx` znikają.

### Success Criteria

#### Automated Verification

- `npm test` kodem wyjścia 0 — testy maszyn stanów nietknięte, bo logika się nie przenosi
- `npx astro build` przechodzi
- ESLint i `npx tsc --noEmit` bez błędów

#### Manual Verification

- Zmiana roli zachowuje się identycznie jak przed refaktorem, łącznie z pytaniem przy ostatnim administratorze i „Anuluj"
- Blokowanie i odblokowanie zachowuje się identycznie, łącznie ze stanem po zablokowaniu siebie
- W wierszu jest **jeden** korzeń hydracji zamiast dwóch — zmierzone w przeglądarce
- Tabela nadal mieści się bez poziomego przewijania

---

## Phase 4: Interfejs — przycisk usunięcia

### Overview

Ostatnia faza. Trzeci przycisk w scalonej wyspie, pytanie nazywające liczbę generacji, komunikat mówiący, ile faktycznie zniszczono.

### Changes Required

#### 1. Maszyna stanów i wyspa

**File**: `src/lib/account-delete-action.ts`, `src/components/admin/AccountActions.tsx`

**Intent**: Decyzja „czy pytać, czy wysyłać" w funkcji czystej — repo nie ma infrastruktury do testowania komponentów.

**Contract**: `planDeleteAction(context, confirmed)` zwraca unię rozłączną `{ kind: "confirm"; warning } | { kind: "send"; confirmLast }`. **Pyta zawsze** — usunięcia nie da się odkliknąć, więc nie ma przypadku „wyślij od razu". Ostrzeżenie nazywa **liczbę generacji**; gdy konto jest ostatnim czynnym administratorem, wygrywa ostrzeżenie o zakończeniu administracji, tak jak przy roli i blokadzie. Dla **własnego wiersza przycisk nie powstaje** — baza i tak odmówi, ale rysowanie przycisku, który zawsze odmawia, byłoby kłamstwem ekranu.

Po sukcesie: stan końcowy z liczbą **z odpowiedzi**, potem przeładowanie. Nigdy odwrotnie.

#### 2. Tabela

**File**: `src/pages/dashboard.astro`

**Intent**: Zmieścić trzeci przycisk bez przywracania poziomego przewijania.

**Contract**: Przycisk w tej samej komórce co dwa pozostałe, w układzie pionowym — szerokość komórki równa się najszerszemu przyciskowi, nie ich sumie (zmierzone przy `S-11`: dołożenie drugiego przycisku kosztowało 0 px).

### Success Criteria

#### Automated Verification

- Test jednostkowy: usunięcie pyta **zawsze**, także przy koncie bez generacji
- Test jednostkowy: przy ostatnim czynnym administratorze wygrywa ostrzeżenie o administracji
- Test jednostkowy: ostrzeżenie niesie liczbę generacji
- `npm test` kodem wyjścia 0
- `npx astro build` przechodzi
- ESLint i `npx tsc --noEmit` bez błędów

#### Manual Verification

- Usunięcie konta z generacjami: pytanie nazywa ich liczbę, komunikat końcowy podaje liczbę z bazy
- Usunięte konto znika z przeglądu, a jego generacje z bazy
- Żywa sesja usuniętego konta ląduje na logowaniu przy następnym żądaniu
- Przy własnym wierszu przycisku nie ma
- Tabela nadal mieści się bez poziomego przewijania
- Zwykłe konto nie widzi sekcji ani przycisków

---

## Testing Strategy

### Unit Tests

- `planDeleteAction`: pyta zawsze; ostrzeżenie z liczbą; pierwszeństwo ostrzeżenia o ostatnim administratorze; `confirmLast` równe `isLastAdmin`
- Schemat parametrów zapytania: brak zgody, zgoda, wartości spoza zbioru
- `mapAccountActionCode` dla dwóch nowych kodów

### Integration Tests

Zestaw integracyjny **nie wyrazi** ścieżki pozytywnej: usunięcie konta wymaga sesji administratora, a zbudowanie jej klientem JS wymaga zapisu do `auth.users`, na co klucz publishable nie ma prawa, a klucz `service_role` odrzuca strażnik w każdym zestawie. To ta sama, czterokrotnie już zapisana granica — plan nie udaje, że tym razem będzie inaczej. Ścieżka pozytywna jest mierzona **testem SQL** w wycofanej transakcji (faza 1) i ręcznie przez interfejs (faza 4).

Wyrażalne integracyjnie i warte zapisania: po usunięciu konta `getUser()` z jego tokenem zwraca 403 — to jedyna asercja, która potwierdza zamknięcie dostępu bez klucza sekretnego.

### Manual Testing Steps

1. Założyć trzy konta, jednemu nadać rolę administratora, drugiemu wygenerować kilka tekstów.
2. Jako administrator otworzyć panel; sprawdzić, że przy własnym wierszu nie ma przycisku usunięcia.
3. Kliknąć usunięcie przy koncie z generacjami; sprawdzić, że pytanie nazywa ich liczbę i że focus jest na „Anuluj".
4. Anulować; kliknąć ponownie — pytanie musi paść od nowa.
5. Potwierdzić; sprawdzić komunikat z liczbą, zniknięcie wiersza i pustkę w `generations` dla tego konta.
6. Z żywą sesją usuniętego konta wykonać żądanie — musi wylądować na logowaniu.
7. Sprawdzić `DELETE` bez nagłówka `Origin` — 403 CSRF, nie kod z kontraktu.

## Performance Considerations

Faza 3 zbija liczbę korzeni hydracji z dwóch na wiersz do jednego, a faza 4 nie dokłada trzeciego — przy suficie 200 wierszy to 200 zamiast 600, gdyby trzecia akcja dostała własną wyspę. To domyka F10 przeglądu `S-10` w kierunku, o który tamto ustalenie prosiło, bez zmiany dyrektywy hydracji.

Samo usunięcie to jeden `delete` z kaskadą po dwóch indeksowanych kluczach obcych; przy skali tego produktu koszt jest nieistotny.

## Migration Notes

Migracja dokłada funkcję i nie rusza żadnej istniejącej — nie ma `drop`, więc nie ma ryzyka utraty grantów, które przy `S-10` i `S-11` wymagało osobnej uwagi.

**Wdrożenie na produkcję zostaje ręczne**: port 5432 jest zablokowany, więc migracja idzie przez edytor SQL dostawcy, a wersja musi zostać wpisana do `supabase_migrations.schema_migrations`. Skrypt kontrolny wkleja się **osobno, w nowej sesji** — zasada przyjęta po tym, jak migracja `S-09` zniknęła z produkcji przy werdykcie `OK`.

**`S-11` musi być na produkcji przed tym plastrem.** `delete_account` woła `active_admin_count()`, która powstaje dopiero w migracji `20260914120000`.

## References

- Wymaganie: `context/foundation/prd.md` § `### Account management`, FR-017; guardrail w `## Success Criteria`; rozstrzygnięcie w `## Open Questions` #8
- Plaster: `context/foundation/roadmap.md` § `### S-12`, w tym wymóg wspólnego klucza blokady
- Wzorzec funkcji i pięć ustaleń przeglądów: `supabase/migrations/20260914120000_account_blocking.sql`
- Wzorzec operacji niszczącej: `src/components/generations/DeleteButton.tsx`, `context/archive/2026-09-07-delete-generation/plan.md`
- Wzorzec maszyny stanów i wyspy: `src/lib/account-block-action.ts`, `src/components/admin/AccountBlockButton.tsx`
- Dług do domknięcia w fazie 3: `context/changes/admin-block-account/reviews/impl-review-phase-3-4.md` § F4 i F5

## Addendum 2026-09-14 — adaptacja fazy 1

**Blok `## Phase 1` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Ochrona ostatniego administratora okazała się w tej funkcji NIEOSIĄGALNA — i wynika to wprost z odpowiedzi na inne pytanie tego samego planu.** Bramka wymaga, żeby wołający był **czynnym** administratorem, więc jest liczony przez `active_admin_count()`. Cel nie może być wołającym, bo usunięcie siebie jest zabronione. Gałąź odpalałaby się tylko wtedy, gdy cel **też** jest czynnym administratorem — a wtedy licznik ma co najmniej dwa i warunek `<= 1` nie zachodzi nigdy. **Zmierzone**: przy dwóch czynnych administratorach wywołanie bez zgody zwróciło `ok`, nie `LAST_ADMIN_NEEDS_CONFIRM`.

Przy `S-10` i `S-11` ten sam przypadek był osiągalny **właśnie dlatego**, że działanie na sobie było dozwolone — migracja `S-11` mówi to wprost: „TEN PRZYPADEK JEST ZAWSZE SOBIE". Zakaz z `S-12` go zabił. Dwie odpowiedzi z ośmiu zazębiły się i ani plan, ani ja tego nie przewidzieliśmy.

Rozstrzygnięte: **gałąź i parametr `p_confirm_last` usunięte**. Martwa gałąź sugerowałaby ochronę, której nie ma, a jej kryterium sukcesu byłoby nietestowalne — żadne wejście nie mogłoby go zaczerwienić, co reguła repo nazywa nie-sprawdzeniem. Nagłówek migracji zapisuje, **co by ją ożywiło**: dopuszczenie usuwania własnego konta.

**Kryterium 1.6 jest przez to NIEWAŻNE, nie „oczekujące".** Opisuje zachowanie, którego w projekcie nie ma. Zostawiam je nieodhaczone celowo — odhaczenie twierdziłoby, że zweryfikowałem coś, czego nie ma, a przemianowanie wiersza łamie kontrakt sekcji `## Progress`. Zastąpiło je nowe kryterium **1.12**, opisane niżej.

**Zero administratorów wróciło innymi drzwiami i to jest poważniejsza połowa tego addendum.** Blokada doradcza chroni licznik, ale bramka wołającego stała **przed** jej wzięciem, więc decyzja zapadała na danych sprzed czekania. **Zmierzone dwiema sesjami**: administratorzy A i B usuwają się nawzajem — sesja B przechodzi bramkę, gdy A jeszcze istnieje, czeka na blokadę, a po jej otrzymaniu usuwa A mimo że sama nie jest już nikim. Wynik: **oba konta usunięte, zero administratorów, bez niczyjej zgody**. Wymóg roadmapy („`S-12` MUSI wziąć ten sam klucz") spełniłem, a skutek i tak przeszedł.

To jest ustalenie **F8 przeglądu `S-11`**, tam przyjęte jako niskie ryzyko — bo skutkiem było zero administratorów **za zgodą**, dopuszczone przez PRD. Tutaj skutkiem jest nieodwracalne usunięcie **bez** zgody, więc ta sama usterka waży inaczej.

Naprawione przez **powtórzenie bramki wołającego po wzięciu blokady**. Dopiero to daje blokadzie realną robotę w tej funkcji. Duplikacja jest świadoma i opisana w migracji, żeby nikt jej nie „uprościł". Pilnuje jej nowe kryterium **1.12** i osobny skrypt `test-wyscig-usuwania.sh` — dwóch sesji nie da się wyrazić w jednej transakcji, więc nie mieści się w teście SQL.

**Test najpierw zależał od stanu, którego nie kontroluje.** Pierwsza wersja porównywała `active_admin_count()` z `1` i przechodziła wyłącznie na bazie świeżo po `db reset`; przy dwóch kontach lokalnych czerwieniła się **bez żadnej zmiany w kodzie**. Liczby przestawione na względne wobec stanu sprzed testu.

**Mutacje generowane z KANONICZNEJ definicji pobranej z bazy**, nie przepisywane ręcznie — inaczej mutacja mogłaby różnić się od funkcji czymś więcej niż zdjętą bramką. Pierwsze uruchomienie nie wypisało nic i wziąłem to za brak czerwieni; w rzeczywistości `pg_get_functiondef` nie zwraca kończącego średnika, więc sklejenie z testem było błędem składni. Zapisane, bo cichy brak wyjścia łatwo pomylić z sukcesem.

**Mutacje, wynik:** bez bramki roli czerwieni 9 z 21; bez zakazu usuwania siebie 9 z 21; bez zgody na zniszczenie 6 z 21. Czysty przebieg 21/21, **z dwoma kontami lokalnymi w bazie**.

## Addendum 2026-09-14 — adaptacja fazy 2

**Blok `## Phase 2` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Jeden parametr zgody, nie dwa — konsekwencja fazy 1.** Plan zapisał `?confirmDestroy=true&confirmLast=true`. `p_confirm_last` przestał istnieć, bo gałąź ostatniego administratora jest w `delete_account` nieosiągalna. Parametr, którego baza nie zna, byłby obietnicą bez pokrycia.

**Zgoda przyjmuje WYŁĄCZNIE `"true"` albo `"false"`, nie „cokolwiek niepuste znaczy tak".** Parametr przychodzi z adresu, więc zawsze jest tekstem. Gdyby liczyła się sama obecność wartości, literówka w adresie zamieniłaby się w zgodę na operację, której nikt nie cofnie — pilnuje tego przypadek różnicujący z dziewięcioma wartościami (`1`, `yes`, `tak`, `TRUE`, `on`, …), z których **żadna** nie przechodzi.

**Brak parametru to błąd walidacji, nie ciche `false`.** Żądanie usunięcia bez słowa o zgodzie jest niepełne, a nie odmowne — użytkownik dostaje komunikat o tym, czego brakuje, zamiast odmowy bez wyjaśnienia. Baza i tak odmówi bez `p_confirm_destroy`, więc to druga warstwa, nie jedyna.

**Dwa nowe kody NIE są wyciszane do `NOT_FOUND`, w odróżnieniu od `FORBIDDEN`** — i to jest świadome rozróżnienie, nie niekonsekwencja. `FORBIDDEN` ukrywamy, bo pyta o nie ktoś bez uprawnień i sama odpowiedź zdradziłaby istnienie operacji (FR-015). `SELF_DELETE_FORBIDDEN` i `DESTROY_CONFIRM_REQUIRED` zwraca się **administratorowi**, który pyta o własne konto albo o własną zgodę — nie ma czego przed nim ukrywać, a wyciszenie zamieniłoby uczciwą odmowę w mylące „nie znaleziono".

**Statusy różne dla dwóch nowych kodów, a nie oba `409`.** `SELF_DELETE_FORBIDDEN` daje **403**: żądanie jest odrzucane **na stałe**, powtórzenie niczego nie da, a `409` sugerowałoby „spróbuj inaczej". `DESTROY_CONFIRM_REQUIRED` daje **409**, jak `LAST_ADMIN_CONFIRM_REQUIRED` — żądanie jest poprawne i wykonalne, tylko koliduje ze stanem, o którym wołający mógł nie wiedzieć.

**Nagłówki plików poprawione od razu, nie po przeglądzie.** Przy `S-11` ta sama klasa („nazwa opisuje połowę zawartości") wyszła trzy razy i za każdym razem dopiero w przeglądzie. Tu nagłówki `[id].ts` i `AccountActionCode` wymieniają wszystkie trzy operacje od pierwszego commitu.

**Pułapka CSRF potwierdzona pomiarem**, a nie przyjęta z planu `S-06` na słowo:

| Żądanie                            | Wynik                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DELETE` **bez** `Origin`          | **403**, zwykły tekst „Cross-site DELETE form submissions are forbidden" — **nie** kontrakt błędów |
| `DELETE` **z** `Origin`, bez sesji | **401** `UNAUTHORIZED`, poprawny JSON                                                              |

To rozstrzyga, że tamto 403 **nie jest bramką uprawnień**, choć tak wygląda — a pomylenie jednego z drugim dałoby fałszywe poczucie, że endpoint jest chroniony.

**Weryfikacja ręczna — siedem gałęzi przez prawdziwy endpoint, z sesją w przeglądarce:**

| Żądanie                                 | Wynik                                     |
| --------------------------------------- | ----------------------------------------- |
| zwykłe konto usuwa                      | **404**, nie 403 — kryterium fazy         |
| brak parametru zgody                    | 400, komunikat przy polu                  |
| `confirmDestroy=tak`                    | 400, komunikat mówiący, co jest dozwolone |
| `confirmDestroy=false`                  | 409 `DESTROY_CONFIRM_REQUIRED`            |
| admin usuwa **siebie**                  | **403** `SELF_DELETE_FORBIDDEN`           |
| nieistniejące konto / zły UUID          | 404                                       |
| admin usuwa cudze konto z 4 generacjami | 200, `destroyedGenerations: 4`            |

Po usunięciu: konto zniknęło z panelu, **zero osieroconych generacji** w bazie, a zwrócona liczba równa się dokładnie temu, co konto miało.

**Przy okazji spłacony dług:** usunięte dziesięć kont narosłych po przebiegach zestawu integracyjnego. To one przy `S-11` rozdęły tabelę i kazały mi podejrzewać własny regres.

## Addendum 2026-09-14 — adaptacja fazy 3

**Blok `## Phase 3` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Kryterium „zachowanie identyczne" jest spełnione dla każdej operacji z osobna, ale JEDNA rzecz zmienia się z założenia** i trzeba to powiedzieć wprost, zamiast chować pod słowem „identyczne": **operacje nie mogą się już przeplatać**. W trakcie potwierdzania jednej druga jest niedostępna — wcześniej obie były klikalne naraz i właśnie stąd brał się wyścig, który ten refaktor miał zamknąć. Zmierzone: przy pytaniu o blokadę przycisk roli znika, a „Anuluj" przywraca oba.

**Maszyny stanów NIE zostały scalone** — `account-role-action.ts` i `account-block-action.ts` są nietknięte. Dowód, że logika się nie przeniosła: `npm test` pokazuje **365 testów przed i po**, bez jednej zmiany w plikach testowych.

**Zmierzone zbicie hydracji:** cztery wiersze, **cztery wyspy zamiast ośmiu** — jedna na wiersz. Przy suficie 200 wierszy to 200 zamiast 400, a po fazie 4 będzie 200 zamiast 600. To domyka F10 przeglądu `S-10` w kierunku, o który tamto ustalenie prosiło, **bez** zmiany dyrektywy hydracji.

**Ciało żądania powstaje w tej samej gałęzi co decyzja.** Pierwsza wersja liczyła akcję raz, a potem odgadywała jej kształt przez `"targetRole" in action` — czyli sprawdzeniem, które typ już raz rozstrzygnął. Przepisane, zanim weszło do commitu.

**Weryfikacja ręczna:**

| Sprawdzenie                                        | Wynik                                                        |
| -------------------------------------------------- | ------------------------------------------------------------ |
| ostrzeżenie przy blokowaniu siebie                 | identyczne co do słowa, gałąź słabsza (dwóch adminów)        |
| focus w pytaniu                                    | na „Anuluj"                                                  |
| „Anuluj"                                           | wraca do spoczynku, **oba** przyciski z powrotem             |
| blokada cudzego konta                              | bez pytania → znacznik „zablokowane", przycisk na „Odblokuj" |
| zmiana roli **na tym samym koncie, tą samą wyspą** | przechodzi, kolumna „Rola" i przycisk przestawione           |
| wysp na wiersz                                     | **1** (było 2)                                               |
| tabela                                             | 638 / 638, zero przewijania                                  |

**Kryterium 3.2 (`astro build`) zostaje NIEODHACZONE — środowiskowo, nie przez tę zmianę.** Build pada na `Authentication error [code: 10000]` przy Cloudflare API, bo sięga po zdalny binding `AI`. Sprawdzone wcześniej przez `git stash`, że pada identycznie na commicie sprzed tych zmian. Wymaga `npx wrangler login` na konto gmail; do tego czasu kryterium jest **zablokowane**, nie niespełnione.

## Addendum 2026-09-14 — adaptacja fazy 4

**Blok `## Phase 4` powyżej zostaje nietknięty; ten addendum notuje, w czym implementacja od niego odeszła.**

**Kryterium 4.2 jest MARTWE, tak samo jak 1.6 — i z tego samego powodu.** Opisuje ostrzeżenie o utracie administracji przy usuwaniu ostatniego administratora. Ta gałąź jest **nieosiągalna**: skoro usunięcie własnego konta jest zabronione (decyzja z fazy planowania), to wołający jest czynnym administratorem i pozostaje nim po operacji — usunięcie kogoś innego nigdy nie zabierze ostatniej roli. Kryterium zostaje **nieodhaczone jako puste**, a nie jako niespełnione. To interakcja dwóch niezależnych odpowiedzi z planowania, której plan nie przewidział.

**Ostrzeżenie odmienia PRZYMIOTNIK, nie tylko rzeczownik.** Pierwsza wersja zmieniała samo `tekstem`/`tekstami` i produkowała na ekranie „wraz z jego **zapisanym tekstami**". Test tego nie złapał, bo sprawdzał wyłącznie formę pojedynczą — wyszło dopiero przy klikaniu. Doszedł `it.each([2, 3, 5, 12, 40])` z asercją negatywną; mutacja (powrót do stałego `zapisanym`) czerwieni go, więc kryterium ma teraz z czego czytać zielone.

**Przycisk w trakcie usuwania mówi „Usuwam…", nie „Zapisuję…".** Pozostałe dwie operacje coś zapisują; ta niszczy. Zmierzone na ekranie, nie przeczytane z kodu — patrz nagrany przebieg niżej.

**Stan końcowy usunięcia jest z założenia PRZELOTNY.** `setStatus("deleted")` stoi przed `window.location.reload()`, więc komunikat „Usunięto konto wraz z N zapisanymi tekstami." widać tylko w szczelinie przed odświeżeniem — dokładnie tak samo, jak przy roli i blokadzie. Stan końcowy nie jest tam po to, żeby go czytać na spokojnie, tylko po to, żeby ekran **mówił prawdę, gdy przeładowanie nie dojdzie**. Żeby to w ogóle zmierzyć, trzeba było nagrać mutacje wiersza do `sessionStorage`: `location.reload` jest niekonfigurowalne i nie da się go podmienić.

**Nagrany przebieg jednego usunięcia** (konto zwykłe, 7 generacji, `MutationObserver` → `sessionStorage`):

| #   | Stan wiersza                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `… 7 · 0 z 10 · Nadaj rolę · Zablokuj · Usuń`                                                                                    |
| 2   | `Usuniesz to konto wraz z jego zapisanymi tekstami — zniknie 7 tekstów. Tej operacji nie da się cofnąć.` + `Tak, usuń` / `Anuluj` |
| 3   | to samo pytanie, przycisk potwierdzenia na **`Usuwam…`**                                                                          |
| 4   | **`Usunięto konto wraz z 7 zapisanymi tekstami.`** + `Odśwież panel`                                                             |

**Liczba w komunikacie końcowym pochodzi z ODPOWIEDZI, nie z przeglądu.** Baza policzyła ją w tej samej transakcji co usunięcie; `generations` z wiersza było tylko przewidywaniem sprzed kliknięcia. Czytana obronnie przez `odczytajLiczbe`, bo przychodzi z sieci — `null` znaczy „nie wiem, ile", i stan końcowy potrafi to powiedzieć uczciwie.

**Weryfikacja ręczna:**

| Sprawdzenie                   | Wynik                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| pytanie nazywa liczbę         | `zniknie 7 tekstów` / `zniknie 3 teksty` — odmiana zgodna z liczbą         |
| konto bez generacji           | `Nie ma zapisanych tekstów do utraty.` zamiast „0 tekstów"                 |
| komunikat końcowy             | `Usunięto konto wraz z 7 zapisanymi tekstami.`                             |
| focus w pytaniu               | na „Anuluj"                                                                 |
| „Anuluj"                      | wraca do spoczynku, **wszystkie trzy** przyciski z powrotem                 |
| usunięte konto w przeglądzie  | znika; `generacji osieroconych: 0`                                          |
| żywa sesja usuniętego konta   | `/generations` i `/dashboard` → `/auth/signin`, **mimo obecnego ciastka**   |
| własny wiersz                 | dwa przyciski, **bez** „Usuń"                                               |
| konto zwykłe                  | nie widzi sekcji kont ani żadnego przycisku                                 |
| wysp na wiersz                | **1** (bez zmiany po dołożeniu trzeciego przycisku)                         |
| tabela                        | zero przewijania poziomego, zapas 0 px                                      |

**Kryterium 4.5 (`astro build`) zostaje NIEODHACZONE — środowiskowo, jak 3.2.** Ten sam `Authentication error [code: 10000]`, ta sama diagnoza (`git stash` dowiódł, że pada również przed tymi zmianami), to samo odblokowanie: `npx wrangler login` na konto gmail.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baza — funkcja usunięcia konta

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie — ce1942e
- [x] 1.2 Skrypt kontrolny: werdykt OK dla wszystkich pięciu funkcji — ce1942e
- [x] 1.3 Test SQL: konto bez roli nie usunie nikogo, stan celu nietknięty — ce1942e
- [x] 1.4 Test SQL: usunięcie siebie odmawia nawet z obiema zgodami — ce1942e
- [x] 1.5 Test SQL: brak `p_confirm_destroy` odmawia administratorowi — ce1942e
- [ ] 1.6 Test SQL: ostatni czynny administrator bez zgody odmawia, ze zgodą przechodzi
- [x] 1.7 Test SQL: zwrócona liczba równa liczbie generacji sprzed usunięcia — ce1942e
- [x] 1.8 Typy zregenerowane; diff wyłącznie nowa funkcja — ce1942e
- [x] 1.9 `npm run test:integration` kodem wyjścia 0 — ce1942e
- [x] 1.10 `npx tsc --noEmit` bez błędów — ce1942e

#### Manual

- [x] 1.11 Zdjęcie każdej z trzech bramek czerwieni odpowiadające przypadki — ce1942e
- [x] 1.12 Wyścig: dwaj administratorzy usuwający się nawzajem nie kończą zerem — ce1942e

### Phase 2: Kontrakt — endpoint, moduł, typy

#### Automated

- [x] 2.1 Test jednostkowy schematu parametrów zapytania — c107395
- [x] 2.2 Test jednostkowy mapowania dwóch nowych kodów — c107395
- [x] 2.3 `npm test` kodem wyjścia 0 — c107395
- [x] 2.4 `npx tsc --noEmit` i ESLint bez błędów — c107395

#### Manual

- [x] 2.5 `DELETE` zwykłym kontem zwraca 404, nie 403 — c107395
- [x] 2.6 `DELETE` bez `Origin` zwraca 403 CSRF — pułapka Astro potwierdzona — c107395

### Phase 3: Scalenie wiersza w jedną wyspę

#### Automated

- [x] 3.1 `npm test` kodem wyjścia 0 — a9fc919
- [ ] 3.2 `npx astro build` przechodzi
- [x] 3.3 ESLint i `npx tsc --noEmit` bez błędów — a9fc919

#### Manual

- [x] 3.4 Zmiana roli zachowuje się identycznie jak przed refaktorem — a9fc919
- [x] 3.5 Blokowanie i odblokowanie zachowuje się identycznie — a9fc919
- [x] 3.6 Jeden korzeń hydracji na wiersz zamiast dwóch — zmierzone — a9fc919
- [x] 3.7 Tabela mieści się bez poziomego przewijania — a9fc919

### Phase 4: Interfejs — przycisk usunięcia

#### Automated

- [x] 4.1 Test jednostkowy: usunięcie pyta zawsze, także bez generacji
- [ ] 4.2 Test jednostkowy: przy ostatnim adminie wygrywa ostrzeżenie o administracji
- [x] 4.3 Test jednostkowy: ostrzeżenie niesie liczbę generacji
- [x] 4.4 `npm test` kodem wyjścia 0
- [ ] 4.5 `npx astro build` przechodzi
- [x] 4.6 ESLint i `npx tsc --noEmit` bez błędów

#### Manual

- [x] 4.7 Pytanie nazywa liczbę generacji, komunikat końcowy podaje liczbę z bazy
- [x] 4.8 Usunięte konto znika z przeglądu, generacje z bazy
- [x] 4.9 Żywa sesja usuniętego konta ląduje na logowaniu
- [x] 4.10 Przy własnym wierszu nie ma przycisku usunięcia
- [x] 4.11 Tabela mieści się bez poziomego przewijania
- [x] 4.12 Zwykłe konto nie widzi sekcji ani przycisków

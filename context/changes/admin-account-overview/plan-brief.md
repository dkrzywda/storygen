# Przegląd kont dla administratora — brief

> Pełny plan: `context/changes/admin-account-overview/plan.md`

## What & Why

Administrator ma zobaczyć, kto ma konto i ile generuje — bo bez tego dwa dzienne sufity
(na konto i na aplikację) są liczbami, których nikt nie widzi. FR-014 wymaga listy kont
z datą rejestracji, liczbą generacji i zużyciem wobec limitu; FR-015 wymaga, żeby odmowa
nie ujawniała, że taki przegląd w ogóle istnieje.

## Starting Point

`F-02` (zarchiwizowany 2026-09-08) dał rolę w `app_metadata`, fail-closed `isAdmin()` i **pustą
sekcję** w `/dashboard` renderowaną tylko dla administratora. Ten plaster ją wypełnia. Zmierzone
przy planowaniu: rola `authenticated` nie ma prawa czytać `auth.users`, więc agregacja ponad
kontami musi iść przez `security definer`.

## Desired End State

Administrator wchodzi na `/dashboard` i w sekcji nad zakładkami widzi tabelę: adres, data
rejestracji, liczba generacji, zużycie dobowe. Konto bez roli nie widzi ani sekcji, ani jej
śladu w źródle strony. Wywołanie funkcji wprost przez klienta zwraca zwykłemu kontu **zero
wierszy**, a `anon` dostaje odmowę uprawnień. W żadnym wierszu nie ma treści generacji.

## Key Decisions Made

| Decyzja                 | Wybór                                     | Dlaczego                                                                                              | Źródło |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Skąd bramka bierze rolę | Z **bazy** dla `auth.uid()`, nie z tokenu | Zmierzone: token wystawiony przed nadaniem roli nie ma jej w claimach — `auth.jwt()` zwraca `NULL`    | Plan   |
| Odmowa na poziomie RPC  | Zero wierszy, nie wyjątek                 | Pusty zbiór jest nieodróżnialny od „brak kont", więc nie ujawnia istnienia przeglądu (FR-015)         | Plan   |
| Zawartość wiersza       | Pełny adres + trzy liczby                 | Dokładnie to, co wylicza FR-014; adres jest identyfikatorem konta, a administratorem jest jedna osoba | Plan   |
| Konta testowe           | Bez filtrowania                           | Filtr po wzorcu adresu byłby regułą wziętą z niczego; na produkcji problem nie istnieje               | Plan   |
| Miejsce w interfejsie   | Sekcja nad zakładkami                     | Zero nowych tras i powierzchni do osłonięcia; sekcja dotyczy konta, tak jak blok limitu               | Plan   |
| Kolejność i sufit       | Najnowsze konta, 200                      | Konwencja najnowsze-pierwsze jest w tej aplikacji wszędzie; sufit ma precedens w `generations.ts:79`  | Plan   |
| Błąd odczytu            | Degradacja jak licznik limitu             | `null` znaczy „nie wiem", nie „zero"; reszta panelu działa dalej — wzorzec już w `dashboard.astro`    | Plan   |
| Zakres przeglądu        | Tylko liczby, nigdy treść                 | Utrzymuje NFR o izolacji kont nienaruszony — polityka RLS na `generations` nie jest poszerzana        | PRD v2 |

## Scope

**W zakresie:** funkcja `accounts_overview()` z bramką roli w środku i właściwymi grantami;
zapytanie kontrolne; typ `AccountOverviewRow`; `src/lib/admin-accounts.ts`; tabela w sekcji
panelu z degradacją przy błędzie; test integracyjny ścieżek negatywnych; ryzyko `R-09`
w planie testów.

**Poza zakresem:** treść generacji w jakiejkolwiek formie; zmiana polityki RLS na `generations`;
zarządzanie kontami (blokowanie, usuwanie, zmiana limitów); filtrowanie kont testowych; trzecia
zakładka lub trasa `/admin`; sufit aplikacji per wiersz.

## Architecture / Approach

Jedna funkcja `security definer` w bazie oddaje wiersz na konto. Bramka roli stoi **w środku
funkcji**, bo rola jest danymi, nie rolą bazodanową — nie da się jej wyrazić grantem. Bramka
czyta `auth.users` dla `auth.uid()`, nie token. Granty: `revoke … from public, anon`, potem
`grant … to authenticated`. Panel woła funkcję tylko wtedy, gdy `isAdmin()` już przeszło, więc
konto bez roli nie generuje nawet zapytania — a gdyby ktoś zawołał RPC wprost, dostanie pusty
zbiór.

## Phases at a Glance

| Faza                     | Co dostarcza                                               | Główne ryzyko                                                                                  |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Funkcja i uprawnienia | Funkcja istnieje i ma właściwe granty; nikt jej nie woła   | `revoke … from public` nie odbiera prawa `anon` — regres zmierzony przy `S-04`                 |
| 2. Odczyt i widok        | Administrator widzi tabelę; konto bez roli nie widzi śladu | Bramka czytająca token zamiast bazy działałaby, dopóki sesja nie jest starsza niż nadanie roli |
| 3. Testy granicy         | Dowód, że `anon` odmówiony, a zwykłe konto dostaje zero    | Ścieżka pozytywna niedowodliwa kluczem publishable — luka zapisana, nie przemilczana           |

**Prerequisites:** `F-02` zarchiwizowany (jest); działający lokalny Supabase do faz 1 i 3.

**Estimated effort:** trzy fazy, każda domykalna w jednej sesji; fazy 1 i 3 wymagają Dockera.

## Open Risks & Assumptions

- **Druga funkcja omijająca RLS w tym projekcie.** Pierwsza (`usage_today` z `S-04`) dostała
  w przeglądzie ustalenie krytyczne. Zakres tej funkcji jest szerszy — czyta `auth.users`
  wszystkich kont — więc błąd w bramce ma większy zasięg niż tam.
- **Ścieżki pozytywnej nie da się pokryć testem** kluczem publishable (nie zbuduje konta z rolą),
  a `service_role` odrzuca strażnik testu. Ta sama świadoma luka co w `F-02`.
- **Wdrożenie na produkcję wymaga obejścia** — port 5432 zablokowany w sieci autora, więc
  migracja idzie przez SQL Editor z ręcznym zaksięgowaniem wersji, jak `S-04`.

## Success Criteria (Summary)

- Administrator widzi listę kont z liczbami; nikt inny nie widzi śladu, że taka lista istnieje
- Konto bez roli wołające funkcję wprost dostaje zero wierszy, `anon` dostaje odmowę
- W żadnym wierszu i w żadnym miejscu źródła strony nie ma treści cudzej generacji

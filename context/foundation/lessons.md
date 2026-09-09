# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Milczenie reguły to nie zgoda

- **Context**: Dopisujesz nowy plik do `src/pages/api/` albo nowy typ domenowy,
  a reguła w CLAUDE.md mówi tylko o czymś obok — o „auth endpoints" albo
  o „shared types" — nie o tym, co właśnie piszesz.
- **Problem**: Reguły opisują to, co już jest w repo. Nowy kod zwykle wypada
  poza ich literalny zakres i łatwo uznać, że skoro nic nie zabrania, to
  można po swojemu. Sprawdziliśmy to (2026-08-24): trzy niezależne przebiegi
  dostały to samo zadanie — endpoint `/api/generate`. Wszystkie trzy uznały,
  że reguła „Auth endpoints are form-post + redirect, not JSON" ich nie
  dotyczy, i zwróciły `Response.json(...)`. Wszystkie trzy zostawiły typy
  lokalnie zamiast w `src/types.ts`, bo formalnie nie były jeszcze „shared".
  Żaden nie złamał zapisanej reguły — a repo ma teraz dwa różne sposoby
  zwracania błędów.
- **Rule**: Reguła, która opisuje sąsiedni przypadek, mówi ci o intencji
  projektu, nie wyznacza granicy dozwolonego. Jeśli twój przypadek do niej nie
  pasuje literalnie, rozejrzyj się po kodzie i zrób tak, jak najbliższe
  istniejące miejsce. Możesz zrobić inaczej, jeśli masz powód — ale wtedy
  napisz to wprost w podsumowaniu zmiany. Zła jest tylko cicha decyzja.
- **Applies to**: plan, implement, impl-review

## Komunikat błędu od zewnętrznej usługi może być pusty

- **Context**: Wołasz zewnętrzną usługę (Supabase Auth, dostawca LLM) i
  przekazujesz jej komunikat błędu użytkownikowi — przez `?error=`, przez pole
  formularza, przez toast. Dotyczy `src/pages/api/**` i każdego miejsca, gdzie
  `error.message` z SDK trafia na powierzchnię produktu.
- **Problem**: SDK zwraca obiekt błędu, ale `message` bywa pusty. Sprawdziliśmy
  to na produkcji (2026-08-24, pierwsza próba rejestracji): Supabase Auth
  zwrócił 502 Bad Gateway, `src/pages/api/auth/signup.ts` zrobił
  `?error=${encodeURIComponent(error.message)}`, a użytkownik zobaczył pustą
  czerwoną ramkę bez tekstu. Kod nie zawiódł — `error` istniał, redirect
  wykonał się poprawnie. Zawiodło założenie, że skoro błąd jest, to ma treść.
  PRD wymaga komunikatu po polsku właśnie dla przypadku „niedostępny dostawca",
  więc pusta ramka to naruszenie wymogu, nie kosmetyka.
- **Rule**: Nigdy nie przekazuj `error.message` z zewnętrznego SDK wprost na
  powierzchnię produktu. Mapuj znane przypadki na własne komunikaty, a dla
  nieznanych i pustych trzymaj jeden komunikat domyślny. Traktuj brak treści
  błędu jako normalny stan do obsłużenia, nie jako sytuację niemożliwą.
- **Applies to**: plan, implement, impl-review

## Nie pisz kodu, dopóki plaster nie ma planu

- **Context**: Każda zmiana, która realizuje pozycję z `context/foundation/roadmap.md`
  albo wymaganie z `prd.md` — niezależnie od tego, czy została zamówiona jako plaster,
  czy jako zwykła prośba o funkcję. Drobne poprawki i literówki poza regułą.
- **Problem**: 2026-09-07 sześć zmian weszło prosto w drzewo robocze bez folderu
  zmiany, bez planu i bez przeglądu: `polish-auth-surface`, `home-screen-generator`,
  `story-format-generation`, `generation-history-storage`, `generation-rating`,
  `lighter-theme`. Cztery z nich to plastry z roadmapy, których nikt nie otworzył
  (S-02, S-03, S-07), dwie były poza PRD, a wszystkie stanęły na niedomkniętym S-01.
  Skutki były trzy i każdy kosztował: drzewa nie dało się recenzować per plaster,
  roadmapa kłamała o własnym stanie (`proposed` przy kodzie leżącym na dysku),
  a `/10x-impl-review` nie miał punktu odniesienia, bo kontrakt implementacji
  istniał tylko dla S-01. Rozbicie tego na commity po fakcie — z ręcznym dzieleniem
  trzech plików i osobną weryfikacją commitów pośrednich — zajęło więcej, niż
  zajęłoby zaplanowanie z góry.
- **Rule**: Zanim dotkniesz kodu, sprawdź, czy istnieje `context/changes/<id>/plan.md`
  dla tej pracy. Jeśli nie — otwórz zmianę przez `/10x-new` i napisz plan przez
  `/10x-plan`. Bezpośredniość prośby użytkownika nie jest zgodą na pominięcie łańcucha.
- **Applies to**: all

## Weryfikacja bez tożsamości środowiska nie jest dowodem

- **Context**: Każda ręczna aplikacja lub weryfikacja SQL na zdalnej bazie
  wykonana poza migracjami CLI — SQL Editor dostawcy, konsola web, doraźny
  klient. Dotyczy również skryptów sprawdzających stan po takiej aplikacji.
- **Problem**: 2026-09-08, wdrożenie S-04 na produkcję. Port 5432 był
  zablokowany w sieci, więc `supabase db push` nie przechodził i trzy migracje
  poszły ręcznie przez SQL Editor, a po nich skrypt weryfikacyjny z trzynastoma
  sprawdzeniami. Wynik: 13/13 na zielono, w tym punkt potwierdzający, że
  `authenticated` może wołać `usage_today()`. Aplikacja i tak zwracała
  `INTERNAL`, a `select * from public.usage_today()` na bazie produkcyjnej
  odpowiadał `42883: function does not exist`. Zielone światło przyszło z innej
  bazy niż ta, z której czyta produkcja. Skrypt nie zwracał ani
  `current_database()`, ani identyfikatora projektu, więc nie było jak tego
  zauważyć — trzynaście punktów i ani jeden o tym, gdzie się wykonały.
- **Rule**: Każdy skrypt weryfikacyjny musi jako pierwszą pozycję zwracać
  tożsamość środowiska, na którym się wykonał — nazwę bazy, identyfikator
  projektu, host. Wynik bez tej pozycji nie jest dowodem i nie wolno na nim
  opierać decyzji o wdrożeniu.
- **Applies to**: all

## Zielone czytaj z tego, co zmieniłoby się przy porażce

- **Context**: Każde sprawdzenie, którego wynik ma być dowodem — skrypt weryfikacyjny,
  kryterium sukcesu w planie, uruchomienie zestawu testów. Dotyczy zarówno odczytu
  wyniku, jak i projektowania samego sprawdzenia.
- **Problem**: 2026-09-08, jedna zmiana (`account-roles`), trzy niezależne wystąpienia
  tego samego błędu. (1) Skrypt kontrolny stawiał `current_database()` jako kolumnę
  tożsamości środowiska — a ta funkcja zwraca `postgres` i lokalnie, i na produkcyjnym
  Supabase, więc nie odróżniała niczego. (2) Kryterium planu twierdziło „testy padają
  po zdjęciu warunku `showAdmin`", choć żaden test nie renderuje strony, w której ten
  warunek stoi — zmierzono mutację innej funkcji. (3) Kryterium „testy integracyjne
  przechodzą" odhaczono na podstawie napisu „30 passed", gdy komenda zwracała kod
  wyjścia 1. Wszystkie trzy dały zielone, którego porażka nie mogłaby zaczerwienić.
- **Rule**: Zanim uznasz sprawdzenie za dowód, nazwij wartość, która **zmieniłaby się**,
  gdyby sprawdzana rzecz była zepsuta — i czytaj wynik z niej. Kod wyjścia, a nie licznik
  w wypisie. Wartość różnicująca środowiska, a nie taka, która jest wszędzie ta sama.
  Test, który faktycznie wykonuje ścieżkę, a nie sąsiednią. Sprawdzenie niewrażliwe na
  awarię, którą ma wykrywać, nie jest sprawdzeniem.
- **Applies to**: all

## Nowa funkcja uprzywilejowana kopiuje listę rol, nie wymyśla jej

- **Context**: Każda nowa funkcja `security definer` w `supabase/migrations/` — czyli każda,
  która celowo omija RLS. Dotyczy zarówno samej migracji, jak i skryptu kontrolnego, który
  po niej sprawdza uprawnienia.
- **Problem**: 2026-09-09, `accounts_overview()`. Migracja zrobiła
  `revoke execute … from public, anon`. Wszystkie **cztery** poprzednie uprzywilejowane funkcje
  w tym repo wymieniają trzy role: `public, anon, service_role` (`20260907192600:127`,
  `20260907221126:85`, `20260907221925:135` i `:142`). Zmierzone:
  `has_function_privilege('service_role', …)` zwracało `t` — prawo faktycznie zostało. Skrypt
  kontrolny sprawdzał `anon` i `authenticated`, ale **nie** `service_role`, więc wypisał `OK`.
  Dostęp nie przeciekł tylko dlatego, że `auth.uid()` jest `null` dla tej roli — czyli uratował
  nas przypadek w bramce, nie sprawdzenie.
- **Rule**: Pisząc `revoke`/`grant` dla nowej funkcji uprzywilejowanej, **przeczytaj poprzednią
  taką migrację i skopiuj z niej listę rol** — nie odtwarzaj jej z pamięci. Skrypt kontrolny musi
  sprawdzać `has_function_privilege` dla **każdej** roli, której `revoke` dotyczy; rola pominięta
  w kontroli to grant, który przejdzie na zielono.
- **Applies to**: plan, implement, impl-review

## Degradacja odczytu nie chroni renderowania

- **Context**: Każdy komponent Astro, który czyta dane w `try/catch` we frontmatterze,
  a potem formatuje je w szablonie — datami, liczbami, `Intl.*`. Dotyczy zwłaszcza sekcji,
  które mają degradować się osobno od reszty strony.
- **Problem**: 2026-09-09, `dashboard.astro`. Odczyt przeglądu kont stoi w `try/catch`,
  a `null` znaczy „nie wiem" i sekcja pokazuje komunikat, nie wywracając panelu. Ale
  `dateFormat.format(account.registeredAt)` stoi w **szablonie**, poza tym blokiem.
  Zmierzone: `auth.users.email` i `created_at` mają `is_nullable = YES`, a wygenerowany
  `database.types.ts` deklaruje je jako nie-null — typ jest **węższy niż schemat**. Wartość
  nieparsowalna w dacie rzuciłaby więc z `Intl.format`, czyli **z szablonu**, wywracając całą
  stronę — łącznie z rankingiem i ulubionymi, które z tą sekcją nie mają nic wspólnego.
  Ostrożny `try` przy odczycie dał złudzenie izolacji, której nie ma.
- **Rule**: `try/catch` przy odczycie chroni tylko odczyt. Jeśli sekcja ma degradować się
  osobno, **przenieś formatowanie do frontmatteru, do tego samego bloku co odczyt** — albo
  zabezpiecz wartość przed wejściem do szablonu. Nie zakładaj też, że typy generowane
  z `auth.*` odpowiadają schematowi: sprawdź `is_nullable`, zanim potraktujesz kolumnę
  jako pewną.
- **Applies to**: plan, implement, impl-review

# Rola konta i serwerowe sprawdzenie dostępu — brief

> Pełny plan: `context/changes/account-roles/plan.md`

## What & Why

Aplikacja zna dziś tylko dwa stany: zalogowany albo nie. `S-09` ma pokazać administratorowi
przegląd kont, więc najpierw musi istnieć rola konta i serwerowe sprawdzenie, które potrafi
po niej odmówić. FR-015 stawia przy tym nietypowy wymóg: odmowa **nie może ujawnić, że przegląd
istnieje** — więc nie wystarczy odmówić, trzeba odmówić nierozróżnialnie od nieistniejącej trasy.

## Starting Point

`src/middleware.ts` bramkuje trasy jednym testem `!locals.user` → przekierowanie na logowanie.
W repo nie ma żadnego pojęcia roli. Zmierzone 2026-09-08: nieistniejąca trasa zwraca wbudowaną
stronę 404 Astro (4319 B, po angielsku) — co przewraca zapis w roadmapie przy `S-02`, twierdzący,
że zwraca puste ciało, i ujawnia naruszenie NFR o języku istniejące niezależnie od tej zmiany.

## Desired End State

Administrator wchodzi na `/admin` i widzi stronę zastępczą. Wszyscy pozostali — zalogowani bez
roli i niezalogowani — dostają polską stronę 404 **identyczną w treści i statusie** z odpowiedzią
na losową nieistniejącą ścieżkę. Rola żyje w `app_metadata`, więc żadne żądanie nie płaci za nią
dodatkowym zapytaniem.

## Key Decisions Made

| Decyzja                     | Wybór                                     | Dlaczego                                                                                                  | Źródło |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| Gdzie mieszka rola          | `app_metadata` w `auth.users`             | Middleware już ją dostaje z `getUser()` — zero dodatkowych zapytań; `user_metadata` byłoby podrabialne    | Plan   |
| Kształt odmowy              | 404 jak nieistniejąca trasa               | Jedyna opcja realizująca FR-015 dosłownie — 403 potwierdza istnienie zasobu                               | Plan   |
| Nierozróżnialność           | Polska `404.astro` + `context.rewrite`    | Jedno źródło prawdy dla obu ścieżek; `new Response(null, {status:404})` przecieka przez długość ciała     | Plan   |
| Podział strony / API        | `ADMIN_ROUTES` w middleware + `isAdmin()` | Zgodne z regułą, że ochrona tras jest middleware-driven, a API nie zostaje bez osłony                     | Plan   |
| Weryfikowalność fundamentu  | Pusta trasa `/admin` w tej zmianie        | Bez trasy nie da się potwierdzić ręcznie, że granica działa, aż do `S-09`                                 | Plan   |
| Konto, którego może nie być | Seed idempotentny + zapytanie kontrolne   | Migracja nie wywala się na czystej bazie; kontrola łapie cichy no-op, nieodróżnialny od poprawnej odmowy  | Plan   |
| Zakres przeglądu            | Tylko liczby, nigdy treść                 | Utrzymuje NFR izolacji kont nienaruszony — RLS na `generations` nie jest poszerzany                       | PRD v2 |
| Rola nie z e-maila          | Własność konta w danych                   | Adres to dane od użytkownika; traktowanie go jako roszczenia o uprawnienia czyni sprawdzenie podrabialnym | PRD v2 |

## Scope

**W zakresie:** rola w `app_metadata` dla dwóch kont; typ `AccountRole`; sprawdzenie `isAdmin()`;
`ADMIN_ROUTES` w middleware; polska strona 404; pusta trasa `/admin`; testy jednostkowe
i integracyjny test granicy; zapytanie kontrolne seeda.

**Poza zakresem:** przegląd kont (`S-09`, FR-014); czytanie cudzych generacji; zmiana polityki
RLS na `generations`; zarządzanie kontami; ścieżka zmiany roli bez wdrożenia; tabela `user_roles`
lub `profiles`; link do `/admin` w nawigacji.

## Architecture / Approach

Migracja dopisuje `{"role": …}` do `auth.users.raw_app_meta_data`. Middleware, które i tak woła
`supabase.auth.getUser()` na każdym żądaniu, dostaje rolę w tej samej odpowiedzi i przekazuje
`locals.user` do czystej funkcji `isAdmin()`. Gdy trasa pasuje do `ADMIN_ROUTES`, a sprawdzenie
nie przechodzi, middleware przepisuje żądanie na `/404` — tę samą stronę, którą Astro renderuje
dla prawdziwego pudła. `isAdmin()` jest jednym miejscem prawdy, więc handlery API `S-09` zawołają
to samo sprawdzenie.

## Phases at a Glance

| Faza                               | Co dostarcza                                               | Główne ryzyko                                                                         |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Rola w danych i typ             | Konta mają rolę; nic jej jeszcze nie czyta                 | Cichy no-op seeda, gdy konta nie ma — dlatego zapytanie kontrolne nie jest opcjonalne |
| 2. Bramka i nierozróżnialna odmowa | `/admin` istnieje dla admina, nie istnieje dla pozostałych | Przekierowanie zamiast 404 ujawniłoby trasę i złamało FR-015                          |
| 3. Testy granicy                   | Dowód, że odmowa jest identyczna, nie tylko obecna         | Test przechodzący też wtedy, gdy bramka odmawia wszystkim — stąd kontrola pozytywna   |

**Prerequisites:** działający lokalny Supabase (Docker) do fazy 1 i 3; konto administratora
istniejące w bazie, na której weryfikujesz fazę 2.

**Estimated effort:** trzy fazy, każda domykalna w jednej sesji; faza 3 wymaga Dockera.

## Open Risks & Assumptions

- **Wiążemy się ze schematem `auth` Supabase.** `raw_app_meta_data` nie jest kontraktem
  gwarantowanym między wersjami. Zapis zweryfikowany lokalnie 2026-09-08, ale aktualizacja
  Supabase może to zmienić. Alternatywa (tabela `user_roles`) została odrzucona świadomie.
- **Nie wiadomo, czy `damiano.krzywda@gmail.com` istnieje w bazie produkcyjnej.** Seed to
  obsługuje jako no-op, a zapytanie kontrolne to pokaże — ale dopóki konto nie istnieje,
  ścieżka „zalogowany bez roli admin" da się przetestować tylko kontem utworzonym doraźnie.
- **404 jako odmowa ma cenę diagnostyczną.** Każdy problem z rolą objawia się identycznie jak
  poprawnie działająca odmowa. Zaakceptowane, bo FR-015 nie dopuszcza innego kształtu.

## Success Criteria (Summary)

- Administrator wchodzi na `/admin` i widzi stronę; nikt inny nie widzi śladu, że ta trasa istnieje
- Odpowiedź dla nieuprawnionego jest bajtowo identyczna z odpowiedzią dla losowej nieistniejącej ścieżki
- Strona 404 jest po polsku — naruszenie NFR o języku zniknięte po drodze

-- Przeglad kont dla administratora (S-09, FR-014 i FR-015).
--
-- DRUGA FUNKCJA W TYM PROJEKCIE OMIJAJACA RLS. Pierwsza (`usage_today` z S-04)
-- dostala w przegladzie ustalenie krytyczne. Zakres tej jest SZERSZY — czyta
-- `auth.users` wszystkich kont — wiec blad w bramce ma wiekszy zasieg.
--
-- GRANICA JEST JEDNA I TWARDA: LICZBY, NIGDY TRESC. Ta funkcja nie dotyka kolumn
-- `topic`, `title` ani `content` z `public.generations` — wylacznie `count(*)`.
-- To wlasnie utrzymuje NFR o izolacji kont NIENARUSZONY: polityka RLS na
-- `generations` nie jest poszerzana ani o wiersz. Poszerzenie tego zakresu jest
-- zmiana w jedynym mechanizmie, na ktorym stoi caly model dostepu, i musi byc
-- uzasadnione osobno (granica zapisana przy FR-014 w PRD v2).

create function public.accounts_overview()
returns table (
  email text,
  registered_at timestamptz,
  generations integer,
  used_today integer,
  own_limit integer,
  -- SUFIT WRACA RAZEM Z DANYMI — ustalenie F3 przegladu, 2026-09-09.
  -- Wczesniej liczba 200 zyla DWA razy: raz w `limit` ponizej, raz jako stala
  -- w `dashboard.astro`. Zmiana sufitu w SQL uciszalaby wtedy komunikat o obcieciu
  -- BEZ ZADNEGO BLEDU, i lista znowu twierdzilaby "widzisz wszystko", gdy widzisz
  -- czesc. Ten sam wzorzec, ktory `usage_today()` stosuje dla progow limitu:
  -- interfejs pokazuje liczby, ktore FAKTYCZNIE obowiazuja przy odczycie.
  row_limit integer
)
language sql
security definer
set search_path = ''
stable
as $function$
  with cfg as (
    -- Jedyne miejsce, w ktorym ta liczba wystepuje. Precedens: `RESULT_LIMIT = 200`
    -- w `src/lib/generations.ts`. Nowa liczba wzieta z niczego bylaby gorsza
    -- od liczby, ktora juz w tym repo stoi.
    select 200::integer as row_limit
  ),
  day as (
    -- Okno doby przepisane z `usage_today()` (S-04). Podwojne `at time zone`
    -- daje lokalna polnoc poprawna wobec czasu letniego, a nie polnoc UTC.
    select
      (date_trunc('day', now() at time zone 'Europe/Warsaw'))
        at time zone 'Europe/Warsaw' as starts_at,
      (date_trunc('day', now() at time zone 'Europe/Warsaw') + interval '1 day')
        at time zone 'Europe/Warsaw' as ends_at
  )
  select
    u.email::text,
    u.created_at,
    (select count(*) from public.generations g where g.user_id = u.id)::integer,
    (
      select count(*)
        from public.generation_attempts a, day
       where a.user_id = u.id
         and a.created_at >= day.starts_at
         and a.created_at <  day.ends_at
    )::integer,
    public.daily_per_account(),
    cfg.row_limit
  from auth.users u, cfg
  -- ==========================================================================
  --  BRAMKA. Rola czytana Z BAZY dla `auth.uid()`, NIE z tokenu.
  --
  --  Zmierzone 2026-09-08: `auth.jwt() #>> '{app_metadata,role}'` zwraca NULL
  --  dla tokenu wystawionego PRZED nadaniem roli, bo claimy zamarzaja w chwili
  --  wystawienia. Bramka oparta na tokenie dzialalaby wiec tylko dla sesji
  --  mlodszych niz nadanie roli — i zawodzilaby w ciszy dla starszych.
  --
  --  ZWROT ZERA WIERSZY, NIE WYJATKU. Pusty zbior jest nieodroznialny od
  --  "brak kont", wiec nie ujawnia, ze przeglad istnieje (FR-015). `raise`
  --  potwierdzalby jego istnienie kazdemu, kto zgadnie nazwe funkcji.
  -- ==========================================================================
  where
    -- KONTA USUNIETE MIEKKO POZA PRZEGLADEM — ustalenie F6 przegladu, 2026-09-09.
    -- `auth.users` ma kolumne `deleted_at`, ktora GoTrue wypelnia przy miekkim
    -- usunieciu. Dzis nic w aplikacji nie usuwa kont, wiec ten filtr nie zmienia
    -- niczego — ale plaster zarzadzania kontami wlasnie to wprowadza, a wtedy
    -- brak filtra pokazywalby administratorowi konta, ktore uznal za usuniete.
    -- Taniej teraz niz przy tamtym plastrze, gdzie ustalenie moglo by umknac.
    --
    -- Filtr dotyczy kont LISTOWANYCH (`u`), nie wolajacego — rola wolajacego
    -- jest sprawdzana ponizej, na osobnym aliasie `me`.
    u.deleted_at is null
    and exists (
      select 1
        from auth.users me
       where me.id = auth.uid()
         and me.raw_app_meta_data->>'role' = 'admin'
    )
  order by u.created_at desc
  limit (select row_limit from cfg);
$function$;

comment on function public.accounts_overview() is
  'Przeglad kont dla administratora (FR-014). Zwraca WYLACZNIE liczby i metadane konta, '
  'nigdy tresci generacji — to utrzymuje NFR o izolacji kont nienaruszony. Bramka roli '
  'jest w srodku funkcji i czyta auth.users dla auth.uid(), nie token. Konto bez roli '
  'admin dostaje zero wierszy, nie blad (FR-015).';

-- UPRAWNIENIA. `revoke ... from public` NIE odbiera prawa rolom `anon`
-- i `authenticated` — Supabase nadaje im je jawnie przez `alter default
-- privileges`. Regres zmierzony przy S-04: bez wymienienia `anon` z nazwy
-- niezalogowany odczytywal `app_count` przez PostgREST. Role trzeba wymienic.
--
-- `service_role` WYMIENIONY Z NAZWY — ustalenie F1 przegladu, 2026-09-09.
-- Wczesniej go tu nie bylo, a wszystkie cztery poprzednie uprzywilejowane funkcje
-- w tym repo go odbieraja (`20260907192600:127`, `20260907221126:85`,
-- `20260907221925:135` i `:142`). Zmierzone: prawo faktycznie zostawalo (`t`).
-- Dostep nie przeciekal, bo `auth.uid()` jest `null` dla tej roli — ale uratowal
-- nas przypadek w bramce, nie uprawnienia. Projekt swiadomie nie ma klienta
-- `service_role`, wiec nic go nie potrzebuje.
--
-- `authenticated` DOSTAJE prawo wykonania celowo: rola admina jest DANYMI
-- w `app_metadata`, nie rola bazodanowa, wiec nie da sie jej wyrazic grantem.
-- Dlatego bramka jest w srodku funkcji, a nie w uprawnieniach.
revoke execute on function public.accounts_overview() from public, anon, service_role;
grant  execute on function public.accounts_overview() to authenticated;

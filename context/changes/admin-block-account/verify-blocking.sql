-- Kontrola stanu bazy po migracji 20260914120000_account_blocking.sql (S-11).
--
-- JEDEN SELECT, KONCZY SIE WYNIKIEM — nie `commit`-em. Edytor SQL dostawcy
-- pokazuje tylko rezultat OSTATNIEJ instrukcji, wiec skrypt konczacy sie
-- `commit` wypisuje "Success. No rows returned", co nie odroznia sukcesu od no-opu.
--
-- WKLEJAJ GO OSOBNO, W NOWEJ SESJI. Kontrola w tej samej sesji co zmiana
-- potwierdza tylko to, co widzi ta sesja. Zasada przyjeta 2026-09-14, po tym jak
-- migracja S-09 zniknela z produkcji razem z wpisem w rejestrze — przy commicie
-- na miejscu i werdykcie OK — a przyczyny nie ustalono.
--
-- PIERWSZA KOLUMNA TO TOZSAMOSC SRODOWISKA (`lessons.md` § "Weryfikacja bez
-- tozsamosci srodowiska nie jest dowodem"). NIE `current_database()`: ta zwraca
-- `postgres` i lokalnie, i na produkcji.
--
-- KAZDA ROLA, KTOREJ DOTYCZY `revoke`, MA WLASNA KONTROLE — dla WSZYSTKICH
-- CZTERECH funkcji uprzywilejowanych. Rola pominieta w kontroli to grant, ktory
-- przejdzie na zielono (ustalenie F2 przegladu S-09).
--
-- `active_admin_count()` MA INNY WZORZEC NIZ POZOSTALE TRZY: nie dostaje grantu
-- dla NIKOGO, wiec `authenticated` jest przy niej sprawdzane jako prawo ODBIERANE,
-- a nie nadawane. Odwrotny kierunek jest tu celowy, nie pomylka w przeklejeniu.

with fn as (
  select
    to_regprocedure('public.accounts_overview()')                        as ov,
    to_regprocedure('public.set_account_role(uuid,text,boolean)')        as sr,
    to_regprocedure('public.set_account_blocked(uuid,boolean,boolean)')  as sb,
    to_regprocedure('public.active_admin_count()')                       as ac
),
meta as (
  select
    (select ov from fn) as ov, (select sr from fn) as sr,
    (select sb from fn) as sb, (select ac from fn) as ac,
    -- Kolumny `returns table` to `proargmodes = 't'`. Po S-11 ma byc 11.
    (select count(*)::integer
       from pg_catalog.pg_proc p, unnest(p.proargmodes) m
      where p.oid = (select ov from fn) and m = 't') as ov_kolumn,
    -- Tryb: przeglad i licznik MUSZA byc stable, obie funkcje zapisujace MUSZA
    -- byc volatile — `stable` zabranialoby im zapisu.
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_tryb,
    -- `prosecdef` i `proconfig` — dwie wlasnosci, na ktorych stoi caly hardening
    -- (ustalenie F6 przegladu S-10).
    --
    -- POROWNANIE DOKLADNE, NIE `like '%search_path=%'` — ustalenie F1 przegladu S-11.
    -- Poprzednia wersja czerwienila sie wylacznie przy CALKOWITYM braku `set search_path`.
    -- Zmierzone na funkcji probnej: `set search_path = public` daje element
    -- `search_path=public`, wiec kontrola przez `LIKE` mowila `true` — a to jest
    -- dokladnie ten stan, przed ktorym `search_path = ''` broni w `security definer`.
    -- Sprawdzenie bylo niewrazliwe na awarie, ktora ma wykrywac.
    --
    -- WARTOSC POROWNYWANA JEST ZMIERZONA, NIE ZGADNIETA: Postgres CYTUJE pusty
    -- lancuch, wiec element brzmi `search_path=""`, a nie `search_path=`. Pierwsza
    -- proba tej poprawki porownywala z `search_path=` i zaczerwienila CZYSTY stan —
    -- co bylo szczescie w nieszczesciu, bo blad w kontroli ujawnil sie od razu.
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_def,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_path
),
priv as (
  select
    -- `coalesce(..., true)` dla praw ODBIERANYCH i `false` dla NADAWANEGO: brak
    -- funkcji ma czerwienic werdykt, nie umykac jako NULL.
    coalesce(has_function_privilege('anon',          m.ov, 'execute'), true)  as ov_anon,
    coalesce(has_function_privilege('service_role',  m.ov, 'execute'), true)  as ov_srv,
    coalesce(has_function_privilege('authenticated', m.ov, 'execute'), false) as ov_auth,
    coalesce(has_function_privilege('anon',          m.sr, 'execute'), true)  as sr_anon,
    coalesce(has_function_privilege('service_role',  m.sr, 'execute'), true)  as sr_srv,
    coalesce(has_function_privilege('authenticated', m.sr, 'execute'), false) as sr_auth,
    coalesce(has_function_privilege('anon',          m.sb, 'execute'), true)  as sb_anon,
    coalesce(has_function_privilege('service_role',  m.sb, 'execute'), true)  as sb_srv,
    coalesce(has_function_privilege('authenticated', m.sb, 'execute'), false) as sb_auth,
    -- Licznik: WSZYSTKIE TRZY to prawa odbierane, `authenticated` wlacznie.
    coalesce(has_function_privilege('anon',          m.ac, 'execute'), true)  as ac_anon,
    coalesce(has_function_privilege('service_role',  m.ac, 'execute'), true)  as ac_srv,
    coalesce(has_function_privilege('authenticated', m.ac, 'execute'), true)  as ac_auth
  from meta m
)
select
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  (select count(*) from auth.users where deleted_at is null) as konta,
  (select count(*) from auth.users
    where deleted_at is null and raw_app_meta_data->>'role' = 'admin') as adminow,
  -- Liczone tak samo jak w funkcji: porownaniem z `now()`, nie obecnoscia wartosci.
  (select count(*) from auth.users
    where deleted_at is null and banned_until is not null and banned_until > now()) as zablokowanych,
  -- Adminow UZYTECZNYCH — ta liczba, a nie `adminow`, decyduje, czy administracja
  -- jest jeszcze osiagalna. Rozjazd miedzy tymi dwiema kolumnami znaczy, ze ktorys
  -- administrator jest zablokowany.
  (select public.active_admin_count()) as adminow_uzytecznych,
  m.ov_kolumn                              as przeglad_kolumn,
  m.ov_tryb                                as przeglad_tryb,
  (m.sr is not null)                       as jest_zmiana_roli,
  (m.sb is not null)                       as jest_blokowanie,
  (m.ac is not null)                       as jest_licznik,
  m.sr_tryb, m.sb_tryb, m.ac_tryb,
  m.ov_def, m.sr_def, m.sb_def, m.ac_def,
  m.ov_path, m.sr_path, m.sb_path, m.ac_path,
  p.ov_anon, p.ov_srv, p.ov_auth,
  p.sr_anon, p.sr_srv, p.sr_auth,
  p.sb_anon, p.sb_srv, p.sb_auth,
  p.ac_anon, p.ac_srv, p.ac_auth,
  case
    when m.ov is null       then 'BLAD: brak accounts_overview()'
    when m.sr is null       then 'BLAD: brak set_account_role()'
    when m.sb is null       then 'BLAD: brak set_account_blocked()'
    when m.ac is null       then 'BLAD: brak active_admin_count()'
    when m.ov_kolumn <> 11  then 'BLAD: przeglad zwraca ' || m.ov_kolumn::text || ' kolumn, oczekiwano 11'
    when m.ov_tryb <> 's'   then 'BLAD: przeglad nie jest stable'
    when m.ac_tryb <> 's'   then 'BLAD: licznik nie jest stable'
    when m.sr_tryb <> 'v'   then 'BLAD: zmiana roli nie jest volatile'
    when m.sb_tryb <> 'v'   then 'BLAD: blokowanie nie jest volatile'
    when not m.ov_def or not m.sr_def or not m.sb_def or not m.ac_def
      then 'BLAD: ktoras funkcja nie jest security definer'
    when not m.ov_path or not m.sr_path or not m.sb_path or not m.ac_path
      then 'BLAD: ktoras funkcja bez set search_path = (pusty)'
    when p.ov_anon or p.sr_anon or p.sb_anon or p.ac_anon
      then 'BLAD: anon ma prawo wykonania'
    when p.ov_srv or p.sr_srv or p.sb_srv or p.ac_srv
      then 'BLAD: service_role ma prawo wykonania'
    when p.ac_auth          then 'BLAD: authenticated ma prawo wykonania licznika adminow'
    when not p.ov_auth or not p.sr_auth or not p.sb_auth
      then 'BLAD: authenticated NIE ma prawa wykonania'
    else 'OK'
  end as werdykt
from meta m, priv p;

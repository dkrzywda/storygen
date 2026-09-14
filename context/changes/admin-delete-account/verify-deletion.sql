-- Kontrola stanu bazy po migracji 20260914160000_account_deletion.sql (S-12).
--
-- JEDEN SELECT, KONCZY SIE WYNIKIEM — nie `commit`-em. Edytor SQL dostawcy
-- pokazuje tylko rezultat OSTATNIEJ instrukcji, wiec skrypt konczacy sie
-- `commit` wypisuje "Success. No rows returned", co nie odroznia sukcesu od no-opu.
--
-- WKLEJAJ GO OSOBNO, W NOWEJ SESJI. Kontrola w tej samej sesji co zmiana
-- potwierdza tylko to, co widzi ta sesja.
--
-- PIERWSZA KOLUMNA TO TOZSAMOSC SRODOWISKA (`lessons.md` § "Weryfikacja bez
-- tozsamosci srodowiska nie jest dowodem"). NIE `current_database()`: ta zwraca
-- `postgres` i lokalnie, i na produkcji.
--
-- KAZDA ROLA, KTOREJ DOTYCZY `revoke`, MA WLASNA KONTROLE — dla WSZYSTKICH
-- PIECIU funkcji uprzywilejowanych. Rola pominieta w kontroli to grant, ktory
-- przejdzie na zielono.
--
-- `active_admin_count()` MA ODWROTNY WZORZEC niz pozostale cztery: nie dostaje
-- grantu dla nikogo, wiec `authenticated` jest przy niej prawem ODBIERANYM.

with fn as (
  select
    to_regprocedure('public.accounts_overview()')                        as ov,
    to_regprocedure('public.set_account_role(uuid,text,boolean)')        as sr,
    to_regprocedure('public.set_account_blocked(uuid,boolean,boolean)')  as sb,
    to_regprocedure('public.active_admin_count()')                       as ac,
    to_regprocedure('public.delete_account(uuid,boolean)')               as da
),
meta as (
  select
    (select ov from fn) as ov, (select sr from fn) as sr, (select sb from fn) as sb,
    (select ac from fn) as ac, (select da from fn) as da,
    -- Kolumny `returns table` to `proargmodes = 't'`.
    (select count(*)::integer from pg_catalog.pg_proc p, unnest(p.proargmodes) m
      where p.oid = (select ov from fn) and m = 't')                     as ov_kolumn,
    (select count(*)::integer from pg_catalog.pg_proc p, unnest(p.proargmodes) m
      where p.oid = (select da from fn) and m = 't')                     as da_kolumn,
    -- Tryb: przeglad i licznik `stable`, trzy funkcje zapisujace `volatile`.
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select da from fn)) as da_tryb,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_def,
    (select p.prosecdef from pg_catalog.pg_proc p where p.oid = (select da from fn)) as da_def,
    -- POROWNANIE DOKLADNE, nie `like '%search_path=%'` — ustalenie F1 przegladu
    -- faz 1-2 `S-11`: wersja przez `LIKE` przepuszczala `search_path = public`,
    -- czyli dokladnie ten stan, przed ktorym pusta sciezka broni. Postgres CYTUJE
    -- pusty lancuch, wiec element brzmi `search_path=""` — wartosc zmierzona.
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select sb from fn)) as sb_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select ac from fn)) as ac_path,
    (select coalesce(p.proconfig @> array['search_path=""'], false)
       from pg_catalog.pg_proc p where p.oid = (select da from fn)) as da_path,
    -- Czy funkcja NIE MA juz parametru `p_confirm_last`. Galaz ostatniego
    -- administratora jest w `delete_account` nieosiagalna (zakaz usuwania siebie
    -- sprawia, ze licznik ma zawsze co najmniej dwa), wiec parametru ma nie byc.
    -- Jego powrot znaczylby, ze ktos przywrocil martwa galaz.
    (select p.pronargs from pg_catalog.pg_proc p where p.oid = (select da from fn)) as da_argumentow
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
    coalesce(has_function_privilege('anon',          m.ac, 'execute'), true)  as ac_anon,
    coalesce(has_function_privilege('service_role',  m.ac, 'execute'), true)  as ac_srv,
    coalesce(has_function_privilege('authenticated', m.ac, 'execute'), true)  as ac_auth,
    coalesce(has_function_privilege('anon',          m.da, 'execute'), true)  as da_anon,
    coalesce(has_function_privilege('service_role',  m.da, 'execute'), true)  as da_srv,
    coalesce(has_function_privilege('authenticated', m.da, 'execute'), false) as da_auth
  from meta m
)
select
  -- TOZSAMOSC KLASTRA JAKO PIERWSZA KOLUMNA, PRZED ADRESEM.
  --
  -- `host(inet_server_addr())` przez pooler Supabase zwraca adres POOLERA,
  -- wspolny dla wszystkich projektow w regionie — dwa projekty w `eu-west-1`
  -- wypisalyby ten sam ciag, czyli dokladnie klasa awarii, dla ktorej regula
  -- „Weryfikacja bez tozsamosci srodowiska nie jest dowodem" powstala.
  -- `system_identifier` jest unikalny i staly per klaster (ustalenie F7
  -- przegladu `S-12`). Adres zostaje jako druga kolumna, bo jest czytelny.
  (select system_identifier from pg_control_system()) as klaster,
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  (select count(*) from auth.users where deleted_at is null) as konta,
  (select public.active_admin_count()) as adminow_uzytecznych,
  (select count(*) from public.generations) as generacji,
  m.ov_kolumn as przeglad_kolumn,
  m.da_kolumn as usuwanie_kolumn,
  m.da_argumentow as usuwanie_argumentow,
  (m.da is not null) as jest_usuwanie,
  m.ov_tryb, m.ac_tryb, m.sr_tryb, m.sb_tryb, m.da_tryb,
  m.ov_def, m.sr_def, m.sb_def, m.ac_def, m.da_def,
  m.ov_path, m.sr_path, m.sb_path, m.ac_path, m.da_path,
  p.ov_anon, p.ov_srv, p.ov_auth,
  p.sr_anon, p.sr_srv, p.sr_auth,
  p.sb_anon, p.sb_srv, p.sb_auth,
  p.ac_anon, p.ac_srv, p.ac_auth,
  p.da_anon, p.da_srv, p.da_auth,
  case
    when m.ov is null then 'BLAD: brak accounts_overview()'
    when m.sr is null then 'BLAD: brak set_account_role()'
    when m.sb is null then 'BLAD: brak set_account_blocked()'
    when m.ac is null then 'BLAD: brak active_admin_count()'
    when m.da is null then 'BLAD: brak delete_account()'
    when m.ov_kolumn <> 11 then 'BLAD: przeglad zwraca ' || m.ov_kolumn::text || ' kolumn, oczekiwano 11'
    when m.da_kolumn <> 2  then 'BLAD: usuwanie zwraca ' || m.da_kolumn::text || ' kolumn, oczekiwano 2 (kod i liczba)'
    when m.da_argumentow <> 2 then 'BLAD: usuwanie ma ' || m.da_argumentow::text || ' argumentow, oczekiwano 2 — czy ktos przywrocil p_confirm_last?'
    when m.ov_tryb <> 's' then 'BLAD: przeglad nie jest stable'
    when m.ac_tryb <> 's' then 'BLAD: licznik nie jest stable'
    when m.sr_tryb <> 'v' or m.sb_tryb <> 'v' or m.da_tryb <> 'v'
      then 'BLAD: ktoras funkcja zapisujaca nie jest volatile'
    when not m.ov_def or not m.sr_def or not m.sb_def or not m.ac_def or not m.da_def
      then 'BLAD: ktoras funkcja nie jest security definer'
    when not m.ov_path or not m.sr_path or not m.sb_path or not m.ac_path or not m.da_path
      then 'BLAD: ktoras funkcja bez set search_path = (pusty)'
    when p.ov_anon or p.sr_anon or p.sb_anon or p.ac_anon or p.da_anon
      then 'BLAD: anon ma prawo wykonania'
    when p.ov_srv or p.sr_srv or p.sb_srv or p.ac_srv or p.da_srv
      then 'BLAD: service_role ma prawo wykonania'
    when p.ac_auth then 'BLAD: authenticated ma prawo wykonania licznika adminow'
    when not p.ov_auth or not p.sr_auth or not p.sb_auth or not p.da_auth
      then 'BLAD: authenticated NIE ma prawa wykonania'
    else 'OK'
  end as werdykt
from meta m, priv p;

-- Kontrola stanu bazy po migracji 20260909121500_account_role_management.sql (S-10).
--
-- JEDEN SELECT, KONCZY SIE WYNIKIEM — nie `commit`-em. Edytor SQL dostawcy pokazuje
-- tylko rezultat OSTATNIEJ instrukcji, wiec skrypt konczacy sie `commit` wypisuje
-- "Success. No rows returned", co NIE ODROZNIA sukcesu od no-opu. Kosztowalo nas to
-- jedna runde diagnozy 2026-09-09 przy wdrozeniu F-02.
--
-- PIERWSZA KOLUMNA TO TOZSAMOSC SRODOWISKA (`lessons.md` § "Weryfikacja bez
-- tozsamosci srodowiska nie jest dowodem"). NIE `current_database()`: ta funkcja
-- zwraca `postgres` i lokalnie, i na produkcyjnym Supabase, wiec nie odroznia
-- niczego. `inet_server_addr()` jest puste przez socket lokalny i niepuste zdalnie.
--
-- KAZDA ROLA, KTOREJ DOTYCZY `revoke`, MA WLASNY WIERSZ KONTROLI — `anon`,
-- `service_role` ORAZ `authenticated`, dla OBU funkcji. Rola pominieta w kontroli
-- to grant, ktory przejdzie na zielono; dokladnie to zdarzylo sie w ustaleniu F2
-- przegladu S-09.

with fn as (
  select
    to_regprocedure('public.accounts_overview()')                 as ov,
    to_regprocedure('public.set_account_role(uuid,text,boolean)') as sr
),
meta as (
  select
    (select ov from fn) as ov,
    (select sr from fn) as sr,
    -- Liczba kolumn zwracanych przez przeglad: `proargmodes = 't'` to kolumny
    -- `returns table`. Po S-10 ma byc 10 (szesc zastanych plus cztery nowe).
    (select count(*)::integer
       from pg_catalog.pg_proc p, unnest(p.proargmodes) m
      where p.oid = (select ov from fn) and m = 't') as ov_kolumn,
    -- Tryb: 's' = stable, 'v' = volatile. Przeglad MUSI byc stable (read-only
    -- z konstrukcji), a zmiana roli MUSI byc volatile — `stable` zabronilby zapisu.
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select ov from fn)) as ov_tryb,
    (select p.provolatile from pg_catalog.pg_proc p where p.oid = (select sr from fn)) as sr_tryb
),
priv as (
  select
    -- `coalesce(..., true)` znaczy "przy nieistniejacej funkcji uznaj prawo za
    -- OBECNE", czyli zepsute. Brak funkcji ma czerwienic werdykt, nie umykac
    -- jako NULL.
    coalesce(has_function_privilege('anon',          m.ov, 'execute'), true) as ov_anon,
    coalesce(has_function_privilege('service_role',  m.ov, 'execute'), true) as ov_service,
    coalesce(has_function_privilege('authenticated', m.ov, 'execute'), false) as ov_auth,
    coalesce(has_function_privilege('anon',          m.sr, 'execute'), true) as sr_anon,
    coalesce(has_function_privilege('service_role',  m.sr, 'execute'), true) as sr_service,
    coalesce(has_function_privilege('authenticated', m.sr, 'execute'), false) as sr_auth
  from meta m
)
select
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  (select count(*) from auth.users where deleted_at is null) as konta,
  (select count(*) from auth.users
    where deleted_at is null and raw_app_meta_data->>'role' = 'admin') as adminow,
  (m.ov is not null)                                   as przeglad_istnieje,
  m.ov_kolumn                                          as przeglad_kolumn,
  m.ov_tryb                                            as przeglad_tryb,
  (m.sr is not null)                                   as zmiana_roli_istnieje,
  m.sr_tryb                                            as zmiana_roli_tryb,
  p.ov_anon, p.ov_service, p.ov_auth,
  p.sr_anon, p.sr_service, p.sr_auth,
  case
    when m.ov is null                then 'BLAD: brak accounts_overview()'
    when m.sr is null                then 'BLAD: brak set_account_role()'
    when m.ov_kolumn <> 10           then 'BLAD: przeglad zwraca ' || m.ov_kolumn::text || ' kolumn, oczekiwano 10'
    when m.ov_tryb  <> 's'           then 'BLAD: przeglad nie jest stable (tryb ' || m.ov_tryb::text || ')'
    when m.sr_tryb  <> 'v'           then 'BLAD: zmiana roli nie jest volatile (tryb ' || m.sr_tryb::text || ')'
    when p.ov_anon                   then 'BLAD: anon ma prawo wykonania przegladu'
    when p.ov_service                then 'BLAD: service_role ma prawo wykonania przegladu'
    when not p.ov_auth               then 'BLAD: authenticated NIE ma prawa wykonania przegladu'
    when p.sr_anon                   then 'BLAD: anon ma prawo zmiany roli'
    when p.sr_service                then 'BLAD: service_role ma prawo zmiany roli'
    when not p.sr_auth               then 'BLAD: authenticated NIE ma prawa zmiany roli'
    else 'OK'
  end as werdykt
from meta m, priv p;

-- KROK 0 — ROZPOZNANIE PRODUKCJI. Czyta, nie zmienia niczego.
--
-- PO CO, SKORO ZNAMY REJESTR: bo 2026-09-09 rejestr KLAMAL. Produkcja miala
-- wpisane siedem migracji, a funkcji `accounts_overview()` nie bylo wcale —
-- wyszlo to dopiero, gdy `drop function` z nastepnej migracji nie mial czego
-- upuscic. Przyczyny nie ustalono. Dlatego stan sprawdzamy, zamiast zakladac.
--
-- Migracja `S-11` ZACZYNA SIE od `drop function public.accounts_overview()`.
-- Jesli tej funkcji na produkcji nie ma, skrypt wdrozeniowy padnie na pierwszej
-- instrukcji. Ten odczyt ma to wykryc ZANIM cokolwiek wkleisz.
--
-- JAK URUCHOMIC: edytor SQL dostawcy, jedno wklejenie, jedno uruchomienie.

select
  -- TOZSAMOSC SRODOWISKA JAKO PIERWSZA POZYCJA (`lessons.md` § "Weryfikacja bez
  -- tozsamosci srodowiska nie jest dowodem"). NIE `current_database()`: ta zwraca
  -- `postgres` i lokalnie, i tutaj, wiec nie odroznia niczego.
  coalesce(host(inet_server_addr())::text, 'socket lokalny')            as serwer,
  current_setting('server_version')                                     as wersja_pg,

  -- Rejestr migracji: ile i ktora ostatnia.
  (select count(*) from supabase_migrations.schema_migrations)          as migracji_w_rejestrze,
  (select max(version) from supabase_migrations.schema_migrations)      as ostatnia_wersja,
  (select string_agg(version, ', ' order by version)
     from supabase_migrations.schema_migrations)                        as wszystkie_wersje,

  -- Czy `S-11` juz tam jest (wtedy nie wklejaj niczego).
  exists(select 1 from supabase_migrations.schema_migrations
          where version = '20260914120000')                             as s11_juz_zabukowane,

  -- CZY FUNKCJE FAKTYCZNIE ISTNIEJA. Rejestr mowi, co MIALO sie wykonac;
  -- to mowi, co faktycznie jest.
  (to_regprocedure('public.accounts_overview()') is not null)           as jest_przeglad_kont,
  (to_regprocedure('public.set_account_role(uuid,text,boolean)') is not null)
                                                                        as jest_zmiana_roli,
  (to_regprocedure('public.set_account_blocked(uuid,boolean,boolean)') is not null)
                                                                        as jest_juz_blokowanie,
  (to_regprocedure('public.active_admin_count()') is not null)          as jest_juz_licznik,
  (to_regprocedure('public.usage_today()') is not null)                 as jest_usage_today,
  (to_regprocedure('public.record_attempt_if_allowed(text)') is not null)
                                                                        as jest_bramka_limitow,

  -- Ile kolumn zwraca przeglad: 6 = wersja S-09, 10 = S-10, 11 = juz S-11.
  (select count(*)::integer
     from pg_catalog.pg_proc p, unnest(p.proargmodes) m
    where p.oid = to_regprocedure('public.accounts_overview()') and m = 't')
                                                                        as kolumn_w_przegladzie,

  -- Stan kont — zeby wiedziec, na czym operujemy.
  (select count(*) from auth.users where deleted_at is null)            as kont,
  (select count(*) from auth.users
    where deleted_at is null and raw_app_meta_data->>'role' = 'admin')  as adminow,
  (select count(*) from auth.users
    where deleted_at is null and banned_until is not null
      and banned_until > now())                                         as zablokowanych,
  (select count(*) from public.generations)                             as generacji,

  -- WERDYKT: co zrobic dalej.
  case
    when exists(select 1 from supabase_migrations.schema_migrations
                 where version = '20260914120000')
      then 'S-11 JUZ ZABUKOWANE — nie wklejaj kroku 1, przejdz od razu do kontroli'
    when to_regprocedure('public.accounts_overview()') is null
      then 'STOP: brak accounts_overview() — krok 1 padnie na `drop function`. To ten sam stan, co 2026-09-09.'
    when to_regprocedure('public.set_account_role(uuid,text,boolean)') is null
      then 'STOP: brak set_account_role() — produkcja nie ma S-10, a S-11 na nim stoi.'
    when not exists(select 1 from supabase_migrations.schema_migrations
                     where version = '20260909121500')
      then 'UWAGA: funkcje sa, ale S-10 nie jest zabukowane — rejestr rozjechany ze stanem.'
    else 'OK — mozna wklejac krok 1'
  end                                                                   as werdykt;

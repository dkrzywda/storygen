-- KROK 0 — ROZPOZNANIE PRODUKCJI PRZED S-12. Czyta, nie zmienia niczego.
--
-- PO CO, SKORO ZNAMY REJESTR: bo 2026-09-09 rejestr KLAMAL. Produkcja miala
-- wpisane siedem migracji, a funkcji `accounts_overview()` nie bylo wcale.
-- Przyczyny nie ustalono. Dlatego stan sprawdzamy, zamiast zakladac.
--
-- CZEGO TEN KROK PILNUJE SZCZEGOLNIE: `delete_account` WOLA `active_admin_count()`,
-- ktora powstaje dopiero w migracji `S-11` (`20260914120000`). Jesli S-11 nie ma
-- na produkcji, migracja S-12 UTWORZY SIE BEZ BLEDU — `plpgsql` nie sprawdza cial
-- funkcji przy tworzeniu — a wywali sie dopiero przy PIERWSZYM klknieciu
-- administratora, komunikatem `42883: function does not exist`. To jest dokladnie
-- ta klasa awarii, ktora przy `S-04` dala zielony werdykt i niedzialajaca aplikacje.
--
-- JAK URUCHOMIC: edytor SQL dostawcy, jedno wklejenie, jedno uruchomienie.

select
  -- TOZSAMOSC SRODOWISKA JAKO PIERWSZA POZYCJA (`lessons.md` § "Weryfikacja bez
  -- tozsamosci srodowiska nie jest dowodem"). NIE `current_database()`: ta zwraca
  -- `postgres` i lokalnie, i tutaj, wiec nie odroznia niczego.
  coalesce(host(inet_server_addr())::text, 'socket lokalny')            as serwer,
  current_setting('server_version')                                     as wersja_pg,

  -- Rejestr migracji.
  (select count(*) from supabase_migrations.schema_migrations)          as migracji_w_rejestrze,
  (select max(version) from supabase_migrations.schema_migrations)      as ostatnia_wersja,

  -- Czy poprzednik jest zabukowany, i czy S-12 juz tam jest.
  exists(select 1 from supabase_migrations.schema_migrations
          where version = '20260914120000')                             as s11_zabukowane,
  exists(select 1 from supabase_migrations.schema_migrations
          where version = '20260914160000')                             as s12_juz_zabukowane,

  -- CO FAKTYCZNIE ISTNIEJE. Rejestr mowi, co MIALO sie wykonac.
  (to_regprocedure('public.accounts_overview()') is not null)           as jest_przeglad_kont,
  (to_regprocedure('public.set_account_role(uuid,text,boolean)') is not null)
                                                                        as jest_zmiana_roli,
  (to_regprocedure('public.set_account_blocked(uuid,boolean,boolean)') is not null)
                                                                        as jest_blokowanie,
  -- TA JEST WARUNKIEM KONIECZNYM DLA S-12.
  (to_regprocedure('public.active_admin_count()') is not null)          as jest_licznik_adminow,
  (to_regprocedure('public.delete_account(uuid,boolean)') is not null)  as jest_juz_usuwanie,

  -- 10 = wersja S-10, 11 = S-11 na miejscu. S-12 wymaga 11.
  (select count(*)::integer
     from pg_catalog.pg_proc p, unnest(p.proargmodes) m
    where p.oid = to_regprocedure('public.accounts_overview()') and m = 't')
                                                                        as kolumn_w_przegladzie,

  -- CO ZNIKNIE, GDYBY KTOS UZYL USUWANIA. Liczby produkcyjne, zeby bylo wiadomo,
  -- na czym operujemy — to jedyna nieodwracalna operacja w produkcie.
  (select count(*) from auth.users where deleted_at is null)            as kont,
  (select count(*) from auth.users
    where deleted_at is null and raw_app_meta_data->>'role' = 'admin')  as adminow,
  (select count(*) from public.generations)                             as generacji,

  -- WERDYKT.
  case
    when exists(select 1 from supabase_migrations.schema_migrations
                 where version = '20260914160000')
      then 'S-12 JUZ ZABUKOWANE — nie wklejaj kroku 1, przejdz od razu do kontroli'
    -- ROZJAZD W DRUGA STRONE: funkcja JEST, ale wersji nie ma w rejestrze.
    -- Wtedy `create function` w kroku 1 padnie na istniejacej funkcji — a bez
    -- tej galezi werdykt powiedzialby "OK" i zaprosil do wklejenia.
    when to_regprocedure('public.delete_account(uuid,boolean)') is not null
      then 'STOP: delete_account() ISTNIEJE, ale wersja nie jest zabukowana. Krok 1 padnie na `create function`. Zabukuj wersje recznie albo ustal, skad wziela sie ta funkcja.'
    when to_regprocedure('public.active_admin_count()') is null
      then 'STOP: brak active_admin_count() — najpierw wdroz S-11. Bez niej delete_account utworzy sie BEZ bledu i wywali sie dopiero przy pierwszym klknieciu.'
    when to_regprocedure('public.accounts_overview()') is null
      then 'STOP: brak accounts_overview() — produkcja nie ma nawet S-09/S-10.'
    when (select count(*)::integer
            from pg_catalog.pg_proc p, unnest(p.proargmodes) m
           where p.oid = to_regprocedure('public.accounts_overview()') and m = 't') <> 11
      then 'STOP: przeglad nie zwraca 11 kolumn — S-11 nie jest w pelni wdrozone.'
    when not exists(select 1 from supabase_migrations.schema_migrations
                     where version = '20260914120000')
      then 'UWAGA: funkcje S-11 sa, ale wersja nie jest zabukowana — rejestr rozjechany ze stanem.'
    else 'OK — mozna wklejac krok 1'
  end                                                                   as werdykt;

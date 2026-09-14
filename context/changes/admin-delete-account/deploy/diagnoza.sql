-- DIAGNOZA — SZESC KOLUMN, ZEBY MIESCILY SIE NA EKRANIE. Czyta, nie zmienia nic.
--
-- PO CO OSOBNY PLIK: `0-rozpoznanie.sql` i `2-kontrola.sql` zwracaja jeden wiersz
-- o kilkudziesieciu kolumnach. W edytorze SQL dostawcy widac wtedy skrajna prawa
-- strone, czyli sam werdykt — a tozsamosc srodowiska stoi po LEWEJ i wypada poza
-- ekran. Werdykt bez tozsamosci nie jest dowodem (`lessons.md`), wiec potrzebny
-- byl odczyt, ktorego nie trzeba przewijac.
--
-- CO ROZSTRZYGA: w kroku 1 funkcja i wpis w rejestrze sa w JEDNEJ transakcji,
-- wiec zyja albo gina razem. Rozjazd miedzy `s12_w_rejestrze` a `jest_usuwanie`
-- znaczy, ze wklejony zostal fragment pliku, a nie calosc.

select
  coalesce(host(inet_server_addr())::text, 'socket lokalny')                as serwer,
  (select count(*) from auth.users where deleted_at is null)                as kont,
  (select count(*) from public.generations)                                 as generacji,
  exists(select 1 from supabase_migrations.schema_migrations
          where version = '20260914160000')                                 as s12_w_rejestrze,
  (to_regprocedure('public.delete_account(uuid,boolean)') is not null)      as jest_usuwanie,
  (to_regprocedure('public.active_admin_count()') is not null)              as jest_licznik;

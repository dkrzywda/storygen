-- Test bramki, blokowania i kolumny `is_blocked` (S-11, FR-016).
--
-- DLACZEGO W SQL, A NIE W VITEST — jak przy S-10: zbudowanie sesji ADMINA przez
-- klienta JS wymaga zapisu do `auth.users`, na co klucz publishable prawa nie ma,
-- a klucz `service_role` odrzuca straznik w kazdym zestawie integracyjnym.
-- Podszywanie sie przez `request.jwt.claims` jest wlasciwym mechanizmem: `auth.uid()`
-- czyta dokladnie to ustawienie, wiec test mierzy bramke BEZPOSREDNIO.
--
-- JAK URUCHOMIC:
--
--   docker exec -i $(docker ps --filter name=supabase_db --format "{{.ID}}") \
--     psql -U postgres -d postgres -f - < context/changes/admin-block-account/test-set-account-blocked.sql
--
-- TYLKO LOKALNIE. Konczy sie `rollback`-iem, bo nie wolno mu zostawic wierszy
-- w `auth.users`. Nie uruchamiaj w edytorze SQL dostawcy — tam ostatnia instrukcja
-- nie zwraca wyniku, wiec nie zobaczysz werdyktu.
--
-- NUMERY LICZONE, NIE WPISANE. Werdykt pilnuje LACZNEJ liczby przypadkow, wiec
-- blok przerwany w polowie czerwieni sie zamiast cicho zglosic komplet zielonych.

begin;

create temporary table wynik (
  nr integer, przypadek text, oczekiwano text, otrzymano text
);

do $test$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';  -- administrator
  b uuid := '22222222-2222-2222-2222-222222222222';  -- konto bez roli
  c uuid := '33333333-3333-3333-3333-333333333333';  -- drugi administrator
  brak uuid := '99999999-9999-9999-9999-999999999999';
  r text;
  n integer := 0;
begin
  -- UWAGA: kolumna `role` ponizej to rola BAZODANOWA dla PostgREST i musi zostac
  -- `authenticated`. Rola aplikacyjna mieszka w `raw_app_meta_data->>'role'`.
  insert into auth.users (id, email, raw_app_meta_data, created_at, updated_at, aud, role)
  values
    (a, 's11-admin@example.test',  '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
    (b, 's11-user@example.test',   '{"provider":"email","providers":["email"]}'::jsonb,                now(), now(), 'authenticated', 'authenticated'),
    (c, 's11-admin2@example.test', '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, now(), now(), 'authenticated', 'authenticated');

  -- ========================================================================
  --  BRAMKA. Konto bez roli probuje zablokowac administratora, z jawna zgoda —
  --  wiec gdyby bramka nie dzialala, zapis by przeszedl.
  -- ========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);

  r := public.set_account_blocked(a, true, true);
  n := n + 1; insert into wynik values (n, 'nie-admin dostaje odmowe', 'FORBIDDEN', r);
  n := n + 1; insert into wynik values (n, 'stan celu NIETKNIETY po odmowie', 'aktywne',
    (select case when u.banned_until is not null and u.banned_until > now() then 'zablokowane' else 'aktywne' end
       from auth.users u where u.id = a));

  -- ========================================================================
  --  SCIEZKA POZYTYWNA. Administrator blokuje konto bez roli.
  -- ========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);

  r := public.set_account_blocked(b, true, false);
  n := n + 1; insert into wynik values (n, 'admin blokuje konto', 'ok', r);
  n := n + 1; insert into wynik values (n, 'cel faktycznie zablokowany', 'zablokowane',
    (select case when u.banned_until > now() then 'zablokowane' else 'aktywne' end from auth.users u where u.id = b));
  n := n + 1; insert into wynik values (n, 'przeglad: is_blocked celu', 'true',
    (select ao.is_blocked::text from public.accounts_overview() ao where ao.id = b));

  -- ========================================================================
  --  ZAPIS NIE RUSZA NICZEGO POZA `banned_until` — ustalenie F2 przegladu S-10
  --  przeniesione tutaj. Kolumna `role` to rola bazodanowa PostgREST; jej zmiana
  --  wywrocilaby autoryzacje calej aplikacji, cicho.
  -- ========================================================================
  n := n + 1; insert into wynik values (n, 'kolumna auth.users.role NIETKNIETA', 'authenticated',
    (select u.role::text from auth.users u where u.id = b));
  n := n + 1; insert into wynik values (n, 'rola aplikacyjna celu NIETKNIETA', 'user',
    (select coalesce(u.raw_app_meta_data->>'role','user') from auth.users u where u.id = b));
  n := n + 1; insert into wynik values (n, 'klucz provider przezyl', 'email',
    (select u.raw_app_meta_data->>'provider' from auth.users u where u.id = b));

  -- ========================================================================
  --  ODBLOKOWANIE nie pyta nigdy.
  -- ========================================================================
  r := public.set_account_blocked(b, false, false);
  n := n + 1; insert into wynik values (n, 'odblokowanie bez zgody przechodzi', 'ok', r);
  n := n + 1; insert into wynik values (n, 'banned_until wyczyszczone', 'null',
    (select coalesce(u.banned_until::text, 'null') from auth.users u where u.id = b));
  n := n + 1; insert into wynik values (n, 'przeglad: is_blocked po odblokowaniu', 'false',
    (select ao.is_blocked::text from public.accounts_overview() ao where ao.id = b));

  -- ========================================================================
  --  PRZYPADEK ROZNICUJACY: `banned_until` W PRZESZLOSCI.
  --
  --  To jest sedno ostrzezenia z naglowka migracji. Wartosc jest NIEPUSTA, wiec
  --  sprawdzenie `is not null` dalo by tu `true` — a konto jest AKTYWNE.
  --  Bez tego przypadku `is_blocked` liczone obecnoscia wartosci przechodzi
  --  wszystkie pozostale testy na zielono.
  -- ========================================================================
  update auth.users u set banned_until = now() - interval '1 day' where u.id = b;
  n := n + 1; insert into wynik values (n, 'banned_until w przeszlosci jest NIEPUSTE', 'niepuste',
    (select case when u.banned_until is null then 'puste' else 'niepuste' end from auth.users u where u.id = b));
  n := n + 1; insert into wynik values (n, 'przeglad: is_blocked przy dacie PRZESZLEJ', 'false',
    (select ao.is_blocked::text from public.accounts_overview() ao where ao.id = b));
  update auth.users u set banned_until = null where u.id = b;

  -- ========================================================================
  --  DWOCH ADMINOW — zablokowanie jednego z nich NIE wymaga zgody.
  --  Przypadek rozniczujacy do nastepnego: bez niego bramka zwracajaca
  --  LAST_ADMIN_NEEDS_CONFIRM zawsze przeszlaby test ostatniego admina.
  -- ========================================================================
  r := public.set_account_blocked(c, true, false);
  n := n + 1; insert into wynik values (n, 'blokada admina przy dwoch adminach nie pyta', 'ok', r);
  r := public.set_account_blocked(c, false, false);
  n := n + 1; insert into wynik values (n, 'i odblokowanie tez', 'ok', r);

  -- ========================================================================
  --  ZABLOKOWANY ADMINISTRATOR NIE JEST ZABEZPIECZENIEM.
  --
  --  To jest zmierzona dziura opisana w naglowku migracji. Przed `S-11` licznik
  --  pytal "kto MA role", a bramka pyta "kto MOZE dzialac" — wiec zablokowany
  --  administrator byl liczony jako zabezpieczenie, ktorego nie ma, i oba
  --  ponizsze wywolania konczyly sie cichym `ok`, zostawiajac ZERO uzytecznych
  --  administratorow bez jednego ostrzezenia.
  --
  --  Bez tej sekcji `active_admin_count()` liczace WSZYSTKICH przechodzi caly
  --  pozostaly plik na zielono.
  -- ========================================================================
  r := public.set_account_blocked(c, true, false);
  n := n + 1; insert into wynik values (n, 'A blokuje drugiego admina', 'ok', r);

  n := n + 1; insert into wynik values (n, 'A jest teraz OSTATNIM uzytecznym adminem', 'true',
    (select ao.is_last_admin::text from public.accounts_overview() ao where ao.id = a));
  -- Brak FALSZYWEGO OSTRZEZENIA na koncie zablokowanego admina: zdjecie mu roli
  -- nie zabiera nikomu nic, bo on i tak nie przechodzi zadnej bramki.
  n := n + 1; insert into wynik values (n, 'zablokowany admin NIE jest ostatnim', 'false',
    (select ao.is_last_admin::text from public.accounts_overview() ao where ao.id = c));

  r := public.set_account_blocked(a, true, false);
  n := n + 1; insert into wynik values (n, 'blokada SIEBIE, drugi admin zablokowany', 'LAST_ADMIN_NEEDS_CONFIRM', r);
  r := public.set_account_role(a, 'user', false);
  n := n + 1; insert into wynik values (n, 'zdjecie WLASNEJ roli, drugi admin zablokowany', 'LAST_ADMIN_NEEDS_CONFIRM', r);

  -- Druga strona tej samej monety: skutek, ktory NIE nastapi, nie ma o co pytac.
  r := public.set_account_blocked(c, true, false);
  n := n + 1; insert into wynik values (n, 'ponowna blokada zablokowanego nie pyta', 'ok', r);
  r := public.set_account_role(c, 'user', false);
  n := n + 1; insert into wynik values (n, 'zdjecie roli ZABLOKOWANEMU nie pyta', 'ok', r);

  -- Przywracamy drugiego admina do stanu sprzed tej sekcji.
  update auth.users u
     set banned_until = null,
         raw_app_meta_data = u.raw_app_meta_data || '{"role":"admin"}'::jsonb
   where u.id = c;

  -- ========================================================================
  --  OSTATNI ADMINISTRATOR. Zdejmujemy role drugiemu, zeby zostal jeden.
  -- ========================================================================
  update auth.users u set raw_app_meta_data = u.raw_app_meta_data || '{"role":"user"}'::jsonb where u.id = c;

  r := public.set_account_blocked(a, true, false);
  n := n + 1; insert into wynik values (n, 'ostatni admin bez zgody odmawia', 'LAST_ADMIN_NEEDS_CONFIRM', r);
  n := n + 1; insert into wynik values (n, 'stan NIETKNIETY po odmowie', 'aktywne',
    (select case when u.banned_until is not null and u.banned_until > now() then 'zablokowane' else 'aktywne' end
       from auth.users u where u.id = a));

  r := public.set_account_blocked(a, true, true);
  n := n + 1; insert into wynik values (n, 'ostatni admin z jawna zgoda przechodzi', 'ok', r);

  -- ========================================================================
  --  ZABLOKOWANY ADMINISTRATOR NIE PRZECHODZI WLASNEJ BRAMKI.
  --
  --  `lessons.md` § "Funkcja uprzywilejowana filtruje stan konta wolajacego":
  --  "deleted_at, a po S-11 takze stan zablokowania". Bez tego predykatu
  --  zablokowany admin z niewygaslym tokenem odblokowalby sam siebie.
  -- ========================================================================
  r := public.set_account_blocked(b, true, true);
  n := n + 1; insert into wynik values (n, 'zablokowany admin nie zablokuje nikogo', 'FORBIDDEN', r);
  r := public.set_account_blocked(a, false, true);
  n := n + 1; insert into wynik values (n, 'zablokowany admin nie odblokuje SIEBIE', 'FORBIDDEN', r);
  n := n + 1; insert into wynik values (n, 'przeglad zablokowanego admina jest PUSTY', '0',
    (select count(*)::text from public.accounts_overview()));

  -- Przywracamy dostep POZA funkcja — zablokowany admin nie moze zrobic tego sam.
  update auth.users u set banned_until = null where u.id = a;

  -- ========================================================================
  --  WALIDACJA I NIEISTNIEJACY CEL.
  -- ========================================================================
  r := public.set_account_blocked(b, null, false);
  n := n + 1; insert into wynik values (n, 'p_blocked null odrzucone', 'VALIDATION_FAILED', r);

  r := public.set_account_blocked(brak, true, false);
  n := n + 1; insert into wynik values (n, 'nieistniejace konto', 'NOT_FOUND', r);
end;
$test$;

-- `IS DISTINCT FROM`, NIE `<>`. Porownanie z NULL daje NULL, a nie `true`, wiec
-- `count(*) filter (where oczekiwano <> otrzymano)` NIE LICZYLO przypadkow, ktore
-- zwrocily NULL — a zwraca je kazdy odczyt z `accounts_overview()`, gdy bramka
-- odrzuci wolajacego. Zmierzone 2026-09-14 na mutacji: tabela pokazywala 18
-- czerwonych, licznik raportowal 13. Przebieg, w ktorym padlyby WYLACZNIE takie
-- przypadki, dostalby werdykt OK.
select w.nr, w.przypadek, w.oczekiwano, w.otrzymano,
       case when w.oczekiwano is not distinct from w.otrzymano then 'ok' else 'BLAD' end as wynik
from wynik w order by w.nr;

select
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  count(*) as przypadkow,
  count(*) filter (where w.oczekiwano is distinct from w.otrzymano) as bledow,
  case
    when count(*) <> 30 then 'BLAD: wykonalo sie ' || count(*)::text || ' przypadkow, oczekiwano 30'
    when count(*) filter (where w.oczekiwano is distinct from w.otrzymano) > 0 then 'BLAD'
    else 'OK'
  end as werdykt
from wynik w;

rollback;

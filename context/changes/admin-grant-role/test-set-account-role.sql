-- Test bramki i sciezki pozytywnej `set_account_role()` (S-10, FR-018).
--
-- DLACZEGO TEN TEST JEST W SQL, A NIE W VITEST. Zbudowanie sesji ADMINA przez
-- klienta JS wymaga zapisu do `auth.users.raw_app_meta_data`, na co klucz
-- publishable prawa nie ma — a klucz `service_role` odrzuca straznik
-- `assertSafeTestTarget` w kazdym zestawie integracyjnym, bo omija RLS
-- i uniewaznilby to, co te zestawy sprawdzaja. Luka byla opisana w
-- `src/lib/admin-accounts.integration.test.ts:18` juz przy S-09; tutaj zostaje
-- zamknieta narzedziem, ktore jej nie ma.
--
-- PODSZYWANIE SIE PRZEZ `request.jwt.claims` jest tu wlasciwym mechanizmem, nie
-- obejsciem: `auth.uid()` w Supabase czyta dokladnie to ustawienie. Test mierzy
-- wiec bramke BEZPOSREDNIO, bez warstwy SDK posrodku.
--
-- TYLKO LOKALNIE, przez `psql`. W odroznieniu od `verify-grant-role.sql` ten plik
-- KONCZY SIE `rollback`-iem, bo nie wolno mu zostawic wierszy w `auth.users`.
-- Nie uruchamiaj go w edytorze SQL dostawcy: tam ostatnia instrukcja nie zwraca
-- wyniku, wiec nie zobaczysz werdyktu.

begin;

create temporary table wynik (
  nr        integer,
  przypadek text,
  oczekiwano text,
  otrzymano  text
);

do $test$
declare
  -- Stale identyfikatory, zeby wynik byl czytelny przy diagnozie.
  a uuid := '11111111-1111-1111-1111-111111111111';  -- administrator
  b uuid := '22222222-2222-2222-2222-222222222222';  -- konto bez roli
  brak uuid := '33333333-3333-3333-3333-333333333333';  -- konto, ktorego nie ma
  r text;
begin
  -- UWAGA: kolumna `role` ponizej to rola BAZODANOWA dla PostgREST i musi zostac
  -- `authenticated`. Rola aplikacyjna mieszka w `raw_app_meta_data->>'role'`.
  -- Pomylenie tych dwoch pol wywraca autoryzacje calej aplikacji
  -- (`20260908124854:36`).
  insert into auth.users (id, email, raw_app_meta_data, created_at, updated_at, aud, role)
  values
    (a, 's10-admin@example.test',
     '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb,
     now(), now(), 'authenticated', 'authenticated'),
    (b, 's10-user@example.test',
     '{"provider":"email","providers":["email"]}'::jsonb,
     now(), now(), 'authenticated', 'authenticated');

  -- ========================================================================
  --  1-2. BRAMKA. Konto bez roli probuje zdjac role administratorowi,
  --  z jawnym potwierdzeniem — wiec gdyby bramka nie dzialala, zapis by przeszedl.
  -- ========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', b::text, 'role', 'authenticated')::text, true);

  r := public.set_account_role(a, 'user', true);
  insert into wynik values (1, 'nie-admin dostaje odmowe', 'FORBIDDEN', r);
  insert into wynik values (2, 'rola celu NIETKNIETA po odmowie', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = a));

  -- ========================================================================
  --  3-4. SCIEZKA POZYTYWNA. Administrator nadaje role kontu bez roli.
  -- ========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', a::text, 'role', 'authenticated')::text, true);

  r := public.set_account_role(b, 'admin', false);
  insert into wynik values (3, 'admin nadaje role', 'ok', r);
  insert into wynik values (4, 'rola celu zmieniona', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = b));

  -- ========================================================================
  --  5-6. IDEMPOTENCJA i NIENARUSZONE KLUCZE GoTrue. Powtorzenie tej samej roli
  --  konczy sie 'ok'. `provider` musi przezyc scalenie `||` — nadpisanie calego
  --  obiektu zepsuloby logowanie.
  -- ========================================================================
  r := public.set_account_role(b, 'admin', false);
  insert into wynik values (5, 'powtorzenie tej samej roli jest idempotentne', 'ok', r);
  insert into wynik values (6, 'klucz provider przezyl zapis', 'email',
    (select u.raw_app_meta_data->>'provider' from auth.users u where u.id = b));

  -- ========================================================================
  --  7. DWOCH ADMINOW — zdjecie roli jednemu z nich NIE wymaga potwierdzenia.
  --  Ten przypadek odroznia "ostatnia rola" od "jakakolwiek rola": bez niego
  --  bramka zwracajaca LAST_ADMIN_NEEDS_CONFIRM ZAWSZE przeszlaby test 8.
  -- ========================================================================
  r := public.set_account_role(b, 'user', false);
  insert into wynik values (7, 'zdjecie roli przy dwoch adminach nie wymaga zgody', 'ok', r);

  -- ========================================================================
  --  8-9. OSTATNIA ROLA. Zostal jeden administrator i zdejmuje ja SOBIE
  --  (dzialanie na sobie jest dozwolone, PRD v4 OQ9). Bez potwierdzenia: odmowa
  --  i stan nietkniety.
  -- ========================================================================
  r := public.set_account_role(a, 'user', false);
  insert into wynik values (8, 'ostatnia rola bez zgody odmawia', 'LAST_ADMIN_NEEDS_CONFIRM', r);
  insert into wynik values (9, 'rola NIETKNIETA po odmowie ostatniej', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = a));

  -- ========================================================================
  --  10-11. Z JAWNA ZGODA przechodzi i konczy administracje. To jednokierunkowe
  --  drzwi zapisane w PRD v4 przy FR-018.
  -- ========================================================================
  r := public.set_account_role(a, 'user', true);
  insert into wynik values (10, 'ostatnia rola z jawna zgoda przechodzi', 'ok', r);
  insert into wynik values (11, 'liczba adminow po zdjeciu ostatniej', '0',
    (select count(*)::text from auth.users u
      where u.deleted_at is null and u.raw_app_meta_data->>'role' = 'admin'));

  -- ========================================================================
  --  12-13. WALIDACJA WEJSCIA i NIEISTNIEJACY CEL. Sprawdzane z sesji, ktora
  --  ZNOWU ma role — inaczej mierzylibysmy bramke, nie walidacje.
  -- ========================================================================
  update auth.users u
     set raw_app_meta_data = u.raw_app_meta_data || '{"role":"admin"}'::jsonb
   where u.id = a;

  r := public.set_account_role(b, 'superadmin', false);
  insert into wynik values (12, 'rola spoza zbioru odrzucona', 'VALIDATION_FAILED', r);

  r := public.set_account_role(brak, 'admin', false);
  insert into wynik values (13, 'nieistniejace konto', 'NOT_FOUND', r);
end;
$test$;

-- Szczegoly, zeby przy porazce bylo widac KTORY przypadek padl.
select
  w.nr,
  w.przypadek,
  w.oczekiwano,
  w.otrzymano,
  case when w.oczekiwano = w.otrzymano then 'ok' else 'BLAD' end as wynik
from wynik w
order by w.nr;

-- WERDYKT JAKO OSTATNI WYNIK, z tozsamoscia srodowiska w pierwszej kolumnie.
select
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  count(*)                                            as przypadkow,
  count(*) filter (where w.oczekiwano <> w.otrzymano) as bledow,
  case
    when count(*) <> 13 then 'BLAD: wykonalo sie ' || count(*)::text || ' przypadkow, oczekiwano 13'
    when count(*) filter (where w.oczekiwano <> w.otrzymano) > 0 then 'BLAD'
    else 'OK'
  end                                                 as werdykt
from wynik w;

rollback;

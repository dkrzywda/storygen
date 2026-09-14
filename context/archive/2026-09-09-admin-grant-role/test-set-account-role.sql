-- Test bramki, sciezki pozytywnej i kolumn przegladu (S-10, FR-018 i FR-014).
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
-- JAK URUCHOMIC (ustalenie T5 przegladu S-10 — wczesniej nie bylo tu komendy,
-- a zaden runner tego pliku nie wola):
--
--   docker exec -i $(docker ps --filter name=supabase_db --format "{{.ID}}") \
--     psql -U postgres -d postgres -f - < context/changes/admin-grant-role/test-set-account-role.sql
--
-- TYLKO LOKALNIE. W odroznieniu od `verify-grant-role.sql` ten plik KONCZY SIE
-- `rollback`-iem, bo nie wolno mu zostawic wierszy w `auth.users`. Nie uruchamiaj
-- go w edytorze SQL dostawcy: tam ostatnia instrukcja nie zwraca wyniku, wiec nie
-- zobaczysz werdyktu.
--
-- NUMERY PRZYPADKOW SA LICZONE, NIE WPISANE. Recznie wpisany numer wymusza
-- przenumerowanie przy kazdym wstawieniu w srodku, a `S-11` i `S-12` beda ten plik
-- rozszerzac. Werdykt pilnuje LACZNEJ liczby przypadkow, wiec blok przerwany
-- w polowie czerwieni sie zamiast cicho zglosic komplet zielonych.

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
  n integer := 0;

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
  --  BRAMKA. Konto bez roli probuje zdjac role administratorowi, z jawnym
  --  potwierdzeniem — wiec gdyby bramka nie dzialala, zapis by przeszedl.
  -- ========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', b::text, 'role', 'authenticated')::text, true);

  r := public.set_account_role(a, 'user', true);
  n := n + 1; insert into wynik values (n, 'nie-admin dostaje odmowe', 'FORBIDDEN', r);
  n := n + 1; insert into wynik values (n, 'rola celu NIETKNIETA po odmowie', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = a));

  -- ========================================================================
  --  SCIEZKA POZYTYWNA. Administrator nadaje role kontu bez roli.
  -- ========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', a::text, 'role', 'authenticated')::text, true);

  r := public.set_account_role(b, 'admin', false);
  n := n + 1; insert into wynik values (n, 'admin nadaje role', 'ok', r);
  n := n + 1; insert into wynik values (n, 'rola celu zmieniona', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = b));

  -- ========================================================================
  --  KOLUMNA `auth.users.role` NIETKNIETA — ustalenie F2 przegladu S-10.
  --
  --  Repo ostrzega przed pomyleniem tej kolumny z `raw_app_meta_data->>'role'`
  --  w czterech miejscach, a mimo to zaden test jej nie czytal. Gdyby ktos
  --  "uproscil" zapis na `set role = p_role`, autoryzacja PostgREST wywrocilaby
  --  sie w calej aplikacji, a komunikat z innych przypadkow mowilby tylko
  --  "rola sie nie zmienila". Ten przypadek nazywa awarie po imieniu.
  -- ========================================================================
  n := n + 1; insert into wynik values (n, 'kolumna auth.users.role NIETKNIETA', 'authenticated',
    (select u.role::text from auth.users u where u.id = b));

  -- ========================================================================
  --  IDEMPOTENCJA i NIENARUSZONE KLUCZE GoTrue. Powtorzenie tej samej roli
  --  konczy sie 'ok'. `provider` musi przezyc scalenie `||` — nadpisanie calego
  --  obiektu zepsuloby logowanie.
  -- ========================================================================
  r := public.set_account_role(b, 'admin', false);
  n := n + 1; insert into wynik values (n, 'powtorzenie tej samej roli jest idempotentne', 'ok', r);
  n := n + 1; insert into wynik values (n, 'klucz provider przezyl zapis', 'email',
    (select u.raw_app_meta_data->>'provider' from auth.users u where u.id = b));

  -- ========================================================================
  --  KOLUMNY PRZEGLADU przy DWOCH adminach — ustalenie F3 przegladu S-10.
  --
  --  Wczesniej `role`, `is_self` i `is_last_admin` nie byly wykonane przez zaden
  --  test; jedyna kontrola liczyla LICZBE kolumn, wiec `is_last_admin` zwracajace
  --  na sztywno `false` przechodzilo na zielono. `is_last_admin` jest jedyna
  --  podstawa ostrzezenia wymaganego przez FR-018 przed jednokierunkowymi drzwiami.
  -- ========================================================================
  n := n + 1; insert into wynik values (n, 'przeglad: is_last_admin przy DWOCH adminach', 'false',
    (select ao.is_last_admin::text from public.accounts_overview() ao where ao.id = a));
  n := n + 1; insert into wynik values (n, 'przeglad: is_self dla wlasnego wiersza', 'true',
    (select ao.is_self::text from public.accounts_overview() ao where ao.id = a));
  n := n + 1; insert into wynik values (n, 'przeglad: rola celu widoczna', 'admin',
    (select ao.role from public.accounts_overview() ao where ao.id = b));

  -- ========================================================================
  --  DWOCH ADMINOW — zdjecie roli jednemu z nich NIE wymaga potwierdzenia.
  --  Ten przypadek odroznia "ostatnia rola" od "jakakolwiek rola": bez niego
  --  bramka zwracajaca LAST_ADMIN_NEEDS_CONFIRM ZAWSZE przeszlaby przypadek nizej.
  -- ========================================================================
  r := public.set_account_role(b, 'user', false);
  n := n + 1; insert into wynik values (n, 'zdjecie roli przy dwoch adminach nie wymaga zgody', 'ok', r);

  -- PARA ROZNICUJACA do przypadku wyzej: TEN SAM odczyt, inny stan, inna wartosc.
  -- `is_last_admin` zwracajace stala nie przejdzie obu naraz.
  n := n + 1; insert into wynik values (n, 'przeglad: is_last_admin przy JEDNYM adminie', 'true',
    (select ao.is_last_admin::text from public.accounts_overview() ao where ao.id = a));

  -- ========================================================================
  --  OSTATNIA ROLA. Zostal jeden administrator i zdejmuje ja SOBIE (dzialanie
  --  na sobie jest dozwolone, PRD v4 OQ9). Bez potwierdzenia: odmowa i stan
  --  nietkniety.
  -- ========================================================================
  r := public.set_account_role(a, 'user', false);
  n := n + 1; insert into wynik values (n, 'ostatnia rola bez zgody odmawia', 'LAST_ADMIN_NEEDS_CONFIRM', r);
  n := n + 1; insert into wynik values (n, 'rola NIETKNIETA po odmowie ostatniej', 'admin',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = a));

  -- ========================================================================
  --  Z JAWNA ZGODA przechodzi i konczy administracje. To jednokierunkowe drzwi
  --  zapisane w PRD v4 przy FR-018.
  -- ========================================================================
  r := public.set_account_role(a, 'user', true);
  n := n + 1; insert into wynik values (n, 'ostatnia rola z jawna zgoda przechodzi', 'ok', r);
  n := n + 1; insert into wynik values (n, 'liczba adminow po zdjeciu ostatniej', '0',
    (select count(*)::text from auth.users u
      where u.deleted_at is null and u.raw_app_meta_data->>'role' = 'admin'));

  -- ========================================================================
  --  WALIDACJA WEJSCIA i NIEISTNIEJACY CEL. Sprawdzane z sesji, ktora ZNOWU ma
  --  role — inaczej mierzylibysmy bramke, nie walidacje.
  -- ========================================================================
  update auth.users u
     set raw_app_meta_data = u.raw_app_meta_data || '{"role":"admin"}'::jsonb
   where u.id = a;

  r := public.set_account_role(b, 'superadmin', false);
  n := n + 1; insert into wynik values (n, 'rola spoza zbioru odrzucona', 'VALIDATION_FAILED', r);

  r := public.set_account_role(brak, 'admin', false);
  n := n + 1; insert into wynik values (n, 'nieistniejace konto', 'NOT_FOUND', r);

  -- ========================================================================
  --  STAN KONTA WOLAJACEGO — ustalenie F1 przegladu S-10 (2026-09-14).
  --  Administrator zostaje miekko usuniety, ale jego sesja (czyli `auth.uid()`)
  --  zyje dalej, bo tokeny nie wygasaja przy `deleted_at`. Bramka ma go odrzucic
  --  tak samo, jak odrzuca konto bez roli.
  --
  --  PRZYPADEK ROZNICUJACY: bez predykatu `me.deleted_at is null` w bramce oba
  --  ponizsze przypadki przechodza na 'ok' i 'admin', bo rola w `raw_app_meta_data`
  --  pozostaje nietknieta przez miekkie usuniecie. Zmierzone 2026-09-14.
  -- ========================================================================
  update auth.users u set deleted_at = now() where u.id = a;

  r := public.set_account_role(b, 'admin', false);
  n := n + 1; insert into wynik values (n, 'admin miekko usuniety dostaje odmowe', 'FORBIDDEN', r);
  n := n + 1; insert into wynik values (n, 'rola celu NIETKNIETA po odmowie usunietego', 'user',
    (select u.raw_app_meta_data->>'role' from auth.users u where u.id = b));
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
    when count(*) <> 20 then 'BLAD: wykonalo sie ' || count(*)::text || ' przypadkow, oczekiwano 20'
    when count(*) filter (where w.oczekiwano <> w.otrzymano) > 0 then 'BLAD'
    else 'OK'
  end                                                 as werdykt
from wynik w;

rollback;

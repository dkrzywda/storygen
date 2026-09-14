-- Test bramek i skutkow `delete_account` (S-12, FR-017).
--
-- DLACZEGO W SQL, A NIE W VITEST — jak przy S-10 i S-11: zbudowanie sesji ADMINA
-- przez klienta JS wymaga zapisu do `auth.users`, na co klucz publishable prawa
-- nie ma, a klucz `service_role` odrzuca straznik w kazdym zestawie
-- integracyjnym. Podszywanie sie przez `request.jwt.claims` jest wlasciwym
-- mechanizmem: `auth.uid()` czyta dokladnie to ustawienie.
--
-- JAK URUCHOMIC:
--
--   docker exec -i $(docker ps --filter name=supabase_db --format "{{.ID}}") \
--     psql -U postgres -d postgres -f - < context/changes/admin-delete-account/test-delete-account.sql
--
-- TYLKO LOKALNIE. Konczy sie `rollback`-iem, a przy TYM pliku ma to wieksza wage
-- niz zwykle: testuje operacje, ktora naprawde usuwa dane.
--
-- CZEGO TEN PLIK NIE OBEJMUJE: wyscigu dwoch administratorow usuwajacych sie
-- nawzajem. Tamto wymaga DWOCH rownoleglych sesji, wiec mieszka osobno,
-- w `test-wyscig-usuwania.sh`.
--
-- NUMERY LICZONE, NIE WPISANE. Porownania przez `IS DISTINCT FROM`, bo `NULL`
-- w porownaniu nie liczylby sie jako blad.

begin;

create temporary table wynik (
  nr integer, przypadek text, oczekiwano text, otrzymano text
);

do $test$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';  -- administrator wolajacy
  b uuid := '22222222-2222-2222-2222-222222222222';  -- konto bez roli, z generacjami
  c uuid := '33333333-3333-3333-3333-333333333333';  -- drugi administrator
  z uuid := '44444444-4444-4444-4444-444444444444';  -- administrator ZABLOKOWANY
  brak uuid := '99999999-9999-9999-9999-999999999999';
  r record;
  n integer := 0;
  -- LICZBY ADMINISTRATOROW SA WZGLEDNE, NIE BEZWZGLEDNE.
  --
  -- `active_admin_count()` liczy CALA baze, wiec kazdy administrator spoza tego
  -- testu — choćby konto autora na maszynie deweloperskiej — przesuwa wynik.
  -- Pierwsza wersja tego pliku porownywala z `1` i przechodzila wylacznie na
  -- bazie swiezo po `db reset`; przy dwoch kontach lokalnych czerwienila sie bez
  -- zadnej zmiany w kodzie. Test zalezny od stanu, ktorego nie kontroluje, nie
  -- mierzy tego, co obiecuje.
  v_baza integer;
begin
  v_baza := public.active_admin_count();
  -- UWAGA: kolumna `role` ponizej to rola BAZODANOWA dla PostgREST i musi zostac
  -- `authenticated`. Rola aplikacyjna mieszka w `raw_app_meta_data->>'role'`.
  insert into auth.users (id, email, raw_app_meta_data, created_at, updated_at, aud, role, banned_until)
  values
    (a, 's12-admin@example.test',  '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, now(), now(), 'authenticated', 'authenticated', null),
    (b, 's12-user@example.test',   '{"provider":"email","providers":["email"]}'::jsonb,                now(), now(), 'authenticated', 'authenticated', null),
    (c, 's12-admin2@example.test', '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, now(), now(), 'authenticated', 'authenticated', null),
    (z, 's12-zablok@example.test', '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, now(), now(), 'authenticated', 'authenticated', now() + interval '100 years');

  -- Piec generacji i trzy proby na koncie `b` — zeby bylo co zniszczyc.
  insert into public.generations (user_id, topic, format, length_preset, content)
  select b, 'temat ' || i, 'joke', 'short', 'tresc ' || i from generate_series(1,5) i;
  insert into public.generation_attempts (user_id, format, created_at)
  select b, 'joke', now() from generate_series(1,3) i;

  -- ========================================================================
  --  BRAMKA. Konto bez roli probuje usunac administratora, ZE zgoda —
  --  wiec gdyby bramka nie dzialala, konto by zniknelo.
  -- ========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);

  select * into r from public.delete_account(a, true);
  n := n + 1; insert into wynik values (n, 'nie-admin dostaje odmowe', 'FORBIDDEN', r.code);
  n := n + 1; insert into wynik values (n, 'liczba przy odmowie jest zerem', '0', r.destroyed_generations::text);
  n := n + 1; insert into wynik values (n, 'cel NIETKNIETY po odmowie', 'true',
    exists(select 1 from auth.users u where u.id = a)::text);

  -- Zablokowany administrator tez nie przechodzi bramki — `lessons.md`
  -- § "Funkcja uprzywilejowana filtruje stan konta wolajacego".
  perform set_config('request.jwt.claims', json_build_object('sub', z::text, 'role', 'authenticated')::text, true);
  select * into r from public.delete_account(b, true);
  n := n + 1; insert into wynik values (n, 'ZABLOKOWANY admin nie usunie nikogo', 'FORBIDDEN', r.code);

  -- ========================================================================
  --  ZAKAZ USUNIECIA SIEBIE — sedno tego plastra.
  --
  --  Wolany ZE zgoda na zniszczenie, wiec brak potwierdzenia nie tlumaczy
  --  odmowy. To jedyne dzialanie na sobie zabronione w bazie, a nie tylko
  --  w widoku, bo jako jedyne jest nieodwracalne.
  -- ========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);

  select * into r from public.delete_account(a, true);
  n := n + 1; insert into wynik values (n, 'admin NIE usunie siebie mimo zgody', 'SELF_DELETE_FORBIDDEN', r.code);
  n := n + 1; insert into wynik values (n, 'wolajacy nadal istnieje', 'true',
    exists(select 1 from auth.users u where u.id = a)::text);

  -- ========================================================================
  --  ZGODA NA ZNISZCZENIE. Bez niej odmawia TAKZE administratorowi.
  --
  --  To jest to, co czyni guardrail PRD wlasnoscia bazy, a nie uprzejmoscia
  --  interfejsu: wywolanie RPC wprost tez go nie ominie.
  -- ========================================================================
  select * into r from public.delete_account(b, false);
  n := n + 1; insert into wynik values (n, 'bez zgody na zniszczenie odmawia', 'DESTROY_CONFIRM_REQUIRED', r.code);
  n := n + 1; insert into wynik values (n, 'generacje celu NIETKNIETE po odmowie', '5',
    (select count(*)::text from public.generations g where g.user_id = b));
  n := n + 1; insert into wynik values (n, 'cel NIETKNIETY po odmowie', 'true',
    exists(select 1 from auth.users u where u.id = b)::text);

  -- Domyslna wartosc parametru tez odmawia — pominiecie argumentu nie moze
  -- byc rownowazne zgodzie.
  select * into r from public.delete_account(b);
  n := n + 1; insert into wynik values (n, 'pominiety argument zgody tez odmawia', 'DESTROY_CONFIRM_REQUIRED', r.code);

  -- ========================================================================
  --  NIEISTNIEJACY CEL — sprawdzany PO zgodzie, wiec kod mowi o celu.
  -- ========================================================================
  select * into r from public.delete_account(brak, true);
  n := n + 1; insert into wynik values (n, 'nieistniejace konto', 'NOT_FOUND', r.code);

  -- ========================================================================
  --  SCIEZKA POZYTYWNA I ZWROT LICZBY — sedno kontraktu tej funkcji.
  -- ========================================================================
  select * into r from public.delete_account(b, true);
  n := n + 1; insert into wynik values (n, 'admin usuwa konto', 'ok', r.code);
  n := n + 1; insert into wynik values (n, 'zwrocona liczba zniszczonych generacji', '5', r.destroyed_generations::text);
  n := n + 1; insert into wynik values (n, 'konto faktycznie usuniete', 'false',
    exists(select 1 from auth.users u where u.id = b)::text);
  n := n + 1; insert into wynik values (n, 'generacje zniknely (kaskada)', '0',
    (select count(*)::text from public.generations g where g.user_id = b));
  n := n + 1; insert into wynik values (n, 'proby tez zniknely (kaskada)', '0',
    (select count(*)::text from public.generation_attempts g where g.user_id = b));

  -- ========================================================================
  --  KONTO BEZ GENERACJI zwraca zero, a nie NULL.
  -- ========================================================================
  select * into r from public.delete_account(c, true);
  n := n + 1; insert into wynik values (n, 'usuniecie konta bez generacji', 'ok', r.code);
  n := n + 1; insert into wynik values (n, 'liczba dla konta bez generacji to zero', '0', r.destroyed_generations::text);

  -- ========================================================================
  --  USUNIECIE ZABLOKOWANEGO ADMINISTRATORA przechodzi.
  --
  --  Zablokowany nie liczy sie do `active_admin_count()`, wiec jego usuniecie
  --  nie zmniejsza liczby uzytecznych administratorow. Przypadek istnieje, zeby
  --  pokazac, ze blokada nie jest ochrona przed usunieciem.
  -- ========================================================================
  -- Zyja tu: wolajacy `a` (czynny admin) i `z` (admin ZABLOKOWANY). Gdyby
  -- zablokowany byl liczony, wynik bylby o jeden wiekszy.
  n := n + 1; insert into wynik values (n, 'zablokowany admin nie liczy sie do czynnych', (v_baza + 1)::text,
    public.active_admin_count()::text);

  select * into r from public.delete_account(z, true);
  n := n + 1; insert into wynik values (n, 'usuniecie ZABLOKOWANEGO admina przechodzi', 'ok', r.code);
  n := n + 1; insert into wynik values (n, 'po wszystkim zostal tylko wolajacy', (v_baza + 1)::text,
    public.active_admin_count()::text);
end;
$test$;

-- `IS DISTINCT FROM`, NIE `<>`: porownanie z NULL daje NULL, wiec przypadek
-- zwracajacy NULL nie liczylby sie jako blad, choc w tabeli swieci na czerwono.
select w.nr, w.przypadek, w.oczekiwano, w.otrzymano,
       case when w.oczekiwano is not distinct from w.otrzymano then 'ok' else 'BLAD' end as wynik
from wynik w order by w.nr;

select
  coalesce(host(inet_server_addr()), 'socket lokalny') as serwer,
  count(*) as przypadkow,
  count(*) filter (where w.oczekiwano is distinct from w.otrzymano) as bledow,
  case
    when count(*) <> 21 then 'BLAD: wykonalo sie ' || count(*)::text || ' przypadkow, oczekiwano 21'
    when count(*) filter (where w.oczekiwano is distinct from w.otrzymano) > 0 then 'BLAD'
    else 'OK'
  end as werdykt
from wynik w;

rollback;

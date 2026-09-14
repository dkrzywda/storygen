-- Zarzadzanie rola konta (S-10, FR-018).
--
-- PIERWSZY ZAPIS DO `auth.users` Z WNETRZA APLIKACJI. Do dzis jedyny zapis do tej
-- tabeli w repo to jednorazowy seed (`20260908124854`), ktory dopasowywal po adresie
-- i sam nazywal sie seedem, nie mechanizmem. Mechanizm wybrany w tej migracji
-- odziedzicza `S-11` (blokowanie) i `S-12` (usuwanie), wiec jest decyzja calego
-- kamienia `M-3`, nie tego jednego plastra.
--
-- TEN PLIK MUSI ZOSTAC WYKONANY W CALOSCI, JEDNYM WYWOLANIEM — ustalenie F5
-- przegladu S-10. Nie ma tu jawnego `begin`/`commit`, bo `supabase db push` i `db
-- reset` opakowuja plik migracji w transakcje same, a edytor SQL dostawcy wysyla
-- caly skrypt jako jedno zapytanie proste, co Postgres wykonuje jako transakcje
-- niejawna. ZADNE z tych dwoch zachowan nie jest sprawdzane przez repo, wiec
-- zapisuje je tutaj jako wymog, a nie jako zaloze.
--
-- Ryzyko materializuje sie przy wklejeniu skryptu FRAGMENTAMI — np. po bledzie.
-- Wtedy `accounts_overview()` zostaje usuniete bez nastepcy albo, grozniej,
-- utworzone BEZ koncowego bloku `revoke` — czyli z domyslnymi grantami Supabase
-- dla `anon` i `service_role`. Ten drugi przypadek NIE RZUCA BLEDU; wylapie go
-- dopiero `verify-grant-role.sql`.
--
-- UWAGA NA ZBIEZNOSC NAZW — powtarzam ostrzezenie z `20260908124854:36`, bo tutaj
-- kosztuje wiecej: `auth.users` ma TAKZE wlasna KOLUMNE `role` (`character varying`,
-- domyslnie `authenticated`), ktorej PostgREST uzywa jako roli BAZODANOWEJ z tokenu.
-- Ta migracja pisze WYLACZNIE do `raw_app_meta_data->>'role'`. Nie "upraszczaj" tego
-- na `set role = ...`: skladnia jest poprawna, a skutkiem byloby wywrocenie
-- autoryzacji PostgREST w calej aplikacji — cicho, bo zapis nie rzuci bledu.

-- ============================================================================
--  1. PRZEGLAD KONT — cztery nowe kolumny
--
--  `DROP` PRZED `CREATE` JEST WYMUSZONY, NIE STYLISTYCZNY. Zmierzone lokalnie
--  2026-09-09: `create or replace` przy zmienionym typie zwracanym odpowiada
--  `ERROR: cannot change return type of existing function`
--  `HINT: Use DROP FUNCTION accounts_overview() first.`
--
--  Kolejnosc i typy szesciu istniejacych kolumn zostaja NIETKNIETE — nowe ida na
--  koniec. `fetchAccountsOverview` mapuje po nazwach, wiec stary kod czytajacy
--  szesc kolumn dziala z nowa funkcja; to jest wlasnie to, co pozwala zastosowac
--  migracje na produkcji PRZED wdrozeniem Workera.
-- ============================================================================

drop function public.accounts_overview();

create function public.accounts_overview()
returns table (
  email text,
  registered_at timestamptz,
  generations integer,
  used_today integer,
  own_limit integer,
  row_limit integer,
  -- IDENTYFIKATOR CELU. Bez niego nie ma czym zaadresowac konta w `set_account_role`.
  -- Adres e-mail celowo NIE jest selektorem: jest zmienny, jest PII, a PRD rozdziela
  -- adres od roszczenia o uprawnienia.
  id uuid,
  -- `coalesce` na 'user', bo konto bez klucza w `raw_app_meta_data` jest zwyklym
  -- uzytkownikiem — tak samo, jak `isAdmin()` traktuje brak klucza jako `false`.
  role text,
  -- Wlasne konto administratora. Dzialanie na sobie jest DOZWOLONE (PRD v4, OQ9),
  -- ale interfejs musi wiedziec, ze klika w siebie, zeby uczciwie o tym powiedziec.
  is_self boolean,
  -- LICZONE W BAZIE, NIE W WIDOKU — ta sama zasada, ktora ustalenie F3 przegladu
  -- S-09 wymusilo dla `row_limit`: liczba, na ktorej stoi komunikat, musi przyjsc
  -- z tego samego odczytu co dane. Kopia w widoku uciszalaby ostrzezenie przy
  -- kazdej zmianie w SQL-u, BEZ ZADNEGO BLEDU.
  is_last_admin boolean
)
language sql
security definer
set search_path = ''
stable
as $function$
  with cfg as (
    select 200::integer as row_limit
  ),
  day as (
    -- Okno doby przepisane z `usage_today()` (S-04). Podwojne `at time zone`
    -- daje lokalna polnoc poprawna wobec czasu letniego, a nie polnoc UTC.
    select
      (date_trunc('day', now() at time zone 'Europe/Warsaw'))
        at time zone 'Europe/Warsaw' as starts_at,
      (date_trunc('day', now() at time zone 'Europe/Warsaw') + interval '1 day')
        at time zone 'Europe/Warsaw' as ends_at
  ),
  admins as (
    -- Raz na wywolanie, nie raz na wiersz. Przy sufcie 200 wierszy roznica jest
    -- nieistotna, ale skorelowane podzapytanie w kolumnie bylo by tu bez powodu.
    select count(*)::integer as n
      from auth.users a
     where a.deleted_at is null
       and a.raw_app_meta_data->>'role' = 'admin'
  )
  select
    u.email::text,
    u.created_at,
    (select count(*) from public.generations g where g.user_id = u.id)::integer,
    (
      select count(*)
        from public.generation_attempts a, day
       where a.user_id = u.id
         and a.created_at >= day.starts_at
         and a.created_at <  day.ends_at
    )::integer,
    public.daily_per_account(),
    cfg.row_limit,
    u.id,
    coalesce(u.raw_app_meta_data->>'role', 'user')::text,
    (u.id = auth.uid()),
    (coalesce(u.raw_app_meta_data->>'role', 'user') = 'admin' and admins.n = 1)
  from auth.users u, cfg, admins
  -- ==========================================================================
  --  BRAMKA. Rola czytana Z BAZY dla `auth.uid()`, NIE z tokenu.
  --
  --  Zmierzone 2026-09-08: `auth.jwt() #>> '{app_metadata,role}'` zwraca NULL
  --  dla tokenu wystawionego PRZED nadaniem roli, bo claimy zamarzaja w chwili
  --  wystawienia. Ta bramka dziala dla sesji dowolnego wieku.
  --
  --  ZWROT ZERA WIERSZY, NIE WYJATKU (FR-015): pusty zbior jest nieodroznialny
  --  od "brak kont", wiec nie ujawnia, ze przeglad istnieje.
  -- ==========================================================================
  where
    -- KONTA USUNIETE MIEKKO POZA PRZEGLADEM — ustalenie F6 przegladu S-09, 2026-09-09.
    -- Ten filtr dotyczy kont LISTOWANYCH (`u`). Stan WOLAJACEGO sprawdza bramka ponizej,
    -- na osobnym aliasie `me`, i sprawdza go tymi SAMYMI predykatami — patrz ustalenie F1
    -- przegladu S-10 (2026-09-14) i `lessons.md` § "Funkcja uprzywilejowana filtruje stan
    -- konta wolajacego, nie tylko celu".
    u.deleted_at is null
    and exists (
      select 1
        from auth.users me
       where me.id = auth.uid()
         -- `deleted_at` WOLAJACEGO — ustalenie F1 przegladu S-10. Bez tego konto
         -- administratora miekko usuniete, ale z niewygaslym tokenem, nadal przechodzi
         -- bramke. Tokeny zyja po `deleted_at`, wiec okno jest realne, nie teoretyczne.
         and me.deleted_at is null
         and me.raw_app_meta_data->>'role' = 'admin'
    )
  order by u.created_at desc
  limit (select row_limit from cfg);
$function$;

comment on function public.accounts_overview() is
  'Przeglad kont dla administratora (FR-014). Zwraca WYLACZNIE liczby i metadane konta, '
  'nigdy tresci generacji — to utrzymuje NFR o izolacji kont nienaruszony. Od S-10 niesie '
  'takze id celu, aktualna role, znacznik wlasnego konta i flage ostatniej roli admina; '
  'wszystkie cztery licza sie w bazie, zeby interfejs nie trzymal ich kopii. Bramka roli '
  'jest w srodku funkcji i czyta auth.users dla auth.uid(), nie token. Konto bez roli '
  'admin dostaje zero wierszy, nie blad (FR-015).';

-- ============================================================================
--  2. ZMIANA ROLI KONTA
--
--  ZWRACA KOD, NIE BOOLEAN I NIE WYJATEK — wzorzec `record_attempt_if_allowed`
--  (`20260907221925:80`). Wolajacy musi wiedziec, KTORA granica zadzialala: brak
--  uprawnien to inna sytuacja niz brak potwierdzenia przy ostatniej roli, i
--  endpoint mapuje je na rozne odpowiedzi.
--
--  VOLATILE, czyli BEZ `stable`. `stable` zabronilby zapisu — i to wlasnie ono
--  czynilo `accounts_overview()` read-only z konstrukcji, a nie z ostroznosci.
-- ============================================================================

create function public.set_account_role(
  p_account uuid,
  p_role text,
  p_confirm_last boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_role text;
  v_admins integer;
begin
  -- BRAMKA PIERWSZA I BEZWARUNKOWA. Przed walidacja wejscia, przed odczytem celu:
  -- konto bez roli nie ma dowiedziec sie niczego, w tym tego, czy `p_account`
  -- istnieje. Endpoint mapuje ten kod na 404, nie 403 (FR-015).
  --
  -- `me.deleted_at is null` — ustalenie F1 przegladu S-10 (2026-09-14). Stan WOLAJACEGO
  -- jest filtrowany tymi samymi predykatami co cel (`:184`) i co konta listowane w
  -- przegladzie. Bez tego konto administratora miekko usuniete, ale z niewygaslym
  -- tokenem, nadaje role `admin` dowolnemu kontu — czyli odtwarza sobie dostep trwale.
  -- Przy `S-11` dojdzie tu warunek na stan zablokowania, z tego samego powodu.
  if not exists (
    select 1
      from auth.users me
     where me.id = auth.uid()
       and me.deleted_at is null
       and me.raw_app_meta_data->>'role' = 'admin'
  ) then
    return 'FORBIDDEN';
  end if;

  -- Zamkniety zbior rol. `p_role` przychodzi z sieci; walidacja jest tu, a nie
  -- tylko w schemacie Zoda, bo funkcje mozna wolac przez PostgREST wprost.
  if p_role is null or p_role not in ('admin', 'user') then
    return 'VALIDATION_FAILED';
  end if;

  -- BLOKADA DORADCZA SERIALIZUJE ODCZYT LICZBY ADMINOW Z ZAPISEM.
  --
  -- CZEGO ONA *NIE* GWARANTUJE — ustalenie F10 przegladu S-10: nie chroni
  -- niezmiennika "istnieje co najmniej jeden admin", bo PRD v4 (OQ9) stan zera
  -- adminow DOPUSZCZA. Gwarantuje trafnosc OSTRZEZENIA — ze `LAST_ADMIN_NEEDS_CONFIRM`
  -- pada dokladnie wtedy, gdy rola faktycznie jest ostatnia.
  --
  -- `S-11` I `S-12` MUSZA WZIAC TEN SAM KLUCZ. Usuniecie konta (`S-12`) doprowadzi
  -- do zera adminow BEZ zadnej zgody, jesli policzy adminow poza ta blokada. Nazwa
  -- klucza jest wezsza niz jego zakres i to jest swiadome: klucz chroni LICZBE
  -- ADMINOW, nie tylko zmiane roli.
  --
  -- Blokada brana jest PO bramce roli, wiec konto bez uprawnien nie zablokuje
  -- niczego. Bez niej dwaj
  -- administratorzy zdejmujacy sobie role rownolegle przy READ COMMITTED obaj
  -- zobacza dwoch adminow, obaj przejda kontrole "to nie ostatnia" i zostanie
  -- zero. Zwalnia sie z koncem transakcji, czyli z koncem tego wywolania; przy
  -- kilku zmianach rol na zycie produktu jej koszt jest zerowy.
  perform pg_advisory_xact_lock(hashtext('account_role_gate'));

  select coalesce(u.raw_app_meta_data->>'role', 'user')
    into v_target_role
    from auth.users u
   where u.id = p_account
     and u.deleted_at is null;

  -- `not found` po `select into` daje NULL, bo `coalesce` dotyczy wartosci w wierszu,
  -- nie braku wiersza. Konto miekko usuniete jest tu nieodroznialne od nieistniejacego
  -- i tak ma byc — przeglad tez go nie pokazuje.
  if v_target_role is null then
    return 'NOT_FOUND';
  end if;

  -- OCHRONA OSTATNIEJ ROLI JEST W BAZIE, NIE W WIDOKU. Ostrzezenie w interfejsie
  -- omijaloby sie wywolaniem RPC wprost — ta sama klasa obejscia, ktora zamknelo
  -- S-09. PRD v4 (OQ9) rozstrzygnal, ze zdjecie ostatniej roli jest DOZWOLONE;
  -- to nie zakaz, tylko wymog jawnej zgody.
  if v_target_role = 'admin' and p_role <> 'admin' then
    select count(*)
      into v_admins
      from auth.users a
     where a.deleted_at is null
       and a.raw_app_meta_data->>'role' = 'admin';

    if v_admins <= 1 and not coalesce(p_confirm_last, false) then
      return 'LAST_ADMIN_NEEDS_CONFIRM';
    end if;
  end if;

  -- SCALENIE `||`, NIE NADPISANIE. GoTrue trzyma w tym polu `provider`
  -- i `providers`; nadpisanie calego obiektu psuje logowanie (`20260908124854:26`).
  --
  -- Zapis jest BEZWARUNKOWY, wiec nadanie roli, ktora konto juz ma, konczy sie
  -- 'ok' i niczego nie zmienia. Idempotencja jest tu celem: podwojne klikniecie
  -- nie ma produkowac falszywego bledu, a dwoch adminow robiacych to samo nie ma
  -- sie scigac o to, kto dostanie blad.
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role)
   where id = p_account
  -- `deleted_at is null` POWTORZONY TU CELOWO — ustalenie F7 przegladu S-10.
  -- Dzis jest zbedny, bo `select ... into` powyzej wyszedlby przez `NOT_FOUND`.
  -- Ale bez niego ochrona zapisu lezy w INNEJ instrukcji niz zapis: zdjecie filtru
  -- z tamtego `select`-a przy `S-11` cicho otworzyloby zapis do kont usunietych.
     and deleted_at is null;

  return 'ok';
end;
$function$;

comment on function public.set_account_role(uuid, text, boolean) is
  'Zmiana roli konta (FR-018, S-10). Bramka roli w srodku funkcji, czytana z auth.users '
  'dla auth.uid(). Zwraca kod: ok / FORBIDDEN / VALIDATION_FAILED / NOT_FOUND / '
  'LAST_ADMIN_NEEDS_CONFIRM. Zdjecie ostatniej roli admina jest dozwolone, ale wymaga '
  'p_confirm_last — ochrona stoi w bazie, bo w widoku omijaloby ja wywolanie RPC wprost. '
  'Pisze WYLACZNIE do raw_app_meta_data, nigdy do kolumny auth.users.role.';

-- ============================================================================
--  3. UPRAWNIENIA
--
--  `DROP FUNCTION` POWYZEJ SKASOWAL GRANTY `accounts_overview()`. Bez ich
--  ponownego nadania funkcja wraca z DOMYSLNYMI grantami Supabase dla `anon`,
--  `authenticated` i `service_role` — czyli z dokladnie ta dziura, ktora
--  migracja `20260907221925:137` musiala latac po dropie `record_attempt`.
--  Pominiecie tego NIE RZUCA BLEDU.
--
--  Lista rol SKOPIOWANA z `20260907221925`, nie odtworzona z pamieci
--  (`lessons.md` § "Nowa funkcja uprzywilejowana kopiuje liste rol"). `revoke
--  ... from public` NIE odbiera prawa `anon` ani `authenticated` — Supabase
--  nadaje im je jawnie przez `alter default privileges`, wiec role trzeba
--  wymienic z nazwy.
--
--  `authenticated` DOSTAJE prawo wykonania celowo, dla obu funkcji: rola admina
--  jest DANYMI w `raw_app_meta_data`, nie rola bazodanowa, wiec nie da sie jej
--  wyrazic grantem. Dlatego bramka jest w srodku funkcji, a nie w uprawnieniach.
-- ============================================================================

revoke execute on function public.accounts_overview() from public, anon, service_role;
grant  execute on function public.accounts_overview() to authenticated;

revoke execute on function public.set_account_role(uuid, text, boolean) from public, anon, service_role;
grant  execute on function public.set_account_role(uuid, text, boolean) to authenticated;

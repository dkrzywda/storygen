-- Blokowanie i odblokowanie konta (S-11, FR-016).
--
-- DOSTAWCA ODMAWIA LOGOWANIA SAM. Zmierzone 2026-09-14 bezposrednim wywolaniem
-- `POST /auth/v1/token` po ustawieniu `banned_until` w przyszlosci: odpowiedz
-- `400`, `{"error_code":"user_banned","msg":"User is banned"}`. Ta migracja nie
-- buduje wiec odmowy — daje tylko sposob, zeby ustawic ten stan z produktu.
--
-- ALE ODMOWA LOGOWANIA NIE KONCZY TRWAJACEJ SESJI. Zmierzone tym samym tokenem,
-- przed i po zablokowaniu: `GET /auth/v1/user` 200 → 200, `rpc/usage_today`
-- 200 → 200. Okno rowna sie zyciu tokenu, zmierzone z `iat`/`exp`: 60 minut.
-- Zamyka je bramka w middleware (faza 2 planu), nie ta migracja.
--
-- `banned_until` TO ZNACZNIK CZASU, NIE FLAGA. Konto z data w PRZESZLOSCI jest
-- aktywne. Kazde sprawdzenie musi porownywac z `now()`; potraktowanie "niepuste
-- = zablokowane" zablokowaloby konta, ktorym blokada minela.
--
-- ============================================================================
--  DLACZEGO TA MIGRACJA DOTYKA TAKZE `set_account_role` Z `S-10`
--
--  Bo `S-10` sama tak zapisala. `20260909121500:185` mowi wprost: "Przy `S-11`
--  dojdzie tu warunek na stan zablokowania, z tego samego powodu". Rozszerzenie
--  bramki o stan zablokowania wolajacego jest wiec domknieciem `S-10`, nie
--  nowym zakresem.
--
--  ZMIERZONA DZIURA, ktora to zamyka (2026-09-14, dwaj administratorzy A i C):
--    1. A blokuje C                                    → `ok`
--    2. A blokuje SIEBIE, bez zgody                    → `ok`   ← cicho
--    3. to samo przez zdjecie wlasnej roli             → `ok`   ← cicho
--    licznik z `S-10` widzial 1 administratora, UZYTECZNYCH bylo 0.
--
--  Przyczyna: licznik pytal "kto MA role", a bramka pyta "kto MOZE dzialac".
--  Zablokowany administrator ma role i dzialac nie moze, wiec byl liczony jako
--  zabezpieczenie, ktorego nie ma — i administracja stawala sie nieosiagalna
--  bez jednego ostrzezenia. To dokladnie ta klasa awarii, ktorej `S-10` broni
--  kodem `LAST_ADMIN_NEEDS_CONFIRM`, i gwarancja opisana przy blokadzie
--  doradczej ("ostrzezenie pada dokladnie wtedy, gdy rola jest ostatnia")
--  przestawala byc prawdziwa.
-- ============================================================================

-- ============================================================================
--  0. LICZNIK UZYTECZNYCH ADMINISTRATOROW
--
--  JEDYNY POWOD, ZEBY TO BYLA FUNKCJA, A NIE POWTORZONY PREDYKAT: po tej
--  migracji ten sam licznik czytaja TRZY funkcje (`accounts_overview`,
--  `set_account_role`, `set_account_blocked`), a `S-12` dolozy czwarta —
--  usuniecie konta. `20260909121500:220` zapisalo ten wymog wprost. Przy dwoch
--  miejscach powtorzenie bylo tansze; przy czterech rozjazd jest kwestia czasu,
--  a rozjazd tutaj nie rzuca bledem — tylko cicho gasi ostrzezenie.
--
--  Bramki wolajacego zostaja ROZPISANE W MIEJSCU, swiadomie. To ustalenie F7
--  przegladu S-10: ochrona ma stac w tej samej instrukcji co rzecz chroniona.
--  Dzielimy niezmiennik liczbowy, nie warunek dostepu.
--
--  BEZ GRANTU DLA KOGOKOLWIEK. Wolaja ja wylacznie funkcje `security definer`
--  nalezace do tego samego wlasciciela, a wlasciciel ma prawo wykonania z
--  definicji. `authenticated` nie ma po co znac liczby administratorow.
-- ============================================================================

create function public.active_admin_count()
returns integer
language sql
security definer
set search_path = ''
stable
as $function$
  select count(*)::integer
    from auth.users a
   where a.deleted_at is null
     -- Te dwa predykaty razem znacza "moze dzialac jako administrator" i sa tym
     -- samym zestawem, ktorym bramki filtruja wolajacego. Rozjechanie ich to
     -- rozjechanie ostrzezenia z rzeczywistoscia.
     and (a.banned_until is null or a.banned_until <= now())
     and a.raw_app_meta_data->>'role' = 'admin';
$function$;

comment on function public.active_admin_count() is
  'Liczba kont, ktore MOGA dzialac jako administrator: rola admin, nieusuniete i '
  'niezablokowane. Czytana przez accounts_overview, set_account_role i set_account_blocked, '
  'zawsze pod blokada doradcza account_role_gate. Nie liczy kont zablokowanych — konto '
  'zablokowane ma role, ale nie przejdzie zadnej bramki, wiec jako zabezpieczenie nie istnieje.';

-- ============================================================================
--  1. PRZEGLAD KONT — kolumna `is_blocked`
--
--  `DROP` PRZED `CREATE` JEST WYMUSZONY: typ zwracany sie zmienia, a
--  `create or replace` odpowiada wtedy `cannot change return type of existing
--  function` (zmierzone przy S-10).
--
--  TEN PLIK MUSI ZOSTAC WYKONANY W CALOSCI, JEDNYM WYWOLANIEM. Wklejony
--  fragmentami zostawi funkcje BEZ koncowego `revoke`, czyli z domyslnymi
--  grantami Supabase dla `anon` i `service_role` — i NIE RZUCI PRZY TYM BLEDU.
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
  -- IDENTYFIKATOR CELU. Bez niego nie ma czym zaadresowac konta w `set_account_role`
  -- ani w `set_account_blocked`. Adres e-mail celowo NIE jest selektorem: jest zmienny,
  -- jest PII, a PRD rozdziela adres od roszczenia o uprawnienia.
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
  is_last_admin boolean,
  -- STAN BLOKADY. Porownanie z `now()`, nie sprawdzenie `is not null` — patrz
  -- ostrzezenie w naglowku. Konto z `banned_until` w przeszlosci jest aktywne.
  is_blocked boolean
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
    -- Raz na wywolanie, nie raz na wiersz.
    select public.active_admin_count() as n
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
    -- OSTATNIA ROLA LICZONA OD KONT UZYTECZNYCH, PO OBU STRONACH.
    --
    -- Sam warunek "ma role i adminow jest jeden" dawal FALSZYWE OSTRZEZENIE na
    -- koncie ZABLOKOWANEGO administratora: zdjecie mu roli nie zabiera nikomu
    -- nic, bo on i tak nie przechodzi zadnej bramki. Wiersz musi wiec sam byc
    -- administratorem UZYTECZNYM, zeby jego rola mogla byc ta ostatnia.
    (
      coalesce(u.raw_app_meta_data->>'role', 'user') = 'admin'
      and (u.banned_until is null or u.banned_until <= now())
      and admins.n = 1
    ),
    (u.banned_until is not null and u.banned_until > now())
  from auth.users u, cfg, admins
  where
    -- KONTA USUNIETE MIEKKO POZA PRZEGLADEM — ustalenie F6 przegladu S-09.
    -- Ten filtr dotyczy kont LISTOWANYCH (`u`). Stan WOLAJACEGO sprawdza bramka
    -- ponizej, tymi SAMYMI predykatami — ustalenie F1 przegladu S-10 i
    -- `lessons.md` § "Funkcja uprzywilejowana filtruje stan konta wolajacego".
    u.deleted_at is null
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
    and exists (
      select 1
        from auth.users me
       where me.id = auth.uid()
         -- `deleted_at` WOLAJACEGO — ustalenie F1 przegladu S-10. Bez tego konto
         -- administratora miekko usuniete, ale z niewygaslym tokenem, nadal przechodzi
         -- bramke. Tokeny zyja po `deleted_at`, wiec okno jest realne, nie teoretyczne.
         and me.deleted_at is null
         -- STAN ZABLOKOWANIA WOLAJACEGO — wymog zapisany w `lessons.md` przy S-10:
         -- "deleted_at, a po S-11 takze stan zablokowania". Bez tego zablokowany
         -- administrator z niewygaslym tokenem nadal czytalby przeglad kont.
         and (me.banned_until is null or me.banned_until <= now())
         and me.raw_app_meta_data->>'role' = 'admin'
    )
  order by u.created_at desc
  limit (select row_limit from cfg);
$function$;

comment on function public.accounts_overview() is
  'Przeglad kont dla administratora (FR-014). Zwraca WYLACZNIE liczby i metadane konta, '
  'nigdy tresci generacji — to utrzymuje NFR o izolacji kont nienaruszony. Od S-11 niesie '
  'takze is_blocked, liczone przez porownanie banned_until z now() — nie przez sprawdzenie '
  'obecnosci wartosci, bo data w przeszlosci oznacza konto AKTYWNE. Bramka roli jest w srodku '
  'funkcji i czyta auth.users dla auth.uid(), nie token: claimy zamarzaja w chwili wystawienia '
  '(zmierzone 2026-09-08). Konto bez roli admin dostaje zero wierszy, nie blad (FR-015). '
  'is_self, is_last_admin i row_limit licza sie w bazie, zeby interfejs nie trzymal ich kopii.';

-- ============================================================================
--  2. BLOKOWANIE I ODBLOKOWANIE KONTA
--
--  OSOBNA FUNKCJA, nie rozszerzenie `set_account_role`. Jedna funkcja na jedna
--  operacje: kazda ma wlasna bramke i wlasny zestaw kodow, a przeglad S-10
--  pokazal, ze te kody niosa konkretne decyzje, nie ozdobe.
--
--  TEN SAM KLUCZ BLOKADY DORADCZEJ co `set_account_role` — wymog zapisany przy
--  `S-11` w roadmapie (ustalenie F10 przegladu S-10). Klucz chroni LICZBE
--  ADMINISTRATOROW, nie tylko zmiane roli: zablokowanie ostatniego admina poza
--  ta blokada doprowadziloby do zera adminow bez zadnej zgody.
-- ============================================================================

create function public.set_account_blocked(
  p_account uuid,
  p_blocked boolean,
  p_confirm boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_role text;
  v_target_blocked boolean;
  v_admins integer;
begin
  -- BRAMKA PIERWSZA I BEZWARUNKOWA, z `deleted_at` wolajacego (ustalenie F1
  -- przegladu S-10). Konto bez roli nie ma dowiedziec sie niczego, w tym tego,
  -- czy `p_account` istnieje. Endpoint mapuje ten kod na 404, nie 403 (FR-015).
  if not exists (
    select 1
      from auth.users me
     where me.id = auth.uid()
       and me.deleted_at is null
       -- Stan zablokowania wolajacego, z tego samego powodu co wyzej.
       and (me.banned_until is null or me.banned_until <= now())
       and me.raw_app_meta_data->>'role' = 'admin'
  ) then
    return 'FORBIDDEN';
  end if;

  if p_blocked is null then
    return 'VALIDATION_FAILED';
  end if;

  perform pg_advisory_xact_lock(hashtext('account_role_gate'));

  select coalesce(u.raw_app_meta_data->>'role', 'user'),
         (u.banned_until is not null and u.banned_until > now())
    into v_target_role, v_target_blocked
    from auth.users u
   where u.id = p_account
     and u.deleted_at is null;

  if v_target_role is null then
    return 'NOT_FOUND';
  end if;

  -- OCHRONA OSTATNIEGO ADMINISTRATORA.
  --
  -- Dotyczy WYLACZNIE blokowania; odblokowanie nie pyta nigdy, bo nikomu niczego
  -- nie odbiera.
  --
  -- `not v_target_blocked` JEST ISTOTNE, nie kosmetyczne: ponowne zablokowanie
  -- konta juz zablokowanego nie zmienia liczby uzytecznych administratorow o nic,
  -- wiec pytanie o zgode byloby pytaniem o skutek, ktory nie nastapi.
  --
  -- WARTO ZAUWAZYC, ZE TEN PRZYPADEK JEST ZAWSZE "SOBIE". Wolajacy musi byc
  -- adminem UZYTECZNYM, wiec jest liczony; gdy cel jest KIMS INNYM i tez jest
  -- uzytecznym adminem, licznik pokaze co najmniej dwa i warunek nie zadziala.
  -- Ostatni admin, ktorego mozna tu zablokowac, to zawsze konto wolajacego —
  -- dokladnie ta sama obserwacja, co ustalenie F2 przegladu S-10.
  if p_blocked and v_target_role = 'admin' and not v_target_blocked then
    v_admins := public.active_admin_count();

    if v_admins <= 1 and not coalesce(p_confirm, false) then
      return 'LAST_ADMIN_NEEDS_CONFIRM';
    end if;
  end if;

  -- ZAPIS DOTYKA WYLACZNIE `banned_until`. Nie rusza `raw_app_meta_data` ani
  -- kolumny `role` — ta druga jest rola BAZODANOWA dla PostgREST i jej zmiana
  -- wywrocilaby autoryzacje calej aplikacji, cicho (`20260908124854:36`).
  --
  -- Data odlegla zamiast `infinity`: `infinity` jest poprawnym `timestamptz`,
  -- ale nie zmierzylem, jak zachowa sie wobec niej warstwa tozsamosci, a sto lat
  -- zmierzylem — odmowa logowania zadzialala.
  --
  -- `deleted_at is null` POWTORZONY w `update` celowo (ustalenie F7 przegladu
  -- S-10): bez niego ochrona zapisu lezy w innej instrukcji niz zapis.
  update auth.users
     set banned_until = case when p_blocked then now() + interval '100 years' else null end
   where id = p_account
     and deleted_at is null;

  return 'ok';
end;
$function$;

comment on function public.set_account_blocked(uuid, boolean, boolean) is
  'Blokowanie i odblokowanie konta (FR-016, S-11). Ustawia auth.users.banned_until, na ktorym '
  'dostawca opiera wlasna odmowe logowania (zmierzone: 400 user_banned). Bramka roli w srodku '
  'funkcji, czytana z auth.users dla auth.uid(). Zwraca kod: ok / FORBIDDEN / VALIDATION_FAILED / '
  'NOT_FOUND / LAST_ADMIN_NEEDS_CONFIRM. Odblokowanie nie wymaga potwierdzenia nigdy. '
  'Dzieli klucz blokady doradczej z set_account_role, bo oba chronia liczbe administratorow.';

-- ============================================================================
--  3. DOMKNIECIE `set_account_role` Z `S-10`
--
--  `CREATE OR REPLACE`, NIE `DROP` + `CREATE`: sygnatura i typ zwracany sie nie
--  zmieniaja, a `replace` ZACHOWUJE granty. Gdyby ktos kiedys zamienil to na
--  `drop`, granty znikna po cichu — dlatego `revoke`/`grant` na koncu pliku
--  wymienia takze te funkcje, mimo ze dzis jest to zapis idempotentny.
--
--  DWIE ZMIANY WOBEC `20260909121500`, obie opisane w naglowku tego pliku:
--    * bramka wolajacego dostaje warunek na `banned_until` (zapowiedziane w :185),
--    * licznik adminow idzie przez `active_admin_count()`, czyli pomija konta
--      zablokowane — i pyta o zgode tylko wtedy, gdy cel sam jest uzytecznym
--      administratorem.
--  Poza nimi cialo i uzasadnienia sa przeniesione: nowa wersja jest odtad kanoniczna,
--  a uzasadnienie, ktorego w niej nie ma, przestalo istniec w projekcie
--  (`lessons.md` § "Funkcja uprzywilejowana filtruje stan konta wolajacego").
--
--  ZDANIE POWYZEJ BRZMIALO WCZESNIEJ "reszta ciala i komentarzy bez zmian" i BYLO
--  NIEPRAWDZIWE — dwa uzasadnienia z naglowka faktycznie wypadly i wrocily dopiero
--  po przegladzie (ustalenie F2 przegladu S-11). Oto one:
--
--  ZWRACA KOD, NIE BOOLEAN I NIE WYJATEK — wzorzec `record_attempt_if_allowed`
--  (`20260907221925:80`). Wolajacy musi wiedziec, KTORA granica zadzialala: brak
--  uprawnien to inna sytuacja niz brak potwierdzenia przy ostatniej roli, i endpoint
--  mapuje je na rozne odpowiedzi. To samo dotyczy `set_account_blocked` powyzej.
--
--  VOLATILE, czyli BEZ `stable`. `stable` zabronilby zapisu — i to wlasnie ono
--  czyni `accounts_overview()` read-only Z KONSTRUKCJI, a nie z ostroznosci.
--  Obie funkcje zapisujace w tym pliku sa volatile z tego samego powodu.
-- ============================================================================

create or replace function public.set_account_role(
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
  v_target_blocked boolean;
  v_admins integer;
begin
  -- BRAMKA PIERWSZA I BEZWARUNKOWA. Przed walidacja wejscia, przed odczytem celu:
  -- konto bez roli nie ma dowiedziec sie niczego, w tym tego, czy `p_account`
  -- istnieje. Endpoint mapuje ten kod na 404, nie 403 (FR-015).
  --
  -- `me.deleted_at is null` — ustalenie F1 przegladu S-10 (2026-09-14). Stan WOLAJACEGO
  -- jest filtrowany tymi samymi predykatami co cel i co konta listowane w przegladzie.
  -- Bez tego konto administratora miekko usuniete, ale z niewygaslym tokenem, nadaje
  -- role `admin` dowolnemu kontu — czyli odtwarza sobie dostep trwale.
  if not exists (
    select 1
      from auth.users me
     where me.id = auth.uid()
       and me.deleted_at is null
       -- WARUNEK DOLOZONY PRZEZ `S-11`, zapowiedziany w `20260909121500:185`.
       -- Bez niego zablokowany administrator z niewygaslym tokenem nadal nadaje
       -- i zdejmuje role — czyli blokada nie dotyka tego, po co ja zakladano.
       and (me.banned_until is null or me.banned_until <= now())
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
  -- pada dokladnie wtedy, gdy rola faktycznie jest ostatnia. Wlasnie ta gwarancja
  -- byla nieprawdziwa do `S-11`, gdy licznik liczyl takze adminow zablokowanych.
  --
  -- `S-12` MUSI WZIAC TEN SAM KLUCZ. Usuniecie konta doprowadzi do zera adminow
  -- BEZ zadnej zgody, jesli policzy adminow poza ta blokada. Nazwa klucza jest
  -- wezsza niz jego zakres i to jest swiadome: klucz chroni LICZBE ADMINOW, nie
  -- tylko zmiane roli.
  --
  -- Blokada brana jest PO bramce roli, wiec konto bez uprawnien nie zablokuje
  -- niczego. Bez niej dwaj administratorzy zdejmujacy sobie role rownolegle przy
  -- READ COMMITTED obaj zobacza dwoch adminow, obaj przejda kontrole "to nie
  -- ostatnia" i zostanie zero. Zwalnia sie z koncem transakcji, czyli z koncem
  -- tego wywolania; przy kilku zmianach rol na zycie produktu jej koszt jest zerowy.
  perform pg_advisory_xact_lock(hashtext('account_role_gate'));

  select coalesce(u.raw_app_meta_data->>'role', 'user'),
         (u.banned_until is not null and u.banned_until > now())
    into v_target_role, v_target_blocked
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
  --
  -- `not v_target_blocked` — zdjecie roli kontu ZABLOKOWANEMU nie zmniejsza
  -- liczby uzytecznych administratorow o nic, bo ono i tak nie przechodzi bramki.
  -- Pytanie o zgode byloby tu ostrzezeniem przed skutkiem, ktory nie nastapi.
  if v_target_role = 'admin' and p_role <> 'admin' and not v_target_blocked then
    v_admins := public.active_admin_count();

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
  -- z tamtego `select`-a cicho otworzyloby zapis do kont usunietych.
     and deleted_at is null;

  return 'ok';
end;
$function$;

comment on function public.set_account_role(uuid, text, boolean) is
  'Zmiana roli konta (FR-018, S-10, domkniete w S-11). Bramka roli w srodku funkcji, czytana '
  'z auth.users dla auth.uid(); od S-11 odrzuca takze wolajacego ZABLOKOWANEGO. Zwraca kod: '
  'ok / FORBIDDEN / VALIDATION_FAILED / NOT_FOUND / LAST_ADMIN_NEEDS_CONFIRM. Zdjecie ostatniej '
  'roli admina jest dozwolone, ale wymaga p_confirm_last — ochrona stoi w bazie, bo w widoku '
  'omijaloby ja wywolanie RPC wprost. Ostatnia role liczy active_admin_count(), wiec konta '
  'zablokowane nie udaja zabezpieczenia. Pisze WYLACZNIE do raw_app_meta_data, nigdy do '
  'kolumny auth.users.role.';

-- ============================================================================
--  4. UPRAWNIENIA
--
--  `DROP FUNCTION` powyzej skasowal granty `accounts_overview()`. Bez ich
--  ponownego nadania funkcja wraca z DOMYSLNYMI grantami Supabase dla `anon`,
--  `authenticated` i `service_role`. Pominiecie tego NIE RZUCA BLEDU — wylapie
--  je dopiero skrypt kontrolny.
--
--  Lista rol SKOPIOWANA z `20260909121500`, nie odtworzona z pamieci
--  (`lessons.md` § "Nowa funkcja uprzywilejowana kopiuje liste rol").
--
--  `set_account_role` przeszla przez `create or replace`, wiec jej granty
--  PRZEZYLY — powtarzamy je mimo to, zeby plik nie zalezal od tego, ktora forma
--  `create` zostanie tu uzyta w przyszlosci.
--
--  `active_admin_count()` NIE DOSTAJE GRANTU DLA NIKOGO. Wolaja ja tylko funkcje
--  `security definer` tego samego wlasciciela; `authenticated` nie ma powodu znac
--  liczby administratorow.
-- ============================================================================

revoke execute on function public.active_admin_count() from public, anon, authenticated, service_role;

revoke execute on function public.accounts_overview() from public, anon, service_role;
grant  execute on function public.accounts_overview() to authenticated;

revoke execute on function public.set_account_role(uuid, text, boolean) from public, anon, service_role;
grant  execute on function public.set_account_role(uuid, text, boolean) to authenticated;

revoke execute on function public.set_account_blocked(uuid, boolean, boolean) from public, anon, service_role;
grant  execute on function public.set_account_blocked(uuid, boolean, boolean) to authenticated;

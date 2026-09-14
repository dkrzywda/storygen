-- Usuwanie konta przez administratora (S-12, FR-017).
--
-- TO JEST JEDYNA NIEODWRACALNA OPERACJA W CALYM PRODUKCIE. Wszystko inne, co
-- administrator robi cudzemu kontu, da sie cofnac: role przywroci inny
-- administrator, blokade zdejmie inny administrator. Usuniecia nie cofnie nikt
-- i nie ma poza produktem zadnej sciezki, ktora przywrocilaby generacje.
--
-- DLACZEGO TWARDE `delete`, A NIE `deleted_at`. Zmierzone 2026-09-14: GoTrue
-- NIE ODMAWIA logowania kontu z ustawionym `deleted_at` — wywolanie
-- `POST /auth/v1/token` przed i po ustawieniu kolumny w obu przypadkach wydalo
-- `access_token`. Konto "usuniete" miekko nadal korzystaloby z produktu, mimo ze
-- wszystkie funkcje w tym pliku i w poprzednich filtruja `deleted_at` i uznaja
-- je za nieistniejace. Wariant lagodniejszy jest wiec zamkniety pomiarem,
-- a nie odlozony.
--
-- CO ZNIKA RAZEM Z KONTEM. Dziesiec kluczy obcych wskazuje na `auth.users`
-- i WSZYSTKIE kasuja kaskadowo: osiem wewnetrznych GoTrue (`identities`,
-- `sessions`, `mfa_factors`, `one_time_tokens`, `oauth_authorizations`,
-- `oauth_consents`, `webauthn_challenges`, `webauthn_credentials`) oraz
-- `public.generations` i `public.generation_attempts`. Zmierzone w katalogu bazy,
-- bo osmiu wewnetrznych nie widac w plikach tego repo.
--
-- KASKADA OMIJA RLS i to jest tu istotne, nie techniczne. `generation_attempts`
-- CELOWO nie ma polityki DELETE (`20260907192600:62-66`: "konto NIE MOZE obnizyc
-- wlasnego zuzycia ani skasowac dowodu proby"). Kaskade wykonuje silnik, wiec
-- usuniecie konta robi dokladnie to, czego tamtej tabeli zabroniono — i dlatego
-- dobowy sufit aplikacji (FR-013) przestaje po usunieciu zapisywac to, co
-- aplikacja faktycznie wydala tego dnia. Zmierzone: konto z czterema probami
-- zabralo ze soba cztery z czterech. PRD zapisalo to jako przyjeta konsekwencje
-- przy FR-017; ta migracja jej nie naprawia, tylko wymienia z nazwy.

-- ============================================================================
--  DLACZEGO NIE MA TU OCHRONY OSTATNIEGO ADMINISTRATORA
--
--  Bo w TEJ funkcji jest ona nieosiagalna, i wynika to wprost z zakazu usuwania
--  siebie. Bramka wymaga, zeby wolajacy byl CZYNNYM administratorem, wiec jest
--  liczony przez `active_admin_count()`. Cel nie moze byc wolajacym. Ochrona
--  odpalalaby sie tylko wtedy, gdy cel TEZ jest czynnym administratorem —
--  a wtedy licznik ma co najmniej dwa i warunek "<= 1" nie zachodzi nigdy.
--
--  Przy `S-10` i `S-11` ten sam przypadek byl osiagalny WLASNIE dlatego, ze
--  dzialanie na sobie bylo dozwolone — `20260914120000:276-281` mowi to wprost:
--  "TEN PRZYPADEK JEST ZAWSZE SOBIE". Zakaz z `S-12` go zabija.
--
--  Dlatego nie ma tu ani galezi `LAST_ADMIN_NEEDS_CONFIRM`, ani parametru
--  `p_confirm_last`. Martwa galaz sugerowalaby ochrone, ktorej nie ma, a jej
--  kryterium sukcesu byloby nietestowalne — zadne wejscie nie moglo by go
--  zaczerwienic.
--
--  CO BY JA OZYWILO: dopuszczenie usuwania wlasnego konta. Gdyby ta decyzja
--  kiedykolwiek sie odwrocila, galaz i parametr trzeba przywrocic RAZEM z nia.
-- ============================================================================

create function public.delete_account(
  p_account uuid,
  p_confirm_destroy boolean default false
)
returns table (
  -- `ok` / `FORBIDDEN` / `SELF_DELETE_FORBIDDEN` / `DESTROY_CONFIRM_REQUIRED`
  -- / `NOT_FOUND`.
  code text,
  -- ZWRACANE RAZEM Z KODEM, nie zamiast niego. Liczba z przegladu bywa
  -- nieaktualna — konto moglo generowac miedzy odczytem tabeli a klikinieciem —
  -- a ekran ma powiedziec, co sie STALO, nie co przewidywal. Przy kazdej
  -- odmowie jest zerem.
  destroyed_generations integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_role text;
  v_generations integer;
begin
  -- ==========================================================================
  --  BRAMKA PIERWSZA I BEZWARUNKOWA — te same predykaty co w `S-10` i `S-11`.
  --
  --  Stan WOLAJACEGO filtrowany tak samo jak stan celu: `deleted_at` oraz
  --  `banned_until` porownane z `now()` (`lessons.md` § "Funkcja uprzywilejowana
  --  filtruje stan konta wolajacego, nie tylko celu"). Konto bez roli nie ma
  --  dowiedziec sie niczego, w tym tego, czy `p_account` istnieje — endpoint
  --  mapuje ten kod na 404, nie 403 (FR-015).
  -- ==========================================================================
  if not exists (
    select 1
      from auth.users me
     where me.id = auth.uid()
       and me.deleted_at is null
       and (me.banned_until is null or me.banned_until <= now())
       and me.raw_app_meta_data->>'role' = 'admin'
  ) then
    return query select 'FORBIDDEN'::text, 0;
    return;
  end if;

  -- ==========================================================================
  --  ZAKAZ USUNIECIA SIEBIE — W BAZIE, NIE W WIDOKU.
  --
  --  To jedyne miejsce w tym produkcie, gdzie dzialanie na sobie jest ZABRONIONE,
  --  i rozroznienie jest umyslne. Przy roli (`S-10`) i przy blokadzie (`S-11`)
  --  pytanie o wlasne konto stoi wylacznie w interfejsie, bo skutek jest
  --  ODWRACALNY: inny administrator przywroci role, inny zdejmie blokade.
  --  Tutaj nie ma czego odwracac i nie ma kogo o to poprosic, wiec uprzejmosc
  --  widoku nie wystarcza — sprawdzenie musi przezyc wywolanie RPC wprost.
  --
  --  Sprawdzane PRZED zgoda na zniszczenie, zeby zadna kombinacja zgod nie
  --  otwierala tej sciezki.
  -- ==========================================================================
  if p_account = auth.uid() then
    return query select 'SELF_DELETE_FORBIDDEN'::text, 0;
    return;
  end if;

  -- ==========================================================================
  --  ZGODA NA ZNISZCZENIE JEST PARAMETREM FUNKCJI, NIE STANEM INTERFEJSU.
  --
  --  Guardrail PRD ("nic nie niszczy zapisanych generacji bez uprzedzenia, na
  --  powierzchni produktu") przestaje przez to byc uprzejmoscia widoku i staje
  --  sie wlasnoscia bazy: bez tego parametru odmawia takze administratorowi
  --  wolajacemu przez PostgREST wprost.
  --
  --  ODWROTNA DECYZJA NIZ PRZY BLOKOWANIU SIEBIE W `S-11` i roznica jest
  --  umyslna: tam skutek byl odwracalny, tutaj nie jest przez nikogo.
  -- ==========================================================================
  if not coalesce(p_confirm_destroy, false) then
    return query select 'DESTROY_CONFIRM_REQUIRED'::text, 0;
    return;
  end if;

  -- ==========================================================================
  --  TEN SAM KLUCZ BLOKADY DORADCZEJ co `set_account_role` i `set_account_blocked`.
  --
  --  Wymog zapisany przy `S-12` w roadmapie i powtorzony w `20260914120000:406`:
  --  klucz chroni LICZBE ADMINISTRATOROW, nie tylko zmiane roli. Policzenie
  --  adminow poza nim doprowadziloby do zera adminow bez zadnej zgody.
  --
  --  Brany PO bramce roli, wiec konto bez uprawnien nie zablokuje niczego.
  -- ==========================================================================
  perform pg_advisory_xact_lock(hashtext('account_role_gate'));

  -- ==========================================================================
  --  BRAMKA WOLAJACEGO POWTORZONA PO WZIECIU BLOKADY — DUPLIKACJA SWIADOMA.
  --
  --  Nie upraszczaj tego. Bez tego powtorzenia blokada nie chroni przed jedynym
  --  scenariuszem, ktory w TEJ funkcji prowadzi do zera administratorow.
  --
  --  ZMIERZONE 2026-09-14, dwiema sesjami: administratorzy A i B usuwaja sie
  --  NAWZAJEM. Sesja B przechodzi bramke, gdy A jeszcze istnieje, po czym czeka
  --  na blokade. W tym czasie sesja A usuwa B i zwalnia blokade. Sesja B budzi
  --  sie, ma juz sprawdzona bramke sprzed czekania i usuwa A. Wynik: oba konta
  --  usuniete, zero administratorow, bez niczyjej zgody.
  --
  --  Sprawdzenie stanu wolajacego PRZED blokada zapada na danych sprzed
  --  czekania; dopiero to sprawdzenie czyta swiat po jej otrzymaniu. To ta sama
  --  asymetria, ktora przeglad `S-11` odnotowal jako F8 i przyjal jako niskie
  --  ryzyko — bo tam skutkiem bylo zero adminow ZA ZGODA, dopuszczone przez PRD.
  --  Tutaj skutkiem jest nieodwracalne usuniecie BEZ zgody, wiec ta sama usterka
  --  wazy inaczej.
  --
  --  UWAGA DLA CZYTELNIKA: TO NIE JEST WZORZEC POZOSTALYCH DWOCH FUNKCJI.
  --
  --  `set_account_role` (`20260914120000:381-416`) i `set_account_blocked`
  --  (`:250-263`) biora TEN SAM klucz blokady, ale sprawdzaja wolajacego
  --  WYLACZNIE przed nia. Ta migracja dokladla przeslanke, ktorej wczesniej nie
  --  bylo: wiersz wolajacego moze zostac TWARDO USUNIETY, gdy jego wlasne
  --  zadanie czeka na blokade.
  --
  --  ZMIERZONE 2026-09-14, dwiema sesjami (ustalenie F1 przegladu `S-12`):
  --  sesja A wola `delete_account(B)`, sesja B wola
  --  `set_account_role(A,'user', p_confirm_last := true)` i przechodzi bramke,
  --  gdy jeszcze istnieje. Po commicie A sesja B budzi sie, NIE sprawdza sie
  --  ponownie i zwraca `ok`. Stan koncowy: konto B nie istnieje, rola A zdjeta,
  --  czynnych adminow 3 -> 1. Przy dwoch administratorach bylo by zero.
  --
  --  Naprawa nalezy do OSOBNEJ zmiany: plan `S-12` zapisuje wprost „zadnej
  --  zmiany w `set_account_role` ani `set_account_blocked`", a obie sa juz
  --  wdrozone. Nie kopiuj stad tej bramki w przekonaniu, ze tamte ja maja.
  -- ==========================================================================
  if not exists (
    select 1
      from auth.users me
     where me.id = auth.uid()
       and me.deleted_at is null
       and (me.banned_until is null or me.banned_until <= now())
       and me.raw_app_meta_data->>'role' = 'admin'
  ) then
    return query select 'FORBIDDEN'::text, 0;
    return;
  end if;

  select coalesce(u.raw_app_meta_data->>'role', 'user')
    into v_target_role
    from auth.users u
   where u.id = p_account
     and u.deleted_at is null;

  -- `not found` po `select into` daje NULL, bo `coalesce` dotyczy wartosci
  -- w wierszu, nie braku wiersza. Konto miekko usuniete jest tu nieodroznialne
  -- od nieistniejacego i tak ma byc — przeglad tez go nie pokazuje.
  if v_target_role is null then
    return query select 'NOT_FOUND'::text, 0;
    return;
  end if;

  -- ==========================================================================
  --  LICZENIE PRZED USUNIECIEM — KOLEJNOSC WYMUSZONA, NIE DOWOLNA.
  --
  --  Po kaskadzie nie ma czego liczyc: wiersze `public.generations` tego konta
  --  juz nie istnieja. Ta jedna linia jest jedynym powodem, dla ktorego ekran
  --  moze powiedziec prawde o tym, co zniszczyl.
  -- ==========================================================================
  select count(*)::integer
    into v_generations
    from public.generations g
   where g.user_id = p_account;

  -- ZAPIS. Kaskada zabiera generacje, proby i wszystkie wiersze GoTrue.
  --
  -- `deleted_at is null` POWTORZONY tu celowo (ustalenie F7 przegladu S-10):
  -- bez niego ochrona zapisu lezalaby w innej instrukcji niz zapis.
  delete from auth.users
   where id = p_account
     and deleted_at is null;

  return query select 'ok'::text, v_generations;
end;
$function$;

comment on function public.delete_account(uuid, boolean) is
  'Usuniecie konta przez administratora (FR-017, S-12). JEDYNA NIEODWRACALNA operacja '
  'w produkcie: kaskada kluczy obcych zabiera generacje konta i jego wpisy w liczniku '
  'dobowego sufitu, wiec FR-013 przestaje po usunieciu zapisywac realny wydatek dnia '
  '(konsekwencja przyjeta w PRD przy FR-017). Bramka roli w srodku funkcji, czytana '
  'z auth.users dla auth.uid(). Usuniecie WLASNEGO konta jest zabronione w bazie, nie '
  'tylko w widoku — to jedyne dzialanie na sobie, ktorego nie da sie odwrocic. Bez '
  'p_confirm_destroy odmawia kazdemu, wiec guardrail PRD jest wlasnoscia bazy, nie '
  'uprzejmoscia interfejsu. Zwraca kod ORAZ liczbe zniszczonych generacji, policzona '
  'przed usunieciem. Dzieli klucz blokady doradczej account_role_gate z pozostalymi '
  'funkcjami dzialajacymi na koncie, bo wszystkie chronia liczbe administratorow.';

-- ============================================================================
--  UPRAWNIENIA
--
--  Lista rol SKOPIOWANA z `20260914120000`, nie odtworzona z pamieci
--  (`lessons.md` § "Nowa funkcja uprzywilejowana kopiuje liste rol"). Rola
--  administratora jest DANYMI w `raw_app_meta_data`, nie rola bazodanowa, wiec
--  nie da sie jej wyrazic grantem — dlatego bramka siedzi w srodku funkcji,
--  a `authenticated` dostaje prawo wykonania.
--
--  Ta migracja NICZEGO NIE UPUSZCZA, wiec nie ma tu ryzyka utraty grantow,
--  ktore przy `S-10` i `S-11` wymagalo osobnej uwagi.
--
--  TEN PLIK MUSI ZOSTAC WYKONANY W CALOSCI, JEDNYM WYWOLANIEM. Wklejony
--  fragmentami zostawi funkcje BEZ koncowego `revoke`, czyli z domyslnymi
--  grantami Supabase dla `anon` i `service_role` — i NIE RZUCI PRZY TYM BLEDU.
--  Baner przeniesiony z `20260914120000:89-92`, bo nowy plik ma dokladnie te
--  wlasnosc, a droga wdrozenia jest RECZNA: port 5432 jest odfiltrowany, wiec
--  migracja idzie wklejeniem do edytora SQL dostawcy (ustalenie F8 przegladu
--  `S-12`).
-- ============================================================================

revoke execute on function public.delete_account(uuid, boolean) from public, anon, service_role;
grant  execute on function public.delete_account(uuid, boolean) to authenticated;

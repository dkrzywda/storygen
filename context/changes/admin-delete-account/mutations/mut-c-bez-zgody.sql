-- MUTACJA C — zdjety wymog jawnej zgody na zniszczenie.
-- Zmierzone: czerwieni przypadki 7-10. To ta mutacja pokazuje, ze guardrail PRD
-- jest wlasnoscia bazy, a nie uprzejmoscia interfejsu.
--
-- JAK URUCHOMIC (sklej z testem, w jednej sesji):
--
--   CID=$(docker ps --filter name=supabase_db --format "{{.ID}}")
--   cat context/changes/admin-delete-account/mutations/mut-c-bez-zgody.sql \
--       context/changes/admin-delete-account/test-delete-account.sql \
--     | docker exec -i $CID psql -U postgres -d postgres
--
-- BEZ `commit`. Transakcje zamyka `rollback` na koncu testu, wiec mutacja
-- nigdy nie zostaje w bazie.

begin;

CREATE OR REPLACE FUNCTION public.delete_account(p_account uuid, p_confirm_destroy boolean DEFAULT false)
 RETURNS TABLE(code text, destroyed_generations integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- <<< WYMOG ZGODY USUNIETY >>>

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

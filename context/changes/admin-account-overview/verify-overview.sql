-- Kontrola funkcji `accounts_overview()` (S-09). Uruchom po KAZDEJ aplikacji
-- migracji `*_accounts_overview.sql` — lokalnie i na produkcji.
--
-- ============================================================================
--  TOZSAMOSC SRODOWISKA — I CZEGO SQL NIE POTRAFI, NAZWANE WPROST
-- ============================================================================
-- `current_database()` NIE nadaje sie na te kolumne: zwraca `postgres` i lokalnie,
-- i na produkcyjnym Supabase (ustalenie F1 przegladu F-02, zmierzone 2026-09-08).
--
--   * `inet_server_addr()` odroznia baze LOKALNA od hostowanej: lokalnie PUSTE
--     (gniazdo uniksowe w kontenerze), na instancji hostowanej ma adres.
--   * `konta` i `generacje` sa odciskiem palca do porownania z tym, czego
--     spodziewasz sie w TYM srodowisku.
--   * IDENTYFIKATOR PROJEKTU POTWIERDZ SAM, w adresie okna Studio. Zadna
--     wartosc z SQL-a tego nie zrobi.
--
-- ============================================================================
--  TA KONTROLA KONCZY SIE SELECTEM, NIE COMMITEM — celowo.
-- ============================================================================
-- SQL Editor pokazuje wynik TYLKO ostatniej instrukcji. Skrypt konczacy sie na
-- `commit;` oddaje "Success. No rows returned", co nie odroznia sukcesu od
-- no-opa. Zaplacilismy za to 2026-09-09: migracja F-02 nie nadala roli, a plik
-- pokazal "Success". Widoczny wynik MUSI byc dowodem.

select
  coalesce(inet_server_addr()::text, '(puste — baza lokalna)')                as serwer,
  (select count(*) from auth.users)                                          as konta,
  (select count(*) from public.generations)                                  as generacje,

  -- Funkcja istnieje?
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accounts_overview')          as funkcja,

  -- UPRAWNIENIA — najwazniejsze trzy wiersze tej kontroli. Regres z S-04:
  -- `revoke ... from public` nie odbiera prawa `anon`, wiec bez tego sprawdzenia
  -- niezalogowany moglby wywolac przeglad wszystkich kont.
  has_function_privilege('anon',          'public.accounts_overview()', 'execute') as anon_moze,
  has_function_privilege('authenticated', 'public.accounts_overview()', 'execute') as auth_moze,

  -- Funkcja MUSI byc `security definer` — bez tego `authenticated` nie ma prawa
  -- czytac `auth.users` (zmierzone: `permission denied for table users`).
  (select case when p.prosecdef then 'definer' else 'invoker' end
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accounts_overview')          as tryb,

  case
    when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'accounts_overview') = 0
      then 'BLAD: funkcji nie ma'
    when has_function_privilege('anon', 'public.accounts_overview()', 'execute')
      then 'BLAD: anon moze wykonac — przeglad kont wyciekl niezalogowanym'
    when not has_function_privilege('authenticated', 'public.accounts_overview()', 'execute')
      then 'BLAD: authenticated nie moze wykonac — admin tez nie zobaczy przegladu'
    else 'OK'
  end                                                                        as werdykt;

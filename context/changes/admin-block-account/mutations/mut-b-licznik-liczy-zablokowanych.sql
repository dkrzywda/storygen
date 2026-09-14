-- MUTACJA B — `active_admin_count()` wraca do zachowania sprzed `S-11`.
--
-- PO CO TO ISTNIEJE: to jest odtworzenie ZMIERZONEJ DZIURY, dla ktorej powstala
-- ta funkcja. Licznik pyta tu "kto MA role" zamiast "kto MOZE dzialac", czyli
-- liczy takze administratorow zablokowanych — a taki administrator nie przejdzie
-- zadnej bramki, wiec jako zabezpieczenie nie istnieje. Skutek: administracja
-- staje sie nieosiagalna bez jednego ostrzezenia.
--
-- JAK URUCHOMIC (sklej z testem, w jednej sesji):
--
--   CID=$(docker ps --filter name=supabase_db --format "{{.ID}}")
--   cat context/changes/admin-block-account/mutations/mut-b-licznik-liczy-zablokowanych.sql \
--       context/changes/admin-block-account/test-set-account-blocked.sql \
--     | docker exec -i $CID psql -U postgres -d postgres
--
-- BEZ `commit`. Transakcje zamyka `rollback` na koncu testu.
--
-- ZMIERZONE 2026-09-14: czerwieni 8 z 30, w tym OBA przypadki zmierzonej dziury:
--   19 — blokada SIEBIE, gdy drugi admin jest zablokowany  → `ok` zamiast pytania
--   20 — zdjecie WLASNEJ roli w tej samej sytuacji         → `ok` zamiast pytania
--
-- Przypadek 18 ("zablokowany admin NIE jest ostatnim") zostaje ZIELONY i to jest
-- poprawne: chroni go predykat na wierszu w `accounts_overview()`, nie licznik.
-- Dwa niezalezne zabezpieczenia, dwa niezalezne testy.

begin;

create or replace function public.active_admin_count()
returns integer
language sql
security definer
set search_path = ''
stable
as $function$
  select count(*)::integer
    from auth.users a
   where a.deleted_at is null
     -- <<< USUNIETY PREDYKAT: `and (a.banned_until is null or a.banned_until <= now())` >>>
     and a.raw_app_meta_data->>'role' = 'admin';
$function$;

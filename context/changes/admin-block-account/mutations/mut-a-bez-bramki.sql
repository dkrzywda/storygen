-- MUTACJA A — bramka wolajacego zdjeta z `set_account_blocked`.
--
-- PO CO TO ISTNIEJE: zielony wynik testu jest dowodem tylko wtedy, gdy potrafi
-- sczerwieniec. Ten plik psuje dokladnie jedna rzecz — sprawdzenie, KTO wola —
-- i pozwala zobaczyc, ktore przypadki na to reaguja. Jesli po tej mutacji test
-- nadal jest zielony, to znaczy, ze nie mierzyl bramki.
--
-- JAK URUCHOMIC (sklej z testem, w jednej sesji):
--
--   CID=$(docker ps --filter name=supabase_db --format "{{.ID}}")
--   cat context/changes/admin-block-account/mutations/mut-a-bez-bramki.sql \
--       context/changes/admin-block-account/test-set-account-blocked.sql \
--     | docker exec -i $CID psql -U postgres -d postgres
--
-- BEZ `commit`. Ten plik OTWIERA transakcje, a zamyka ja `rollback` na koncu
-- testu — wiec mutacja nigdy nie zostaje w bazie. Test wypisze wlasne `begin;`
-- jako ostrzezenie "there is already a transaction in progress"; to normalne.
--
-- ZMIERZONE 2026-09-14: czerwieni 18 z 30 przypadkow, w tym wszystkie cztery
-- dotyczace bramki wprost — 1, 2, 26, 27.

begin;

create or replace function public.set_account_blocked(
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
  -- <<< USUNIETA BRAMKA: tu stoi `if not exists (... me.id = auth.uid() ...)`,
  --     ktore zwraca 'FORBIDDEN'. Cala reszta funkcji jest bez zmian. >>>

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

  if p_blocked and v_target_role = 'admin' and not v_target_blocked then
    v_admins := public.active_admin_count();

    if v_admins <= 1 and not coalesce(p_confirm, false) then
      return 'LAST_ADMIN_NEEDS_CONFIRM';
    end if;
  end if;

  update auth.users
     set banned_until = case when p_blocked then now() + interval '100 years' else null end
   where id = p_account
     and deleted_at is null;

  return 'ok';
end;
$function$;

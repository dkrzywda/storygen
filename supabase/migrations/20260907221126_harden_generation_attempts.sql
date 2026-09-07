-- Domkniecie ustalenia F1 z przegladu implementacji `daily-generation-limits`.
--
-- CO BYLO ZLE. Dwie rzeczy, ktore osobno sa niegrozne, a razem daja bezterminowa
-- odmowe uslugi dla calego produktu:
--
--   1. `usage_today()` mialo tylko DOLNA granice doby (`created_at >= starts_at`).
--      CTE liczylo `ends_at` i nikt go nie uzywal, wiec wiersz z data w przyszlosci
--      liczyl sie do "dzisiaj" na zawsze.
--   2. Polityka INSERT pozwalala roli `authenticated` wstawiac wiersze wprost przez
--      PostgREST z DOWOLNYM `created_at` — kolumna miala `default now()`, ale nic
--      tej wartosci nie wymuszalo.
--
-- ZMIERZONE 2026-09-07 (transakcja z rollbackiem, rola `authenticated`): `app_count`
-- 24 → wstawienie wiersza z `created_at = '2030-01-01'` → `app_count` 25, a proba
-- usuniecia go przez samego wstawiajacego dala `DELETE 0`. Trzydziesci takich wstawien
-- z dowolnego konta — a rejestracja jest otwarta z wyboru — blokowalo generowanie
-- WSZYSTKIM kontom bezterminowo, bez zadnego srodka naprawczego w aplikacji: polityki
-- DELETE nie ma, klienta `service_role` projekt swiadomie nie ma.
--
-- Gwarancja kosztu (FR-013) przetrwalaby taki atak — neurony nie sa wydawane.
-- Nie przetrwalaby dostepnosc, ktorej ten plaster mial bronic.

-- 1. Gorna granica doby. `ends_at` bylo liczone i marnowane.
create or replace function public.usage_today()
returns table (own_count integer, app_count integer, resets_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $function$
  with day as (
    select
      (date_trunc('day', now() at time zone 'Europe/Warsaw'))
        at time zone 'Europe/Warsaw' as starts_at,
      (date_trunc('day', now() at time zone 'Europe/Warsaw') + interval '1 day')
        at time zone 'Europe/Warsaw' as ends_at
  )
  select
    (count(a.id) filter (where a.user_id = auth.uid()))::integer,
    (count(a.id))::integer,
    day.ends_at
  from day
  left join public.generation_attempts a
    on a.created_at >= day.starts_at
   and a.created_at < day.ends_at
  group by day.ends_at;
$function$;

-- 2. Zapis proby przechodzi przez funkcje, ktora sama ustawia OBA pola decydujace
--    o tym, komu i kiedy proba sie liczy. Klient podaje wylacznie format — wartosc,
--    ktora nie wplywa ani na liczenie, ani na autoryzacje, a jej poprawnosci pilnuje
--    check constraint tabeli.
--
--    To DRUGI w projekcie wyjatek od RLS i jest waski w ten sam sposob co pierwszy:
--    nie przyjmuje niczego, co moglby wykorzystac wolajacy. `auth.uid()` i `now()`
--    pochodza z serwera, nie z zadania.
create function public.record_attempt(p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'record_attempt() wymaga zalogowanego uzytkownika';
  end if;

  insert into public.generation_attempts (user_id, format, created_at)
  values (auth.uid(), p_format, now());
end;
$function$;

comment on function public.record_attempt(text) is
  'Zapisuje probe generowania dla zalogowanego uzytkownika. Ustawia user_id i created_at po stronie serwera — klient nie moze ich podac. Jedyna droga zapisu do generation_attempts.';

-- 3. Odebranie klientom prawa zapisu wprost do tabeli. Bez tego punkty 1 i 2 sa
--    ozdoba, bo PostgREST nadal wystawialby INSERT z dowolnym `created_at`.
revoke insert on table public.generation_attempts from anon, authenticated;

-- Polityka INSERT ZOSTAJE, mimo ze po odebraniu uprawnienia jest nieosiagalna.
-- Jest teraz druga warstwa: gdyby ktos kiedys przywrocil `grant insert`, polityka
-- nadal nie pozwoli zapisac wiersza na cudze konto. Usuniecie jej zamienialoby
-- ciche przywrocenie uprawnienia w cicha dziure.

revoke execute on function public.record_attempt(text) from public, anon, service_role;
grant execute on function public.record_attempt(text) to authenticated;

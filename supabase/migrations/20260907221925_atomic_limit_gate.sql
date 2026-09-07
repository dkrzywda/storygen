-- Domkniecie ustalenia F2 z przegladu implementacji `daily-generation-limits`.
--
-- CO BYLO ZLE. Bramka czytala liczniki, decydowala w TypeScripcie i dopiero potem
-- zapisywala probe — trzy kroki, dwa obroty do bazy, zero blokady. Plan opisal ten
-- wyscig jako "przekroczenie o jedna pozycje" i to oszacowanie bylo zanizone:
-- przekroczenie ogranicza WSPOLBIEZNOSC, nie liczba 1. Czterdziesci rownoleglych
-- zadan odczytuje `app_count = 0`, wszystkie przechodza bramke i wszystkie wolaja
-- model — dzienny przydzial neuronow, czyli jedyny powod istnienia sufitu, znika
-- w jednej serii.
--
-- CO SIE ZMIENIA. Liczenie, decyzja i zapis wchodza do JEDNEJ funkcji, ktora
-- serializuje sie blokada doradcza. Konsekwencja architektoniczna, ktora trzeba
-- nazwac wprost: **autorytetem limitow staje sie baza, nie TypeScript**. Liczby nie
-- moga byc parametrem funkcji, bo wolajacy podalby wlasne i obszedlby sufit jednym
-- zadaniem do PostgREST — mieszkaja wiec w SQL, a `usage_today()` je zwraca, zeby
-- interfejs czytal te same wartosci, ktore obowiazuja przy zapisie.

-- Jedno miejsce dla obu liczb. Wyprowadzenie 30: darmowy przydzial Workers AI to
-- 10 000 neuronow/dobe, a najgorszy przypadek — samo opowiadanie z jedna ponowna
-- proba — kosztuje ~302 neurony, wiec 30 x 302 ~ 9 060 i miesci sie. 10 na konto
-- oznacza, ze trzy konta wyczerpuja sufit, wiec prog na konto zostaje realna
-- granica sprawiedliwosci przy otwartej rejestracji.
create function public.daily_per_account() returns integer
language sql immutable parallel safe as $function$ select 10 $function$;

create function public.daily_app_ceiling() returns integer
language sql immutable parallel safe as $function$ select 30 $function$;

-- `usage_today()` zwraca teraz takze OBOWIAZUJACE limity. Bez tego interfejs
-- pokazywalby liczby z TypeScriptu, a baza egzekwowala swoje — i rozjazd ujawnilby
-- sie dopiero jako odmowa przy liczniku pokazujacym wolne miejsce.
-- `create or replace` NIE wystarczy: Postgres nie pozwala zmienic typu zwracanego
-- istniejacej funkcji (42P13), a dokladamy dwie kolumny. Trzeba ja usunac i utworzyc
-- od nowa — co kasuje takze uprawnienia, wiec `grant` ponizej nie jest powtorzeniem.
drop function public.usage_today();

create function public.usage_today()
returns table (
  own_count integer,
  app_count integer,
  own_limit integer,
  app_limit integer,
  resets_at timestamptz
)
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
    public.daily_per_account(),
    public.daily_app_ceiling(),
    day.ends_at
  from day
  left join public.generation_attempts a
    on a.created_at >= day.starts_at
   and a.created_at < day.ends_at
  group by day.ends_at;
$function$;

-- Bramka atomowa: policz, zdecyduj, zapisz — w jednej instrukcji.
--
-- BLOKADA DORADCZA JEST TU ISTOTA, nie ostroznoscia. Samo `insert ... where (select
-- count(*)) < N` NIE wystarcza: przy izolacji READ COMMITTED dwie rownolegle
-- instrukcje widza ten sam stan sprzed obu zapisow i obie przechodza. Blokada na
-- stalym kluczu serializuje bramke, a przy 30 generacjach na dobe jej koszt jest
-- zerowy. Zwalnia sie z koncem transakcji, czyli z koncem tego wywolania.
--
-- Zwraca KOD, nie boolean: wolajacy musi wiedziec, KTORA granica zadziala, bo
-- FR-012 i FR-013 wymagaja roznych komunikatow.
create function public.record_attempt_if_allowed(p_format text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_own integer;
  v_app integer;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  if auth.uid() is null then
    raise exception 'record_attempt_if_allowed() wymaga zalogowanego uzytkownika';
  end if;

  perform pg_advisory_xact_lock(hashtext('generation_attempts_gate'));

  v_starts := (date_trunc('day', now() at time zone 'Europe/Warsaw')) at time zone 'Europe/Warsaw';
  v_ends := (date_trunc('day', now() at time zone 'Europe/Warsaw') + interval '1 day')
              at time zone 'Europe/Warsaw';

  select
    count(*) filter (where a.user_id = auth.uid()),
    count(*)
  into v_own, v_app
  from public.generation_attempts a
  where a.created_at >= v_starts and a.created_at < v_ends;

  -- Kolejnosc jak w planie: najpierw wlasny limit. Uzytkownik ma uslyszec o swojej
  -- sytuacji, nie o cudzej.
  if v_own >= public.daily_per_account() then
    return 'DAILY_LIMIT_REACHED';
  end if;

  if v_app >= public.daily_app_ceiling() then
    return 'APP_LIMIT_REACHED';
  end if;

  insert into public.generation_attempts (user_id, format, created_at)
  values (auth.uid(), p_format, now());

  return 'ok';
end;
$function$;

comment on function public.record_attempt_if_allowed(text) is
  'Bramka dziennych limitow (FR-012, FR-013): liczy, decyduje i zapisuje probe w jednej instrukcji, serializowana blokada doradcza. Zwraca ok / DAILY_LIMIT_REACHED / APP_LIMIT_REACHED.';

-- `record_attempt()` MUSI zniknac. Zostawiona obok bramki bylaby jej obejsciem:
-- zapisywala bezwarunkowo, wiec wolana wprost przez PostgREST podnosilaby licznik
-- calej aplikacji bez zadnego sprawdzenia — czyli ta sama odmowa uslugi, ktora
-- zamknelo F1, tylko innymi drzwiami.
drop function public.record_attempt(text);

revoke execute on function public.record_attempt_if_allowed(text) from public, anon, service_role;
grant execute on function public.record_attempt_if_allowed(text) to authenticated;

-- Uprawnienia dla `usage_today()` NADAWANE PONOWNIE, bo `drop function` powyzej je
-- skasowalo. Gdyby ich tu zabraklo, funkcja wrocilaby z domyslnymi grantami Supabase
-- (anon, authenticated, service_role) — czyli z dokladnie ta dziura, ktora zamknelismy
-- w migracji tworzacej tabele.
revoke execute on function public.usage_today() from public, anon, service_role;
grant execute on function public.usage_today() to authenticated;

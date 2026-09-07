-- Tabela zdarzen, na ktorej stoja oba dzienne limity (S-04, FR-012 i FR-013),
-- oraz jedyna w tym projekcie funkcja celowo omijajaca RLS.
--
-- DLACZEGO OSOBNA TABELA, A NIE `count` PO `generations`. Limit ma ograniczac
-- KOSZT, a koszt powstaje przy wywolaniu modelu, nie przy zapisie wyniku.
-- `TOPIC_REJECTED`, `FORMAT_CONTRACT_FAILED`, `GENERATION_TIMEOUT` i nieudany
-- best-effort zapis wydaja neurony i NIE zapisuja nic do `generations` — sufit
-- policzony po zapisanych wierszach przepuscilby dowolna liczbe drogich porazek.
-- Wiersz w tej tabeli powstaje PRZED wywolaniem modelu, wiec proba, ktora padnie,
-- i tak jest policzona.
--
-- RLS jest wlaczony w TEJ SAMEJ migracji co tabela — tak jak w migracji
-- `generations`, zeby nie zostawic okna, w ktorym izolacja kont nie obowiazuje.

create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Format nie bierze udzialu w limicie: sufit neuronowy sam wycenia opowiadanie
  -- ~4,5x drozej niz dowcip, wiec rozroznienie limitu per format jest zbedne
  -- (roadmapa, S-04). Kolumna istnieje dla DIAGNOSTYKI KOSZTU: skoro wiersz nie
  -- trzyma wyniku proby, bez formatu tabela nie odpowie na pytanie "ile kosztowaly
  -- porazki", ktore jest jedyna pozostala droga do tej liczby.
  format text not null,

  created_at timestamptz not null default now(),

  constraint generation_attempts_format_allowed check (format in ('joke', 'story'))
);

comment on table public.generation_attempts is
  'Proby generowania — jeden wiersz na zadanie, wstawiany PRZED wywolaniem modelu. Podstawa dziennego limitu na konto (FR-012) i dziennego sufitu calej aplikacji (FR-013).';
comment on column public.generation_attempts.format is
  'Format zamowionego tekstu. Nie wplywa na limit; sluzy diagnostyce kosztu, bo opowiadanie jest ~4,5x drozsze od dowcipu.';

-- Sufit calej aplikacji czyta "wszystko od lokalnej polnocy" — bez `user_id`.
create index generation_attempts_created_at_idx
  on public.generation_attempts (created_at desc);

-- Wlasne zuzycie czyta "moje od lokalnej polnocy".
create index generation_attempts_user_id_created_at_idx
  on public.generation_attempts (user_id, created_at desc);

alter table public.generation_attempts enable row level security;

-- SELECT — wylacznie wlasne wiersze. Sufit calej aplikacji NIE idzie ta droga,
-- tylko przez `usage_today()` ponizej; zwykly `count` z klienta aplikacji zobaczylby
-- tu tylko wlasne proby i po cichu sklamalby o stanie calej aplikacji.
create policy generation_attempts_select_own
  on public.generation_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT — nie da sie zapisac proby na cudze konto.
create policy generation_attempts_insert_own
  on public.generation_attempts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- BRAK POLITYK UPDATE I DELETE JEST MECHANIZMEM, NIE PRZEOCZENIEM.
-- Dopoki ich nie ma, RLS odrzuca kazda zmiane i kazde usuniecie, wiec konto NIE
-- MOZE obnizyc wlasnego zuzycia ani skasowac dowodu proby. To ta sama logika, ktora
-- w migracji `generations` trzymala usuwanie zamknietym do czasu S-06 — z ta roznica,
-- ze tutaj brak polityki jest stanem docelowym, a nie tymczasowym.

-- Licznik dobowy: trzy liczby i ani jednego wiersza.
--
-- To JEDYNY w projekcie celowy wyjatek od RLS. Izolacja kont stoi na politykach,
-- a FR-013 wymaga policzenia prob WSZYSTKICH kont — czego zadna polityka przepuscic
-- nie moze bez otwarcia dostepu do cudzych danych. Wyjatek jest wiec zamkniety
-- w jednym obiekcie, ktory na zewnatrz oddaje wylacznie skalary: zadnego `id`,
-- zadnego `user_id`, zadnej tresci.
--
-- FUNKCJA NIE MOZE PRZYJMOWAC PARAMETRU. Gdyby granica doby wchodzila argumentem,
-- konto podaloby stara date, dostaloby niski wynik i obeszloby sufit przez publiczne
-- API. Dobe liczy wiec funkcja sama — i to jest jedyne miejsce w produkcie, gdzie
-- ta arytmetyka istnieje.
--
-- PODWOJNE `at time zone` NIE JEST OZDOBA. Pierwsze sprowadza "teraz" do czasu
-- lokalnego, zeby `date_trunc` ucial dobe na LOKALNEJ polnocy; drugie wraca do
-- `timestamptz`, czyli do momentu na osi czasu. Przy tej drodze zmiana czasu daje
-- poprawna dobe 23- lub 25-godzinna bez ani jednej linii kodu na to poswieconej.
--
-- `count(a.id)`, NIE `count(*)`: `left join` daje jeden wiersz takze wtedy, gdy
-- prob nie ma, a `count(*)` policzylby ten sztuczny wiersz jako jedna probe.
create function public.usage_today()
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
  group by day.ends_at;
$function$;

comment on function public.usage_today() is
  'Zuzycie w biezacej dobie (Europe/Warsaw): wlasne, calej aplikacji, oraz moment odnowienia. security definer, bo FR-013 wymaga policzenia prob wszystkich kont; zwraca wylacznie skalary.';

-- ODEBRANIE PUBLIC NIE WYSTARCZA — zmierzone 2026-09-07 na lokalnej bazie.
-- Postgres nadaje EXECUTE roli PUBLIC domyslnie, ale Supabase dokłada do tego TRZY
-- JAWNE GRANTY (`anon`, `authenticated`, `service_role`) przez `alter default
-- privileges` w schemacie `public`. `revoke ... from public` ich nie rusza, wiec po
-- samym tym revoke `has_function_privilege('anon', ...)` nadal zwracalo `true`.
-- Skutek bylby realny: PostgREST wystawia RPC, wiec niezalogowane zadanie na
-- /rest/v1/rpc/usage_today zwrocilo by `app_count`, czyli dzienne zuzycie calej
-- aplikacji bez logowania. Role trzeba wymienic z nazwy.
--
-- `service_role` odebrany razem z `anon`: ten projekt swiadomie nie ma klienta
-- omijajacego RLS (patrz plan, "What We're NOT Doing"), wiec rola, ktora go
-- reprezentuje, nie ma po co wolac licznika.
revoke execute on function public.usage_today() from public, anon, service_role;
grant execute on function public.usage_today() to authenticated;

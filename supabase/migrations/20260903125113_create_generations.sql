-- Pierwsza migracja w tym projekcie. Tworzy tabele przechowujaca generacje
-- uzytkownika wraz z opcjonalnym tytulem nadanym recznie.
--
-- RLS jest wlaczony w TEJ SAMEJ migracji co tabela. Dolozenie polityk osobna
-- migracja zostawiloby okno, w ktorym gwarancja izolacji kont nie obowiazuje,
-- a nic w kodzie by tego nie wykrylo.
--
-- Polityki sa granularne per operacja i per rola, zgodnie z konwencja repo.
-- Polityki DELETE swiadomie nie ma — powstanie razem z S-06, bo uprawnienie
-- pojawia sie razem ze swoja funkcja.
--
-- Zakres: S-08 (annotate-generation). Kolumny topic/format/length_preset/content
-- powstaja tutaj, choc wypelni je dopiero S-01/S-03 — tabela musi miec ksztalt
-- docelowy, zeby S-03 nie musial jej przebudowywac.

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Temat podany przez uzytkownika. Gorna granica lustrzana wobec FR-003.
  topic text not null,
  format text not null,
  length_preset text not null,
  content text not null,

  -- Tytul nadany recznie. NULL oznacza "brak tytulu" — interfejs pokazuje wtedy
  -- poczatek wygenerowanego tekstu. Pusty string NIE jest dozwolony, zeby lista
  -- nie musiala rozrozniac dwoch reprezentacji tego samego stanu.
  title text,

  created_at timestamptz not null default now(),

  constraint generations_topic_length check (char_length(btrim(topic)) between 3 and 80),
  constraint generations_format_allowed check (format in ('joke', 'story')),
  constraint generations_length_allowed check (length_preset in ('short', 'medium', 'long')),
  constraint generations_content_not_blank check (char_length(btrim(content)) > 0),
  constraint generations_title_length check (
    title is null or char_length(btrim(title)) between 1 and 80
  )
);

comment on table public.generations is
  'Wygenerowane teksty nalezace do jednego uzytkownika. Widoczne wylacznie dla wlasciciela (RLS).';
comment on column public.generations.title is
  'Tytul nadany recznie przez uzytkownika. NULL = brak tytulu. Pusty string zabroniony przez constraint.';

-- Historia jest zawsze czytana jako "moje pozycje, od najnowszej".
create index generations_user_id_created_at_idx
  on public.generations (user_id, created_at desc);

alter table public.generations enable row level security;

-- SELECT — wylacznie wlasne wiersze.
create policy generations_select_own
  on public.generations
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT — nie da sie zapisac wiersza na cudze konto.
create policy generations_insert_own
  on public.generations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE — `using` decyduje, ktore wiersze sa widoczne do zmiany, `with check`
-- nie pozwala przepisac wiersza na inne konto w trakcie aktualizacji. Bez tego
-- drugiego wlasciciel moglby podmienic user_id i wypchnac wiersz poza swoj zasieg.
create policy generations_update_own
  on public.generations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Brak polityki DELETE jest zamierzony: dopoki jej nie ma, RLS odrzuca kazde
-- usuniecie. Polityke dodaje S-06 (delete-generation).

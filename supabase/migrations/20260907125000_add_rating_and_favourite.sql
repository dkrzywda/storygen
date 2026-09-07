-- Ocena gwiazdkowa i oznaczenie ulubionego dla zapisanych generacji.
--
-- Zakres: ranking z podzialem na formaty oraz zakladka "Ulubione" w panelu.
--
-- Obie kolumny siedza W WIERSZU generacji, nie w osobnej tabeli. Model dostepu
-- jest plaski — uzytkownik widzi wylacznie swoje wiersze — wiec "ocena uzytkownika
-- X dla generacji Y" nie ma drugiego wymiaru, ktory osobna tabela mialaby obsluzyc.
-- Gdyby kiedys pojawily sie oceny cudzych tekstow, to bedzie inna migracja i inny
-- model dostepu, a nie rozszerzenie tego.
--
-- Nowych polityk RLS NIE dokladamy, i to jest decyzja, nie przeoczenie:
-- `generations_update_own` z migracji 20260903125113 obejmuje kazda kolumne wiersza,
-- wiec ocena i ulubione sa juz ograniczone do wlasciciela. Druga polityka UPDATE
-- tylko POSZERZYLABY dostep — polityki sumuja sie przez OR, nie zaweza.

alter table public.generations
  -- NULL znaczy "nieocenione" i jest stanem domyslnym. Ranking celowo pomija
  -- nieocenione pozycje, wiec brak oceny musi byc odrozniamy od oceny najnizszej.
  add column rating smallint,
  add column is_favourite boolean not null default false;

alter table public.generations
  add constraint generations_rating_range check (rating is null or rating between 1 and 5);

comment on column public.generations.rating is
  'Ocena 1-5 gwiazdek nadana przez wlasciciela. NULL = nieocenione, pozycja nie wchodzi do rankingu.';
comment on column public.generations.is_favourite is
  'Oznaczenie ulubionego przez wlasciciela. Zasila zakladke "Ulubione" w panelu.';

-- Ranking czytany jest jako "moje pozycje danego formatu, od najwyzej ocenionej".
-- Indeks pokrywa dokladnie ten dostep. Warunek `where rating is not null` trzyma go
-- malym: nieocenione pozycje nigdy nie sa przez niego szukane.
create index generations_ranking_idx
  on public.generations (user_id, format, rating desc, created_at desc)
  where rating is not null;

-- Zakladka ulubionych czyta "moje ulubione, od najnowszych".
create index generations_favourites_idx
  on public.generations (user_id, created_at desc)
  where is_favourite;

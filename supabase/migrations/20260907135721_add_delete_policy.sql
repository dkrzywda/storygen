-- Polityka DELETE dla wlasnych generacji.
--
-- Zakres: S-06 (delete-generation), FR-011.
--
-- To NIE jest polityka, ktora powstala przypadkiem — domyka swiadoma luke
-- z migracji 20260903125113. Tamta migracja celowo pominela `delete`, pod zasada,
-- ze uprawnienie pojawia sie razem ze swoja funkcja: dopoki nie bylo czym usuwac,
-- baza odrzucala kazde usuniecie. Plan S-08 mial to nawet jako odhaczone kryterium
-- weryfikacji ("polityki delete nie ma").
--
-- Polityka jest osobna i granularna per operacja oraz per rola, zgodnie z konwencja
-- repo. Polityka `generations_select_own` tego nie pokrywa — RLS nie wnioskuje
-- uprawnienia do usuwania z uprawnienia do odczytu.
--
-- UWAGA DLA CZYTAJACEGO TESTY: `delete ... where` CZYTA wiersze, zanim je usunie,
-- wiec musi spelnic takze polityke SELECT. Skutek praktyczny — rozszerzenie samej
-- tej polityki do `using (true)` NIE zrobi zestawu R-05 czerwonym, bo obce konto
-- nadal blokuje polityka odczytu. Czerwony wynik pojawia sie dopiero przy
-- rozszerzeniu obu. Zmierzone w tym repo 2026-09-03 dla UPDATE; dla DELETE
-- mechanizm jest ten sam.

create policy generations_delete_own
  on public.generations
  for delete
  to authenticated
  using (auth.uid() = user_id);

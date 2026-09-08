-- Nadaje role dwom znanym kontom (F-02, PRD v2 § Access Control).
--
-- DLACZEGO ROLA MIESZKA W `app_metadata`, A NIE W WLASNEJ TABELI:
-- middleware i tak wola `supabase.auth.getUser()` na KAZDYM zadaniu i dostaje
-- `app_metadata` w tej samej odpowiedzi, wiec sprawdzenie roli nie kosztuje ani
-- jednego dodatkowego zapytania. Wlasna tabela kosztowalaby odczyt na kazde
-- zadanie albo funkcje `security definer`, a przy tym dokladalaby nowa polityke
-- RLS — czyli komplikowala dokladnie ten mechanizm, na ktorym stoi izolacja kont.
--
-- DLACZEGO `app_metadata`, A NIE `user_metadata`: `user_metadata` uzytkownik
-- zapisuje sam przez `updateUser`, wiec rola trzymana tam bylaby podrabialna.
-- `app_metadata` jest wylacznie serwerowe. PRD zabrania tego wprost.
--
-- NADANIE PO E-MAILU JEST JEDNORAZOWYM SEEDEM, NIE MECHANIZMEM. Aplikacja nigdy
-- nie wyprowadza roli z adresu przy zadaniu — adres jest danymi od uzytkownika,
-- a traktowanie go jako roszczenia o uprawnienia czyniloby sprawdzenie podrabialnym.

-- Scalenie `||` zachowuje istniejace klucze, ktore GoTrue trzyma w tym polu
-- (`provider`, `providers`). Nadpisanie calego obiektu zepsuloby logowanie.
--
-- `where email = …` nie dopasowuje nic, gdy konta nie ma, i to jest ZAMIERZONE:
-- migracja musi przechodzic na czystej bazie, inaczej `supabase db reset`
-- i testy integracyjne przestaja dzialac. Cena tego wyboru jest realna —
-- cichy no-op objawia sie identycznie jak poprawnie dzialajaca odmowa 404 —
-- i dlatego istnieje `context/changes/account-roles/verify-roles.sql`.

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
 where email = 'dkrzywda@amniscode.pl';

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'user')
 where email = 'damiano.krzywda@gmail.com';

-- UWAGA NA ZBIEZNOSC NAZW — ustalenie F6 przegladu, zmierzone 2026-09-08.
-- `auth.users` ma TAKZE wlasna KOLUMNE `role` (`character varying`, domyslnie
-- `authenticated`), ktorej PostgREST uzywa jako roli BAZODANOWEJ z tokenu JWT.
-- To zupelnie inna rzecz niz `raw_app_meta_data->>'role'`, ktore ustawiamy powyzej.
-- Nie "upraszczaj" tego na `set role = 'admin'`: skladnia jest poprawna, a skutkiem
-- byloby wywrocenie autoryzacji PostgREST w calej aplikacji — cicho, bo nic nie rzuci
-- bledu przy zapisie.

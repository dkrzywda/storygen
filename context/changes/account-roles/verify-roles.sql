-- Kontrola seeda rol (F-02). Uruchom po KAZDEJ aplikacji migracji
-- `*_seed_account_roles.sql` — lokalnie i na produkcji.
--
-- DLACZEGO TO ISTNIEJE, A NIE JEST OPCJONALNE: migracja nadaje role po e-mailu
-- i jest no-opem, gdy konta nie ma. Sekcja administratora po prostu sie nie pojawi,
-- bez zadnego komunikatu — a dla konta bez roli brak sekcji jest stanem POPRAWNYM.
-- To zapytanie jest jedynym sposobem odroznienia "nie mam roli" od "wszystko dziala,
-- nie jestem adminem".
--
-- ============================================================================
--  TOZSAMOSC SRODOWISKA — CZEGO SQL NIE POTRAFI, NAZWANE WPROST
-- ============================================================================
-- Ten skrypt mial wczesniej `current_database()` jako pierwsza kolumne, w imie reguly
-- z `context/foundation/lessons.md` § "Weryfikacja bez tozsamosci srodowiska nie jest
-- dowodem". USTALENIE F1 PRZEGLADU (2026-09-08): ta funkcja zwraca `postgres` I lokalnie,
-- I na produkcyjnym Supabase, wiec spelniala regule literalnie, nie w istocie —
-- nie zapobieglaby incydentowi, na ktory sie powolywala.
--
-- Z samego SQL-a NIE DA SIE jednoznacznie zidentyfikowac projektu Supabase. Ponizej
-- jest wiec tyle, ile SQL daje, i jedna rzecz, ktorej nie da:
--
--   * `inet_server_addr()` rozroznia LOKALNA baze od hostowanej: lokalnie jest PUSTE
--     (polaczenie przez gniazdo uniksowe w kontenerze, zmierzone 2026-09-08),
--     na instancji hostowanej ma adres.
--   * `konta_ogolem` i `najstarsze_konto` sa odciskiem palca do porownania z tym,
--     czego sie spodziewasz w TYM srodowisku.
--   * IDENTYFIKATOR PROJEKTU MUSISZ POTWIERDZIC SAM, w adresie okna Studio.
--     Zadna wartosc dostepna z SQL-a tego nie zrobi. Jesli uruchamiasz to gdzie indziej
--     niz w Studio — potwierdz host, z ktorym rozmawia Twoj klient.
-- ============================================================================

with srodowisko as (
  select
    coalesce(inet_server_addr()::text, '(puste — baza lokalna)') as serwer,
    (select count(*) from auth.users)                            as konta_ogolem,
    (select min(created_at)::date::text from auth.users)         as najstarsze_konto
),
oczekiwane(email, rola) as (
  values ('dkrzywda@amniscode.pl', 'admin'),
         ('damiano.krzywda@gmail.com', 'user')
)
select
  s.serwer,
  s.konta_ogolem,
  s.najstarsze_konto,
  o.email,
  o.rola                                    as oczekiwana_rola,
  u.raw_app_meta_data->>'role'              as faktyczna_rola,
  case
    when u.id is null                                    then 'KONTA NIE MA — seed byl no-opem'
    when u.raw_app_meta_data->>'role' is null            then 'BLAD: konto jest, roli nie ma'
    when u.raw_app_meta_data->>'role' = o.rola           then 'OK'
    else                                                      'BLAD: rola inna niz oczekiwana'
  end                                       as werdykt
from srodowisko s
cross join oczekiwane o
left join auth.users u on u.email = o.email
order by o.email;

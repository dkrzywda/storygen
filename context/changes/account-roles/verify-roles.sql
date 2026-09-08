-- Kontrola seeda rol (F-02). Uruchom po KAZDEJ aplikacji migracji
-- `*_seed_account_roles.sql` — lokalnie i na produkcji.
--
-- DLACZEGO TO ISTNIEJE, A NIE JEST OPCJONALNE: migracja nadaje role po e-mailu
-- i jest no-opem, gdy konta nie ma. Przy odmowie 404 (FR-015) cichy no-op objawia
-- sie DOKLADNIE tak samo jak poprawnie dzialajaca odmowa — administrator zobaczy
-- 404 i przeczyta to jako zepsuta trase, nie jako brak roli. To zapytanie jest
-- jedynym sposobem odroznienia tych dwoch stanow.
--
-- PIERWSZA KOLUMNA TO TOZSAMOSC BAZY i to jest celowe — regula z
-- `context/foundation/lessons.md` § „Weryfikacja bez tozsamosci srodowiska nie jest
-- dowodem". Wynik bez niej nie jest dowodem: 2026-09-08 zestaw trzynastu sprawdzen
-- przeszedl w calosci na innej bazie niz ta, z ktorej czyta produkcja.

with oczekiwane(email, rola) as (
  values ('dkrzywda@amniscode.pl', 'admin'),
         ('damiano.krzywda@gmail.com', 'user')
)
select
  current_database()                        as baza,
  o.email,
  o.rola                                    as oczekiwana_rola,
  u.raw_app_meta_data->>'role'              as faktyczna_rola,
  case
    when u.id is null                                    then 'KONTA NIE MA — seed byl no-opem'
    when u.raw_app_meta_data->>'role' is null            then 'BLAD: konto jest, roli nie ma'
    when u.raw_app_meta_data->>'role' = o.rola           then 'OK'
    else                                                      'BLAD: rola inna niz oczekiwana'
  end                                       as werdykt
from oczekiwane o
left join auth.users u on u.email = o.email
order by o.email;

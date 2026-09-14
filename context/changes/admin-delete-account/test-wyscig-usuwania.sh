#!/usr/bin/env bash
# Wyscig: dwaj administratorzy usuwajacy sie NAWZAJEM (S-12, FR-017).
#
# PO CO OSOBNY PLIK: ten przypadek wymaga DWOCH rownoleglych sesji, wiec nie da
# sie go wyrazic w `test-delete-account.sql`, ktory jest jedna transakcja.
#
# CO MIERZY. Bramka wolajacego w `delete_account` jest POWTORZONA po wzieciu
# blokady doradczej. Bez tego powtorzenia okno wyglada tak:
#
#   Sesja B przechodzi bramke, gdy A jeszcze istnieje, po czym czeka na blokade.
#   W tym czasie sesja A usuwa B i zwalnia blokade. Sesja B budzi sie z bramka
#   sprawdzona SPRZED czekania i usuwa A. Wynik: oba konta usuniete, zero
#   administratorow, bez niczyjej zgody.
#
# Zmierzone 2026-09-14 na wersji BEZ powtorzonej bramki: oba konta znikaly.
# Ten skrypt odtwarza to okno wiernie — sesja 1 trzyma blokade, wiec timing nie
# jest zgadywany — i sprawdza, ze teraz konczy sie odmowa.
#
# TYLKO LOKALNIE. Sprzata po sobie.
#
#   bash context/changes/admin-delete-account/test-wyscig-usuwania.sh

set -u

CID=$(docker ps --filter name=supabase_db --format "{{.ID}}" | head -1)
if [ -z "$CID" ]; then
  echo "ODMOWA: nie znaleziono kontenera bazy. Uruchom 'npx supabase start'." >&2
  exit 1
fi

psql() { docker exec -i "$CID" psql -U postgres -d postgres -tA "$@"; }

# TOZSAMOSC SRODOWISKA JAKO PIERWSZA POZYCJA (`lessons.md` § "Weryfikacja bez
# tozsamosci srodowiska nie jest dowodem").
echo "serwer:    $(psql -c "select coalesce(host(inet_server_addr()),'socket lokalny')")"
echo "kontener:  $CID"
echo

A=aaaaaaaa-0000-0000-0000-00000000000a
B=bbbbbbbb-0000-0000-0000-00000000000b

sprzatnij() {
  psql -c "delete from auth.users where email in ('wyscig-a@example.test','wyscig-b@example.test')" >/dev/null
}
trap sprzatnij EXIT

sprzatnij
psql -c "insert into auth.users (id,email,raw_app_meta_data,created_at,updated_at,aud,role) values
 ('$A','wyscig-a@example.test','{\"provider\":\"email\",\"providers\":[\"email\"],\"role\":\"admin\"}'::jsonb,now(),now(),'authenticated','authenticated'),
 ('$B','wyscig-b@example.test','{\"provider\":\"email\",\"providers\":[\"email\"],\"role\":\"admin\"}'::jsonb,now(),now(),'authenticated','authenticated')" >/dev/null

echo "przygotowano dwoch administratorow, A i B"

# SESJA 1 — bierze blokade, trzyma ja, usuwa A, zwalnia.
docker exec -i "$CID" psql -U postgres -d postgres -tA >/dev/null 2>&1 <<SQL &
begin;
select pg_advisory_xact_lock(hashtext('account_role_gate'));
select pg_sleep(4);
delete from auth.users where id = '$A';
commit;
SQL
S1=$!

sleep 1

# SESJA 2 — wola jako A, celuje w B. Bramke przejdzie, na blokade poczeka,
# a po jej otrzymaniu POWTORZONA bramka ma zobaczyc, ze A juz nie istnieje.
KOD=$(docker exec -i "$CID" psql -U postgres -d postgres -tA <<SQL | tail -1
select set_config('request.jwt.claims', json_build_object('sub','$A','role','authenticated')::text, false);
select code from public.delete_account('$B', true);
SQL
)
wait $S1

A_ZYJE=$(psql -c "select exists(select 1 from auth.users where id='$A')")
B_ZYJE=$(psql -c "select exists(select 1 from auth.users where id='$B')")

echo
echo "sesja 2 (A usuwa B, w tle ktos usuwa A) zwrocila: $KOD"
echo "A istnieje po wszystkim: $A_ZYJE   (A zostal usuniety przez sesje 1 — tak ma byc)"
echo "B istnieje po wszystkim: $B_ZYJE   (B ma PRZEZYC — usuwal go ktos, kogo juz nie bylo)"
echo

# WERDYKT CZYTANY Z WARTOSCI, KTORA ZMIENILABY SIE PRZY PORAZCE: los konta B.
# Sam kod zwrotu nie wystarczy — liczy sie, czy B faktycznie przezyl.
if [ "$KOD" = "FORBIDDEN" ] && [ "$B_ZYJE" = "t" ]; then
  echo "WERDYKT: OK — powtorzona bramka zamknela okno. Usuniety wolajacy niczego nie usuwa."
  exit 0
else
  echo "WERDYKT: BLAD — kod '$KOD', B istnieje '$B_ZYJE'."
  echo "         Jesli B zniknal, dwaj administratorzy moga usunac sie nawzajem"
  echo "         i doprowadzic do zera administratorow bez niczyjej zgody."
  exit 1
fi

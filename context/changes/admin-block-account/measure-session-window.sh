#!/usr/bin/env bash
# Pomiar okna trwajacej sesji po zablokowaniu konta (S-11, FR-016).
#
# PO CO TO ISTNIEJE: plan zapisal jako kryterium fazy 2 "test integracyjny: zywy
# token, ktory przed zablokowaniem czytal dane, po zablokowaniu nie przechodzi".
# Zestaw Vitest tego NIE WYRAZI: zablokowanie konta to zapis do
# `auth.users.banned_until`, na co klucz publishable nie ma prawa, a klucza
# `service_role` straznik odrzuca w kazdym zestawie integracyjnym — i musi
# odrzucac, bo omija RLS. Pomiar zostaje wiec tutaj: poza runnerem, ale
# POWTARZALNIE, a nie jako zdanie w raporcie.
#
# CO DOKLADNIE POKAZUJE — i to jest cala teza fazy 2:
#   dostawca pilnuje DRZWI (odmawia nowego logowania),
#   ale NIE wyrzuca tego, kto jest juz w srodku.
# Dlatego bramka w middleware nie jest ostroznoscia, tylko warunkiem FR-016.
#
# TYLKO LOKALNIE. Sprawdza to jawnie i odmawia uruchomienia gdzie indziej.
#
#   bash context/changes/admin-block-account/measure-session-window.sh

set -u

URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
KEY="${SUPABASE_KEY:-sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH}"

host=$(printf '%s' "$URL" | sed -E 's#^https?://##; s#[:/].*$##')
if [ "$host" != "127.0.0.1" ] && [ "$host" != "localhost" ]; then
  echo "ODMOWA: skrypt zaklada konto i blokuje je. Nielokalny host: $host" >&2
  exit 1
fi
case "$KEY" in
  sb_secret_*|*service_role*)
    echo "ODMOWA: uzyj klucza publishable. Sekretny omija RLS i falszuje pomiar." >&2
    exit 1 ;;
esac

CID=$(docker ps --filter name=supabase_db --format "{{.ID}}" | head -1)
if [ -z "$CID" ]; then
  echo "ODMOWA: nie znaleziono kontenera bazy. Uruchom 'npx supabase start'." >&2
  exit 1
fi

psql() { docker exec -i "$CID" psql -U postgres -d postgres -tA -c "$1"; }

EMAIL="okno-$(date +%s)-$$@example.test"
HASLO="Testowe-haslo-123"

echo "konto testowe: $EMAIL"
echo

# --- 1. Rejestracja i pobranie zywego tokenu ---------------------------------
TOKEN=$(curl -s -X POST "$URL/auth/v1/signup" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$HASLO\"}" \
  | sed -E 's/.*"access_token":"([^"]*)".*/\1/')

if [ -z "$TOKEN" ] || [ ${#TOKEN} -lt 20 ]; then
  echo "ODMOWA: nie dostalem tokenu (dlugosc ${#TOKEN}). Pomiar bylby bezwartosciowy." >&2
  exit 1
fi
echo "token dlugosci ${#TOKEN} — OK"

# Czas zycia tokenu liczony Z SAMEGO TOKENU, nie z dokumentacji — to ta liczba
# mowi, jak dlugie jest okno, ktore zamyka bramka.
#
# `node`, a nie `base64 | bc`: pierwsza wersja tego pomiaru opierala sie na `bc`,
# ktorego w tym srodowisku nie ma — i linia z wynikiem po prostu NIE POJAWIALA SIE
# w wypisie, bez jednego slowa bledu. Pomiar, ktory milczy przy porazce, jest
# gorszy niz jego brak, bo wyglada jak nieistotny.
OKNO=$(printf '%s' "$TOKEN" | node -e '
  const t = require("fs").readFileSync(0, "utf8").trim().split(".")[1];
  const p = JSON.parse(Buffer.from(t, "base64url").toString());
  if (typeof p.iat !== "number" || typeof p.exp !== "number") process.exit(1);
  process.stdout.write(String(p.exp - p.iat));
' 2>/dev/null)

if [ -n "${OKNO:-}" ]; then
  echo "okno tokenu (exp-iat): $((OKNO / 60)) minut"
else
  echo "okno tokenu: NIE UDALO SIE ODCZYTAC z tokenu — reszta pomiaru zostaje wazna"
fi
echo

czytaj() { curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/rest/v1/rpc/usage_today" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'; }

loguj() { curl -s -X POST "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$HASLO\"}"; }

# --- 2. Stan PRZED blokada ---------------------------------------------------
PRZED_RPC=$(czytaj)
PRZED_BAN=$(psql "select coalesce(banned_until::text,'(puste)') from auth.users where email='$EMAIL'")

# --- 3. BLOKADA (tak, jak zrobi to `set_account_blocked`) --------------------
psql "update auth.users set banned_until = now() + interval '100 years' where email='$EMAIL'" >/dev/null

# --- 4. Stan PO blokadzie ----------------------------------------------------
PO_RPC=$(czytaj)
PO_BAN=$(psql "select coalesce(banned_until::text,'(puste)') from auth.users where email='$EMAIL'")
PO_USER=$(curl -s "$URL/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN")
PO_LOGIN=$(loguj)

# --- 5. Sprzatanie -----------------------------------------------------------
psql "delete from auth.users where email='$EMAIL'" >/dev/null

# --- 6. Wynik ----------------------------------------------------------------
echo "                                  PRZED        PO"
echo "rpc/usage_today zywym tokenem     $PRZED_RPC          $PO_RPC"
echo "banned_until w bazie              $PRZED_BAN   $PO_BAN"
echo
echo "GET /auth/v1/user zywym tokenem po blokadzie:"
printf '%s\n' "$PO_USER" | sed -E 's/.*("banned_until":[^,}]*).*/  niesie \1/;t;s/.*/  BRAK pola banned_until w odpowiedzi/'
echo
echo "nowe logowanie po blokadzie:"
printf '%s\n' "$PO_LOGIN" | sed -E 's/.*"error_code":"([^"]*)".*/  odmowa: \1/;t;s/.*"access_token".*/  PRZESZLO — dostawca NIE odmawia/;t;s/.*/  (nierozpoznana odpowiedz)/'
echo
if [ "$PRZED_RPC" = "200" ] && [ "$PO_RPC" = "200" ]; then
  echo "WNIOSEK: zywy token czyta dane ROWNIEZ PO blokadzie."
  echo "         Dostawca zamyka drzwi, ale nie wyrzuca tego, kto jest w srodku."
  echo "         To okno zamyka wylacznie bramka w src/middleware.ts."
else
  echo "UWAGA: PRZED=$PRZED_RPC PO=$PO_RPC — inaczej niz przy pomiarze 2026-09-14 (200/200)."
  echo "       Jesli PO != 200, dostawca zmienil zachowanie i bramke trzeba przemyslec."
fi

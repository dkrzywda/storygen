---
change_id: email-confirmation
title: "Potwierdzanie rejestracji mailem"
status: new
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

Trzeba poprawic rejestracje, uzytkownik musi potwierdzic rejestracje mailowo.

## Rozstrzygniecie 2026-09-07 — brak zmiany do wykonania

Framowanie nie bylo potrzebne: przeslanka okazala sie falszywa. Potwierdzanie
rejestracji mailem **dziala i zostalo przejechane na produkcji** 2026-08-24
(`context/deployment/deploy-plan.md`: rejestracja -> potwierdzenie mailem -> sesja
-> strona chroniona -> wylogowanie).

Lokalnie potwierdzenia sa wylaczone **celowo**: `supabase/config.toml`
(`enable_confirmations = false`), zeby praca w devie nie wymagala skrzynki
pocztowej. `src/pages/auth/confirm-email.astro` obsluguje oba przypadki przez
rozgalezienie na `import.meta.env.DEV`.

Autor potwierdzil: "jesli to dziala to okej". Zmiana zamknieta bez implementacji.

Do archiwizacji przez `/10x-archive email-confirmation`.

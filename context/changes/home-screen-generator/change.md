---
change_id: home-screen-generator
title: "Strona glowna jako generator zamiast landingu startera"
status: implementing
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

**Folder zalozony wstecznie.** Kod wszedl commitem `fa4e5c4` PRZED powstaniem tego
pliku, poza lancuchem `/10x-new` -> `/10x-plan` -> `/10x-implement`. `/10x-new` sluzy
do otwierania zmiany przed praca, wiec nie dalo sie go tu uzyc zgodnie z jego
przeznaczeniem — zapis powstal recznie w tym samym formacie.

Brak pozycji w roadmapie i brak wymagania w PRD. Zmiana usuwa marketingowy landing
`10x-astro-starter` i stawia pod `/` ekran generatora. Uzasadnienie produktowe:
landing opisywal szablon, nie produkt, a PRD mowi, ze kazdy ekran poza rejestracja
i logowaniem wymaga sesji — wiec strona glowna moze byc chroniona.

Decyzje warte pamieci:

1. **Trasa `/` chroniona dokladnym dopasowaniem, nie prefiksem.** Prefiks `/` pasuje
   do kazdej sciezki, w tym `/auth/signin`, co dawaloby nieskonczona petle
   przekierowan. Stad osobna lista `PROTECTED_EXACT` w `src/middleware.ts`.
2. **`Topbar` wciagniety do ekranu generatora.** Istnial WYLACZNIE w usunietym
   `Welcome.astro`; bez przeniesienia zalogowany uzytkownik stracilby wylogowanie
   i cala nawigacje.
3. **`/generate` zostaje** i renderuje ten sam komponent, bo plan `S-01` ma odhaczona
   pozycje weryfikacji "zadanie anonimowe do /generate zwraca przekierowanie".

## Status weryfikacji

Sprawdzone: przekierowania anonima na `/`, `/generate`, `/generations` (302), brak
petli na `/auth/signin` (200), render dla zalogowanego. `npx astro check` bez bledow.

Bez przegladu `/10x-impl-review` — nie ma planu, wobec ktorego mozna by go zrobic.

---
change_id: lighter-theme
title: "Jasny motyw z akcentem morskim i warstwa tokenow"
status: implementing
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

Zmiana kolorystyki na jasna, zamowiona bezposrednio 2026-09-07. Brak pozycji
w roadmapie i brak wymagania w PRD — PRD nie mowi nic o wygladzie poza tym, ze
interfejs jest po polsku.

Wybor autora: jasny motyw (tlo `#f7f8fb`, tekst `#1a1d29`, panele biale z cieniem)
i akcent morski (`#0d9488`).

Decyzje warte pamieci:

1. **Wprowadzona warstwa tokenow semantycznych** w `src/styles/global.css`. Przed ta
   zmiana motyw byl wpisany na sztywno w ~160 klasach Tailwinda w 17 plikach —
   `text-white` (25x), `text-blue-100` (37x), `purple-` (35x) — wiec zmiana kolorow
   byla zmiana w siedemnastu plikach. Teraz jest zmiana w jednym bloku `@theme`.
2. **Token nazywa sie `brand`, nie `accent`.** shadcn ma wlasny `--color-accent`
   (jasnoszary, uzywany przez warianty `ghost` i `outline` w `button.tsx`); kolizja
   przemalowalaby komponenty biblioteki.
3. **`star` i `heart` zostaja zlote i rozowe.** Te dwa kolory niosa znaczenie
   (ocena, ulubione), nie stylistyke, wiec nie zmieniaja sie razem z paleta.
4. **Zmienne shadcn ustawione na te sama palete** (`--background`, `--primary`,
   `--ring`, `--border`). Dotad byly domyslne i nieuzywane przez zaden ekran —
   motyw zyl obok systemu, ktory mial go trzymac.
5. **Biel zachowana tam, gdzie lezy na tle brandowym** — tekst i spinner na
   przyciskach akcji. Mechaniczna podmiana `text-white` -> `text-ink` zepsulaby je.
6. **Usuniete `src/components/ui/LibBadge.astro`** — martwe od usuniecia
   `Welcome.astro`, a jako jedyne trzymalo klasy `bg-blue-900/50` i `bg-purple-500/30`.

## Napotkane przy okazji

`npx eslint --fix` zdjal rzutowania `as ApiErrorBody` i `as ApiSuccessBody<Generation>`
w `TitleEditor.tsx`, po czym sam zglosil bledy `no-unsafe-*` na powstalym `any`.
Przy typach Cloudflare `json<T>()` wnioskuje typ z kontekstu, wiec rzutowanie jest
zbedne — ale bez niego wartosc jest `any`. Rozwiazane adnotacja typu zmiennej,
zgodnie z wzorcem, ktory juz stosuja `GenerateForm.tsx` i `RatingControls.tsx`.

## Status weryfikacji

Sprawdzone w przegladarce: ekran logowania, generator, panel z rankingiem — wszystkie
w nowej palecie, bez bledow w konsoli. Weryfikacja grepem, ze zadna stara klasa
kolorystyczna nie zostala poza `src/components/ui/button.tsx`, ktory uzywa tokenow
shadcn. 164 testy przechodza, `npx astro check` bez bledow.

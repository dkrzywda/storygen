---
change_id: first-joke-generation
title: "Generowanie dowcipu na temat uzytkownika z kopiowaniem wyniku"
status: implementing
created: 2026-09-04
updated: 2026-09-07
archived_at: null
---

## Notes

Roadmap: `context/foundation/roadmap.md` — pozycja **S-01**, gwiazda przewodnia kamienia
milowego M-1. Odblokowana 2026-09-03 decyzja o dostawcy (Cloudflare Workers AI,
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) i domknieciem `F-01`.

Faza 1 jest bramka jakosciowa, nie formalnoscia: jesli model nie utrzyma dowcipu
z puenta w limicie slow po polsku, fazy 2-4 zmieniaja ksztalt. Ten plan zaklada,
ze bramka przejdzie, i mowi wprost, co zrobic, jesli nie przejdzie.

Rozstrzyga tez PRD Open Question #3 (granica "tematu niedozwolonego") na rzecz
polegania na odmowie modelu — bez budowania wlasnej moderacji, ktora Non-Goals wyklucza.

## Stan na 2026-09-07 — praca poza tym planem

Ten plaster jest nadal `implementing`: w planie zostaly niezaznaczone pozycje
weryfikacji recznej (2.4, 3.6-3.10, 4.5-4.10, 5.3-5.4). Tymczasem na jego kodzie
stanely cztery kolejne zmiany, zadna nie przeszla przez `/10x-plan`:

- `polish-auth-surface` (S-02) — `2721cc9`
- `home-screen-generator` — `fa4e5c4`, bez plastra w roadmapie
- `story-format-generation` (S-07) — `2763aa2`
- `generation-history-storage` (S-03) — `c4d9e7e`
- `generation-rating` — `7f66fed`, bez plastra i bez FR w PRD

Dwie z nich dotykaja kodu opisanego w TYM planie i zmieniaja jego zalozenia:

1. **S-07 zniosl blokade formatu.** Plan zakladal `format: z.literal("joke")`
   w schemacie zadania; test utrwalajacy te blokade ("odrzuca format story")
   zostal zamieniony na "przyjmuje format story". Faza 2 tego planu opisuje wiec
   stan, ktorego w kodzie juz nie ma.
2. **S-03 dolozyl zapis do bazy w `/api/generate`.** Plan mowi wprost: "ten plan
   do niej nie pisze — zapis nalezy do S-03". Endpoint zwraca teraz dodatkowo
   `id`, ktorego kontrakt tego planu nie przewidywal.

Pelne zestawienie: `context/foundation/roadmap.md`, sekcja "Dlug procesowy".

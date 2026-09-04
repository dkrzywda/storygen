---
change_id: first-joke-generation
title: "Generowanie dowcipu na temat uzytkownika z kopiowaniem wyniku"
status: implementing
created: 2026-09-04
updated: 2026-09-04
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

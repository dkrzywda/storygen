---
change_id: admin-account-overview
title: Przegląd kont dla administratora
status: impl_reviewed
created: 2026-09-08
updated: 2026-09-09
archived_at: null
---

## Notes

Realizuje `S-09` z `context/foundation/roadmap.md`, kamień `M-2` (`admin-account-visibility`).
Zależy od `F-02` (`account-roles`), zarchiwizowanego 2026-09-08.

Wymagania źródłowe: FR-014 (przegląd kont — **tylko liczby, nigdy treść**) oraz FR-015
(odmowa nieujawniająca istnienia przeglądu). Granica „tylko liczby" jest zapisana w PRD v2
przy FR-014 i to ona utrzymuje NFR o izolacji kont nienaruszony — polityka RLS na
`generations` nie jest poszerzana.

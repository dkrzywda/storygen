---
change_id: daily-generation-limits
title: Dzienny limit na konto i sufit dzienny całej aplikacji
status: impl_reviewed
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

Plaster S-04 z `context/foundation/roadmap.md`. Realizuje FR-012 (limit na konto)
i FR-013 (sufit całej aplikacji) — oba must-have. Prerequisite S-03 jest `done`.

Zamówione jako rozbudowa panelu użytkownika: panel ma pokazywać wykorzystanie
dziennego limitu, a wyczerpanie limitu ma dawać wyjaśnienie zamiast wyniku.

**Liczby odblokowane 2026-09-07** — to była zapisana blokada plastra
(„Blokada: brak liczb dla FR-012/FR-013", Backlog Handoff):

- **Sufit całej aplikacji (FR-013): 30 generacji/dzień**
- **Limit na konto (FR-012): 10 generacji/dzień**

Uzasadnienie sufitu, wyliczone przed wyborem: darmowy przydział Workers AI to
10 000 Neuronów/dzień, co `tech-stack.md` przelicza na ~300 dowcipów albo ~66
opowiadań (≈33 Neurony na dowcip, ≈151 na opowiadanie). Przy najgorszym
przypadku — same opowiadania, każde z jedną ponowną próbą z reguły kontraktu
formatu — pozycja kosztuje ~302 Neurony, więc 30 × 302 ≈ 9 060 mieści się
w przydziale. Trzy konta po 10 wyczerpują sufit, co zachowuje FR-012 jako
realną granicę sprawiedliwości przy otwartej rejestracji.

**Sprzeczność do rozstrzygnięcia w planie:** `context/foundation/tech-stack.md`
twierdzi, że sufit „50 generacji/dzień fits with room for the one-retry rule".
Przy mieszance z przewagą opowiadań daje to do ~15 100 Neuronów, czyli ponad
dzienny przydział — twierdzenie broni się tylko dla mieszanki zdominowanej przez
dowcipy. Plan musi zdecydować, czy poprawiamy `tech-stack.md`, czy zostawiamy
rozbieżność opisaną.

**Niezmierzone:** liczby 33/151 Neuronów pochodzą z `tech-stack.md`, nie z pomiaru
na tym modelu i tych promptach. Sufit 30 został wybrany z zapasem właśnie dlatego.

# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Milczenie reguły to nie zgoda

- **Context**: Dopisujesz nowy plik do `src/pages/api/` albo nowy typ domenowy,
  a reguła w CLAUDE.md mówi tylko o czymś obok — o „auth endpoints" albo
  o „shared types" — nie o tym, co właśnie piszesz.
- **Problem**: Reguły opisują to, co już jest w repo. Nowy kod zwykle wypada
  poza ich literalny zakres i łatwo uznać, że skoro nic nie zabrania, to
  można po swojemu. Sprawdziliśmy to (2026-08-24): trzy niezależne przebiegi
  dostały to samo zadanie — endpoint `/api/generate`. Wszystkie trzy uznały,
  że reguła „Auth endpoints are form-post + redirect, not JSON" ich nie
  dotyczy, i zwróciły `Response.json(...)`. Wszystkie trzy zostawiły typy
  lokalnie zamiast w `src/types.ts`, bo formalnie nie były jeszcze „shared".
  Żaden nie złamał zapisanej reguły — a repo ma teraz dwa różne sposoby
  zwracania błędów.
- **Rule**: Reguła, która opisuje sąsiedni przypadek, mówi ci o intencji
  projektu, nie wyznacza granicy dozwolonego. Jeśli twój przypadek do niej nie
  pasuje literalnie, rozejrzyj się po kodzie i zrób tak, jak najbliższe
  istniejące miejsce. Możesz zrobić inaczej, jeśli masz powód — ale wtedy
  napisz to wprost w podsumowaniu zmiany. Zła jest tylko cicha decyzja.
- **Applies to**: plan, implement, impl-review

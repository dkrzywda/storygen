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

## Komunikat błędu od zewnętrznej usługi może być pusty

- **Context**: Wołasz zewnętrzną usługę (Supabase Auth, dostawca LLM) i
  przekazujesz jej komunikat błędu użytkownikowi — przez `?error=`, przez pole
  formularza, przez toast. Dotyczy `src/pages/api/**` i każdego miejsca, gdzie
  `error.message` z SDK trafia na powierzchnię produktu.
- **Problem**: SDK zwraca obiekt błędu, ale `message` bywa pusty. Sprawdziliśmy
  to na produkcji (2026-08-24, pierwsza próba rejestracji): Supabase Auth
  zwrócił 502 Bad Gateway, `src/pages/api/auth/signup.ts` zrobił
  `?error=${encodeURIComponent(error.message)}`, a użytkownik zobaczył pustą
  czerwoną ramkę bez tekstu. Kod nie zawiódł — `error` istniał, redirect
  wykonał się poprawnie. Zawiodło założenie, że skoro błąd jest, to ma treść.
  PRD wymaga komunikatu po polsku właśnie dla przypadku „niedostępny dostawca",
  więc pusta ramka to naruszenie wymogu, nie kosmetyka.
- **Rule**: Nigdy nie przekazuj `error.message` z zewnętrznego SDK wprost na
  powierzchnię produktu. Mapuj znane przypadki na własne komunikaty, a dla
  nieznanych i pustych trzymaj jeden komunikat domyślny. Traktuj brak treści
  błędu jako normalny stan do obsłużenia, nie jako sytuację niemożliwą.
- **Applies to**: plan, implement, impl-review

---
change_id: history-filters
title: Filtrowanie i szukanie w historii generacji
status: implemented
created: 2026-09-08
updated: 2026-09-08
archived_at: null
---

## Notes

filtrowanie i szukanie w historii generacji — filtr po formacie i ocenie, tylko ulubione, szukanie po temacie; domyka FR-010, poza PRD

**Kontekst wyboru (2026-09-08).** Zamówione jako kontynuacja pracy nad panelem
użytkownika, po domknięciu i zarchiwizowaniu `daily-generation-limits` (S-04).

**Poza PRD i to jest świadome.** FR-010 mówi tylko: „użytkownik może przeglądać
własne generacje najnowsze-najpierw i otworzyć dowolną w całości" — i to jest już
dowiezione przez S-05. Filtry i szukanie są rozszerzeniem, nie realizacją wymagania.
Ta zmiana powiększa więc ten sam dług, który roadmapa notuje jako nierozstrzygnięty
przy `generation-rating`: „Decyzja, czy należy do M-1, czy do następnego kamienia".
Autor został o tym poinformowany przed wyborem i wybrał mimo to.

**Ryzyko do pilnowania w planie — zapisane w roadmapie przy S-05.** „Każdy nowy
odczyt to nowa okazja do obejścia RLS filtrem w kodzie". Filtry są dokładnie taką
okazją: naturalnym odruchem jest dopisanie `.eq("user_id", …)` obok `.eq("format", …)`,
co dałoby ten sam wynik dla poprawnej polityki i **zamaskowało błędną** — czyli
odebrałoby testowi R-05 siłę dowodową. Zasada z `src/lib/generations.ts` obowiązuje
bez zmian: żaden odczyt nie filtruje po `user_id`.

**Stan wyjściowy.** `/generations` renderuje płaską listę z `fetchHistory()`
(`LIST_COLUMNS`, `order created_at desc`, bez limitu i bez paginacji). Panel
`/dashboard` ma już własne odczyty: `fetchRanking(format)` i `fetchFavourites()` —
filtrowanie po formacie i po ulubionych **istnieje więc w produkcie dwa razy**,
tylko na innym ekranie i bez możliwości łączenia. Plan powinien rozstrzygnąć, czy
to się scala, czy zostaje osobno.

**Otwarte przed planem:** czy filtry idą przez parametry adresu (jak zakładki
panelu, z możliwością odświeżenia i wklejenia linku), czy przez wyspę Reacta;
oraz czy szukanie po temacie ma iść po stronie bazy (`ilike`) czy klienta.

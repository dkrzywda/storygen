---
change_id: generation-rating
title: "Oceny gwiazdkowe, ranking per format i ulubione"
status: implementing
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

**Folder zalozony wstecznie.** Kod wszedl commitem `7f66fed` przed powstaniem tego
pliku, poza lancuchem skilli.

**To jest nowy zakres produktu, nie zalegly plaster.** Ocenianie, ranking i ulubione
nie realizuja zadnego z 13 wymagan funkcjonalnych PRD ani zadnej pozycji roadmapy.
Zamowione bezposrednio 2026-09-07.

**Nierozstrzygnieta decyzja produktowa:** czy ta funkcja nalezy do kamienia milowego
M-1. Jesli nie, roadmapa powinna ja przeniesc do nastepnego, a nie trzymac obok
plastrow M-1 bez przypisania. Wlasciciel: autor.

Relacja do Non-Goals: PRD wyklucza "trending list", ale dotyczylo to publicznych
feedow. Prywatny ranking wlasnych tekstow nie lamie jednodostepnosci produktu.

Decyzje warte pamieci:

1. **Ocena i ulubione siedza w wierszu generacji**, nie w osobnej tabeli. Model
   dostepu jest plaski, wiec "ocena uzytkownika X dla generacji Y" nie ma drugiego
   wymiaru, ktory osobna tabela mialaby obsluzyc.
2. **Bez nowych polityk RLS.** `generations_update_own` obejmuje kazda kolumne
   wiersza; druga polityka UPDATE tylko POSZERZYLABY dostep, bo polityki sumuja sie
   przez OR, nie zawezaja.
3. **Ranking pomija nieocenione pozycje.** Ranking pozycji bez ocen nie jest
   rankingiem. Data rozstrzyga remisy, zeby kolejnosc byla stabilna miedzy
   odswiezeniami.
4. **Zakladki panelu przez parametry adresu, nie wyspe Reacta.** Kazda zakladka i tak
   wykonuje inne zapytanie do bazy, a przy parametrach ma wlasny adres.

## Status weryfikacji

Sprawdzone klikaniem na tymczasowych danych (usunietych po tescie): zapis ocen 5/3/4,
przelaczenie ulubionego, kolejnosc rankingu, kasowanie oceny przez ponowne klikniecie
tej samej gwiazdki, odrzucenie oceny 9 przez constraint bazy, przekierowania anonima.
23 nowe testy jednostkowe schematu latki. `npx astro check` bez bledow.

**Dlug:** brak testu integracyjnego RLS dla nowych kolumn — `src/lib/generations.integration.test.ts`
jest wlasciwym miejscem, zeby dowiesc, ze obce konto nie zmieni cudzej oceny.
Wymaga Dockera.

**Dlug:** migracje `20260903125113` i `20260907125000` NIE sa wypchniete na produkcyjne
Supabase. Projekt nie jest zlinkowany z maszyny autora.

---
project: "Storygen"
version: 1
created: 2026-09-03
updated: 2026-09-03
runner: "Vitest 4.1.11 — `npm test`"
---

# Plan testów

Dokument wiąże **ryzyka** z **zestawami testów**. Nie jest listą wszystkiego, co da się
przetestować — jest listą tego, czego zepsucie boli, i tego, co konkretnie przed tym broni.

Zasada doboru: testujemy to, czego nie widać po awarii. Błąd, który krzyczy — czerwony build,
biały ekran — obroni się sam. Ryzyka poniżej łączy to, że **łamią się cicho**: aplikacja
odpowiada 200, wygląda normalnie, a gwarancja jest już naruszona.

## Rejestr ryzyk

| ID   | Ryzyko                                                                                        | Dlaczego cicho                                                                          | Waga          | Zestaw testów                             | Stan                   |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- | ----------------------------------------- | ---------------------- |
| R-01 | Komunikat błędu od zewnętrznej usługi jest pusty i użytkownik nie dowiaduje się, co się stało | SDK zwraca obiekt błędu, redirect wykonuje się poprawnie, nic nie rzuca wyjątku         | wysoka        | `src/lib/api-errors.test.ts`              | **pokryte**            |
| R-02 | `?error=` odbija dowolny tekst z URL-a na ekran w firmowo wyglądającej ramce błędu            | Strona renderuje się poprawnie, status 200, żadnego śladu w logach                      | wysoka        | `src/lib/api-errors.test.ts`              | **pokryte**            |
| R-03 | Nowy kod błędu dostaje status HTTP, ale nie dostaje komunikatu (albo odwrotnie)               | Użytkownik widzi `undefined` albo pustą ramkę zamiast zdania                            | średnia       | `src/lib/api-errors.test.ts`              | **pokryte**            |
| R-04 | Walidacja wejścia przepuszcza angielski komunikat Zoda na powierzchnię produktu               | Komunikat jest niepusty i wygląda sensownie — tylko nie po polsku                       | średnia       | `src/lib/validation.test.ts`              | **pokryte**            |
| R-05 | Konto czyta lub zmienia cudze generacje                                                       | RLS milczy przy zbyt szerokiej polityce; zapytanie zwraca wiersze, nikt nie widzi błędu | **krytyczna** | `src/lib/generations.integration.test.ts` | **pokryte**            |
| R-06 | Wyjście łamie kontrakt formatu, a mimo to trafia do użytkownika                               | Tekst jest poprawny językowo, tylko za długi albo bez puenty                            | wysoka        | —                                         | luka, wchodzi z `S-01` |
| R-07 | Licznik limitu nie domyka się i sufit kosztu nie działa                                       | Generowanie działa dalej — awarią jest rachunek, nie błąd                               | wysoka        | —                                         | luka, wchodzi z `S-04` |

Ryzyka R-06 i R-07 są zapisane celowo, mimo że nie mają jeszcze testów: kod, którego dotyczą,
nie istnieje. Wchodzą razem ze swoimi plastrami z roadmapy.

## Zestaw R-01 — pusty komunikat błędu

**Ryzyko.** Sprawdzone na produkcji 2026-08-24, przy pierwszej próbie rejestracji: Supabase Auth
zwrócił 502, kod zrobił `?error=${encodeURIComponent(error.message)}`, a użytkownik zobaczył
ramkę bez tekstu. Kod nie zawiódł — zawiodło założenie, że skoro błąd istnieje, to ma treść.
PRD wymaga komunikatu po polsku właśnie dla przypadku „niedostępny dostawca", więc pusta ramka
jest naruszeniem wymagania, nie kosmetyką.

**Co jest testowane.** `toApiErrorCode` przy komunikacie pustym, złożonym z samych spacji,
z samych znaków sterujących, przy obiekcie bez pól, przy `null`, przy `undefined` i przy gołym
stringu zamiast obiektu — każdy z tych przypadków musi skończyć się kodem domyślnym, a nie
przepuszczeniem pustki dalej.

**Czego test nie dowodzi.** Że komunikat domyślny jest zrozumiały dla człowieka. To ocena
redakcyjna, nie automat.

## Zestaw R-02 — odbicie tekstu z URL-a

**Ryzyko.** Do 2026-09-03 `src/pages/auth/signin.astro` czytał `?error=` i podawał zawartość
wprost do komponentu błędu. Link `/auth/signin?error=Twoje+konto+wygasło,+zadzwoń+pod...`
wyświetlał ten tekst w ramce wyglądającej jak komunikat aplikacji. Znalezione przy okazji
planowania `F-01`, nie było celem zmiany.

**Co jest testowane.** `messageForCode` nigdy nie zwraca swojego wejścia: dla dowolnego tekstu,
dla treści phishingowej z numerem telefonu, dla pustego stringu, dla samych białych znaków, dla
kodu dostawcy zamiast własnego, dla `null`, `undefined`, liczby i pustego obiektu. Osobno:
`isApiErrorCode` odrzuca własności odziedziczone z prototypu (`toString`, `constructor`), żeby
`?error=toString` nie przeszedł jako „znany kod".

**Czego test nie dowodzi.** Że każde miejsce w aplikacji przechodzi przez ten słownik. Tego
pilnuje kryterium `grep -rn "error.message" src/pages/api/auth/` oraz reguła w `CLAUDE.md`.

## Zestaw R-03 — kompletność słownika

**Ryzyko.** Kod dodany do `ApiErrorCode` bez wpisu w `API_ERRORS` albo z pustym komunikatem.

**Co jest testowane.** Dla **każdego** kodu w słowniku, wyliczonego z niego samego, nie z listy
przepisanej ręcznie: komunikat po `trim()` jest niepusty, a status mieści się w 400–599.
Test rośnie sam wraz ze słownikiem.

**Zabezpieczenie poza testem.** `Record<ApiErrorCode, ApiErrorSpec>` sprawia, że pominięty wpis
jest błędem kompilacji. Test pokrywa to, czego typ nie złapie — wpis obecny, ale pusty.

## Zestaw R-04 — walidacja nie przepuszcza komunikatów Zoda

**Ryzyko.** Domyślne komunikaty Zoda są po angielsku i wewnętrzne. PRD wymaga polskiego,
a `lessons.md` zakazuje przekazywania cudzych komunikatów na powierzchnię produktu.

**Co jest testowane.** Porażka schematu zwraca mapę pól z komunikatem **zdefiniowanym
w schemacie**, każde niepoprawne pole osobno, a błąd całego formularza ląduje pod kluczem
formularza. Dodatkowo `jsonError` wyprowadza status z kodu, a nie z ręcznego wpisu.

## Zestaw R-05 — izolacja kont

**Ryzyko.** Zbyt szeroka polityka RLS nie rzuca błędem. Zapytanie zwraca wiersze, aplikacja
je renderuje, status jest 200 — a gwarancja izolacji kont, na której stoi cały model dostępu,
już nie obowiązuje. Drugi, udowodniony sposób złamania tego samego: użycie klucza
`service_role` zamiast publishable — omija RLS bez błędu i bez testu, który by to złapał
(`context/deployment/deploy-plan.md`, § Bramki ludzkie).

**Co jest testowane.** Dwa świeże konta na lokalnym stacku. Konto B nie zmienia tytułu wiersza
konta A (zero zmienionych wierszy), nie widzi go przy odczycie, i nie zapisze wiersza na konto
A. Kontrola pozytywna w tym samym pliku: konto A zmienia własny wiersz — bez niej zielony wynik
mógłby oznaczać, że aktualizacja nie działa dla nikogo. Dodatkowo: brak polityki `delete`
sprawia, że nikt nie usuwa wierszy.

Sam test ma dwie bariery przeciw fałszywemu zielonemu: odmawia uruchomienia przeciwko
nielokalnej bazie i odrzuca klucz `service_role`.

**Czego test nie dowodzi — sprawdzone eksperymentalnie 2026-09-03.** Postgres wymaga spełnienia
polityki `SELECT` także przy `UPDATE ... WHERE`, bo instrukcja czyta istniejące wiersze. Skutek:
rozszerzenie **samej** polityki `UPDATE` do `using (true)` nie robi tego zestawu czerwonym —
konto B nadal blokuje polityka odczytu. Czerwony wynik pojawia się dopiero, gdy rozszerzone są
obie polityki. Gwarancja izolacji jest przez to nienaruszona, ale nie czytaj tego zestawu jako
dowodu na poprawność polityki `UPDATE` w oderwaniu od `SELECT`.

## Jak to uruchomić

```bash
npm test
```

Zestaw jednostkowy: 4 pliki, 68 testów, bez Dockera.

```bash
npm run test:integration
```

Zestaw integracyjny: 1 plik, 6 testów. **Wymaga `npx supabase start`**, czyli Dockera i ~7 GB RAM.

Testy leżą obok swojego przedmiotu jako `src/**/*.test.ts`, integracyjne jako
`src/**/*.integration.test.ts` — konfiguracja jednostkowa wyklucza te drugie, żeby `npm test`
został szybki i niezależny od Dockera. Alias `@/*` rozwiązują obie konfiguracje lustrzanie
wobec `tsconfig.json`; rozjazd między nimi sprawia, że testy importują co innego niż build.

## Czego świadomie nie testujemy

- **Testów end-to-end przez przeglądarkę nie ma.** Ścieżkę przez interfejs pokrywa weryfikacja
  ręczna spisana w planach zmian. Wprowadzenie trzeciego narzędzia to osobna decyzja.
- **Komponentów React** — obecne są cienkie i bez logiki poza walidacją formularza po stronie
  klienta, która i tak jest dublowana na serwerze.
- **Konfiguracji Astro, Tailwinda i adaptera** — awaria jest głośna, build nie przechodzi.

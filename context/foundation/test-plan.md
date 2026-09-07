---
project: "Storygen"
version: 1
created: 2026-09-03
updated: 2026-09-07
runner: "Vitest 4.1.11 — `npm test`"
---

# Plan testów

Dokument wiąże **ryzyka** z **zestawami testów**. Nie jest listą wszystkiego, co da się
przetestować — jest listą tego, czego zepsucie boli, i tego, co konkretnie przed tym broni.

Zasada doboru: testujemy to, czego nie widać po awarii. Błąd, który krzyczy — czerwony build,
biały ekran — obroni się sam. Ryzyka poniżej łączy to, że **łamią się cicho**: aplikacja
odpowiada 200, wygląda normalnie, a gwarancja jest już naruszona.

## Rejestr ryzyk

| ID   | Ryzyko                                                                                        | Dlaczego cicho                                                                          | Waga          | Zestaw testów                              | Stan                                 |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- | ------------------------------------------ | ------------------------------------ |
| R-01 | Komunikat błędu od zewnętrznej usługi jest pusty i użytkownik nie dowiaduje się, co się stało | SDK zwraca obiekt błędu, redirect wykonuje się poprawnie, nic nie rzuca wyjątku         | wysoka        | `src/lib/api-errors.test.ts`               | **pokryte**                          |
| R-02 | `?error=` odbija dowolny tekst z URL-a na ekran w firmowo wyglądającej ramce błędu            | Strona renderuje się poprawnie, status 200, żadnego śladu w logach                      | wysoka        | `src/lib/api-errors.test.ts`               | **pokryte**                          |
| R-03 | Nowy kod błędu dostaje status HTTP, ale nie dostaje komunikatu (albo odwrotnie)               | Użytkownik widzi `undefined` albo pustą ramkę zamiast zdania                            | średnia       | `src/lib/api-errors.test.ts`               | **pokryte**                          |
| R-04 | Walidacja wejścia przepuszcza angielski komunikat Zoda na powierzchnię produktu               | Komunikat jest niepusty i wygląda sensownie — tylko nie po polsku                       | średnia       | `src/lib/validation.test.ts`               | **pokryte**                          |
| R-05 | Konto czyta lub zmienia cudze generacje                                                       | RLS milczy przy zbyt szerokiej polityce; zapytanie zwraca wiersze, nikt nie widzi błędu | **krytyczna** | `src/lib/generations.integration.test.ts`  | **pokryte**                          |
| R-06 | Wyjście łamie kontrakt formatu, a mimo to trafia do użytkownika                               | Tekst jest poprawny językowo, tylko za długi albo bez puenty                            | wysoka        | `src/lib/format-contract.test.ts`          | **częściowo pokryte** — patrz zestaw |
| R-07 | Licznik limitu nie domyka się i sufit kosztu nie działa                                       | Generowanie działa dalej — awarią jest rachunek, nie błąd                               | wysoka        | `src/lib/limits.test.ts` + `.integration.` | **pokryte**                          |

**R-06 jest pokryte tylko częściowo i to jest świadome.** Szczegóły w jego zestawie poniżej —
przeczytaj je, zanim uznasz kontrakt formatu za zabezpieczony.

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

## Zestaw R-06 — kontrakt formatu (pokrycie częściowe)

**Ryzyko.** Wyjście modelu łamie kontrakt formatu, a mimo to trafia do użytkownika. Tekst jest
poprawny językowo i wygląda normalnie — jest tylko za długi, urwany albo poprzedzony wstępem.
Bez sprawdzenia nikt tego nie zauważy, bo nic nie krzyczy.

**Co jest testowane.** Liczba słów dokładnie na limicie i jeden ponad, dla każdego presetu.
Próg minimalny. Prefiksy („Oto dowcip:"), markdown, tekst pusty i złożony z białych znaków.
Osobno: **obcięcie na suficie `max_tokens`** — tekst bez znaku końca zdania jest odrzucany,
bo obcięty tekst ma poprawną długość i przechodzi każdą inną kontrolę. To ryzyko wprowadził
sam mechanizm generowania, więc test powstał razem z nim.

W zestawie są też **dwa prawdziwe wyjścia modelu** zmierzone 2026-09-04. Gdyby ktoś zaostrzył
walidator tak, że odrzuca to, co model realnie produkuje, test spadnie na czerwono — zamiast
odkrycia tego przez użytkownika.

**Czego test NIE dowodzi — i to jest istota pokrycia częściowego.** Walidator sprawdza
**długość i czystość, nie obecność puenty**. Mechanicznie się jej nie da sprawdzić, a drugie
wywołanie modelu jako sędziego podwoiłoby czas i neurony, wywracając NFR 15 s. Puentę wymusza
wyłącznie prompt.

Konsekwencja jest obserwowalna, nie teoretyczna: w weryfikacji `S-01` (2026-09-04) **dwa kolejne
wygenerowane teksty przeszły kontrakt, nie będąc dowcipami** — były poprawnymi obserwacjami bez
puenty, mieszczącymi się w limicie. PRD `## Business Logic` obiecuje, że wyjście „kończy się
puentą"; kod tego nie egzekwuje. Jeśli ta obietnica ma być dotrzymana, potrzebny jest albo lepszy
prompt, albo inny model, albo zmiana PRD — nie kolejny test.

## Zestaw R-05 — izolacja kont

**Ryzyko.** Zbyt szeroka polityka RLS nie rzuca błędem. Zapytanie zwraca wiersze, aplikacja
je renderuje, status jest 200 — a gwarancja izolacji kont, na której stoi cały model dostępu,
już nie obowiązuje. Drugi, udowodniony sposób złamania tego samego: użycie klucza
`service_role` zamiast publishable — omija RLS bez błędu i bez testu, który by to złapał
(`context/deployment/deploy-plan.md`, § Bramki ludzkie).

**Co jest testowane.** Dwa świeże konta na lokalnym stacku. Konto B nie zmienia tytułu wiersza
konta A (zero zmienionych wierszy), nie widzi go przy odczycie, i nie zapisze wiersza na konto
A. Kontrola pozytywna w tym samym pliku: konto A zmienia własny wiersz — bez niej zielony wynik
mógłby oznaczać, że aktualizacja nie działa dla nikogo.

Od `S-06` doszło usuwanie i **gwarancja zmieniła charakter**. Wcześniej nikt nie usuwał
wierszy, bo polityki `delete` po prostu nie było; teraz polityka istnieje, a zestaw dowodzi,
że nikt nie usuwa **cudzego**: konto B nie usuwa wiersza konta A (zero usuniętych wierszy,
bez błędu), wiersz konta A przetrwał tę próbę, a kontrola pozytywna potwierdza, że konto A
usuwa własny wiersz. Kontrola pozytywna zakłada **własny** wiersz zamiast wspólnego — inaczej
zabrałaby dane pozostałym przypadkom i dopisanie czegokolwiek poniżej cicho psułoby zestaw.

Sam test ma dwie bariery przeciw fałszywemu zielonemu: odmawia uruchomienia przeciwko
nielokalnej bazie i odrzuca klucz `service_role`.

**Czego test nie dowodzi — sprawdzone eksperymentalnie 2026-09-03.** Postgres wymaga spełnienia
polityki `SELECT` także przy `UPDATE ... WHERE`, bo instrukcja czyta istniejące wiersze. Skutek:
rozszerzenie **samej** polityki `UPDATE` do `using (true)` nie robi tego zestawu czerwonym —
konto B nadal blokuje polityka odczytu. Czerwony wynik pojawia się dopiero, gdy rozszerzone są
obie polityki. Gwarancja izolacji jest przez to nienaruszona, ale nie czytaj tego zestawu jako
dowodu na poprawność polityki `UPDATE` w oderwaniu od `SELECT`.

**Ta sama pułapka dotyczy `DELETE`.** `DELETE ... WHERE` również czyta istniejące wiersze,
zanim je usunie, więc rozszerzenie **samej** polityki `delete` do `using (true)` nie zrobi
zestawu czerwonym — konto B nadal blokuje polityka odczytu. Czerwony wynik pojawia się dopiero
przy rozszerzeniu `delete` i `select` razem, i dokładnie ten eksperyment jest weryfikacją
ręczną fazy 1 planu `delete-generation`.

## Zestaw R-07 — licznik limitu i sufit kosztu

**Ryzyko.** Limity dzienne (FR-012, FR-013) to jedyna bariera kosztowa w produkcie, przy
otwartej rejestracji i publicznym adresie. Gdy licznik przestaje się domykać, **nic się nie
psuje na ekranie** — generowanie działa dalej, statusy są poprawne, a awaria objawia się
dopiero rachunkiem u dostawcy. To jest ta klasa cichej awarii, dla której powstał ten dokument.

Ryzyko ma dwie twarze i każda ma swój zestaw, bo żyją w innych warstwach.

**Decyzja bramki — `src/lib/limits.test.ts`, bez Dockera.** `checkLimits` jest funkcją czystą,
więc da się ją zamknąć testem jednostkowym: granica dokładna (zużycie **równe** limitowi już
odmawia — przy `>` zamiast `>=` dziesiąty licznik przepuściłby jedenastą generację),
pierwszeństwo kodu własnego limitu, gdy oba progi stoją, oraz stan po przekroczeniu wyścigiem.
Progi są czytane ze stałych, nie wpisane liczbami — test z zahardkodowanym 10 i 30 przestałby
cokolwiek sprawdzać w dniu zmiany limitu.

**Polityki, wyjątek od RLS i doba — `src/lib/limits.integration.test.ts`, wymaga Dockera.**
Trzy rzeczy, których test jednostkowy dotknąć nie może:

- **Brak polityk `UPDATE` i `DELETE`** na `generation_attempts` — konto nie może obniżyć
  własnego zużycia ani skasować dowodu próby. Sprawdzane na **własnym** wierszu właściciela,
  bo to nie jest izolacja od cudzych danych, tylko brak uprawnienia dla kogokolwiek.
- **Zasięg wyjątku `security definer`** — `usage_today()` musi widzieć cudze próby
  w `app_count` (inaczej FR-013 jest martwy) i **jednocześnie** nie wystawiać ich w `own_count`
  ani nie zwracać żadnego identyfikatora. Kształt zwracanego wiersza jest sprawdzany wprost.
- **Granica doby w `Europe/Warsaw`** — próba sprzed lokalnej północy nie liczy się do bieżącej
  doby, a moment odnowienia wypada o 00:00 czasu warszawskiego. Przy naiwnym `date_trunc`
  na UTC wyszłaby tu 01:00 albo 02:00.

**Zapis na cudze konto jest tu groźniejszy niż w `generations`.** Tam podrzucony wiersz zaśmieca
komuś historię; tutaj **podnosi cudzy licznik**, czyli pozwala zablokować wybranemu kontu
generowanie na całą dobę. Dlatego kierunek jest sprawdzany w obie strony, a nie raz.

**Regres pilnowany osobno — zmierzone 2026-09-07.** `revoke execute … from public` **nie**
odbiera uprawnienia roli `anon`, bo Supabase dokłada jawne granty przez `alter default
privileges`. Zanim role wymieniono z nazwy, niezalogowany odczytywał `app_count` przez
PostgREST. Przypadek „anonim nie wywoła licznika" jest strażnikiem tej poprawki.

**Zestaw ma zęby — sprawdzone eksperymentalnie 2026-09-07.** Rozszerzenie polityki `SELECT`
tabeli `generation_attempts` do `using (true)` robi **trzy** testy czerwonymi, w tym „Bob nie
widzi prób Alice". Bez tego eksperymentu zielony wynik nie byłby dowodem.

**Czego ten zestaw NIE dowodzi.** Nie dotyka **wyścigu dwóch równoległych żądań tego samego
konta**: odczyt licznika i zapis próby to dwie operacje, więc oba żądania mogą zobaczyć ten sam
stan i oba przejść. Przy jednym realnym użytkowniku i limicie 10 to przekroczenie o jedną
pozycję, nie wyciek kosztu — domknięcie wymagałoby transakcji albo warunku liczącego wewnątrz
jednej instrukcji `insert`. Świadomie odłożone, nie przeoczone.

**Uwaga środowiskowa — zmierzone 2026-09-07.** Kontener `auth` potrafi chodzić o sekundę do
przodu względem bazy, przez co świeżo wystawiony token ma `iat` w przyszłości i pierwsze
zapytanie wraca błędem `JWT issued at future`. Zestaw ma wąską pętlę ponawiającą **wyłącznie**
ten komunikat; każdy inny błąd wywraca test natychmiast.

## Jak to uruchomić

```bash
npm test
```

Zestaw jednostkowy: 8 plików, 177 testów, bez Dockera.

```bash
npm run test:integration
```

Zestaw integracyjny: 2 pliki, 25 testów. **Wymaga `npx supabase start`**, czyli Dockera i ~7 GB RAM.

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

# Rola konta i serwerowe sprawdzenie dostępu — plan implementacji

## Overview

Konto zyskuje rolę (`user` albo `admin`) trzymaną w `app_metadata`, a `/dashboard` zyskuje
**sekcję widoczną wyłącznie dla administratora**. To fundament `F-02`: nie dostarcza jeszcze
przeglądu kont (to `S-09`, FR-014), tylko granicę, na której ten przegląd stanie.

> Ten akapit opisuje projekt po zmianie z 2026-09-08 — patrz `## Zmiana projektu` poniżej.
> Pierwotny plan zakładał osobną trasę `/admin` maskowaną odpowiedzią nierozróżnialną od
> nieistniejącej ścieżki; ta droga została porzucona, bo sekcja warunkowa spełnia FR-015
> strukturalnie, a nie przez wysiłek.

## Current State Analysis

- **Autoryzacja jest binarna.** `src/middleware.ts:5-11` trzyma `PROTECTED_ROUTES` (prefiksy)
  i `PROTECTED_EXACT` (`/`), a jedyny test to `!context.locals.user` → `redirect("/auth/signin")`
  (`src/middleware.ts:28-30`). W repo nie ma **żadnego** pojęcia roli: wszystkie trafienia
  na „role" to role wiadomości LLM (`src/lib/llm.ts:85`), kod błędu `UNAUTHORIZED` i atrybut HTML.
- **`locals.user` już niesie `app_metadata`.** Middleware woła `supabase.auth.getUser()`
  (`src/middleware.ts:17-19`) i zapisuje pełny obiekt `User` do `context.locals.user`, typowany
  w `src/env.d.ts`. Rola trzymana w `app_metadata` jest więc dostępna **bez ani jednego
  dodatkowego zapytania** — istotne, bo middleware biegnie na każdym żądaniu.
- **`app_metadata` jest zapisywalne tylko serwerowo.** `user_metadata` użytkownik zapisuje sam
  przez `updateUser`, więc rola trzymana tam byłaby podrabialna. PRD `## Access Control` zabrania
  tego wprost.
- **Nie ma `src/pages/404.astro`.** Zmierzone na produkcji 2026-09-08: nieistniejąca trasa
  zwraca wbudowaną stronę 404 Astro — 4319 B, `<html lang="en">`, `<title>404: Not Found</title>`.
  To **przewraca zapis w roadmapie** przy `S-02`, który twierdzi, że nieznana ścieżka zwraca
  „404 z pustym ciałem". Zwraca pełną stronę, po angielsku.
- **Ta strona łamie NFR o języku już dziś** — PRD wymaga interfejsu wyłącznie po polsku.
- **`context.rewrite` jest dostępne** w Astro 6.3.1
  (`node_modules/astro/dist/types/public/context.d.ts:375`), a `next()` też przyjmuje payload
  przepisania (`common.d.ts:84`).

## Desired End State

Konto `dkrzywda@amniscode.pl` ma w `app_metadata` rolę `admin`, `damiano.krzywda@gmail.com`
rolę `user` (jeśli konto istnieje). Wejście na `/dashboard`:

| kto                                  | co widzi                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------- |
| administrator                        | panel + sekcję „Administracja" z informacją, że przegląd stanie tu w `S-09` |
| zalogowany bez roli admin            | panel **bez żadnego śladu** tej sekcji — także w źródle strony              |
| niezalogowany                        | przekierowanie na `/auth/signin`, jak dotąd (`PROTECTED_ROUTES`)            |
| ktokolwiek na `/nie-ma-takiej-trasy` | polską stronę 404 ze statusem 404                                           |
| ktokolwiek na `/admin`               | **to samo** — ta trasa nie istnieje i nie ma jej powstać                    |

Weryfikowalne: źródło `/dashboard` dla konta bez roli nie może zawierać ani słowa
„Administracja", ani `aria-label` tej sekcji. Obecność jednego i drugiego jest dowodem wycieku.

### Key Discoveries:

- `UserAppMetadata` w SDK ma `[key: string]: any`
  (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:346-356`), więc
  `user.app_metadata.role` jest typu `any` i wywróci `@typescript-eslint/no-unsafe-member-access`
  pod `strictTypeChecked`. Sprawdzenie **musi** zawężać typ jawnie, nie rzutować.
- Migracja może zapisać `auth.users.raw_app_meta_data` — zweryfikowane lokalnie 2026-09-08
  w transakcji wycofanej; scala się czysto z istniejącym `{"provider":"email","providers":["email"]}`.
- `supabase.auth.getUser()` odpytuje serwer auth, nie dekoduje tokenu lokalnie, więc rola
  nadana migracją działa **natychmiast**, bez czekania na odświeżenie sesji.
- Wzorzec współlokowanych testów: `src/lib/*.test.ts` obok podmiotu, integracyjne jako
  `src/lib/*.integration.test.ts` (`src/lib/limits.integration.test.ts` jako odniesienie).

## What We're NOT Doing

- **Nie budujemy przeglądu kont** — to `S-09` i wymaganie FR-014. Tu powstaje pusta trasa.
- **Nie czytamy cudzych generacji** i nie ruszamy polityki RLS na `generations`. Granica
  zapisana przy FR-014 w PRD.
- **Nie dodajemy zarządzania kontami** — bez blokowania, usuwania i zmiany limitów.
  `## Non-Goals` w PRD v2 wylicza to wprost.
- **Nie budujemy ścieżki zmiany roli bez wdrożenia.** Rola jest nadawana migracją; szersza
  ścieżka wymagałaby własnego uzasadnienia.
- **Nie tworzymy tabeli `user_roles` ani `profiles`.** Rozważone i odrzucone: każda dokłada
  odczyt na każdym żądaniu albo nową powierzchnię RLS.
- **Nie dodajemy linku do `/admin` w nawigacji.** Fundament nie ma być widoczny; `S-09` zdecyduje.

## Implementation Approach

Trzy fazy w kolejności „dane → mechanizm → dowód". Faza 1 kończy się stanem, w którym rola
istnieje, ale nic jej nie czyta — bezpiecznym do wdrożenia osobno. Faza 2 dokłada bramkę
i nierozróżnialną odmowę. Faza 3 dowodzi ścieżki negatywnej, bo to jedyna ścieżka, która
zawodzi w ciszy.

## Zmiana projektu — 2026-09-08, w trakcie fazy 2

**Sekcja w `/dashboard` zamiast osobnej trasy `/admin`.** Zmiana na żądanie autora, przyjęta —
i jest **mocniejsza wobec FR-015, nie słabsza**. FR-015 wymaga, żeby odmowa nie ujawniała, że
przegląd kont istnieje. Osobny adres spełniał to _przez wysiłek_: trzeba go było maskować
odpowiedzią nierozróżnialną od nieistniejącej ścieżki, z pułapką w postaci przekierowania,
które by go zdradziło. Sekcja warunkowa spełnia to _strukturalnie_: nie ma adresu do odgadnięcia,
więc nie ma czego odmawiać. Zwykłe konto widzi panel, konto administratora widzi panel z jedną
sekcją więcej.

Co zostaje w mocy, a co jest **unieważnione** w tekście poniżej:

| element planu                                | stan                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `isAdmin()` w `src/lib/account-role.ts`      | **w mocy** — teraz woła go `src/pages/dashboard.astro`                                      |
| `src/pages/404.astro`                        | **w mocy**, ale przestaje być celem odmowy; jego wartość to naprawa naruszenia NFR o języku |
| Faza 2, poz. 3 — `ADMIN_ROUTES` w middleware | **UNIEWAŻNIONE** — martwy mechanizm bez wywołania; middleware wraca do stanu z `HEAD`       |
| Faza 2, poz. 4 — pusta trasa `/admin`        | **UNIEWAŻNIONE** — zastąpiona warunkową sekcją w `/dashboard`                               |
| Kryteria 2.5–2.8 i test integracyjny fazy 3  | **PRZEPISANE** — dowodzą obecności/braku sekcji, nie identyczności ciał 404                 |

Reguła z CLAUDE.md o ochronie tras w middleware **nie jest naruszona**: `/dashboard` jest
w `PROTECTED_ROUTES`, więc ochrona trasy zostaje w middleware. Rozstrzyga się tu tylko, **co**
strona renderuje, nie **czy** wpuszcza.

## Critical Implementation Details

**Debug & observability — cena seeda po e-mailu jest realna i trzeba ją opłacić w fazie 1.**
Administrator, któremu seed cicho nie nadał roli, po prostu nie zobaczy sekcji — bez żadnego
komunikatu, bo dla konta bez roli brak sekcji jest stanem poprawnym. Dlatego zapytanie
kontrolne w fazie 1 nie jest opcjonalne: bez niego „nie mam roli" i „wszystko działa, nie jestem
adminem" są nieodróżnialne.

**Timing & lifecycle — na świeżej bazie seed nigdy nie nada roli.** Migracje biegną przed
rejestracją kont, więc `update … where email = …` dopasowuje zero wierszy. Zmierzone 2026-09-08
po `db reset`: oba konta z werdyktem „KONTA NIE MA". Na nowym środowisku kolejność jest wymuszona —
najpierw rejestracja, potem ponowne uruchomienie pliku migracji przez `psql`. Plik migracji jest
więc jednocześnie migracją i skryptem operacyjnym; to ustalenie do triage'u, nie usterka.

---

## Phase 1: Rola w danych i typ

### Overview

Rola trafia do `app_metadata` obu kont i do systemu typów. Aplikacja jeszcze jej nie czyta.

### Changes Required:

#### 1. Migracja nadająca role

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_seed_account_roles.sql`

**Intent**: Dopisać rolę do `auth.users.raw_app_meta_data` dla dwóch znanych adresów. Nadanie
po e-mailu jest jednorazowym seedem, nie mechanizmem — aplikacja nigdy nie wyprowadza roli
z adresu przy żądaniu, bo adres jest danymi od użytkownika.

**Contract**: Idempotentne i bez błędu, gdy konta nie ma (`update … where email = …` dopasuje
zero wierszy). Scalenie zachowuje istniejące klucze `provider`/`providers`:

```sql
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
 where email = 'dkrzywda@amniscode.pl';
```

Analogicznie `'user'` dla `damiano.krzywda@gmail.com`. Migracja **nie może** rzucać błędu przy
braku konta — inaczej `supabase db reset` i testy integracyjne przestaną przechodzić na czystej bazie.

#### 2. Typ roli

**File**: `src/types.ts`

**Intent**: Dodać `AccountRole` jako typ domenowy, obok istniejących typów encji i DTO.

**Contract**: `export type AccountRole = "user" | "admin";`. Zamknięty zestaw, nie `string` —
literał wymusza błąd kompilacji przy literówce w porównaniu.

#### 3. Zapytanie kontrolne

**File**: `context/changes/account-roles/verify-roles.sql`

**Intent**: Jedno zapytanie do uruchomienia po każdej aplikacji migracji, pokazujące jaka rola
faktycznie wylądowała na jakim koncie. Istnieje, bo cichy no-op seeda objawia się dokładnie
tak jak poprawna odmowa (patrz `## Critical Implementation Details`).

**Contract**: Zwraca `current_database()` w **pierwszej kolumnie** — reguła z
`context/foundation/lessons.md` § „Weryfikacja bez tożsamości środowiska nie jest dowodem".
Dalej e-mail, `raw_app_meta_data->>'role'` i werdykt dla dwóch oczekiwanych adresów, w tym
jawny wiersz dla konta, którego nie ma.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Typy przechodzą: `npx tsc --noEmit`
- Lint przechodzi na zmienionych plikach: `npx eslint src/types.ts`
- Testy jednostkowe przechodzą: `npm test`

#### Manual Verification:

- Zapytanie kontrolne na lokalnej bazie pokazuje `admin` przy właściwym adresie
- Zapytanie kontrolne pokazuje jawny wiersz dla konta, którego nie ma, zamiast milczeć
- `npx supabase db reset` przechodzi na bazie bez żadnych kont

---

## Phase 2: Bramka i nierozróżnialna odmowa

### Overview

Sprawdzenie roli, polska strona 404, bramka w middleware i pusta trasa `/admin`.

### Changes Required:

#### 1. Sprawdzenie roli

**File**: `src/lib/account-role.ts`

**Intent**: Jedno miejsce, które odpowiada na pytanie „czy ten użytkownik jest administratorem".
Wołane i przez middleware, i przez przyszłe handlery API `S-09` — żeby nie było dwóch definicji
tego, kto jest adminem.

**Contract**: `export function isAdmin(user: User | null): boolean`. **Musi zawężać typ jawnie**:
`app_metadata` ma w SDK `[key: string]: any`, więc odczyt bez sprawdzenia `typeof` wywróci
`@typescript-eslint/no-unsafe-member-access` pod `strictTypeChecked`. Brak użytkownika, brak
`app_metadata`, brak klucza `role` i wartość spoza `AccountRole` dają `false` — **fail-closed**,
tak samo jak `interpretGate` w `src/lib/limits.ts`.

#### 2. Polska strona 404

**File**: `src/pages/404.astro`

**Intent**: Zastąpić angielską stronę wbudowaną w Astro. Naprawia zmierzone naruszenie NFR
o języku i jednocześnie daje odmowie cel przepisania, identyczny z prawdziwym pudłem.

**Contract**: Ustawia `Astro.response.status = 404` jawnie — bez tego przepisanie z middleware
oddaje 200. Używa `Layout.astro` jak pozostałe strony. Treść nie może zdradzać, że istnieje
jakakolwiek trasa admina.

#### 3. Bramka w middleware

**File**: `src/middleware.ts`

**Intent**: Dodać listę tras administratora i przepisać żądanie na `/404`, gdy sprawdzenie roli
nie przechodzi.

**Contract**: Nowa stała `ADMIN_ROUTES` dopasowywana po prefiksie. Rozstrzygana **przed**
przekierowaniem z `PROTECTED_ROUTES`, i `/admin` **nie** wchodzi do `PROTECTED_ROUTES` — powód
w `## Critical Implementation Details`. Odmowa: `return context.rewrite("/404")`, ta sama ścieżka
dla braku sesji i dla sesji bez roli.

#### 4. Pusta trasa administratora

**File**: `src/pages/admin/index.astro`

**Intent**: Dać fundamentowi ścieżkę weryfikacji ręcznej — bez trasy nie da się potwierdzić,
że granica działa, aż do `S-09`.

**Contract**: Strona bez logiki i bez zapytań do bazy; informuje, że przegląd kont stanie tu
w `S-09`. Nie robi własnego sprawdzenia roli — bramka jest w middleware, zgodnie z regułą
z `CLAUDE.md`, że ochrona tras nie jest per-strona.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx tsc --noEmit`
- Lint przechodzi na zmienionych plikach: `npx eslint src/middleware.ts src/lib/account-role.ts`
- Testy jednostkowe przechodzą: `npm test`
- Build przechodzi: `npx astro build`

#### Manual Verification:

- Administrator wchodzi na `/admin` i widzi stronę zastępczą
- Zalogowany bez roli admin dostaje 404, **nie** przekierowanie na logowanie
- Niezalogowany dostaje 404, **nie** przekierowanie na logowanie
- Treść i status odpowiedzi dla `/admin` bez uprawnień są **identyczne** z odpowiedzią dla
  losowej nieistniejącej ścieżki — porównane, nie oglądnięte
- Strona 404 jest po polsku

---

## Phase 3: Testy granicy

### Overview

Dowód ścieżki negatywnej. To jedyna ścieżka w tej zmianie, która zawodzi w ciszy.

### Changes Required:

#### 1. Testy jednostkowe sprawdzenia

**File**: `src/lib/account-role.test.ts`

**Intent**: Pokryć każdy sposób, w jaki `isAdmin` może dostać coś innego niż spodziewa się autor.

**Contract**: Przypadki: `null`; użytkownik bez `app_metadata`; `app_metadata` bez klucza `role`;
`role` jako `"user"`; `role` jako wartość spoza zestawu; `role` jako liczba i jako obiekt;
`role` jako `"admin"` — jedyny zwracający `true`.

#### 2. Test integracyjny granicy

**File**: `src/pages/admin/admin-gate.integration.test.ts`

**Intent**: Dowieść, że odmowa jest nierozróżnialna, a nie tylko obecna. Test jednostkowy
sprawdzenia nie powie nic o tym, czy middleware faktycznie przepisuje na tę samą stronę.

**Contract**: Porównuje status **i treść** trzech odpowiedzi: `/admin` bez sesji, `/admin`
z sesją bez roli, oraz losowa nieistniejąca ścieżka. Wszystkie trzy muszą być identyczne.
Czwarty przypadek: `/admin` z sesją administratora zwraca 200 i treść inną niż pozostałe —
bez tego test przeszedłby też wtedy, gdyby bramka odmawiała wszystkim.

Wzorzec i strażnik środowiska skopiowane z `src/lib/limits.integration.test.ts`. Test tworzy
własne konto i nadaje mu rolę bezpośrednio w bazie — nie polega na seedzie z fazy 1, bo ten
zależy od adresów, których na czystej bazie nie ma.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Testy integracyjne przechodzą: `npm run test:integration`
- Testy padają po zdjęciu bramki — zmierzone, nie założone
- Lint przechodzi na plikach testowych: `npx eslint src/lib/account-role.test.ts src/pages/admin/admin-gate.integration.test.ts`

#### Manual Verification:

- Po zakomentowaniu bramki w middleware test integracyjny czerwienieje, potem przywrócone
- `context/foundation/test-plan.md` odnotowuje nowy zestaw

---

## Testing Strategy

### Unit Tests:

- `isAdmin` — fail-closed na każdym uszkodzonym wejściu, `true` wyłącznie dla `"admin"`
- Brzeg typu: `role` niebędące stringiem nie może przejść przez zawężenie

### Integration Tests:

- Trzy odpowiedzi odmowy identyczne w treści i statusie
- Odpowiedź administratora różna od nich — kontrola przeciw bramce odmawiającej wszystkim

### Manual Testing Steps:

1. Zaloguj się kontem administratora, wejdź na `/admin` — strona zastępcza
2. Wyloguj się, wejdź na `/admin` — 404, bez przekierowania na logowanie
3. Zaloguj się drugim kontem, wejdź na `/admin` — 404
4. Porównaj bajtowo odpowiedź z punktu 3 z odpowiedzią dla `/losowa-sciezka`
5. Uruchom zapytanie kontrolne z fazy 1 i sprawdź, że pokazuje właściwą bazę

## Performance Considerations

Rola w `app_metadata` nie dokłada **ani jednego** zapytania: middleware już woła
`supabase.auth.getUser()` na każdym żądaniu i dostaje `app_metadata` w tej samej odpowiedzi.
Sprawdzenie jest czystą funkcją nad obiektem, który już jest w pamięci. Tabela `user_roles`
kosztowałaby odczyt na każdym żądaniu — to był główny powód jej odrzucenia.

## Migration Notes

Migracja jest idempotentna i nie zależy od istnienia kont, więc `db reset` i testy integracyjne
przechodzą na czystej bazie. **Kolejność wdrożenia jest wymuszona**: migracja przed kodem.
Odwrotna kolejność daje administratorowi 404 na własnej trasie, co — zgodnie z zapisem
w `## Critical Implementation Details` — wygląda jak zepsuta trasa, nie jak brak roli.

Cofnięcie kodu nie cofa migracji (`context/deployment/deploy-plan.md`, § Rollback). Zostawiona
rola w `app_metadata` bez kodu, który ją czyta, jest nieszkodliwa — nic jej nie interpretuje.

## References

- Roadmapa: `context/foundation/roadmap.md`, `F-02`
- Wymagania: `context/foundation/prd.md` v2, `## Access Control` i FR-015
- Wzorzec fail-closed: `src/lib/limits.ts` (`interpretGate`)
- Wzorzec testu integracyjnego i strażnika środowiska: `src/lib/limits.integration.test.ts`
- Reguła o tożsamości bazy w weryfikacji: `context/foundation/lessons.md`

## Progress

> Konwencja: `- [ ]` w toku, `- [x]` zrobione. Dopisz ` — <commit sha>` przy domknięciu kroku.
> Nie zmieniaj tytułów kroków.

### Phase 1: Rola w danych i typ

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie: `npx supabase db reset` — 10aa463
- [x] 1.2 Typy przechodzą: `npx tsc --noEmit` — 10aa463
- [x] 1.3 Lint przechodzi na zmienionych plikach — 10aa463
- [x] 1.4 Testy jednostkowe przechodzą: `npm test` — 10aa463

#### Manual

- [x] 1.5 Zapytanie kontrolne pokazuje `admin` przy właściwym adresie — 10aa463
- [x] 1.6 Zapytanie kontrolne pokazuje jawny wiersz dla konta, którego nie ma — 10aa463
- [x] 1.7 `npx supabase db reset` przechodzi na bazie bez żadnych kont — 10aa463

### Phase 2: Bramka i nierozróżnialna odmowa

#### Automated

- [x] 2.1 Typy przechodzą: `npx tsc --noEmit`
- [x] 2.2 Lint przechodzi na zmienionych plikach
- [x] 2.3 Testy jednostkowe przechodzą: `npm test`
- [x] 2.4 Build przechodzi: `npx astro build`

#### Manual

- [x] 2.5 Konto administratora widzi sekcję „Administracja" w `/dashboard`
- [x] 2.6 Konto bez roli nie widzi sekcji ani żadnego jej śladu w źródle strony
- [x] 2.7 Niezalogowany nadal jest odsyłany na logowanie przez istniejące middleware
- [x] 2.8 Nie istnieje żadna trasa `/admin` — adres oddaje 404 jak każdy inny nieznany
- [x] 2.9 Strona 404 jest po polsku

### Phase 3: Testy granicy

#### Automated

- [x] 3.1 Testy jednostkowe przechodzą: `npm test`
- [x] 3.2 Testy integracyjne przechodzą: `npm run test:integration`
- [x] 3.3 Testy padają po zdjęciu warunku `showAdmin` — zmierzone
- [x] 3.4 Lint przechodzi na plikach testowych

#### Manual

- [x] 3.5 Test integracyjny czerwienieje po zakomentowaniu warunku, potem przywrócone
- [x] 3.6 `context/foundation/test-plan.md` odnotowuje nowy zestaw

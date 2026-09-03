---
project: storygen
deployed_at: 2026-08-24
platform: Cloudflare Workers
url: https://storygen.storygen.workers.dev
worker_name: storygen
status: live
scope: deploy-1-transport-only
plan_source: Plan Mode (approved 2026-08-24)
---

# Pierwsze wdrożenie produkcyjne — ślad audytowy

Zapis tego, co było zaplanowane, co faktycznie się stało i czym te dwie rzeczy
się różniły. Kolejne etapy czytają ten plik jako źródło prawdy o tym, co już
stoi na produkcji i które sekrety są podłączone.

Decyzja platformowa: `context/foundation/infrastructure.md`.
Zatwierdzony plan: Plan Mode, 2026-08-24.

## Stan końcowy

|                       |                                                                |
| --------------------- | -------------------------------------------------------------- |
| URL                   | `https://storygen.storygen.workers.dev`                        |
| Nazwa Workera         | `storygen` (nieodwracalna — Workerów nie da się przemianować)  |
| Plan                  | free tier, $0/mo                                               |
| Wersje Workera        | 3 (deploy + 2× `secret put`)                                   |
| Version ID deployu #1 | `0af4f1d8-d226-495d-8d66-6e92d941b872`                         |
| Sekrety               | `SUPABASE_URL`, `SUPABASE_KEY` — oba `secret_text`             |
| Baza                  | Supabase, projekt `oajdssejrnjvhrvggnmd`, klucz publishable    |
| Runtime               | workerd, `nodejs_compat` v1 (`compatibility_date: 2026-05-08`) |
| Observability         | włączona                                                       |
| CI/CD                 | **brak** — deploy wyłącznie ręczny (patrz „Dług")              |

Commity: `b5c3328` (rename), `d951475` (skrypty + flaga + korekty),
`2e78115` (formatowanie), wypchnięte do `origin/main`.

## Co dowiedziono, a czego nie

**Dowiedziono end-to-end na produkcji**: build → deploy → publiczny URL →
rejestracja → potwierdzenie mailem → sesja → strona chroniona → wylogowanie.
Dodatkowo: chroniona trasa nie wycieka anonimowym żądaniom (302 bez żadnego
adresu e-mail w treści, brak nagłówków cache na `/dashboard`).

**Czego to wdrożenie nie dowodzi**, i trzeba to powiedzieć wprost, bo zielona
lista kontrolna czyta się jak „produkt działa":

- **Nic o generowaniu** — nie istnieje. Dowiedziono transportu, nie funkcji.
- **Nic o limicie 10 ms CPU.** Obecne strony robią bliskie zeru obliczenia.
  Limit zaboli dopiero, gdy 400-słowna historia będzie parsowana,
  walidowana, sprawdzana pod kontrakt formatu i renderowana przez wyspy React —
  a kontrakt każe powtórzyć generowanie raz przy niepowodzeniu, więc najgorszy
  przypadek liczy się dwukrotnie w jednym wywołaniu.
- **Nic o budżecie 15 s / 30 s** — żadne wywołanie LLM nie miało miejsca.
- **Nic o zapasie subrequestów** (50/żądanie). Obecny najgorszy przypadek to 1.
- **Nic o RLS ani izolacji między kontami** — nie ma jeszcze tabel ani polityk.

## Ryzyka, które nie wystąpiły

Wszystkie cztery ryzyka techniczne przewidziane dla tego wdrożenia okazały się
niegroźne. Zapisane, żeby kolejny czytelnik nie budował wokół nich bramek:

1. **Odrzucenie flagi `global_fetch_strictly_public`** — zaakceptowana przez
   workerd przy `compatibility_date: 2026-05-08`. Zweryfikowane `--dry-run`.
2. **`SESSION` KV bez `id`** — adapter v13 sam wstrzykuje binding KV (i `IMAGES`),
   o które projekt nie prosił. Deploy przeszedł mimo braku `id`. Nadal warto
   rozważyć `session: false` w `astro.config.mjs`, bo auth idzie przez ciasteczka
   Supabase i sklep sesji Astro jest tu zbędny.
3. **Odczyt `astro:env` w scope modułu** — `config-status.ts` czyta sekrety na
   top-levelu modułu. Gdyby workerd odrzucił to jako niedozwoloną operację
   globalną, każda strona zwracałaby 500. Zwraca 200.
4. **Publikacja bundle'a serwera jako publicznego assetu** — nie nastąpiła.
   `GET /wrangler.json` → 404.

## Trzy błędne komendy znalezione w `infrastructure.md`

Plik z decyzją platformową zawierał komendy, które nie działają dla wersji
przypiętych w tym repo. Wszystkie trzy poprawione w `d951475`; zapisane tutaj,
bo pokazują klasę błędu, nie pojedyncze literówki — komendy przepisane z
dokumentacji platformy bez sprawdzenia wobec konkretnych wersji.

| Zapisane                               | Rzeczywistość                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrangler deploy --yes`                | Flaga nie istnieje w wrangler 4.90. Zwraca `ERROR Unknown argument: yes` i **przerywa deploy**. `-y` jest tylko na `rollback` i `versions deploy` |
| `echo -n "$X" \| wrangler secret put`  | `echo -n` nie istnieje w PowerShell. Właściwa droga to interaktywny prompt — wejście ukryte, wartość nie trafia do historii                       |
| „Rotacja działa od następnego deployu" | Działa natychmiast. `secret put` tworzy **i wdraża** nową wersję; licznik poszedł 1 → 3, co to potwierdziło                                       |

Czwarte ustalenie, dopisane do `infrastructure.md`: **`wrangler tail` nie
raportuje czasu CPU** — pole `cpuTime` nie istnieje w bundle'u wranglera 4.90.
Jedyny sygnał to binarne `outcome: "exceededCpu"`. Konsekwencja: ryzyko 10 ms
CPU jest **niewykrywalne w pętli weryfikacji deployu** i wymaga osobnego
przeglądu Workers Observability, gdy generowanie zacznie istnieć.

## Mechanika, o której trzeba wiedzieć przy każdym kolejnym deployu

**Build musi poprzedzać deploy — strukturalnie, nie z ostrożności.**
`@cloudflare/vite-plugin` generuje `wrangler.json` w `dist/server/` oraz
przekierowanie `.wrangler/deploy/config.json` w roocie, nadpisując `main`
(na zbundlowany chunk) i `assets.directory` (na `../client`). Bez buildu
wrangler czyta root `wrangler.jsonc`, gdzie `assets.directory: "./dist"` jest
bezczynne pod v13, a `main` to niebundlowalny bare specifier.

Dlatego deploy idzie przez `npm run deploy`, nie przez gołą komendę: npm
uruchamia skrypty z katalogu `package.json`, czyli z roota, gdzie leży plik
przekierowania.

`assets.directory: "./dist"` w roocie **zostawiono świadomie** — jest bezczynne,
a jego czyszczenie to osobna zmiana z własną weryfikacją.

## Awaria napotkana w trakcie

Przy pierwszej próbie rejestracji Supabase Auth zwrócił **502 Bad Gateway** na
`/auth/v1/*`, podczas gdy `/rest/v1/` i korzeń projektu odpowiadały normalnie —
czyli awaria dotyczyła samej usługi Auth, nie projektu ani konfiguracji
Cloudflare. Ustąpiła samoczynnie; `/auth/v1/health` wrócił z 200 i rejestracja
przeszła bez żadnej zmiany w kodzie.

Skutek uboczny wart zapamiętania: użytkownik zobaczył **pustą czerwoną ramkę**,
bo `signup.ts` przekazuje `error.message` wprost, a Supabase zwrócił błąd bez
treści. Zapisane jako lekcja w `context/foundation/lessons.md`
(„Komunikat błędu od zewnętrznej usługi może być pusty").

Ustawienia auth projektu, odczytane 2026-08-24: `disable_signup: false`,
`mailer_autoconfirm: false` — czyli **potwierdzenie mailem jest wymagane**, a
`signUp()` w `signup.ts` nie przekazuje `emailRedirectTo`, więc adres w mailu
bierze się wyłącznie z Site URL po stronie Supabase.

## Dług pozostawiony świadomie

Kolejność jest celowa — każdy punkt zależy od poprzedniego.

1. **Warstwa komunikatów po polsku.** Trzy naruszenia PRD potwierdzone na
   produkcji, nie przypuszczane: interfejs po angielsku („10x Astro Starter",
   „Sign in", „Dashboard"), surowe komunikaty Supabase odbite do URL-a
   (`?error=Invalid login credentials`, `?error=Email not confirmed`) oraz pusta
   ramka przy błędzie bez treści. **Do zrobienia przed generowaniem** —
   generowanie doda kolejne tryby awarii (timeout, przekroczony limit, odrzucony
   temat) do tego samego, nieistniejącego mechanizmu.
2. **`secrets.required: ["SUPABASE_URL","SUPABASE_KEY"]`** w `wrangler.jsonc` —
   teraz już można, bo sekrety istnieją. Na nieistniejącym Workerze ta opcja
   rzuca błąd. Zamienia „sekret cicho zniknął" w głośną awarię deployu.
3. **`src/pages/404.astro`** po polsku — dziś nieznana ścieżka zwraca 404 z
   pustym ciałem, bo `not_found_handling: "404-page"` nie ma czego podać.
4. **CI**: naprawić trigger `master` → `main` **osobnym commitem**, potwierdzić
   że przechodzi, i **dopiero potem** dodać job deployu. Inaczej pierwszy
   przebieg CI byłby jednocześnie pierwszym deployem z CI.
5. **`compatibility_date`** — bump to zmiana semantyki Node-compat
   (v1 → v2 przy `2026-08-04`), nie zmiana konfiguracji. Osobny commit, osobny
   deploy, ponowna weryfikacja auth end-to-end.
6. **Token API** — deploy #1 użył OAuth (`wrangler login`). Token o zakresie
   Workers Scripts: Edit + Workers Tail: Read potrzebny dopiero przy
   automatyzacji. Uwaga: selektor zasobów wydaje się działać z granularnością
   konta, nie skryptu, więc „token tylko do tego Workera" prawdopodobnie nie
   jest osiągalny — realne kontrole to jednoprojektowe konto, TTL i filtr IP.

## Rollback

Deploy #1 nie miał celu rollbacku — rolę tę pełniły `--dry-run` i inspekcja
artefaktów. Od teraz cel istnieje:

```
npx wrangler versions list --json
npx wrangler rollback <VERSION_ID> -y -m "powód"
```

Dwa zastrzeżenia specyficzne dla tego Workera:

1. **Rollback przed wersję, która ustawiła sekrety, wyzeruje sekrety** — wersje
   zapisują swoje bindingi. Aplikacja cicho wróci do polskiego bannera
   „Supabase nie jest skonfigurowany" z wyłączonym auth, i **będzie to wyglądać
   jak w pełni udany rollback**. Po każdym rollbacku uruchom `secret list` i
   sprawdź, czy banner nie wrócił.
2. Kod się cofa, migracje Supabase nie. Dziś `supabase/migrations/` nie istnieje,
   więc nie dotyczy — ale zacznie dotyczyć przy pierwszej zmianie schematu.

Zdjęcie z powietrza bez usuwania Workera: `"workers_dev": false` w
`wrangler.jsonc`, rebuild, redeploy.

## Bramki ludzkie utrzymane

Wykonane ręcznie przy tym wdrożeniu i takie mające pozostać: utworzenie Workera
(nazwa nieodwracalna), rejestracja subdomeny workers.dev, uwierzytelnienie
Cloudflare, wybór klucza Supabase (**musi być publishable/anon — `service_role`
obchodzi RLS i cicho łamie gwarancję izolacji kont, bez błędu i bez testu, który
by to wyłapał**), wpisanie wartości sekretów, oraz `git push`.

Agent może bez pytania: `npm run deploy`, `versions upload`, `deployments list`,
`versions list`, `secret list`, `tail`, `rollback`.

Ceremonia nie powinna rosnąć — deploy #1 był jednorazowo nieodwracalny, kolejne
nie są. Utrzymywanie tej samej liczby bramek po przejściu nieodwracalnego kroku
jest tym, jak deploye przestają się dziać.

## Niedomknięte

**Korelacja `wrangler tail`** — jedyny punkt z dwunastu w liście kontrolnej
weryfikacji, którego nie zaliczono. `wrangler tail` nie wypisuje nic w środowisku
bez TTY, więc nie potwierdzono, że żądanie assetu (`/favicon.png`) **nie**
wywołuje Workera. Do domknięcia w interaktywnym terminalu:
`npx wrangler tail --format json`.

Nie jest to krytyczne: echo parametru z query stringa
(`/auth/signin?error=SSR-PROBE-...`) już rozstrzyga, że treść pochodzi z SSR, a
nie ze statycznego artefaktu.

### Główny problem

Ludzie chcą szybko dostać krótki, śmieszny lub ciekawy tekst na konkretny temat („kot programisty”, „poniedziałek w open space”), ale dziś muszą albo szukać w internecie czegoś, co nigdy nie pasuje dokładnie do ich tematu, albo samodzielnie promptować model językowy i walczyć z formatowaniem, długością i tonem.

Aplikacja rozwiązuje to jednym ruchem: user podaje tematykę, wybiera format (**kawał** albo **opowiadanie**) i dostaje gotowy tekst dopasowany do wybranej długości i tonu. Konto (logowanie) jest potrzebne, żeby: (a) user miał swoją historię wygenerowanych tekstów i mógł do nich wrócić, (b) móc limitować koszty generowania per user.

**Reguła domenowa (nie samo CRUD):** generowanie jest ograniczone kontraktem `temat + format + długość + ton`. Aplikacja nie przepuszcza dowolnego promptu do modelu — waliduje temat (długość, język, blokada treści niedozwolonych), a następnie sama buduje prompt pod wybrany format. Kawał ma zwrotkę-puentę i limit ~60 słów; opowiadanie ma początek/rozwinięcie/zakończenie i limit ~400 słów. Wynik, który nie spełnia kontraktu formatu, jest generowany ponownie (maks. 1 retry), a potem zwracany jest czytelny błąd.

---

### Najmniejszy zestaw funkcjonalności
 
1. **Rejestracja i logowanie** — e-mail + hasło, sesja utrzymywana między wejściami, wylogowanie. Wszystkie ekrany poza logowaniem/rejestracją wymagają zalogowania.
2. **Formularz generowania** — pole „tematyka” (tekst, 3–200 znaków) + wybór formatu (kawał / opowiadanie) + wybór długości (krótkie / średnie / długie).
3. **Generowanie tekstu** — wysłanie żądania do modelu LLM po stronie serwera, walidacja tematu przed wysłaniem, budowa promptu pod format, wyświetlenie wyniku ze stanem „generuję…” i czytelnym błędem przy niepowodzeniu.
4. **Zapis wyniku** — każde udane generowanie zapisuje się automatycznie na koncie usera (temat, format, długość, treść, data).
5. **Historia moich generacji** — lista wygenerowanych tekstów zalogowanego usera (najnowsze na górze), podgląd pełnej treści, usunięcie pozycji.
6. **Kopiowanie do schowka** — jeden przycisk „Kopiuj” na wyniku i w podglądzie z historii.
7. **Limit generowań** — twardy licznik na usera na dobę (np. 10), z komunikatem po przekroczeniu. Chroni koszt API i jest częścią reguły domenowej, nie „nice to have”.

**Pierwszy przepływ dający wartość (happy path):** rejestracja → wpisanie tematu → wybór „kawał” → generowanie → skopiowanie wyniku. Cztery kroki, jedna integracja (LLM), do zamknięcia w ~1 tygodniu pracy po godzinach.

---

### Co NIE wchodzi w zakres MVP

- **Logowanie społecznościowe** (Google / GitHub / OAuth), magic link, 2FA, reset hasła przez e-mail (w MVP hasło zmienia się tylko przez support/ręcznie).
- **Współdzielenie i publiczne linki** — brak publicznych URL-i do wygenerowanych tekstów, brak feedu, brak „trending”, brak polubień i komentarzy.
- **Eksport** do PDF/DOCX, wysyłanie mailem, integracje z social media.
- **Edycja i regeneracja fragmentów** — brak edytora treści, brak „przepisz ten akapit”, brak wersjonowania wyniku.
- **Zaawansowana personalizacja** — brak własnych szablonów promptów, brak wyboru modelu, brak parametrów typu temperatura, brak wyboru gatunku opowiadania (horror/sci-fi/bajka) poza domyślnym neutralnym tonem.
- **Wielojęzyczność** — MVP obsługuje jeden język interfejsu i generowania (polski).
- **Płatności i plany** — brak subskrypcji, brak Stripe'a, brak płatnych limitów. Limit dobowy jest stały dla wszystkich.
- **Moderacja treści przez człowieka**, panel administracyjny, zgłaszanie nadużyć.
- **Obrazy, głos, audio** — brak ilustracji do opowiadań, brak TTS.
- **Tryb offline, aplikacja mobilna, rozszerzenie do przeglądarki.**
- **Analityka produktowa i A/B testy** poza podstawowym logowaniem błędów.

---

### Kryteria zakresu

Kryteria wpuszczenia funkcjonalności do MVP — funkcja wchodzi tylko wtedy, gdy spełnia **wszystkie** cztery:

1. **Leży na happy pathie.** Bez niej nie da się przejść ścieżki „zaloguj się → podaj temat → dostań tekst → skopiuj go”. Jeśli da się przejść, funkcja idzie na after-MVP.
2. **Nie wymaga nowej integracji zewnętrznej.** MVP ma dokładnie jedną integrację (dostawca LLM) plus baza danych i auth. Każda kolejna usługa zewnętrzna (mailing, płatności, storage plików, OAuth provider) dyskwalifikuje funkcję z MVP.
3. **Mieści się w budżecie ~1 tygodnia pracy po godzinach.** Szacowanie robimy na całość, nie na pojedynczą funkcję: jeśli po dodaniu funkcji suma przekracza tydzień, funkcja wypada — nie przedłużamy MVP.
4. **Jest weryfikowalna bez pytania człowieka o opinię.** Musi istnieć jednoznaczny test (klik lub automatyczny) mówiący „działa / nie działa”. „Czy kawał jest śmieszny” nie jest kryterium zakresu — „czy kawał mieści się w limicie 60 słów i ma puentę w ostatnim zdaniu” już jest.

Kryteria zamknięcia MVP (definition of done dla całości):

- Nowy user może się zarejestrować, zalogować i wygenerować kawał oraz opowiadanie bez pomocy dokumentacji.
- Udane generowanie zwraca tekst w < 15 s dla „krótkie/średnie” i < 30 s dla „długie”; przekroczenie kończy się komunikatem, nie zawieszeniem interfejsu.
- Każdy udany wynik pojawia się w historii usera i jest widoczny po ponownym zalogowaniu.
- User nie widzi cudzych generacji — próba wejścia na obcy zasób zwraca 404/403.
- Przekroczenie limitu dobowego blokuje generowanie z jasnym komunikatem, a nie błędem 500.
- Nieudane wywołanie LLM (timeout, błąd dostawcy, odrzucony temat) zawsze kończy się czytelnym komunikatem po polsku.

---

### Otwarte pytania

- Jaki dostawca i model LLM (wpływa na koszt, latencję i limit dobowy)? — poza zakresem tej notatki, decyzja należy do etapu wyboru stacku.
- Czy limit 10 generowań/dobę jest właściwy, czy powinien zależeć od formatu (opowiadanie droższe niż kawał)?
- Czy „długość” to trzy presety, czy suwak liczby słów? Notatka zakłada trzy presety jako prostsze do walidacji.
- Jak dokładnie definiujemy „temat niedozwolony” — lista blokowanych kategorii czy moderacja po stronie dostawcy LLM?

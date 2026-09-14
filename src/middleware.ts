import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { isBlocked } from "@/lib/account-blocked";
import { jsonError } from "@/lib/api-response";

// Trasy chronione dopasowywane po PREFIKSIE.
const PROTECTED_ROUTES = ["/dashboard", "/generations", "/generate"];

// Trasy chronione dopasowywane DOKLADNIE. "/" nie moze wejsc do listy powyzej:
// jako prefiks pasuje do kazdej sciezki, w tym do /auth/signin, co dalo by
// nieskonczona petle przekierowan. Strona glowna to generator, wiec wymaga sesji.
const PROTECTED_EXACT = ["/"];

/**
 * Sciezki, ktorych bramka blokady NIE dotyczy.
 *
 * TO NIE JEST ULATWIENIE, TYLKO WARUNEK DZIALANIA. Bramka przekierowuje na
 * `/auth/signin`; bez wylaczenia z niej samej sciezki `/auth/*` powstalaby petla
 * przekierowan i zablokowany NIGDY nie zobaczylby komunikatu, dla ktorego to
 * wszystko powstalo.
 *
 * `/api/auth/` jest tu z drugiego powodu: zablokowany musi moc sie WYLOGOWAC.
 * Wylogowanie to `POST /api/auth/signout`, a odcinanie komus mozliwosci
 * zakonczenia wlasnej sesji byloby uwiezieniem go w niej, nie zablokowaniem.
 * Logowaniu ta furtka nie szkodzi — zablokowanemu i tak odmawia dostawca.
 */
const BLOCK_GATE_EXEMPT = ["/auth/", "/api/auth/"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const { pathname } = context.url;

  // BRAMKA BLOKADY — drugi, niezalezny mechanizm wobec odmowy logowania (FR-016).
  //
  // Dostawca pilnuje DRZWI WEJSCIOWYCH i robi to sam. Ta bramka pilnuje tego, KTO
  // JEST JUZ W SRODKU: zmierzone 2026-09-14, po zablokowaniu konta jego trwajaca
  // sesja czytala dane jeszcze przez 60 minut — tyle, ile zyje token. Bez tego
  // bloku zablokowanie konta nie mialoby natychmiastowego skutku, a FR-016 mowi
  // "nie moze korzystac z produktu", nie "nie zaloguje sie ponownie".
  //
  // STOI PRZED sprawdzeniem `isProtected`, i to jest istotne: strona glowna z
  // generatorem jest w `PROTECTED_EXACT`, ale zakres tej bramki jest SZERSZY niz
  // lista tras chronionych. Zawezenie jej do `PROTECTED_ROUTES` zostawiloby luki
  // tam, gdzie pojawi sie kolejna trasa — a pominiecie w TEJ liscie nie rzuca
  // bledem, tylko cicho przepuszcza zablokowanego.
  //
  // `banned_until` przychodzi w odpowiedzi `getUser()` powyzej, wiec bramka nie
  // kosztuje ani jednego dodatkowego zapytania.
  const exemptFromBlockGate = BLOCK_GATE_EXEMPT.some((prefix) => pathname.startsWith(prefix));

  if (!exemptFromBlockGate && isBlocked(context.locals.user)) {
    // DWA KSZTALTY ODPOWIEDZI, JEDEN KONTRAKT BLEDU — regula z CLAUDE.md.
    // Przekierowanie w odpowiedzi na `fetch()` z wyspy byloby dla niej HTML-em
    // ze statusem 200: `readApiError` nie znalazlby tam zadnego kodu, a uzytkownik
    // zobaczylby komunikat domyslny zamiast informacji o zawieszeniu dostepu.
    if (pathname.startsWith("/api/")) {
      return jsonError("ACCOUNT_BLOCKED");
    }

    // Parametr niesie KOD, nie tresc — strona logowania rozwiazuje go przez
    // slownik, wiec komunikat nie podrozuje w adresie.
    return context.redirect("/auth/signin?error=ACCOUNT_BLOCKED");
  }

  const isProtected =
    PROTECTED_EXACT.includes(pathname) || PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

  if (isProtected && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  return next();
});

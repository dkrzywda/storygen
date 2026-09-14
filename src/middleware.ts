import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { blockGateDecision } from "@/lib/account-blocked";
import { jsonError } from "@/lib/api-response";

// Trasy chronione dopasowywane po PREFIKSIE.
const PROTECTED_ROUTES = ["/dashboard", "/generations", "/generate"];

// Trasy chronione dopasowywane DOKLADNIE. "/" nie moze wejsc do listy powyzej:
// jako prefiks pasuje do kazdej sciezki, w tym do /auth/signin, co dalo by
// nieskonczona petle przekierowan. Strona glowna to generator, wiec wymaga sesji.
const PROTECTED_EXACT = ["/"];

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
  // CALA DECYZJA MIESZKA W `blockGateDecision` — funkcji czystej, ktora ma wlasny
  // test (ustalenie F6 przegladu S-11). Tutaj zostaje wylacznie wykonanie jej
  // werdyktu, zeby kod na sciezce KAZDEGO zadania dalo sie sprawdzic bez Dockera.
  //
  // STOI PRZED sprawdzeniem `isProtected`, i to jest istotne: zakres tej bramki jest
  // SZERSZY niz lista tras chronionych. Zawezenie jej do `PROTECTED_ROUTES` zostawiloby
  // luki tam, gdzie pojawi sie kolejna trasa — a pominiecie w TEJ liscie nie rzuca
  // bledem, tylko cicho przepuszcza zablokowanego.
  //
  // `banned_until` przychodzi w odpowiedzi `getUser()` powyzej, wiec bramka nie
  // kosztuje ani jednego dodatkowego zapytania.
  const decision = blockGateDecision(pathname, context.locals.user);

  if (decision === "json") {
    return jsonError("ACCOUNT_BLOCKED");
  }

  if (decision === "redirect") {
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

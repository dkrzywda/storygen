import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

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
  const isProtected =
    PROTECTED_EXACT.includes(pathname) || PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

  if (isProtected && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  return next();
});

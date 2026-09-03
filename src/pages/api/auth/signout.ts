import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Wylogowanie i tak konczy sie przekierowaniem — uzytkownik nie ma czego
      // poprawic. Ale blad przestaje znikac bez sladu.
      logApiError("auth/signout", toApiErrorCode(error), error);
    }
  }
  return context.redirect("/");
};

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=NOT_CONFIGURED");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // `?error=` niesie kod, nigdy tresci — strona rozwiazuje go przez slownik.
    const code = toApiErrorCode(error);
    logApiError("auth/signin", code, error);
    return context.redirect(`/auth/signin?error=${code}`);
  }

  return context.redirect("/");
};

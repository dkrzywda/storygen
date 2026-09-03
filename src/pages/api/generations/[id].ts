import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { generationTitleSchema, normalizeTitle } from "@/lib/generation-title";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH: APIRoute = async (context) => {
  // `context.locals.user` jest rozwiazywany przez middleware na kazdym zadaniu
  // i jest `null` takze przy niedostepnym Supabase — osobne sprawdzenie klienta
  // nie jest tu potrzebne.
  if (!context.locals.user) {
    return jsonError("UNAUTHORIZED");
  }

  const id = context.params.id;
  // Identyfikator spoza formatu UUID nie moze trafic do zapytania: baza rzucilaby
  // bledem skladni, a uzytkownik dostalby 500 zamiast uczciwego 404.
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError("VALIDATION_FAILED", { _: "Treść żądania musi być poprawnym JSON-em." });
  }

  const parsed = validate(generationTitleSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_FAILED", parsed.fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  const { data, error } = await supabase
    .from("generations")
    .update({ title: normalizeTitle(parsed.data.title) })
    .eq("id", id)
    .select();

  if (error) {
    const code = toApiErrorCode(error);
    logApiError("api/generations/[id]", code, error);
    return jsonError(code);
  }

  // Zero wierszy znaczy "nie istnieje ALBO nie jest Twoj" — handler swiadomie
  // NIE porownuje wlasciciela w kodzie. Porownanie dawaloby ten sam wynik dla
  // poprawnej polityki RLS i maskowalo blad w niepoprawnej.
  if (data.length === 0) {
    return jsonError("NOT_FOUND");
  }

  return jsonOk(data[0]);
};

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { logApiError, toApiErrorCode } from "@/lib/api-errors";
import { validate } from "@/lib/validation";
import { normalizeTitle } from "@/lib/generation-title";
import { generationPatchSchema } from "@/lib/generation-patch";
import type { Database } from "@/lib/database.types";

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

  const parsed = validate(generationPatchSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_FAILED", parsed.fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  // Do zapytania trafiaja WYLACZNIE pola obecne w zadaniu. Porownanie z `undefined`,
  // a nie `in`, bo `rating: null` jest wartoscia znaczaca (kasuje ocene) i musi
  // przejsc, podczas gdy brak pola musi zostac pominiety.
  const update: Database["public"]["Tables"]["generations"]["Update"] = {};
  if (parsed.data.title !== undefined) {
    update.title = normalizeTitle(parsed.data.title);
  }
  if (parsed.data.rating !== undefined) {
    update.rating = parsed.data.rating;
  }
  if (parsed.data.isFavourite !== undefined) {
    update.is_favourite = parsed.data.isFavourite;
  }

  const { data, error } = await supabase.from("generations").update(update).eq("id", id).select();

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

/**
 * Usuniecie pozycji z wlasnej historii (FR-011, S-06).
 *
 * Te same trzy bramki co w `PATCH` i z tych samych powodow — nie powtarzam tu ich
 * uzasadnien, zeby dwa komentarze o tym samym nie rozjechaly sie przy pierwszej zmianie.
 *
 * Rozni sie jednym: nie ma ciala zadania, wiec nie ma czego walidowac. Caly kontrakt
 * wejsciowy to identyfikator w adresie, dlatego nie ma tu schematu Zoda.
 */
export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError("UNAUTHORIZED");
  }

  const id = context.params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("NOT_FOUND");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("NOT_CONFIGURED");
  }

  const { data, error } = await supabase.from("generations").delete().eq("id", id).select("id");

  if (error) {
    const code = toApiErrorCode(error);
    logApiError("api/generations/[id]", code, error);
    return jsonError(code);
  }

  // Zero wierszy znaczy "nie istnieje ALBO nie jest Twoj" — ta sama regula co w `PATCH`.
  // Polityka `generations_delete_own` odfiltrowuje cudze wiersze BEZ rzucania bledem,
  // wiec brak bledu nie znaczy, ze cokolwiek usunieto.
  if (data.length === 0) {
    return jsonError("NOT_FOUND");
  }

  // Endpoint mowi, CO usunal, niezaleznie od tego, co z tym zrobi interfejs.
  return jsonOk({ id: data[0].id });
};

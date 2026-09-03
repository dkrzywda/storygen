import type { ZodType } from "zod";
import type { ApiFieldErrors } from "@/types";

/**
 * Zamienia porazke schematu Zoda na `ApiFieldErrors`.
 *
 * Komunikaty per pole pochodza **z definicji schematu** — autor schematu podaje
 * polski tekst. Domyslne komunikaty Zoda sa po angielsku i wewnetrzne, wiec nigdy
 * nie trafiaja na powierzchnie produktu.
 *
 * Schematy sa wspollokowane z endpointami, ktore ich uzywaja; ten modul niesie
 * wylacznie mechanizm.
 */

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; fields: ApiFieldErrors };

/** Klucz dla bledu dotyczacego calego formularza, a nie konkretnego pola. */
export const FORM_FIELD_KEY = "_";

export function validate<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const fields: ApiFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : FORM_FIELD_KEY;
    // Pierwszy blad na pole wygrywa — uzytkownik dostaje jedna wskazowke, nie liste.
    fields[key] ??= issue.message;
  }

  return { ok: false, fields };
}

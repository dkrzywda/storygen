import { z } from "zod";

/**
 * Schemat tytulu nadawanego recznie zapisanej generacji.
 *
 * NIE lezy obok endpointu, mimo ze tam byloby mu najblizej: w Astro kazdy plik
 * `.ts` pod `src/pages/` staje sie trasa, wiec schemat obok handlera wystawilby
 * publiczny `/api/generations/title-schema`.
 *
 * Komunikaty sa po polsku i pochodza z definicji schematu — domyslne teksty Zoda
 * sa po angielsku i nigdy nie moga trafic na powierzchnie produktu.
 */

/** Ta sama granica co dla tematu w FR-003 — jedna liczba w produkcie zamiast dwoch. */
export const TITLE_MAX_LENGTH = 80;

/**
 * Samo POLE tytulu, wydzielone, bo maja je dwa kontrakty: ten schemat (tytul
 * wymagany) i schemat latki w `@/lib/generation-patch` (tytul opcjonalny, obok
 * oceny i ulubionego). Bez wydzielenia reguly tytulu istnialyby w dwoch kopiach
 * i rozjechalyby sie przy pierwszej zmianie limitu.
 */
export const titleField = z
  .string({ error: "Tytuł musi być tekstem." })
  .transform((value) => value.trim())
  .refine((value) => value.length <= TITLE_MAX_LENGTH, {
    error: `Tytuł może mieć najwyżej ${TITLE_MAX_LENGTH} znaków.`,
  });

export const generationTitleSchema = z.object({ title: titleField });

export type GenerationTitleInput = z.infer<typeof generationTitleSchema>;

/**
 * Pusty tytul ma dwa znaczenia i jedno zachowanie: kasuje nazwe, ustawiajac NULL.
 * Bez tego lista musialaby rozrozniac "brak tytulu" od "tytul bedacy pustym
 * stringiem" przy kazdym renderowaniu — a baza i tak odrzuca pusty string.
 */
export function normalizeTitle(trimmed: string): string | null {
  return trimmed.length === 0 ? null : trimmed;
}

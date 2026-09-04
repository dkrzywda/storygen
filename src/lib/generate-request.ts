import { z } from "zod";

/**
 * Schemat zadania generowania.
 *
 * NIE lezy obok endpointu, bo w Astro kazdy plik `.ts` pod `src/pages/` staje sie
 * trasa — schemat obok handlera wystawilby publiczny endpoint.
 *
 * Komunikaty po polsku pochodza z tej definicji; domyslne teksty Zoda sa po angielsku
 * i nie moga trafic na powierzchnie produktu (`lessons.md`).
 */

/** FR-003: temat miedzy 3 a 80 znakami. Gorna granica broni kontraktu formatu — */
/** krotkie pole wymusza temat, a nie instrukcje w rodzaju "napisz w stylu X, piec akapitow". */
export const TOPIC_MIN = 3;
export const TOPIC_MAX = 80;

export const generateRequestSchema = z.object({
  topic: z
    .string({ error: "Podaj temat." })
    .transform((value) => value.trim())
    .refine((value) => value.length >= TOPIC_MIN, {
      error: `Temat musi mieć co najmniej ${String(TOPIC_MIN)} znaki.`,
    })
    .refine((value) => value.length <= TOPIC_MAX, {
      error: `Temat może mieć najwyżej ${String(TOPIC_MAX)} znaków.`,
    }),

  // Tylko `joke`. Format `story` wchodzi z `S-07` — kontrakt formatu i presety juz
  // go znaja, ale jego limity nie sa zmierzone, wiec endpoint go jeszcze nie przyjmuje.
  format: z.literal("joke", { error: "Wybierz format." }),

  length: z.enum(["short", "medium", "long"], { error: "Wybierz długość." }),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

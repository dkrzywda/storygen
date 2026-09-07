import { z } from "zod";
import { titleField } from "@/lib/generation-title";

/**
 * Schemat czesciowej zmiany zapisanej generacji: tytul, ocena, ulubione.
 *
 * NIE lezy obok endpointu — w Astro kazdy plik `.ts` pod `src/pages/` staje sie
 * trasa, wiec schemat obok handlera wystawilby publiczny endpoint.
 *
 * Kazde pole jest OPCJONALNE, bo interfejs zmienia je niezaleznie: klikniecie
 * gwiazdki nie wysyla tytulu, a przelaczenie ulubionego nie wysyla oceny. Zadanie
 * bez ani jednego pola jest jednak bledem — inaczej pusty JSON dawalby 200 i
 * uzytkownik nie wiedzialby, ze nic sie nie stalo.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

const RATING_RANGE_MESSAGE = `Ocena musi być liczbą od ${String(RATING_MIN)} do ${String(RATING_MAX)}.`;

export const generationPatchSchema = z
  .object({
    title: titleField.optional(),

    // `null` jest wartoscia ZNACZACA — kasuje ocene. Dlatego `.nullable()` obok
    // `.optional()`: brak pola znaczy "nie ruszaj", a `null` znaczy "wyczysc".
    rating: z
      .number({ error: RATING_RANGE_MESSAGE })
      .int({ error: RATING_RANGE_MESSAGE })
      .min(RATING_MIN, { error: RATING_RANGE_MESSAGE })
      .max(RATING_MAX, { error: RATING_RANGE_MESSAGE })
      .nullable()
      .optional(),

    isFavourite: z.boolean({ error: "Oznaczenie ulubionego musi być wartością logiczną." }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: "Nie podano żadnego pola do zmiany.",
  });

export type GenerationPatchInput = z.infer<typeof generationPatchSchema>;

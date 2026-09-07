import { useState } from "react";
import { Heart, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { RATING_MAX } from "@/lib/generation-patch";
import type { ApiErrorBody } from "@/types";

/**
 * Ocena gwiazdkowa i oznaczenie ulubionego jednej zapisanej generacji.
 *
 * Zmiana jest OPTYMISTYCZNA: stan przelacza sie natychmiast, a przy bledzie wraca
 * do poprzedniej wartosci i pokazuje komunikat. Czekanie na odpowiedz serwera przy
 * klikaniu gwiazdek dawaloby interfejs, ktory sprawia wrazenie zepsutego — ale
 * cofniecie musi byc widoczne, inaczej uzytkownik zostaje z falszywym stanem.
 */

interface Props {
  id: string;
  initialRating: number | null;
  initialFavourite: boolean;
}

const STARS = Array.from({ length: RATING_MAX }, (_, index) => index + 1);

export default function RatingControls({ id, initialRating, initialFavourite }: Props) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [favourite, setFavourite] = useState(initialFavourite);
  const [hovered, setHovered] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(patch: { rating?: number | null; isFavourite?: boolean }, rollback: () => void) {
    setError(null);
    try {
      const response = await fetch(`/api/generations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const body: ApiErrorBody = await response.json();
        rollback();
        setError(body.error.message);
      }
    } catch {
      rollback();
      setError("Nie udało się zapisać zmiany. Sprawdź połączenie.");
    }
  }

  function rate(value: number) {
    const previous = rating;
    // Klikniecie w te sama gwiazdke KASUJE ocene. Bez tego raz wystawionej oceny
    // nie da sie wycofac, a pozycja zostaje w rankingu na zawsze.
    const next = previous === value ? null : value;
    setRating(next);
    void send({ rating: next }, () => {
      setRating(previous);
    });
  }

  function toggleFavourite() {
    const previous = favourite;
    setFavourite(!previous);
    void send({ isFavourite: !previous }, () => {
      setFavourite(previous);
    });
  }

  const shown = hovered ?? rating ?? 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-0.5"
          onMouseLeave={() => {
            setHovered(null);
          }}
        >
          {STARS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                rate(value);
              }}
              onMouseEnter={() => {
                setHovered(value);
              }}
              className="p-0.5 transition-transform hover:scale-110"
              aria-label={rating === value ? `Usuń ocenę ${String(value)}` : `Oceń na ${String(value)}`}
              aria-pressed={rating !== null && value <= rating}
            >
              <Star className={cn("size-4", value <= shown ? "fill-amber-300 text-amber-300" : "text-white/25")} />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleFavourite}
          className="flex items-center gap-1 p-0.5 text-xs transition-transform hover:scale-110"
          aria-label={favourite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
          aria-pressed={favourite}
        >
          <Heart className={cn("size-4", favourite ? "fill-rose-400 text-rose-400" : "text-white/25")} />
        </button>

        {rating === null && <span className="text-xs text-blue-100/30">bez oceny</span>}
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

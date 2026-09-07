import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ApiErrorBody } from "@/types";

/**
 * Trwale usuniecie jednej zapisanej generacji (FR-011).
 *
 * Dwa kroki, nie jeden, i to jest cala roznica wobec pozostalych akcji na tej
 * liscie: ocene i ulubione da sie odklikac, usuniecia nie da sie odwrocic w ogole.
 * Dlatego pierwszy klik NIE wysyla zadania — tylko odslania pytanie.
 *
 * Po sukcesie strona sie przeladowuje. Lista jest renderowana serwerowo przez Astro,
 * wiec wyspa nie moze zgasic wiersza bez przeniesienia calego markupu do Reacta.
 * Przeladowanie daje przy okazji zgodnosc numeracji rankingu, ktora po usunieciu
 * i tak sie przesuwa.
 */

interface Props {
  id: string;
}

type Status = "idle" | "confirming" | "deleting";

export default function DeleteButton({ id }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setStatus("deleting");
    setError(null);

    try {
      const response = await fetch(`/api/generations/${id}`, { method: "DELETE" });

      if (!response.ok) {
        const body: ApiErrorBody = await response.json();
        // Komunikat pochodzi z kontraktu bledow, nigdy z tresci technicznej.
        setError(body.error.message);
        setStatus("idle");
        return;
      }

      window.location.reload();
    } catch {
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setStatus("idle");
    }
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setStatus("confirming");
          }}
          className="border-hairline bg-panel text-ink-muted hover:bg-app flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors"
        >
          <Trash2 className="size-3" />
          Usuń
        </button>
        {error && <p className="text-danger text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-ink-muted text-xs">Na pewno?</span>
        <button
          type="button"
          disabled={status === "deleting"}
          onClick={() => void remove()}
          className="bg-danger flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white transition-opacity disabled:opacity-50"
        >
          <Trash2 className="size-3" />
          {status === "deleting" ? "Usuwam…" : "Tak, usuń"}
        </button>
        <button
          type="button"
          disabled={status === "deleting"}
          onClick={() => {
            setStatus("idle");
            setError(null);
          }}
          className="text-ink-muted hover:text-ink text-xs transition-colors disabled:opacity-40"
        >
          Anuluj
        </button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

import { useState } from "react";
import { Check, Eraser, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiErrorBody, ApiSuccessBody } from "@/types";

interface Generation {
  id: string;
  title: string | null;
}

interface TitleEditorProps {
  id: string;
  initialTitle: string | null;
  /** Poczatek wygenerowanego tekstu — pokazywany, gdy pozycja nie ma tytulu. */
  fallback: string;
}

type Status = "idle" | "saving" | "saved";

export default function TitleEditor({ id, initialTitle, fallback }: TitleEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle ?? "");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(nextTitle: string) {
    setStatus("saving");
    setError(null);

    const response = await fetch(`/api/generations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    });

    if (!response.ok) {
      const body = (await response.json()) as ApiErrorBody;
      // Komunikat pola wygrywa nad ogolnym — uzytkownik ma wiedziec, co poprawic.
      setError(body.error.fields?.title ?? body.error.message);
      setStatus("idle");
      return;
    }

    const body = (await response.json()) as ApiSuccessBody<Generation>;
    setTitle(body.data.title);
    setDraft(body.data.title ?? "");
    setEditing(false);
    setStatus("saved");
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm", title ? "font-medium text-white" : "text-blue-100/50 italic")}>
          {title ?? fallback}
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setStatus("idle");
          }}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs text-blue-100/80 transition-colors hover:bg-white/15"
        >
          <Pencil className="size-3" />
          {title ? "Zmień tytuł" : "Nadaj tytuł"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`title-${id}`} className="block text-xs text-blue-100/60">
        Tytuł tej pozycji
      </label>
      <div className="flex gap-2">
        <input
          id={`title-${id}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          placeholder="np. Dowcip na spotkanie zespołu"
          className={cn(
            "w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-blue-100/30",
            error ? "border-red-500/50" : "border-white/20",
          )}
        />
        <button
          type="button"
          disabled={status === "saving"}
          onClick={() => void save(draft)}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
        >
          <Check className="size-4" />
          Zapisz
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Kasowanie jest osobna, nazwana akcja. Gdyby chowalo sie za "zapisz puste",
            uzytkownik kasowalby tytul przez przypadek. */}
        <button
          type="button"
          disabled={status === "saving" || title === null}
          onClick={() => void save("")}
          className="flex items-center gap-1 text-xs text-blue-100/60 underline-offset-2 transition-colors hover:text-blue-100 disabled:opacity-40 disabled:hover:text-blue-100/60"
        >
          <Eraser className="size-3" />
          Usuń tytuł
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(title ?? "");
            setError(null);
          }}
          className="text-xs text-blue-100/60 transition-colors hover:text-blue-100"
        >
          Anuluj
        </button>
        {status === "saving" && <span className="text-xs text-blue-100/50">Zapisywanie…</span>}
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

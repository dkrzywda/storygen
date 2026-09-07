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
      const body: ApiErrorBody = await response.json();
      // Komunikat pola wygrywa nad ogolnym — uzytkownik ma wiedziec, co poprawic.
      setError(body.error.fields?.title ?? body.error.message);
      setStatus("idle");
      return;
    }

    const body: ApiSuccessBody<Generation> = await response.json();
    setTitle(body.data.title);
    setDraft(body.data.title ?? "");
    setEditing(false);
    setStatus("saved");
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm", title ? "text-ink font-medium" : "text-ink-subtle italic")}>{title ?? fallback}</p>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setStatus("idle");
          }}
          className="border-hairline bg-panel text-ink-muted hover:bg-app flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors"
        >
          <Pencil className="size-3" />
          {title ? "Zmień tytuł" : "Nadaj tytuł"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`title-${id}`} className="text-ink-muted block text-xs">
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
            "bg-panel text-ink placeholder:text-ink-subtle w-full rounded-lg border px-3 py-2 text-sm",
            error ? "border-danger" : "border-hairline",
          )}
        />
        <button
          type="button"
          disabled={status === "saving"}
          onClick={() => void save(draft)}
          className="bg-brand hover:bg-brand-strong flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm text-white transition-colors disabled:opacity-50"
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
          className="text-ink-muted hover:text-ink disabled:hover:text-ink-muted flex items-center gap-1 text-xs underline-offset-2 transition-colors disabled:opacity-40"
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
          className="text-ink-muted hover:text-ink text-xs transition-colors"
        >
          Anuluj
        </button>
        {status === "saving" && <span className="text-ink-subtle text-xs">Zapisywanie…</span>}
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

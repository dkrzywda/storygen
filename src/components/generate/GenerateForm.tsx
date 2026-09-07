import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOPIC_MAX, TOPIC_MIN } from "@/lib/generate-request";
import { wordLimitFor } from "@/lib/format-contract";
import RatingControls from "@/components/generations/RatingControls";
import CopyButton from "@/components/generations/CopyButton";
import { wordsLabel } from "@/lib/generation-labels";
import { readApiError } from "@/lib/api-errors";
import type { ApiSuccessBody, GenerationFormat, GenerationResult, LengthPreset } from "@/types";

/**
 * FR-004: dwa formaty i to, czym sie roznia dla uzytkownika.
 *
 * `hint` nie jest ozdoba — bez niego "Dowcip" i "Historia" nie mowia, czego sie
 * spodziewac, a to jest cala roznica miedzy nimi: dowcip ma zaskoczyc, historia
 * ma zostawic mysl.
 */
const FORMATS: { value: GenerationFormat; label: string; hint: string }[] = [
  { value: "joke", label: "Dowcip", hint: "ma być zabawny" },
  { value: "story", label: "Historia", hint: "z mądrą puentą" },
];

/** Teksty zalezne od formatu. Jedno miejsce, zeby etykiety nie rozjechaly sie z wyborem. */
const COPY: Record<GenerationFormat, { topicLabel: string; submit: string; pending: string }> = {
  joke: { topicLabel: "O czym ma być dowcip?", submit: "Wygeneruj dowcip", pending: "Piszę dowcip…" },
  story: { topicLabel: "O czym ma być historia?", submit: "Wygeneruj historię", pending: "Piszę historię…" },
};

const PRESETS: { value: LengthPreset; label: string }[] = [
  { value: "short", label: "Krótki" },
  { value: "medium", label: "Średni" },
  { value: "long", label: "Długi" },
];

type Status = "idle" | "generating" | "done";

export default function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<GenerationFormat>("joke");
  const [preset, setPreset] = useState<LengthPreset>("medium");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  // NFR wymaga CIAGLEGO widocznego postepu przez cale oczekiwanie. Sam spinner
  // nie wystarcza przy 15 s — uzytkownik musi widziec, ze czas plynie, a nie ze
  // cos zawislo. Licznik tyka co 100 ms.
  useEffect(() => {
    if (status !== "generating") {
      return;
    }
    const id = setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
    }, 100);
    return () => {
      clearInterval(id);
    };
  }, [status]);

  const copy = COPY[format];
  const trimmed = topic.trim();
  const canSubmit = trimmed.length >= TOPIC_MIN && trimmed.length <= TOPIC_MAX && status !== "generating";

  /**
   * Podpowiedz przy polu, gdy temat jest poza zakresem.
   *
   * Sam wygaszony przycisk to antywzorzec: uzytkownik widzi, ze nie moze kliknac,
   * i nie wie dlaczego. Serwer waliduje to samo i zwraca wlasny komunikat, ale
   * przy zablokowanym przycisku zadanie nigdy tam nie dociera.
   */
  const topicHint =
    trimmed.length === 0
      ? null
      : trimmed.length < TOPIC_MIN
        ? `Temat musi mieć co najmniej ${String(TOPIC_MIN)} znaki.`
        : trimmed.length > TOPIC_MAX
          ? `Temat może mieć najwyżej ${String(TOPIC_MAX)} znaków.`
          : null;

  const fieldMessage = topicError ?? topicHint;

  async function generate() {
    setStatus("generating");
    setError(null);
    setTopicError(null);
    setResult(null);
    setElapsed(0);
    startedAt.current = Date.now();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, format, length: preset }),
      });

      if (!response.ok) {
        const { message, fields } = await readApiError(response);
        // Komunikat pola wygrywa nad ogolnym — uzytkownik ma wiedziec, co poprawic.
        if (fields?.topic) {
          setTopicError(fields.topic);
        } else {
          setError(message);
        }
        setStatus("idle");
        return;
      }

      const body: ApiSuccessBody<GenerationResult> = await response.json();
      setResult(body.data);
      setStatus("done");
    } catch {
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="text-ink text-sm font-medium">Format</span>
        <div className="flex gap-2">
          {FORMATS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setFormat(option.value);
              }}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                format === option.value
                  ? "border-brand bg-brand-soft text-brand-strong"
                  : "border-hairline bg-panel text-ink-muted hover:bg-app",
              )}
            >
              <span className="block">{option.label}</span>
              <span className="block text-xs opacity-60">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="topic" className="text-ink text-sm font-medium">
            {copy.topicLabel}
          </label>
          <span className={cn("text-xs", trimmed.length > TOPIC_MAX ? "text-danger" : "text-ink-subtle")}>
            {trimmed.length} / {TOPIC_MAX}
          </span>
        </div>
        <input
          id="topic"
          value={topic}
          onChange={(event) => {
            setTopic(event.target.value);
            setTopicError(null);
          }}
          placeholder="np. koty programistów"
          className={cn(
            "bg-panel text-ink placeholder:text-ink-subtle w-full rounded-lg border px-3 py-2",
            fieldMessage ? "border-danger" : "border-hairline",
          )}
        />
        {fieldMessage && <p className="text-danger text-xs">{fieldMessage}</p>}
      </div>

      <div className="space-y-2">
        <span className="text-ink text-sm font-medium">Długość</span>
        <div className="flex gap-2">
          {PRESETS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setPreset(option.value);
              }}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                preset === option.value
                  ? "border-brand bg-brand-soft text-brand-strong"
                  : "border-hairline bg-panel text-ink-muted hover:bg-app",
              )}
            >
              <span className="block">{option.label}</span>
              {/* Limit slow pokazany wprost — wybor ma byc konkretny, nie estetyczny. */}
              <span className="block text-xs opacity-60">do {wordLimitFor(format, option.value)} słów</span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void generate()}
        className="bg-brand hover:bg-brand-strong flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium text-white transition-colors disabled:opacity-40"
      >
        <Sparkles className="size-4" />
        {status === "generating" ? "Piszę…" : copy.submit}
      </button>

      {status === "generating" && (
        <div className="border-hairline bg-panel space-y-2 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <span className="border-hairline border-t-brand size-4 shrink-0 animate-spin rounded-full border-2" />
            <span className="text-ink-muted text-sm">{copy.pending}</span>
            <span className="text-ink-subtle ml-auto font-mono text-sm">{(elapsed / 1000).toFixed(1)} s</span>
          </div>
          <p className="text-ink-subtle text-xs">
            Jeśli pierwsza wersja nie zmieści się w limicie, napiszę ją jeszcze raz.
          </p>
        </div>
      )}

      {error && (
        <p className="border-danger-line bg-danger-soft text-danger rounded-lg border px-3 py-2 text-sm">{error}</p>
      )}

      {result && (
        <div className="border-hairline bg-panel space-y-3 rounded-lg border p-4">
          <p className="text-ink whitespace-pre-wrap">{result.text}</p>
          {/* Zapis moze zawiesc mimo udanego generowania — wtedy `id` jest `null`
              i nie ma czego ocenic. Pokazanie martwych gwiazdek byloby klamstwem. */}
          {result.id !== null && (
            <div className="border-hairline border-t pt-3">
              <RatingControls id={result.id} initialRating={null} initialFavourite={false} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-ink-subtle text-xs">{wordsLabel(result.words)}</span>
            {/* Wspolna wyspa — jedna implementacja kopiowania w produkcie (S-05). */}
            <CopyButton text={result.text} />
          </div>
        </div>
      )}
    </div>
  );
}

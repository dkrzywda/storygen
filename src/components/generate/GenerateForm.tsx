import { useEffect, useRef, useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOPIC_MAX, TOPIC_MIN } from "@/lib/generate-request";
import { wordLimitFor } from "@/lib/format-contract";
import type { ApiErrorBody, ApiSuccessBody, LengthPreset } from "@/types";

interface GenerationResult {
  text: string;
  words: number;
}

const PRESETS: { value: LengthPreset; label: string }[] = [
  { value: "short", label: "Krótki" },
  { value: "medium", label: "Średni" },
  { value: "long", label: "Długi" },
];

type Status = "idle" | "generating" | "done";

export default function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [preset, setPreset] = useState<LengthPreset>("medium");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
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
    setCopied(false);
    setElapsed(0);
    startedAt.current = Date.now();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, format: "joke", length: preset }),
      });

      if (!response.ok) {
        const body: ApiErrorBody = await response.json();
        // Komunikat pola wygrywa nad ogolnym — uzytkownik ma wiedziec, co poprawic.
        if (body.error.fields?.topic) {
          setTopicError(body.error.fields.topic);
        } else {
          setError(body.error.message);
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

  async function copyResult() {
    if (!result) {
      return;
    }
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="topic" className="text-sm font-medium text-white">
            O czym ma być dowcip?
          </label>
          <span className={cn("text-xs", trimmed.length > TOPIC_MAX ? "text-red-300" : "text-blue-100/50")}>
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
            "w-full rounded-lg border bg-white/5 px-3 py-2 text-white placeholder:text-blue-100/30",
            fieldMessage ? "border-red-500/50" : "border-white/20",
          )}
        />
        {fieldMessage && <p className="text-xs text-red-300">{fieldMessage}</p>}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-white">Długość</span>
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
                  ? "border-purple-400 bg-purple-600/30 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/70 hover:bg-white/10",
              )}
            >
              <span className="block">{option.label}</span>
              {/* Limit slow pokazany wprost — wybor ma byc konkretny, nie estetyczny. */}
              <span className="block text-xs opacity-60">do {wordLimitFor("joke", option.value)} słów</span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void generate()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40"
      >
        <Sparkles className="size-4" />
        {status === "generating" ? "Piszę…" : "Wygeneruj dowcip"}
      </button>

      {status === "generating" && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-purple-300" />
            <span className="text-sm text-blue-100/80">Piszę dowcip…</span>
            <span className="ml-auto font-mono text-sm text-blue-100/50">{(elapsed / 1000).toFixed(1)} s</span>
          </div>
          <p className="text-xs text-blue-100/40">
            Jeśli pierwsza wersja nie zmieści się w limicie, napiszę ją jeszcze raz.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/10 p-4">
          <p className="whitespace-pre-wrap text-white">{result.text}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-100/40">{result.words} słów</span>
            <button
              type="button"
              onClick={() => void copyResult()}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-blue-100/80 transition-colors hover:bg-white/15"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Skopiowano" : "Kopiuj"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

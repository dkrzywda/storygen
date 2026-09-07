import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Kopiowanie tekstu do schowka (FR-008) — jedyna implementacja w produkcie.
 *
 * Do S-05 to zachowanie zylo jako kilkanascie linii wewnatrz `GenerateForm`.
 * Okno pozycji historii potrzebuje dokladnie tego samego, a dwie kopie rozjechalyby
 * sie przy pierwszej zmianie — ten sam argument, ktory w S-06 dal `readApiError`.
 *
 * Awaria schowka NIE jest cicha. `navigator.clipboard` odmawia poza bezpiecznym
 * kontekstem i bez gestu uzytkownika; stary kod nie mial `catch`, wiec przycisk
 * po prostu nic nie robil. Tu uzytkownik dostaje komunikat i wie, co zrobic.
 */

interface Props {
  text: string;
}

type Status = "idle" | "copied" | "failed";

const RESET_AFTER_MS = 2000;

export default function CopyButton({ text }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      // `mounted` jest sprawdzany PO `await` w `copy()` — samo czyszczenie timera nie
      // wystarcza, bo timer powstaje dopiero po rozwiazaniu obietnicy schowka, czyli
      // mogl by zostac zaplanowany po odmontowaniu okna. Ustalenie F9 przegladu.
      mounted.current = false;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  async function copy() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    // Nowe klikniecie czysci poprzedni komunikat — tak stan "failed" znika, mimo ze
    // nie ma timera, ktory by go zgasil.
    setStatus("idle");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (mounted.current) {
        setStatus("failed");
      }
      // BEZ timera. "Nie udalo sie skopiowac. Zaznacz tekst i skopiuj recznie." to
      // INSTRUKCJA DO WYKONANIA, nie potwierdzenie — zgaszenie jej po dwoch sekundach
      // odbieraloby uzytkownikowi czas na jej wykonanie. Rodzenstwo (`DeleteButton`,
      // `RatingControls`) trzyma bledy do nastepnej akcji. Ustalenie F1 przegladu.
      return;
    }

    if (!mounted.current) {
      return;
    }
    setStatus("copied");
    timer.current = window.setTimeout(() => {
      setStatus("idle");
    }, RESET_AFTER_MS);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        className="border-hairline bg-panel text-ink-muted hover:bg-app flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      >
        {status === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {status === "copied" ? "Skopiowano" : "Kopiuj"}
      </button>
      {status === "failed" && (
        <p role="alert" className="text-danger text-xs">
          Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.
        </p>
      )}
    </div>
  );
}

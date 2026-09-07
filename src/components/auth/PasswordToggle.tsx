import { Eye, EyeOff } from "lucide-react";

interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
}

export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-ink-subtle hover:text-ink-muted absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
      aria-label={visible ? "Ukryj hasło" : "Pokaż hasło"}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}

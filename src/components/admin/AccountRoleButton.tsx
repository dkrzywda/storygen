import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { readApiError } from "@/lib/api-errors";
import { losesOwnAccess, planRoleAction, roleActionLabel, type RoleActionContext } from "@/lib/account-role-action";

/**
 * Nadanie i odebranie roli administratora przy wierszu konta (FR-018, S-10).
 *
 * WYSPA JEST CIENKA Z ZALOZENIA. Decyzje — czy pytac, czy wysylac, z jakim
 * potwierdzeniem — podejmuje `@/lib/account-role-action`, bo to maszyna stanow,
 * a nie renderowanie, i bo repo nie ma infrastruktury do testowania komponentow.
 * Tutaj zostaje wylacznie stan interakcji i wywolanie sieci.
 *
 * Uklad dwoch krokow, przenoszenie focusu na "Anuluj" i przeladowanie po sukcesie
 * sa przepisane z `@/components/generations/DeleteButton` — razem z ustaleniami
 * trzech przegladow, ktore ten komponent uksztaltowaly.
 */

interface Props extends RoleActionContext {
  accountId: string;
  email: string;
}

type Status = "idle" | "confirming" | "sending" | "demoted";

export default function AccountRoleButton({ accountId, email, role, isSelf, isLastAdmin }: Props) {
  const context: RoleActionContext = { role, isSelf, isLastAdmin };

  const [status, setStatus] = useState<Status>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Flaga `isLastAdmin` przyszla z serwera przy renderowaniu strony i moze byc
   * NIEAKTUALNA — ktos mogl w miedzyczasie zmienic role w drugiej karcie. Gdy baza
   * odpowie `LAST_ADMIN_CONFIRM_REQUIRED` mimo `isLastAdmin === false`, pytamy
   * i zapamietujemy, ze kolejne wyslanie ma niesc jawna zgode.
   */
  const [forceConfirmLast, setForceConfirmLast] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus na "Anuluj", nie na "Tak" — domyslny cel focusu ma byc bezpieczny.
  // Galezie renderuja rozlaczne drzewa przyciskow, wiec bez tego focus spada na `body`.
  useEffect(() => {
    if (status === "confirming") {
      cancelRef.current?.focus();
    }
  }, [status]);

  async function apply(confirmed: boolean) {
    const action = planRoleAction(context, confirmed);

    if (action.kind === "confirm") {
      setWarning(action.warning);
      setError(null);
      setStatus("confirming");
      return;
    }

    setStatus("sending");
    setError(null);

    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: action.targetRole,
          confirmLast: action.confirmLast || forceConfirmLast,
        }),
      });

      if (!response.ok) {
        // `readApiError` zawsze zwraca komunikat — takze gdy cialo nie jest JSON-em
        // albo `message` jest puste. Patrz uzasadnienie w `@/lib/api-errors`.
        const { code, message } = await readApiError(response);

        if (code === "LAST_ADMIN_CONFIRM_REQUIRED") {
          // Baza wie lepiej niz flaga sprzed renderowania. Pytamy teraz.
          setWarning(message);
          setForceConfirmLast(true);
          setStatus("confirming");
          return;
        }

        setError(message);
        setStatus("idle");
        return;
      }

      if (losesOwnAccess(context)) {
        // NIE przeladowujemy od razu. Sekcja administratora zniknie przy nastepnym
        // zadaniu, a ciche zniknniecie calej sekcji wyglada identycznie jak awaria —
        // `lessons.md` § "Degradacja odczytu nie chroni renderowania".
        setStatus("demoted");
        return;
      }

      // Tabela jest renderowana serwerowo, wiec wyspa nie zmieni cudzego wiersza
      // bez przeniesienia calego markupu do Reacta. Przeladowanie odswieza przy
      // okazji `is_last_admin`, ktore po kazdej zmianie moze byc inne w KAZDYM wierszu.
      window.location.reload();
    } catch {
      // Tu naprawde nie doszlo do serwera — dopiero teraz diagnoza sieciowa jest uczciwa.
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setStatus("idle");
    }
  }

  if (status === "demoted") {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink text-xs">Rola administratora została zdjęta z Twojego konta.</p>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="border-hairline bg-panel text-ink-muted hover:bg-app shrink-0 rounded-lg border px-2 py-1 text-xs transition-colors"
        >
          Odśwież panel
        </button>
      </div>
    );
  }

  /**
   * Galaz potwierdzenia PRZEZYWA wysylanie, i to jest istotne, nie kosmetyczne.
   *
   * Gdyby znikala przy `sending`, dwa szybkie klikniecia w "Tak, zdejmij" trafilyby
   * oba w ten sam render i wyslaly dwa zadania — a `disabled` nie mialby czego
   * blokowac. Ostrzezenie tez by zniklo w polowie operacji, ktora wlasnie przez nie
   * wymagala potwierdzenia.
   *
   * `warning !== null` odroznia ta sciezke od wyslania BEZ pytania (nadanie roli,
   * zdjecie obcemu koncie), ktore tez przechodzi przez `sending`.
   */
  if (warning !== null && (status === "confirming" || status === "sending")) {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink-muted max-w-xs text-right text-xs">{warning}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={status === "sending"}
            onClick={() => void apply(true)}
            className="bg-danger hover:bg-danger-strong flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white transition-colors disabled:opacity-50"
          >
            <ShieldOff className="size-3" />
            {status === "sending" ? "Zapisuję…" : "Tak, zdejmij"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={status === "sending"}
            onClick={() => {
              setStatus("idle");
              setWarning(null);
              setError(null);
            }}
            className="text-ink-muted hover:text-ink text-xs transition-colors disabled:opacity-40"
          >
            Anuluj
          </button>
        </div>
      </div>
    );
  }

  const label = roleActionLabel(context);
  const Icon = role === "admin" ? ShieldOff : ShieldCheck;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={status === "sending"}
        onClick={() => void apply(false)}
        aria-label={`${label} — ${email}`}
        className="border-hairline bg-panel text-ink-muted hover:bg-app flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap transition-colors disabled:opacity-50"
      >
        <Icon className="size-3" />
        {status === "sending" ? "Zapisuję…" : label}
      </button>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

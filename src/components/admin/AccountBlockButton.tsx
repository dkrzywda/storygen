import { useEffect, useRef, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { readApiError } from "@/lib/api-errors";
import {
  blockActionAriaLabel,
  blockActionLabel,
  losesOwnAccess,
  planBlockAction,
  type BlockActionContext,
} from "@/lib/account-block-action";

/**
 * Zablokowanie i odblokowanie konta przy wierszu (FR-016, S-11).
 *
 * WYSPA JEST CIENKA Z ZALOZENIA. Decyzje — czy pytac, czy wysylac, z jakim
 * potwierdzeniem — podejmuje `@/lib/account-block-action`, bo to maszyna stanow,
 * a nie renderowanie, i bo repo nie ma infrastruktury do testowania komponentow.
 * Tutaj zostaje wylacznie stan interakcji i wywolanie sieci.
 *
 * Uklad dwoch krokow, przenoszenie focusu na „Anuluj" i stan koncowy przed
 * przeladowaniem sa przepisane z `@/components/admin/AccountRoleButton` — razem
 * z ustaleniami przegladow, ktore tamten komponent uksztaltowaly. Powtorzenie,
 * a nie wspolny komponent: oba przyciski maja wlasne kody, wlasne ostrzezenia
 * i wlasny stan koncowy, a sklejenie ich dalo by komponent z dwoma trybami,
 * ktorego kazda galaz i tak trzeba czytac osobno.
 */

interface Props extends BlockActionContext {
  accountId: string;
  email: string;
}

/**
 * `done` i `blockedSelf` to DWA ROZNE stany koncowe, oba istniejace dla przypadku,
 * w ktorym przeladowanie NIE dojdzie (brak sieci, blad SSR, uspiona karta).
 *
 * Bez nich przycisk zostawalby na zawsze w „Zapisuje…", zablokowany, choc stan
 * w bazie jest juz zmieniony — czyli ekran klamalby w strone zachecajaca do
 * drugiej proby. Ustalenie F5 przegladu calosci `S-10`.
 */
type Status = "idle" | "confirming" | "sending" | "done" | "blockedSelf";

export default function AccountBlockButton({ accountId, email, isBlocked, isSelf, isLastAdmin }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Baza powiedziala, ze to JEST ostatni czynny administrator, choc flaga
   * z renderowania mowila inaczej. Od tego momentu traktujemy wiersz tak samo.
   *
   * Wartosc wchodzi do KONTEKSTU maszyny stanow, a nie tylko do ciala zadania —
   * ustalenie F1 przegladu `S-10`. Inaczej kolejne klikniecie pytaloby slabszym
   * ostrzezeniem („blokujesz wlasne konto"), a wysylalo jawna zgode na zakonczenie
   * administracji — i „Anuluj" z poprzedniej proby przenosiloby sie po cichu
   * jako ta zgoda.
   */
  const [knownLastAdmin, setKnownLastAdmin] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Kontekst decyzji ZAWSZE laczy to, co przyszlo z serwera, z tym, czego
  // dowiedzielismy sie od bazy — zeby ostrzezenie i wysylana zgoda opisywaly
  // ten sam stan swiata.
  const context: BlockActionContext = { isBlocked, isSelf, isLastAdmin: isLastAdmin || knownLastAdmin };

  // Focus na „Anuluj", nie na „Tak" — domyslny cel focusu ma byc bezpieczny.
  // Galezie renderuja rozlaczne drzewa przyciskow, wiec bez tego focus spada na `body`.
  useEffect(() => {
    if (status === "confirming") {
      cancelRef.current?.focus();
    }
  }, [status]);

  /** Powrot do spoczynku kasuje stan INTERAKCJI, ale NIE `knownLastAdmin` — patrz wyzej. */
  function reset() {
    setStatus("idle");
    setWarning(null);
    setError(null);
  }

  async function apply(confirmed: boolean) {
    const action = planBlockAction(context, confirmed);

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
        // `blocked` BEZ `role` — endpoint odrzuca cialo z obiema wartosciami.
        body: JSON.stringify({ blocked: action.targetBlocked, confirmLast: action.confirmLast }),
      });

      if (!response.ok) {
        // `readApiError` zawsze zwraca komunikat — takze gdy cialo nie jest JSON-em
        // albo `message` jest puste. Patrz uzasadnienie w `@/lib/api-errors`.
        const { code, message } = await readApiError(response);

        if (code === "LAST_ADMIN_CONFIRM_REQUIRED") {
          // Baza wie lepiej niz flaga sprzed renderowania. Zapamietujemy to
          // W KONTEKSCIE i pytamy jej wlasnym komunikatem.
          setKnownLastAdmin(true);
          setWarning(message);
          setStatus("confirming");
          return;
        }

        setError(message);
        // Ostrzezenie znika razem z powrotem do spoczynku — inaczej zostawaloby
        // osierocone, opisujac probe, ktorej juz nie ma.
        setWarning(null);
        setStatus("idle");
        return;
      }

      if (losesOwnAccess(context)) {
        // NIE przeladowujemy. Przeladowanie trafiloby w bramke z fazy 2 i wyrzucilo
        // uzytkownika na ekran logowania BEZ slowa o tym, ze sam to zrobil —
        // a ciche wypchniecie wyglada identycznie jak awaria.
        setStatus("blockedSelf");
        return;
      }

      // Stan koncowy USTAWIANY PRZED przeladowaniem, nie zamiast niego: gdy
      // przeladowanie nie dojdzie, ekran mowi prawde zamiast wisiec na „Zapisuje…".
      setStatus("done");
      // Tabela jest renderowana serwerowo, wiec wyspa nie zmieni cudzego wiersza
      // bez przeniesienia calego markupu do Reacta. Przeladowanie odswieza przy
      // okazji `is_last_admin`, ktore po kazdej zmianie moze byc inne w KAZDYM wierszu.
      window.location.reload();
    } catch {
      // Tu naprawde nie doszlo do serwera — dopiero teraz diagnoza sieciowa jest uczciwa.
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setWarning(null);
      setStatus("idle");
    }
  }

  if (status === "blockedSelf") {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink max-w-xs text-right text-xs">
          Twoje konto zostało zablokowane. Przy następnym żądaniu zostaniesz wylogowany, a odblokować Cię może tylko
          inny administrator.
        </p>
        <a
          href="/auth/signin"
          className="border-hairline bg-panel text-ink-muted hover:bg-app shrink-0 rounded-lg border px-2 py-1 text-xs transition-colors"
        >
          Przejdź do logowania
        </a>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div role="status" className="flex flex-col items-end gap-1">
        <p className="text-ink-subtle text-xs">{isBlocked ? "Odblokowano" : "Zablokowano"}</p>
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
   * Gdyby znikala przy `sending`, dwa szybkie klikniecia w „Tak, zablokuj" trafilyby
   * oba w ten sam render i wyslaly dwa zadania — a `disabled` nie mialby czego
   * blokowac. Ostrzezenie tez by zniklo w polowie operacji, ktora wlasnie przez nie
   * wymagala potwierdzenia.
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
            <Lock className="size-3" />
            {status === "sending" ? "Zapisuję…" : "Tak, zablokuj"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={status === "sending"}
            onClick={reset}
            className="text-ink-muted hover:text-ink text-xs transition-colors disabled:opacity-40"
          >
            Anuluj
          </button>
        </div>
      </div>
    );
  }

  const label = blockActionLabel(context);
  const Icon = isBlocked ? LockOpen : Lock;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={status === "sending"}
        onClick={() => void apply(false)}
        aria-label={blockActionAriaLabel(context, email)}
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

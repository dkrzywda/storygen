import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { readApiError } from "@/lib/api-errors";
import {
  losesOwnAccess,
  planRoleAction,
  roleActionAriaLabel,
  roleActionLabel,
  type RoleActionContext,
} from "@/lib/account-role-action";

/**
 * Nadanie i odebranie roli administratora przy wierszu konta (FR-018, S-10).
 *
 * WYSPA JEST CIENKA Z ZALOZENIA. Decyzje — czy pytac, czy wysylac, z jakim
 * potwierdzeniem — podejmuje `@/lib/account-role-action`, bo to maszyna stanow,
 * a nie renderowanie, i bo repo nie ma infrastruktury do testowania komponentow.
 * Tutaj zostaje wylacznie stan interakcji i wywolanie sieci.
 *
 * Uklad dwoch krokow, przenoszenie focusu na "Anuluj" i stan koncowy przed
 * przeladowaniem sa przepisane z `@/components/generations/DeleteButton` — razem
 * z ustaleniami przegladow, ktore tamten komponent uksztaltowaly.
 */

interface Props extends RoleActionContext {
  accountId: string;
  email: string;
}

/**
 * `done` i `demoted` to DWA ROZNE stany koncowe, oba istniejace dla przypadku,
 * w ktorym przeladowanie NIE dojdzie (brak sieci, blad SSR, uspiona karta).
 *
 * Bez nich przycisk zostawalby na zawsze w "Zapisuje…", zablokowany, choc rola
 * w bazie jest juz zmieniona — czyli ekran klamalby w strone zachecajaca do
 * drugiej proby. Ustalenie F4 przegladu calosci S-10 ("Brak stanu koncowego przed
 * `reload()`"); ten sam powod, dla ktorego
 * `DeleteButton` ma stan `deleted` (tam: ustalenie F5 tamtego przegladu).
 */
type Status = "idle" | "confirming" | "sending" | "done" | "demoted";

export default function AccountRoleButton({ accountId, email, role, isSelf, isLastAdmin }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Baza powiedziala, ze to JEST ostatnia rola, choc flaga z renderowania mowila
   * inaczej. Od tego momentu traktujemy wiersz jak ostatnia role.
   *
   * KIEDY TO NAPRAWDE MOZE PASC — wezej, niz sugerowalby odruch (ustalenie F2).
   * Wolajacy musi byc adminem, inaczej dostalby `FORBIDDEN`; jest wiec liczony
   * w tych, ktorych baza sprawdza. Gdy cel jest KIMS INNYM i ma role, adminow jest
   * co najmniej dwoch i `LAST_ADMIN_NEEDS_CONFIRM` paść NIE MOZE. Ta sciezka jest
   * osiagalna wylacznie dla WLASNEGO wiersza: zaczales jako jeden z dwoch, ktos
   * odebral role temu drugiemu, a Ty w tym czasie potwierdzales slabsze ostrzezenie.
   *
   * Wartosc wchodzi do KONTEKSTU maszyny stanow, a nie tylko do ciala zadania
   * (ustalenie F3 przegladu calosci S-10: "`forceConfirmLast` przezywal «Anuluj»
   * i blad"). Inaczej kolejne klikniecie pytaloby slabszym ostrzeznieniem
   * ("stracisz dostep"), a wysylalo jawna zgode na zakonczenie administracji —
   * i "Anuluj" z poprzedniej proby przenosiloby sie po cichu jako ta zgoda.
   */
  const [knownLastAdmin, setKnownLastAdmin] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Kontekst decyzji ZAWSZE laczy to, co przyszlo z serwera, z tym, czego
  // dowiedzielismy sie od bazy. Dzieki temu ostrzezenie i wysylana zgoda opisuja
  // ten sam stan swiata.
  const context: RoleActionContext = { role, isSelf, isLastAdmin: isLastAdmin || knownLastAdmin };

  // Focus na "Anuluj", nie na "Tak" — domyslny cel focusu ma byc bezpieczny.
  // Galezie renderuja rozlaczne drzewa przyciskow, wiec bez tego focus spada na `body`.
  useEffect(() => {
    if (status === "confirming") {
      cancelRef.current?.focus();
    }
  }, [status]);

  /**
   * Powrot do spoczynku kasuje stan INTERAKCJI, ale NIE `knownLastAdmin`.
   *
   * To celowe i jest sednem naprawy F1: "ta rola jest ostatnia" to fakt o koncie,
   * ktorego dowiedzielismy sie od bazy, a nie stan tej jednej proby. Skasowanie go
   * przy "Anuluj" sprawiloby, ze kolejne klikniecie znowu pyta SLABSZYM ostrzeznieniem
   * ("stracisz dostep") o operacje, ktora konczy administracje. Zapamietany, wchodzi
   * do `context` powyzej, wiec ostrzezenie i wysylana zgoda opisuja to samo.
   */
  function reset() {
    setStatus("idle");
    setWarning(null);
    setError(null);
  }

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
        // Bez sklejania z osobna flaga — `context` juz ja niesie.
        body: JSON.stringify({ role: action.targetRole, confirmLast: action.confirmLast }),
      });

      if (!response.ok) {
        // `readApiError` zawsze zwraca komunikat — takze gdy cialo nie jest JSON-em
        // albo `message` jest puste. Patrz uzasadnienie w `@/lib/api-errors`.
        const { code, message } = await readApiError(response);

        if (code === "LAST_ADMIN_CONFIRM_REQUIRED") {
          // Baza wie lepiej niz flaga sprzed renderowania. Zapamietujemy to W KONTEKSCIE
          // i pytamy jej wlasnym komunikatem.
          setKnownLastAdmin(true);
          setWarning(message);
          setStatus("confirming");
          return;
        }

        setError(message);
        // Ostrzezenie znika razem z powrotem do spoczynku — inaczej zostawaloby
        // osierocone, opisujac probe, ktorej juz nie ma (ustalenie F7).
        setWarning(null);
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

      // Stan koncowy USTAWIANY PRZED przeladowaniem, nie zamiast niego: gdy
      // przeladowanie nie dojdzie, ekran mowi prawde zamiast wisiec na "Zapisuje…".
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

  if (status === "demoted") {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink max-w-xs text-right text-xs">
          Rola administratora została zdjęta z Twojego konta.{" "}
          {/* Ustalenie F5 przegladu calosci S-10 ("Po degradacji siebie reszta tabeli
              przeczy stanowi") — numer poprawiony po przegladzie faz 3-4; wczesniej
              stal tu F4, zamieniony miejscami z numerem w naglowku tego pliku.
              Wyspa zmienia TYLKO swoja komorke, wiec
              kolumna "Rola" w tym wierszu i przyciski przy pozostalych wierszach nadal
              pokazuja stan sprzed operacji. Klikniecie ktoregokolwiek z nich trafi teraz
              w odmowe i pokaze "Nie znaleziono takiej pozycji" dla konta widocznego na
              ekranie. Taniej powiedziec to wprost, niz gasic cudze wiersze z tej wyspy. */}
          <span className="text-ink-muted">
            Reszta tej tabeli pokazuje jeszcze stan sprzed zmiany i żadna operacja w niej już nie zadziała.
          </span>
        </p>
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

  if (status === "done") {
    return (
      <div role="status" className="flex flex-col items-end gap-1">
        <p className="text-ink-subtle text-xs">Zmieniono rolę</p>
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
            onClick={reset}
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
        aria-label={roleActionAriaLabel(context, email)}
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

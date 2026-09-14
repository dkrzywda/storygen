import { useEffect, useRef, useState } from "react";
import { Lock, LockOpen, ShieldCheck, ShieldOff } from "lucide-react";
import { readApiError } from "@/lib/api-errors";
import {
  losesOwnAccess as roleLosesOwnAccess,
  planRoleAction,
  roleActionAriaLabel,
  roleActionLabel,
  type RoleActionContext,
} from "@/lib/account-role-action";
import {
  blockActionAriaLabel,
  blockActionLabel,
  losesOwnAccess as blockLosesOwnAccess,
  planBlockAction,
  type BlockActionContext,
} from "@/lib/account-block-action";
import type { AccountRole } from "@/types";

/**
 * Wszystkie dzialania administratora przy JEDNYM wierszu konta.
 *
 * ============================================================================
 *  DLACZEGO JEDNA WYSPA ZAMIAST TRZECH
 * ============================================================================
 *
 * Wczesniej kazdy przycisk byl osobna wyspa React. Przeglad `S-11` odnotowal
 * wynikajacy z tego wyscig (ustalenie F5) i przyjal go jako ryzyko z adnotacja:
 * „do przemyslenia razem z trzecia wyspa przy `S-12`, a nie po kawalku".
 * Oto ten moment.
 *
 * Dwie niezalezne wyspy po sukcesie na cudzym koncie woalaly `window.location.reload()`.
 * Gdy obie byly w locie, ta, ktora skonczyla pierwsza, przeladowywala strone
 * i wynik drugiej ginal. Tutaj stan interakcji jest JEDEN, wiec dwie operacje nie
 * moga biec naraz i nie ma czego gubic.
 *
 * Drugi zysk jest policzalny: jeden korzen hydracji na wiersz zamiast dwoch —
 * przy sufcie 200 wierszy 200 zamiast 400, a po dolozeniu usuwania 200 zamiast
 * 600. To domyka F10 przegladu `S-10` w kierunku, o ktory tamto ustalenie
 * prosilo, BEZ zmiany dyrektywy hydracji, ktora bez pomiaru byla by
 * optymalizacja na oko.
 *
 * ============================================================================
 *  CO SIE NIE ZMIENIA, A CO TAK
 * ============================================================================
 *
 * MASZYNY STANOW ZOSTAJA OSOBNE. `@/lib/account-role-action` i
 * `@/lib/account-block-action` nie sa scalane — scala sie wylacznie renderowanie
 * i stan interakcji. Decyzja „czy pytac, czy wysylac" nadal mieszka w funkcjach
 * czystych, ktore maja wlasne testy; ta wyspa zostaje cienka.
 *
 * ZACHOWANIE KAZDEJ OPERACJI JEST IDENTYCZNE. Zmienia sie jedna rzecz i jest nia
 * cel calego refaktoru: operacje nie moga sie juz PRZEPLATAC. W trakcie
 * potwierdzania jednej, druga jest niedostepna — wczesniej obie byly klikalne
 * naraz, i wlasnie stad bral sie wyscig.
 *
 * Wszystkie ustalenia, ktore uksztaltowaly oba poprzednie komponenty, sa tu
 * przeniesione: `knownLastAdmin` wchodzi do KONTEKSTU maszyny stanow i nie kasuje
 * go powrot do spoczynku (F3 przegladu calosci `S-10`); focus siada na „Anuluj";
 * galaz potwierdzenia PRZEZYWA wysylanie; stan koncowy ustawiany PRZED
 * przeladowaniem (F4); oba stany odbierajace wolajacemu dostep mowia, ze reszta
 * tabeli przeczy juz stanowi (F5).
 */

interface Props {
  accountId: string;
  email: string;
  role: AccountRole;
  isSelf: boolean;
  isLastAdmin: boolean;
  isBlocked: boolean;
}

/** Ktora operacja jest w toku. `null` znaczy spoczynek. */
type Akcja = "rola" | "blokada";

/**
 * `done`, `demoted` i `blockedSelf` to stany koncowe, wszystkie istniejace dla
 * przypadku, w ktorym przeladowanie NIE dojdzie (brak sieci, blad SSR, uspiona
 * karta). Bez nich przycisk zostawalby na zawsze w „Zapisuje…", choc stan w bazie
 * jest juz zmieniony — czyli ekran klamalby w strone zachecajaca do drugiej proby
 * (ustalenie F4 przegladu calosci `S-10`).
 */
type Status = "idle" | "confirming" | "sending" | "done" | "demoted" | "blockedSelf";

export default function AccountActions({ accountId, email, role, isSelf, isLastAdmin, isBlocked }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [akcja, setAkcja] = useState<Akcja | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Baza powiedziala, ze to JEST ostatnia rola albo ostatni czynny administrator,
   * choc flaga z renderowania mowila inaczej.
   *
   * Wartosc wchodzi do KONTEKSTU obu maszyn stanow, a nie tylko do ciala zadania
   * — ustalenie F3 przegladu calosci `S-10`. Inaczej kolejne klikniecie pytaloby
   * slabszym ostrzezeniem, a wysylalo jawna zgode na zakonczenie administracji,
   * i „Anuluj" z poprzedniej proby przenosiloby sie po cichu jako ta zgoda.
   *
   * WSPOLNA DLA OBU OPERACJI, bo opisuje KONTO, nie operacje: skoro to ostatni
   * czynny administrator, jest nim tak samo dla zdjecia roli, jak dla blokady.
   */
  const [knownLastAdmin, setKnownLastAdmin] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const ostatni = isLastAdmin || knownLastAdmin;
  const roleContext: RoleActionContext = { role, isSelf, isLastAdmin: ostatni };
  const blockContext: BlockActionContext = { isBlocked, isSelf, isLastAdmin: ostatni };

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
    setAkcja(null);
    setWarning(null);
    setError(null);
  }

  async function apply(ktora: Akcja, confirmed: boolean) {
    // CIALO ZADANIA POWSTAJE W TEJ SAMEJ GALEZI, CO DECYZJA. Wczesniejsza wersja
    // liczyla akcje raz, a potem odgadywala jej ksztalt przez `in` — czyli
    // sprawdzaniem, ktore typ juz raz rozstrzygnal. Tutaj kazda galaz oddaje
    // komplet: ostrzezenie albo gotowe cialo.
    const plan =
      ktora === "rola"
        ? (() => {
            const a = planRoleAction(roleContext, confirmed);
            return a.kind === "confirm"
              ? ({ kind: "confirm", warning: a.warning } as const)
              : ({ kind: "send", body: { role: a.targetRole, confirmLast: a.confirmLast } } as const);
          })()
        : (() => {
            const a = planBlockAction(blockContext, confirmed);
            return a.kind === "confirm"
              ? ({ kind: "confirm", warning: a.warning } as const)
              : ({ kind: "send", body: { blocked: a.targetBlocked, confirmLast: a.confirmLast } } as const);
          })();

    if (plan.kind === "confirm") {
      setAkcja(ktora);
      setWarning(plan.warning);
      setError(null);
      setStatus("confirming");
      return;
    }

    setAkcja(ktora);
    setStatus("sending");
    setError(null);

    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Cialo niesie `role` ALBO `blocked`, nigdy oba — endpoint odrzuca zadanie
        // z obiema wartosciami.
        body: JSON.stringify(plan.body),
      });

      if (!response.ok) {
        // `readApiError` zawsze zwraca komunikat — takze gdy cialo nie jest JSON-em
        // albo `message` jest puste.
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
        // osierocone, opisujac probe, ktorej juz nie ma (ustalenie F7 `S-10`).
        setWarning(null);
        setStatus("idle");
        return;
      }

      const traciDostep = ktora === "rola" ? roleLosesOwnAccess(roleContext) : blockLosesOwnAccess(blockContext);
      if (traciDostep) {
        // NIE przeladowujemy. Przy roli sekcja administratora zniknie przy
        // nastepnym zadaniu; przy blokadzie przeladowanie trafiloby w bramke
        // z `S-11` i wyrzucilo uzytkownika na logowanie BEZ slowa o tym, ze sam
        // to zrobil. Ciche zniknniecie wyglada identycznie jak awaria.
        setStatus(ktora === "rola" ? "demoted" : "blockedSelf");
        return;
      }

      // Stan koncowy USTAWIANY PRZED przeladowaniem, nie zamiast niego.
      setStatus("done");
      // Tabela jest renderowana serwerowo, wiec wyspa nie zmieni cudzego wiersza.
      // Przeladowanie odswieza przy okazji `is_last_admin` i `is_blocked`, ktore
      // po kazdej zmianie moga byc inne w KAZDYM wierszu.
      window.location.reload();
    } catch {
      // Tu naprawde nie doszlo do serwera — dopiero teraz diagnoza sieciowa jest uczciwa.
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setWarning(null);
      setStatus("idle");
    }
  }

  const odswiez = (
    <button
      type="button"
      onClick={() => {
        window.location.reload();
      }}
      className="border-hairline bg-panel text-ink-muted hover:bg-app shrink-0 rounded-lg border px-2 py-1 text-xs transition-colors"
    >
      Odśwież panel
    </button>
  );

  /**
   * Zdanie o nieaktualnej reszcie tabeli — ustalenie F5 przegladu calosci `S-10`,
   * wspolne dla obu stanow odbierajacych wolajacemu dostep. Wyspa zmienia TYLKO
   * swoja komorke, wiec pozostale wiersze pokazuja jeszcze stan sprzed operacji.
   */
  const resztaTabeli = (
    <span className="text-ink-muted">
      Reszta tej tabeli pokazuje jeszcze stan sprzed zmiany i żadna operacja w niej już nie zadziała.
    </span>
  );

  if (status === "demoted") {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink max-w-xs text-right text-xs">
          Rola administratora została zdjęta z Twojego konta. {resztaTabeli}
        </p>
        {odswiez}
      </div>
    );
  }

  if (status === "blockedSelf") {
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink max-w-xs text-right text-xs">
          Twoje konto zostało zablokowane. Przy następnym żądaniu zostaniesz wylogowany, a odblokować Cię może tylko
          inny administrator. {resztaTabeli}
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
        <p className="text-ink-subtle text-xs">
          {akcja === "rola" ? "Zmieniono rolę" : isBlocked ? "Odblokowano" : "Zablokowano"}
        </p>
        {odswiez}
      </div>
    );
  }

  /**
   * Galaz potwierdzenia PRZEZYWA wysylanie, i to jest istotne, nie kosmetyczne.
   *
   * Gdyby znikala przy `sending`, dwa szybkie klikniecia w „Tak" trafilyby oba
   * w ten sam render i wyslaly dwa zadania — a `disabled` nie mialby czego
   * blokowac. Ostrzezenie tez by zniklo w polowie operacji, ktora wlasnie przez
   * nie wymagala potwierdzenia.
   *
   * `warning !== null` odroznia te sciezke od wyslania BEZ pytania (nadanie roli,
   * odblokowanie, dzialanie na cudzym koncie), ktore tez przechodzi przez `sending`.
   */
  if (warning !== null && akcja !== null && (status === "confirming" || status === "sending")) {
    const Ikona = akcja === "rola" ? ShieldOff : Lock;
    return (
      <div role="alert" className="flex flex-col items-end gap-1">
        <p className="text-ink-muted max-w-xs text-right text-xs">{warning}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={status === "sending"}
            onClick={() => void apply(akcja, true)}
            className="bg-danger hover:bg-danger-strong flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white transition-colors disabled:opacity-50"
          >
            <Ikona className="size-3" />
            {status === "sending" ? "Zapisuję…" : akcja === "rola" ? "Tak, zdejmij" : "Tak, zablokuj"}
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

  const RolaIkona = role === "admin" ? ShieldOff : ShieldCheck;
  const BlokadaIkona = isBlocked ? LockOpen : Lock;
  const przycisk =
    "border-hairline bg-panel text-ink-muted hover:bg-app flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      {/* PIONOWO, NIE OBOK SIEBIE. Szerokosc komorki rowna sie wtedy najszerszemu
          przyciskowi, a nie ich sumie — tabela ma zmierzone 0 px zapasu. */}
      <button
        type="button"
        disabled={status === "sending"}
        onClick={() => void apply("rola", false)}
        aria-label={roleActionAriaLabel(roleContext, email)}
        className={przycisk}
      >
        <RolaIkona className="size-3" />
        {status === "sending" && akcja === "rola" ? "Zapisuję…" : roleActionLabel(roleContext)}
      </button>
      <button
        type="button"
        disabled={status === "sending"}
        onClick={() => void apply("blokada", false)}
        aria-label={blockActionAriaLabel(blockContext, email)}
        className={przycisk}
      >
        <BlokadaIkona className="size-3" />
        {status === "sending" && akcja === "blokada" ? "Zapisuję…" : blockActionLabel(blockContext)}
      </button>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

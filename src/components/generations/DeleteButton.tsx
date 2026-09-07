import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { readApiError } from "@/lib/api-errors";

/**
 * Trwale usuniecie jednej zapisanej generacji (FR-011).
 *
 * Dwa kroki, nie jeden, i to jest cala roznica wobec pozostalych akcji na tej
 * liscie: ocene i ulubione da sie odklikac, usuniecia nie da sie odwrocic w ogole.
 * Dlatego pierwszy klik NIE wysyla zadania — tylko odslania pytanie.
 *
 * Po sukcesie strona sie przeladowuje. Lista jest renderowana serwerowo przez Astro,
 * wiec wyspa nie moze zgasic wiersza bez przeniesienia calego markupu do Reacta.
 * Przeladowanie daje przy okazji zgodnosc numeracji rankingu, ktora po usunieciu
 * i tak sie przesuwa.
 */

interface Props {
  id: string;
  /**
   * Adres, na ktory isc po udanym usunieciu. Bez niego strona sie przeladowuje —
   * to wlasciwe na liscie. W oknie pozycji (`/generations?open=<id>`) przeladowanie
   * odpytaloby o wiersz, ktorego juz nie ma, i pokazalo 404 zamiast listy; tam
   * wywolujacy podaje `/generations`.
   *
   * Typ jest UNIA ZNANYCH TRAS, nie `string` — ustalenie F5 przegladu. Wartosc idzie
   * wprost do `location.replace`, wiec `string` pozwolilby przyszlemu wywolaniu
   * przepuscic tu parametr adresu i zrobic z przycisku otwarte przekierowanie.
   * Poszerzenie unii ma byc decyzja, nie przypadkiem.
   */
  afterDelete?: "/generations";
}

/**
 * Stan `deleted` istnieje dla przypadku, w ktorym przeladowanie NIE dojdzie
 * (brak sieci, blad SSR, uspiona karta). Bez niego wiersz zostawalby na ekranie
 * z przyciskiem zablokowanym na "Usuwam...", choc w bazie go juz nie ma — czyli
 * interfejs klamalby w strone zachecajaca do drugiej proby, a ta zwrocilaby
 * celowe 404 dla pozycji, na ktora uzytkownik patrzy. Ustalenie F5 przegladu.
 */
type Status = "idle" | "confirming" | "deleting" | "deleted";

export default function DeleteButton({ id, afterDelete }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  /**
   * Focus przenoszony jawnie na "Anuluj" — ustalenie F2 przegladu.
   *
   * Galezie spoczynku i potwierdzenia renderuja ROZLACZNE drzewa przyciskow, wiec
   * po klikniecu "Usun" element z focusem jest odmontowany i focus spada na `body`.
   * Bez tego kolejny Tab startuje od gory dokumentu, a nie od pytania. Celem jest
   * "Anuluj", nie "Tak, usun": domyslny cel focusu ma byc bezpieczny.
   */
  useEffect(() => {
    if (status === "confirming") {
      cancelRef.current?.focus();
    }
  }, [status]);

  async function remove() {
    setStatus("deleting");
    setError(null);

    try {
      const response = await fetch(`/api/generations/${id}`, { method: "DELETE" });

      if (!response.ok) {
        // `readApiError` zawsze zwraca komunikat — takze gdy cialo nie jest JSON-em
        // albo `message` jest puste. Patrz uzasadnienie w `@/lib/api-errors`.
        const { message } = await readApiError(response);
        setError(message);
        setStatus("idle");
        return;
      }

      setStatus("deleted");
      if (afterDelete) {
        // `replace`, nie `assign` — inaczej Wstecz wracalby na ?open=<usuniety id>
        // i pokazywal 404 dla pozycji, ktora uzytkownik wlasnie skasowal (F4).
        window.location.replace(afterDelete);
      } else {
        window.location.reload();
      }
    } catch {
      // Tu naprawde nie doszlo do serwera — dopiero teraz diagnoza sieciowa jest uczciwa.
      setError("Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
      setStatus("idle");
    }
  }

  if (status === "deleted") {
    return <p className="text-ink-subtle shrink-0 text-xs">Usunięto</p>;
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setStatus("confirming");
          }}
          className="border-hairline bg-panel text-ink-muted hover:bg-app flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors"
        >
          <Trash2 className="size-3" />
          Usuń
        </button>
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className="flex shrink-0 items-center gap-2">
      <span className="text-ink-muted text-xs">Na pewno? Tego nie da się odwrócić.</span>
      <button
        type="button"
        disabled={status === "deleting"}
        onClick={() => void remove()}
        className="bg-danger hover:bg-danger-strong flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white transition-colors disabled:opacity-50"
      >
        <Trash2 className="size-3" />
        {status === "deleting" ? "Usuwam…" : "Tak, usuń"}
      </button>
      <button
        ref={cancelRef}
        type="button"
        disabled={status === "deleting"}
        onClick={() => {
          setStatus("idle");
          setError(null);
        }}
        className="text-ink-muted hover:text-ink text-xs transition-colors disabled:opacity-40"
      >
        Anuluj
      </button>
    </div>
  );
}

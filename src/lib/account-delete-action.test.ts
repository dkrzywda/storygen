import { describe, expect, it } from "vitest";
import {
  canOfferDelete,
  deleteActionAriaLabel,
  deleteActionLabel,
  planDeleteAction,
  type DeleteActionContext,
} from "@/lib/account-delete-action";

/**
 * Maszyna stanow przycisku usuwania (S-12, FR-017).
 *
 * CZEGO TEN PLIK NIE DOWODZI: ze usuniecie jest EGZEKWOWANE ani ze zgoda jest
 * wymagana. Oba egzekwuje BAZA — `delete_account()` odmawia bez
 * `p_confirm_destroy` i odmawia usuniecia wlasnego konta, takze wolajacemu
 * przez PostgREST wprost. Tutaj sprawdzam wylacznie, czy klikniecie pyta i czy
 * pytanie mowi prawde o tym, co zniknie.
 */

const ctx = (over: Partial<DeleteActionContext> = {}): DeleteActionContext => ({
  isSelf: false,
  generations: 0,
  ...over,
});

describe("planDeleteAction", () => {
  // PYTA ZAWSZE — nie ma przypadku „wyslij od razu", ktory maja pozostale dwie
  // operacje. Usuniecia nie da sie odkliknac.
  it.each([0, 1, 4, 12, 200])("pyta takze przy %i generacjach", (generations) => {
    const action = planDeleteAction(ctx({ generations }), false);
    expect(action.kind).toBe("confirm");
  });

  it("po potwierdzeniu wysyla", () => {
    expect(planDeleteAction(ctx({ generations: 5 }), true).kind).toBe("send");
  });
});

describe("ostrzezenie mowi, CO zniknie", () => {
  // TO JEST SEDNO GUARDRAILA Z PRD: „nic nie niszczy zapisanych generacji bez
  // uprzedzenia, na powierzchni produktu, CO zostanie zniszczone". Ostrzezenie
  // bez liczby spelnia wymog tylko pozornie.
  it("niesie liczbe generacji", () => {
    const action = planDeleteAction(ctx({ generations: 7 }), false);
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.warning).toContain("7");
    }
  });

  it("zawsze mowi o nieodwracalnosci", () => {
    for (const generations of [0, 1, 5]) {
      const action = planDeleteAction(ctx({ generations }), false);
      if (action.kind === "confirm") {
        expect(action.warning).toContain("nie da się cofnąć");
      }
    }
  });

  // Zero jest informacja, ze nie ma czego zalowac — lepiej powiedziec to wprost
  // niz napisac „0 tekstow".
  it("konto bez generacji dostaje inne zdanie, nie zero", () => {
    const action = planDeleteAction(ctx({ generations: 0 }), false);
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.warning).toContain("Nie ma zapisanych tekstów");
      expect(action.warning).not.toContain("0 tekst");
    }
  });

  describe("polska odmiana liczebnika", () => {
    // Zla forma nie rzuci bledem — sprawi tylko, ze komunikat o nieodwracalnej
    // operacji zabrzmi jak maszyna, a ma byc przeczytany uwaznie.
    it.each([
      [1, "1 tekst"],
      [2, "2 teksty"],
      [3, "3 teksty"],
      [4, "4 teksty"],
      [5, "5 tekstów"],
      [11, "11 tekstów"],
      // Nastolatki sa wyjatkiem: 12 tekstOW, nie „12 teksty".
      [12, "12 tekstów"],
      [14, "14 tekstów"],
      [22, "22 teksty"],
      [25, "25 tekstów"],
      [102, "102 teksty"],
      [111, "111 tekstów"],
    ])("%i → %s", (generations, oczekiwane) => {
      const action = planDeleteAction(ctx({ generations }), false);
      expect(action.kind).toBe("confirm");
      if (action.kind === "confirm") {
        expect(action.warning).toContain(oczekiwane);
      }
    });
  });

  // PRZYMIOTNIK MUSI SIE ODMIENIC RAZEM Z RZECZOWNIKIEM.
  //
  // Pierwsza wersja sprawdzala tylko forme pojedyncza i przechodzila na zielono,
  // podczas gdy ekran pokazywal „wraz z jego zapisanym tekstami". Blad wyszedl
  // dopiero przy klikaniu — dlatego obie formy maja teraz wlasny przypadek,
  // a asercja negatywna pilnuje, ze zla forma nie wroci.
  it("liczba pojedyncza: zapisanym tekstem", () => {
    const action = planDeleteAction(ctx({ generations: 1 }), false);
    if (action.kind === "confirm") {
      expect(action.warning).toContain("zapisanym tekstem");
    }
  });

  it.each([2, 3, 5, 12, 40])("liczba mnoga przy %i: zapisanymi tekstami", (generations) => {
    const action = planDeleteAction(ctx({ generations }), false);
    if (action.kind === "confirm") {
      expect(action.warning).toContain("zapisanymi tekstami");
      expect(action.warning).not.toContain("zapisanym tekstami");
    }
  });
});

describe("canOfferDelete", () => {
  // Baza i tak odmowi (`SELF_DELETE_FORBIDDEN`), ale rysowanie przycisku, ktory
  // ZAWSZE odmawia, byloby klamstwem ekranu.
  it("nie oferuje usuniecia przy wlasnym wierszu", () => {
    expect(canOfferDelete(ctx({ isSelf: true }))).toBe(false);
  });

  it("oferuje przy cudzym", () => {
    expect(canOfferDelete(ctx({ isSelf: false }))).toBe(true);
  });

  it("liczba generacji nie ma z tym nic wspolnego", () => {
    expect(canOfferDelete(ctx({ isSelf: true, generations: 99 }))).toBe(false);
    expect(canOfferDelete(ctx({ isSelf: false, generations: 0 }))).toBe(true);
  });
});

describe("etykiety", () => {
  it("tekst przycisku jest krotki — kolumna ma 0 px zapasu", () => {
    expect(deleteActionLabel()).toBe("Usuń");
  });

  it("nazwa dostepna niesie adres i mowi o tekstach, nie tylko o koncie", () => {
    const label = deleteActionAriaLabel("kto@example.test");
    expect(label).toContain("kto@example.test");
    expect(label).toContain("tekstami");
  });
});

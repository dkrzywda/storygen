import { describe, expect, it } from "vitest";
import {
  escapeLike,
  filterLabels,
  filtersToQuery,
  hasAnyFilter,
  parseFilters,
  type GenerationFilters,
} from "@/lib/generation-filters";
import { TOPIC_MAX } from "@/lib/generate-request";

/**
 * Filtry historii — czesc zyjaca w TypeScripcie.
 *
 * Ten plik bierze wszystko, co da sie rozstrzygnac bez bazy: odczyt parametrow adresu,
 * ucieczke znakow `LIKE`, skladanie adresu z powrotem i etykiety. Tego, czy filtr nie
 * omija RLS, dotknac tu NIE MOZNA — to jest w `generations.integration.test.ts`.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseFilters — wartosci poprawne", () => {
  it("pusty adres daje pusty zestaw filtrow", () => {
    expect(parseFilters(params(""))).toEqual({});
  });

  it("czyta wszystkie cztery filtry naraz", () => {
    expect(parseFilters(params("format=story&rating=4&fav=1&q=koty"))).toEqual({
      format: "story",
      minRating: 4,
      favourite: true,
      query: "koty",
    });
  });

  it.each([1, 2, 3, 4, 5])("przyjmuje ocene %i", (rating) => {
    expect(parseFilters(params(`rating=${String(rating)}`)).minRating).toBe(rating);
  });
});

describe("parseFilters — wartosci spoza zbioru sa POMIJANE, nie sa bledem", () => {
  /*
   * Ten sam wybor i to samo uzasadnienie co przy zakladkach panelu: adres wpisuje
   * czlowiek, a literowka nie powinna dawac komunikatu o bledzie. Skutkiem ma byc
   * widok SZERSZY, nie pusty — pominiety filtr niczego nie zaweza.
   */
  it.each([
    ["format=dowcip", "format po polsku"],
    ["format=", "pusty format"],
    ["format=JOKE", "format zla wielkoscia liter"],
    ["rating=0", "ocena ponizej zakresu"],
    ["rating=6", "ocena powyzej zakresu"],
    ["rating=-1", "ocena ujemna"],
    ["rating=2.5", "ocena niecalkowita"],
    ["rating=abc", "ocena nieliczbowa"],
    ["rating=", "pusta ocena"],
    ["fav=0", "ulubione wylaczone"],
    ["fav=true", "ulubione jako true"],
    ["fav=on", "ulubione jako on"],
    ["q=", "pusta fraza"],
    ["q=%20%20", "fraza z samych bialych znakow"],
  ])("pomija %j (%s)", (raw, _opis) => {
    expect(parseFilters(params(raw))).toEqual({});
  });

  it("nieznane parametry nie tworza filtrow", () => {
    expect(parseFilters(params("sort=asc&page=2"))).toEqual({});
  });
});

describe("parseFilters — fraza", () => {
  it("obcina biale znaki z brzegow", () => {
    expect(parseFilters(params("q=%20koty%20")).query).toBe("koty");
  });

  it("obcina fraze do gornej granicy tematu", () => {
    // Dluzsza fraza nie moze mieć trafienia, bo dluzszy temat nie moze istniec (FR-003).
    const long = "a".repeat(TOPIC_MAX + 20);
    expect(parseFilters(params(`q=${long}`)).query).toHaveLength(TOPIC_MAX);
  });

  it("zachowuje znaki specjalne LIKE — ucieczka nalezy do zapytania, nie do odczytu", () => {
    expect(parseFilters(params("q=100%25_pewne")).query).toBe("100%_pewne");
  });
});

describe("escapeLike", () => {
  it("nie rusza zwyklego tekstu", () => {
    expect(escapeLike("koty programistow")).toBe("koty programistow");
  });

  it.each([
    ["100%", "100\\%"],
    ["a_b", "a\\_b"],
    ["a\\b", "a\\\\b"],
    ["%_%", "\\%\\_\\%"],
  ])("ucieka %j do %j", (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });

  /*
   * NAJWAZNIEJSZY PRZYPADEK W TYM PLIKU. Gdyby kolejnosc podmian byla odwrotna,
   * ucieczka dodana dla `%` zostalaby sama poddana ucieczce i wzorzec szukalby
   * doslownego odwrotnego ukosnika. Wynik nadal wygladalby sensownie — bylby nie ten.
   */
  it("radzi sie z odwrotnym ukosnikiem PRZED znakiem specjalnym", () => {
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});

describe("hasAnyFilter", () => {
  it("pusty zestaw to brak filtrow", () => {
    expect(hasAnyFilter({})).toBe(false);
  });

  it.each<[string, GenerationFilters]>([
    ["format", { format: "joke" }],
    ["ocena", { minRating: 3 }],
    ["ulubione", { favourite: true }],
    ["fraza", { query: "koty" }],
  ])("rozpoznaje pojedynczy filtr: %s", (_opis, filters) => {
    expect(hasAnyFilter(filters)).toBe(true);
  });
});

describe("filtersToQuery", () => {
  it("pusty zestaw daje pusty adres", () => {
    expect(filtersToQuery({})).toBe("");
  });

  it("pomija nieustawione klucze", () => {
    expect(filtersToQuery({ format: "joke" })).toBe("format=joke");
  });

  // Stala kolejnosc: ten sam zestaw filtrow musi dawac zawsze ten sam adres, inaczej
  // historia przegladarki zbiera wiele wpisow dla jednego widoku.
  it("zachowuje stala kolejnosc kluczy", () => {
    const filters: GenerationFilters = { query: "koty", favourite: true, minRating: 2, format: "story" };
    expect(filtersToQuery(filters)).toBe("format=story&rating=2&fav=1&q=koty");
  });

  it("jest odwracalne przez parseFilters", () => {
    const filters: GenerationFilters = { format: "story", minRating: 5, favourite: true, query: "100%_pewne" };
    expect(parseFilters(params(filtersToQuery(filters)))).toEqual(filters);
  });
});

describe("filterLabels", () => {
  it("pusty zestaw nie ma etykiet", () => {
    expect(filterLabels({})).toEqual([]);
  });

  it("wylicza aktywne filtry po polsku", () => {
    expect(filterLabels({ format: "joke", minRating: 4, favourite: true, query: "koty" })).toEqual([
      "tylko dowcipy",
      "ocena co najmniej 4",
      "tylko ulubione",
      "temat zawiera „koty”",
    ]);
  });

  it("rozroznia formaty", () => {
    expect(filterLabels({ format: "story" })).toEqual(["tylko historie"]);
  });
});

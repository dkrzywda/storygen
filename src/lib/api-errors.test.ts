import { describe, expect, it } from "vitest";
import {
  API_ERRORS,
  DEFAULT_ERROR_CODE,
  isApiErrorCode,
  messageForCode,
  statusForCode,
  toApiErrorCode,
} from "@/lib/api-errors";
import type { ApiErrorCode } from "@/types";

const ALL_CODES = Object.keys(API_ERRORS) as ApiErrorCode[];

describe("slownik komunikatow", () => {
  it.each(ALL_CODES)("kod %s ma niepusty komunikat", (code) => {
    expect(API_ERRORS[code].message.trim()).not.toBe("");
  });

  it.each(ALL_CODES)("kod %s ma status z zakresu bledow", (code) => {
    expect(statusForCode(code)).toBeGreaterThanOrEqual(400);
    expect(statusForCode(code)).toBeLessThan(600);
  });
});

describe("messageForCode", () => {
  it("zwraca komunikat przypisany do znanego kodu", () => {
    expect(messageForCode("INVALID_CREDENTIALS")).toBe(API_ERRORS.INVALID_CREDENTIALS.message);
  });

  // To jest gwarancja, ze `?error=` przestaje odbijac tresc z URL-a.
  it.each([
    ["dowolny tekst wpisany recznie", "tekst z URL-a"],
    ["Twoje konto wygasło, zadzwoń pod 500-100-200", "tresc phishingowa"],
    ["", "pusty string"],
    ["   ", "same biale znaki"],
    ["invalid_credentials", "kod dostawcy, nie nasz"],
  ])("nie zwraca wejscia %j (%s)", (input, _opis) => {
    const result = messageForCode(input);
    expect(result).toBe(API_ERRORS[DEFAULT_ERROR_CODE].message);
    expect(result).not.toBe(input);
  });

  it.each([[null], [undefined], [42], [{}]])("dla wartosci %j zwraca komunikat domyslny", (input) => {
    expect(messageForCode(input)).toBe(API_ERRORS[DEFAULT_ERROR_CODE].message);
  });
});

describe("isApiErrorCode", () => {
  it("odrzuca wlasnosci z prototypu", () => {
    expect(isApiErrorCode("toString")).toBe(false);
    expect(isApiErrorCode("constructor")).toBe(false);
  });
});

describe("toApiErrorCode", () => {
  it("preferuje kod dostawcy nad trescia", () => {
    expect(toApiErrorCode({ code: "invalid_credentials", message: "cokolwiek innego" })).toBe("INVALID_CREDENTIALS");
  });

  it("mapuje 5xx od dostawcy na PROVIDER_UNAVAILABLE", () => {
    expect(toApiErrorCode({ status: 502, message: "Bad Gateway" })).toBe("PROVIDER_UNAVAILABLE");
  });

  // Incydent z produkcji 2026-08-24: blad istnial, ale nie mial tresci.
  it.each([
    [{ message: "" }, "pusty komunikat"],
    [{ message: "   " }, "same biale znaki"],
    [{ message: "\n\t" }, "same znaki sterujace"],
    [{}, "obiekt bez pol"],
    [null, "null"],
    [undefined, "undefined"],
    ["Invalid login credentials", "goly string zamiast obiektu"],
  ])("dla %j (%s) zwraca kod domyslny", (input, _opis) => {
    expect(toApiErrorCode(input)).toBe(DEFAULT_ERROR_CODE);
  });

  it("mapuje po tresci, gdy dostawca nie podal kodu", () => {
    expect(toApiErrorCode({ message: "Invalid login credentials" })).toBe("INVALID_CREDENTIALS");
    expect(toApiErrorCode({ message: "Email not confirmed" })).toBe("EMAIL_NOT_CONFIRMED");
    expect(toApiErrorCode({ message: "User already registered" })).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("nieznana tresc konczy sie kodem domyslnym", () => {
    expect(toApiErrorCode({ message: "Coś zupełnie nowego od dostawcy" })).toBe(DEFAULT_ERROR_CODE);
  });
});

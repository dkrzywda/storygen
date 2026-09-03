import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FORM_FIELD_KEY, validate } from "@/lib/validation";
import { jsonError, jsonOk } from "@/lib/api-response";
import { API_ERRORS } from "@/lib/api-errors";
import type { ApiErrorBody, ApiSuccessBody } from "@/types";

const topicSchema = z.object({
  topic: z
    .string()
    .trim()
    .min(3, "Temat musi mieć co najmniej 3 znaki.")
    .max(80, "Temat może mieć najwyżej 80 znaków."),
  format: z.enum(["joke", "story"], { message: "Wybierz format." }),
});

describe("validate", () => {
  it("zwraca dane sparsowane przy poprawnym wejsciu", () => {
    const result = validate(topicSchema, { topic: "koty programistow", format: "joke" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.topic).toBe("koty programistow");
    }
  });

  it("zwraca mape pol z komunikatem ze schematu, nie z Zoda", () => {
    const result = validate(topicSchema, { topic: "ab", format: "joke" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.topic).toBe("Temat musi mieć co najmniej 3 znaki.");
    }
  });

  it("zglasza kazde niepoprawne pole osobno", () => {
    const result = validate(topicSchema, { topic: "ab", format: "haiku" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual(["format", "topic"]);
    }
  });

  it("blad calego formularza laduje pod kluczem formularza", () => {
    const result = validate(topicSchema, "to nie jest obiekt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields)).toContain(FORM_FIELD_KEY);
    }
  });
});

describe("jsonError", () => {
  it("wyprowadza status z kodu domenowego", async () => {
    const response = jsonError("VALIDATION_FAILED");
    expect(response.status).toBe(API_ERRORS.VALIDATION_FAILED.status);

    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toBe(API_ERRORS.VALIDATION_FAILED.message);
    expect(body.error.fields).toBeUndefined();
  });

  it("dolacza rozbicie na pola, gdy je podano", async () => {
    const response = jsonError("VALIDATION_FAILED", { topic: "Temat musi mieć co najmniej 3 znaki." });
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.fields).toEqual({ topic: "Temat musi mieć co najmniej 3 znaki." });
  });

  it("dostawca niedostepny daje 502", () => {
    expect(jsonError("PROVIDER_UNAVAILABLE").status).toBe(502);
  });
});

describe("jsonOk", () => {
  it("opakowuje wynik w pole data ze statusem 200", async () => {
    const response = jsonOk({ text: "dowcip" });
    expect(response.status).toBe(200);

    const body = (await response.json()) as ApiSuccessBody<{ text: string }>;
    expect(body.data.text).toBe("dowcip");
  });
});

import { API_ERRORS } from "@/lib/api-errors";
import type { ApiErrorBody, ApiErrorCode, ApiFieldErrors, ApiSuccessBody } from "@/types";

/**
 * Jedyny sposob, w jaki endpointy nie-auth buduja odpowiedz.
 *
 * Status HTTP jest **wyprowadzany z kodu domenowego**, nigdy wpisywany w handlerze —
 * dzieki temu status widoczny w observability Cloudflare zawsze zgadza sie z trescia.
 */

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  // Bez parametru typu — `Response.json` i tak wymazuje typ na granicy sieci,
  // wiec generyk nie kupowalby zadnej gwarancji, a ESLint slusznie go odrzuca.
  const body: ApiSuccessBody<unknown> = { data };
  return Response.json(body, { status: 200, ...init });
}

export function jsonError(code: ApiErrorCode, fields?: ApiFieldErrors): Response {
  const { status, message } = API_ERRORS[code];
  const body: ApiErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
  return Response.json(body, { status });
}

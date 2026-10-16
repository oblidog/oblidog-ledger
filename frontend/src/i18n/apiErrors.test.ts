import { afterEach, expect, test } from "bun:test"
import { AxiosError } from "axios"
import {
  apiErrorPayload,
  getApiErrorMessage,
  isAuthenticationFailure,
} from "./apiErrors"
import { i18n } from "./index"

afterEach(async () => {
  await i18n.changeLanguage("en")
})
const axios = (data: unknown) => ({
  isAxiosError: true,
  code: "ERR_BAD_REQUEST",
  response: { status: 409, data },
})
test("known auth, permission, conflict, lifecycle and demo codes translate in EN/PL", async () => {
  const cases = [
    [
      "auth_invalid_credentials",
      "Incorrect email or password",
      "Nieprawidłowy e-mail lub hasło",
    ],
    [
      "auth_session_expired",
      "Your session has expired. Sign in again.",
      "Sesja wygasła. Zaloguj się ponownie.",
    ],
    [
      "permission_denied",
      "You do not have permission to perform this action",
      "Nie masz uprawnień do wykonania tej operacji",
    ],
    [
      "obligation_conflict",
      "Obligation already exists",
      "Zobowiązanie już istnieje",
    ],
    [
      "obligation_invalid_lifecycle",
      "This action is unavailable for the current obligation status",
      "Ta operacja jest niedostępna dla obecnego statusu zobowiązania",
    ],
    [
      "invitation_expired",
      "This invitation has expired. Ask an administrator to resend it.",
      "To zaproszenie wygasło. Poproś administratora o ponowne wysłanie.",
    ],
    [
      "demo_read_only",
      "Demo is temporarily read-only",
      "Demo jest tymczasowo dostępne tylko do odczytu",
    ],
  ]
  for (const language of ["en", "pl"] as const) {
    await i18n.changeLanguage(language)
    for (const [code, en, pl] of cases)
      expect(
        getApiErrorMessage(
          axios({ code, detail: "arbitrary diagnostic text" }),
        ),
      ).toBe(language === "en" ? en : pl)
  }
})
test("Axios/generated adapter, body wrappers and fetch payloads share extraction", () => {
  const body = {
    code: "integration_conflict",
    detail: { code: "revision_conflict" },
    params: { reason: "revision_conflict" },
  }
  for (const error of [body, axios(body), { error: body }, { body }]) {
    expect(apiErrorPayload(error)).toEqual(body)
    expect(getApiErrorMessage(error)).toBe(
      i18n.t("errors:integration_conflict"),
    )
  }
})
test("Pydantic errors use type/loc/ctx without reading msg or input", async () => {
  await i18n.changeLanguage("pl")
  const issue = (type: string, field: string, ctx?: unknown) =>
    axios({
      code: "request_validation_failed",
      detail: [
        {
          type,
          loc: ["body", field],
          ctx,
          msg: "DO NOT SHOW",
          input: "secret",
        },
      ],
    })
  expect(getApiErrorMessage(issue("missing", "name"))).toBe(
    "Nazwa: to pole jest wymagane",
  )
  expect(
    getApiErrorMessage(
      issue("string_too_short", "password", { min_length: 8 }),
    ),
  ).toBe("Hasło: minimalna długość to 8")
  expect(
    getApiErrorMessage(issue("less_than_equal", "month", { le: 12 })),
  ).toBe("Miesiąc: wartość może wynosić najwyżej 12")
  expect(
    getApiErrorMessage(
      issue("greater_than_equal", "current_amount", { ge: 0 }),
    ),
  ).toBe("Kwota: wartość musi wynosić co najmniej 0")
  expect(getApiErrorMessage(issue("int_parsing", "year"))).toBe(
    "Rok: podaj liczbę całkowitą",
  )
  expect(getApiErrorMessage(issue("date_parsing", "due_date"))).toBe(
    "Termin płatności: podaj poprawną datę",
  )
  expect(getApiErrorMessage(issue("enum", "language"))).toBe(
    "Język: wybierz dostępną opcję",
  )
  expect(
    getApiErrorMessage(
      issue("value_error", "email", { reason: "private exception" }),
    ),
  ).toBe("E-mail: nieprawidłowa wartość")
})
test("legacy validation arrays and nested field locations stay usable", async () => {
  await i18n.changeLanguage("pl")
  expect(
    getApiErrorMessage(
      axios({
        detail: [{ type: "missing", loc: ["body", "items", 0, "name"] }],
      }),
    ),
  ).toBe("Nazwa: to pole jest wymagane")
  expect(
    getApiErrorMessage({
      detail: [{ type: "unknown", loc: ["body", "private_field"] }],
    }),
  ).toBe("Pole: nieprawidłowa wartość")
})
test("malformed validation context and unknown codes never leak diagnostics", async () => {
  await i18n.changeLanguage("pl")
  for (const ctx of [
    undefined,
    null,
    [],
    { min_length: "secret" },
    { min_length: {} },
    { min_length: Number.POSITIVE_INFINITY },
  ])
    expect(
      getApiErrorMessage({
        code: "request_validation_failed",
        detail: [{ type: "string_too_short", loc: ["body", "name"], ctx }],
      }),
    ).toBe("Nazwa: nieprawidłowa wartość")
  for (const error of [
    undefined,
    null,
    "private exception",
    new Error("secret"),
    { detail: { unexpected: "secret" } },
    { detail: "SQL diagnostic" },
    { code: "future_unknown", detail: "secret" },
    { code: {}, detail: "secret" },
  ])
    expect(getApiErrorMessage(error)).toBe(i18n.t("errors:generic_error"))
})
test("network failures have a localized fallback and quota parameters are validated", async () => {
  await i18n.changeLanguage("pl")
  expect(
    getApiErrorMessage(
      new AxiosError("private transport message", "ERR_NETWORK"),
    ),
  ).toBe(i18n.t("errors:network_error"))
  expect(
    getApiErrorMessage({
      code: "demo_limit_reached",
      params: { limit: 3, resource: "ledgers" },
    }),
  ).toBe("Osiągnięto limit demo (3). Dane demo są okresowo resetowane.")
  expect(
    getApiErrorMessage({
      code: "demo_limit_reached",
      params: { limit: { secret: "x" } },
    }),
  ).toBe(i18n.t("errors:generic_error"))
})

test("permission, demo and CSRF failures do not sign the user out", () => {
  for (const code of [
    "permission_denied",
    "demo_read_only",
    "capability_disabled",
    "auth_csrf_invalid",
    "auth_origin_forbidden",
    "future_unknown",
  ])
    expect(
      isAuthenticationFailure({ response: { status: 403, data: { code } } }),
    ).toBe(false)
  for (const code of [
    "auth_required",
    "auth_invalid_token",
    "auth_session_expired",
  ])
    expect(
      isAuthenticationFailure({ response: { status: 403, data: { code } } }),
    ).toBe(true)
  expect(
    isAuthenticationFailure({
      response: { status: 401, data: { detail: "legacy" } },
    }),
  ).toBe(true)
  expect(
    isAuthenticationFailure({
      response: { status: 400, data: { code: "auth_invalid_credentials" } },
    }),
  ).toBe(false)
  expect(isAuthenticationFailure(new Error("offline"))).toBe(false)
})

test("malformed JSON code objects are never coerced to strings", async () => {
  await i18n.changeLanguage("pl")
  for (const error of [
    { code: { toString: null } },
    { code: { toString: {}, valueOf: null } },
    { code: ["ERR_NETWORK"] },
  ]) {
    expect(getApiErrorMessage(error)).toBe(i18n.t("errors:generic_error"))
  }
})

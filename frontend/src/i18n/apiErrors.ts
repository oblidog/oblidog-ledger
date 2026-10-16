import { i18n } from "./index"
import messages from "./locales/en/errors.json"
import fields from "./locales/en/validation.json"

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

/** Accept Axios/generated adapter errors, legacy body wrappers and fetch payloads. */
export function apiErrorPayload(error: unknown): JsonObject | undefined {
  const candidate = object(error)
  if (!candidate) return undefined
  const response = object(candidate.response)
  if (response) return object(response.data)
  return object(candidate.error) ?? object(candidate.body) ?? candidate
}

function fieldLabel(location: unknown): string {
  if (!Array.isArray(location)) return i18n.t("validation:field")
  const path = location.filter((part) => typeof part === "string")
  for (const part of path.reverse()) {
    if (Object.keys(fields.fields).includes(part))
      return i18n.t(`validation:fields.${part as keyof typeof fields.fields}`)
  }
  return i18n.t("validation:field")
}

function validationMessage(value: unknown): string {
  const issue = object(value)
  if (!issue) return i18n.t("errors:request_validation_failed")
  const field = fieldLabel(issue.loc)
  const context = object(issue.ctx)
  const invalid = () => i18n.t("validation:invalid", { field })
  const constraint = (
    key: "min_length" | "max_length" | "gt" | "ge" | "lt" | "le",
    message:
      | "min_length"
      | "max_length"
      | "greater_than"
      | "greater_than_equal"
      | "less_than"
      | "less_than_equal",
  ) => {
    const limit = context?.[key]
    return typeof limit === "number" &&
      Number.isFinite(limit) &&
      Math.abs(limit) <= Number.MAX_SAFE_INTEGER
      ? i18n.t(`validation:${message}`, { field, limit })
      : invalid()
  }
  switch (issue.type) {
    case "missing":
      return i18n.t("validation:required", { field })
    case "string_too_short":
    case "too_short":
      return constraint("min_length", "min_length")
    case "string_too_long":
    case "too_long":
      return constraint("max_length", "max_length")
    case "greater_than":
      return constraint("gt", "greater_than")
    case "greater_than_equal":
      return constraint("ge", "greater_than_equal")
    case "less_than":
      return constraint("lt", "less_than")
    case "less_than_equal":
      return constraint("le", "less_than_equal")
    case "int_parsing":
    case "int_type":
    case "int_from_float":
      return i18n.t("validation:integer", { field })
    case "float_parsing":
    case "float_type":
    case "decimal_parsing":
    case "decimal_type":
    case "finite_number":
      return i18n.t("validation:number", { field })
    case "bool_parsing":
    case "bool_type":
      return i18n.t("validation:boolean", { field })
    case "date_parsing":
    case "date_type":
    case "date_from_datetime_parsing":
    case "date_from_datetime_inexact":
      return i18n.t("validation:date", { field })
    case "datetime_parsing":
    case "datetime_type":
    case "datetime_from_date_parsing":
      return i18n.t("validation:datetime", { field })
    case "enum":
    case "literal_error":
      return i18n.t("validation:choice", { field })
    case "json_invalid":
      return i18n.t("validation:json")
    default:
      return invalid()
  }
}

/** Never present arbitrary server prose, exception messages, input or ctx.error. */
export function getApiErrorMessage(error: unknown): string {
  const raw = object(error)
  if (
    raw &&
    !raw.response &&
    (raw.isAxiosError === true ||
      ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"].includes(String(raw.code)))
  )
    return i18n.t("errors:network_error")
  const payload = apiErrorPayload(error)
  const code = payload?.code
  if (payload && typeof code === "string") {
    if (code === "request_validation_failed") {
      return Array.isArray(payload.detail) && payload.detail.length
        ? validationMessage(payload.detail[0])
        : i18n.t("errors:request_validation_failed")
    }
    if (!Object.keys(messages).includes(code))
      return i18n.t("errors:generic_error")
    if (code === "demo_limit_reached") {
      const limit = object(payload.params)?.limit
      return typeof limit === "number" &&
        Number.isSafeInteger(limit) &&
        limit >= 0
        ? i18n.t("errors:demo_limit_reached", { limit })
        : i18n.t("errors:generic_error")
    }
    return i18n.t(`errors:${code as keyof typeof messages}`)
  }
  if (Array.isArray(payload?.detail) && payload.detail.length)
    return validationMessage(payload.detail[0])

  return i18n.t("errors:generic_error")
}

/** Only session failures should redirect; permission/demo/CSRF errors stay visible. */
export function isAuthenticationFailure(error: unknown): boolean {
  const raw = object(error)
  const response = object(raw?.response)
  if (response?.status !== 401 && response?.status !== 403) return false
  const code = apiErrorPayload(error)?.code
  // Keep the old status-based behavior for servers without the additive contract.
  if (code === undefined) return true
  return (
    code === "auth_required" ||
    code === "auth_invalid_token" ||
    code === "auth_session_expired"
  )
}

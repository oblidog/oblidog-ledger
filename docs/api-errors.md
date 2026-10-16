# API error contract

Application errors keep their existing HTTP status and `detail` value. Clients
may continue to read the string, validation array, or structured conflict object
exactly as before. Responses now also include a stable `code` and a `params`
object (empty unless that code defines parameters):

```json
{
  "detail": "Only ready obligations can be marked as paid",
  "code": "obligation_invalid_lifecycle",
  "params": {}
}
```

Codes are language independent. The backend does not negotiate a language and
never derives a code from exception messages. Routes assign codes explicitly;
known domain exceptions are handled by their class. The authoritative catalog is
`backend/app/core/api_error_codes.py`; frontend catalogs in
`frontend/src/i18n/locales/{en,pl}/errors.json` cover every backend code.

`detail` remains diagnostic data, not a UI translation key. Its English text is
not a stable identifier. Clients should translate known `code` values and use a
localized generic message for unknown codes, old string-only responses, malformed
bodies or unexpected failures. The Ledger frontend uses
`getApiErrorMessage(error)` for Axios errors, generated adapter wrappers and
parsed fetch response bodies. Transport errors use a localized connection message.
Do not render arbitrary `Error.message`, server `detail`, validation `msg`, `input`
or exception values from `ctx` to users.

## Parameters

| Code | Parameters | Client behavior |
| --- | --- | --- |
| `demo_limit_reached` | `limit`: integer; `resource`: existing machine identifier | Interpolate the validated limit. Keep the resource identifier for diagnostics. |
| `integration_conflict` | `reason`: existing integration conflict code | Show a conflict message. The original `detail: {"code": "revision_conflict"}` contract is unchanged. |
| `system_run_unknown_tasks`, `system_run_disabled_tasks`, `system_run_non_manual_tasks` | `tasks`: array of task identifiers | Translate the surrounding message; retain task identifiers. |

Other current codes have empty parameters. Additional codes or parameters may be
added. Clients must tolerate them. Never use operator exception prose as a code
or parameter intended for interpolation.

## Request validation

FastAPI/Pydantic validation keeps status 422 and its original `detail` array.
The envelope code is `request_validation_failed`. For example:

```json
{
  "detail": [{
    "type": "less_than_equal",
    "loc": ["query", "month"],
    "msg": "Input should be less than or equal to 12",
    "input": "13",
    "ctx": {"le": 12}
  }],
  "code": "request_validation_failed",
  "params": {}
}
```

The UI translates the first issue using its `type`, a localized field name from
`loc`, and validated numeric constraints from `ctx`. Nested paths and array
indices are supported. Unknown fields, issue types, or malformed constraints use
a generic translated field/validation message. The English `msg` is ignored.
Legacy validation arrays without an envelope code also remain usable.

HTTP exception headers, including `WWW-Authenticate`, are preserved. Unexpected
exceptions return status 500 with `internal_error` and safe `detail`; the operator
log retains the traceback. Stored integration run diagnostics and server logs are
not translated.

## OpenAPI and clients

`ApiErrorResponse` documents the common error responses, including validation.
`IntegrationConflictResponse` retains its original nested detail type and adds
common metadata. The frontend client and `openapi/integration.json` are generated
from these schemas. External client repositories can regenerate independently;
existing consumers that ignore extra JSON fields remain compatible.

For new application errors, raise `ApplicationError` with an explicit catalog
code, keep the historical status/detail when adapting an existing route, and add
both translations. Contract tests verify representative real auth, integration
conflict and obligation lifecycle routes, validation, demo/browser restrictions,
headers, unexpected failures, and catalog coverage.

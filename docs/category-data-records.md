# Category Data Records

Category data is stored as a timestamped history of observations. Each record
is validated against the category's active custom-field schema and permanently
keeps the schema version that was active when it was created.

## Define a category data schema

A schema describes the shape of the `data` object in every observation for a
category. Create it in the **Custom fields** page for a category, or send it to
`POST /api/v1/ledgers/{ledger_id}/categories/{category_id}/data-schema` as the
`schema` property of the request body. Every successful update creates a new
schema version; existing records keep the version used when they were created.

The API accepts a valid JSON Schema whose root has `"type": "object"`. This
is the smallest useful schema:

```json
{
  "schema": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  }
}
```

`properties` maps each field name to its definition. `required` lists the
property names that must be supplied. Set `additionalProperties` to `false` to
reject fields that are not explicitly defined; this is recommended for stable
integration payloads.

For example, a category that records a billing period, an amount, and an
optional tariff can use:

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "billing_date": {
        "type": "string",
        "format": "date",
        "title": "Billing date"
      },
      "amount": {
        "type": "number",
        "minimum": 0,
        "title": "Amount"
      },
      "tariff": {
        "type": "string",
        "enum": ["standard", "night"],
        "description": "Provider tariff at the time of the reading"
      }
    },
    "required": ["billing_date", "amount"],
    "additionalProperties": false
  }
}
```

### Fields supported by the Custom fields builder

The backend validates standard JSON Schema, but the in-app builder intentionally
edits a smaller, predictable subset. To keep a schema editable in the builder,
use only these root keywords: `type`, `properties`, `required`, and
`additionalProperties`. The root must be an object, `properties` must be an
object, `required` must be an array of defined field names, and
`additionalProperties` must be `false`.

For each property, the builder supports the following definitions:

| Field type | JSON Schema | Optional keywords |
| --- | --- | --- |
| Text | `"type": "string"` | `title`, `description`, `minLength`, `maxLength`, `enum` |
| Number | `"type": "number"` | `title`, `description`, `minimum`, `maximum` |
| Integer | `"type": "integer"` | `title`, `description`, `minimum`, `maximum` |
| Yes / no | `"type": "boolean"` | `title`, `description` |
| Date | `"type": "string", "format": "date"` | `title`, `description` |
| Date and time | `"type": "string", "format": "date-time"` | `title`, `description` |

Use **Date and time** for RFC 3339 timestamps, for example
`2026-09-02T19:30:00+02:00`. Date and Date and time are distinct types, so use
Date when the time of day is not part of the value.

Use a field key that is meaningful and stable, such as `meter_reading_kwh` or
`billing_date`. A property that uses another JSON Schema keyword, type, or
format can still be valid through the API, but the Custom fields page presents
it as read-only so that it cannot accidentally remove configuration it does not
understand.

### Edit raw JSON

The schema page has **Edit fields** and **Edit JSON** modes. Edit JSON is useful
for valid JSON Schema features the visual builder cannot represent, such as
nested objects or `pattern` constraints.

In JSON mode:

- **Format JSON** prettifies a valid JSON object.
- **Copy JSON** copies the current text to the clipboard.
- **Apply JSON** parses the text and updates the local schema draft without
  creating a schema version or sending a request to the server.
- **Save as new version** persists the last successfully applied schema.

JSON must have an object as its root. Syntax or root-type errors leave the last
valid draft unchanged. The backend remains responsible for complete JSON Schema
validation when a new version is saved. Drafts are kept locally per category,
survive a reload, and can be discarded from either editing mode.

## Create an observation through the integration API

Use the connection key of the integration assigned to the category. Replace the
example API key, timestamp, fields, and external ID with your own values. The
record source is assigned automatically from the authenticated integration.

```bash
curl --silent --show-error --fail-with-body \
  --request POST \
  --header "Authorization: Bearer fdg_live_your_api_key" \
  --header "Content-Type: application/json" \
  --data '{
    "observed_at": "2026-08-24T12:00:00Z",
    "data": {
      "DK": "2026-08-24",
      "apartment_fee": 199.99
    },
    "external_id": "flat-2026-08-24"
  }' \
  "http://localhost:8000/api/v1/integration/category/data-records"
```

`observed_at` is the time at which the value was observed, rather than the time
at which the request is sent. The `data` object must satisfy the active schema
for the category.

The integration source and `external_id` form an idempotency identity for that
category. Retrying the same request returns the existing record instead of
creating a duplicate.

## Read observations

```bash
curl --silent --show-error --fail-with-body \
  --header "Authorization: Bearer fdg_live_your_api_key" \
  "http://localhost:8000/api/v1/integration/categories/FLAT/data-records?limit=100"
```

The list is ordered from newest to oldest. It supports `from`, `to`, `limit`,
and `offset` query parameters. To retrieve only the newest record, use:

```bash
curl --silent --show-error --fail-with-body \
  --header "Authorization: Bearer fdg_live_your_api_key" \
  "http://localhost:8000/api/v1/integration/categories/FLAT/data-records/latest"
```

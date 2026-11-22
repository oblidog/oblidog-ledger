# API request limits

`RequestLimitsMiddleware` bounds incoming bodies before FastAPI parses them or
runs endpoint dependencies. It applies to the configured API prefix (including
its root) for every HTTP method and content type. Non-HTTP scopes and paths
outside that prefix pass through. This is a body-byte budget, not a rate limit,
connection timeout, response-size limit, or a cap on total concurrent memory.

## Defaults and configuration

| Environment | Setting | Default | JSON complexity checks |
| --- | --- | --- | --- |
| Production, staging, local | `REQUEST_BODY_LIMIT_BYTES` | 1,048,576 bytes (1 MiB) | Endpoint/schema validation; no added global JSON restrictions |
| Demo | `DEMO_REQUEST_BODY_LIMIT_BYTES` | 65,536 bytes (64 KiB) | Existing depth 12, 1,024 value nodes, 2,048 characters per string/key |

Both settings accept positive integers only; zero does not disable protection.
The byte boundary is inclusive. Multi-byte UTF-8 characters consume multiple
bytes. Demo string limits count characters. Demo JSON checks apply to
`application/json`, `application/*+json` (including parameters and mixed case),
and missing Content-Type, matching FastAPI's JSON detection. Invalid JSON is
left to FastAPI's existing validation; excessive decoder recursion is rejected
with 413 in demo.

Production and standalone Compose services load `.env`; the local demo harness
loads `.env.demo`. Vercel requires setting environment variables on the backend
project and redeploying. Example env files document the appropriate setting.

## Endpoint inventory and exceptions

Reviewed the integration routes, request models, and CSV route on Ledger `dev`,
and [the importer implementations at 8ee9ca0](https://github.com/oblidog/oblidog-integrations/tree/8ee9ca0397a222595db4671aac1d010a1f9f6b41/src/oblidog_integrations/integrations).

| Endpoint family | Legitimate request shape | Decision |
| --- | --- | --- |
| Integration obligation/component writes | One obligation update or one component per request; eKartoteka, NJU and iPrzedszkole loop over components | Standard 1 MiB budget, no bulk exception |
| Integration category data records | One observation; eKartoteka settlement snapshot, NJU account summary, iPrzedszkole receivables | Standard budget; preserve arbitrary `data` dictionaries |
| Category data and schema writes | User-defined data and JSON Schema dictionaries | Standard budget; no demo-style global string/node caps in production |
| Notes, descriptions, component metadata | Text and dynamic JSON; several fields have no schema maximum | Standard budget becomes the transport ceiling |
| Integration run start/finish, login, settings and other CRUD | Small structured payloads; run error message is capped at 1,000 characters | Standard budget |
| Category CSV export | GET returning CSV, no uploaded CSV body | No response limit introduced |
| Legacy import | Removed from current `dev` | No upload exception retained |

There is no finite maximum derivable from all existing models: dynamic JSON,
notes and some descriptions are intentionally unbounded at schema level. The
1 MiB default is an explicit transport budget, not a claim about measured live
payloads. No production traffic or private provider data was accessed. Current
importer shapes do not justify a larger endpoint-specific exception. The tests
exercise a valid observation larger than 64 KiB with a long Unicode string and
more than 1,024 values.

No endpoint is exempt. If a deployment needs more than 1 MiB, adjust the setting
and its reverse proxy together. A future bulk/file upload endpoint should have
an explicitly reviewed per-route budget and streaming implementation; avoid a
blanket exemption for the entire integration prefix.

## Receive and rejection behavior

A declared `Content-Length` above the limit is rejected without calling ASGI
`receive`. Regardless of that header, each incoming ASGI chunk is counted. A
chunk crossing the limit is rejected before extending the middleware buffer;
remaining chunks are not read and the endpoint is not invoked. A valid body is
replayed unchanged to FastAPI after it is fully received. The middleware keeps
at most the configured limit in its accumulator; the server's current ASGI
chunk, replay bytes and parsed objects still have their own memory costs.

No application decompressor is installed. The byte counter applies to the body
presented by the ASGI server, not the headers or HTTP chunk framing. If request
decompression is introduced later, enforce a limit on the decompressed bytes
before JSON/form parsing too. Wire framing and malformed Content-Length
validation remain the responsibility of the HTTP server/proxy.

Application rejections return HTTP 413 with the existing error envelope:

```json
{"detail":"Request body is too large","code":"request_too_large","params":{}}
```

Demo preserves `demo_request_too_large` and its existing detail messages. No body,
credentials or query parameters are logged. Production JSON is parsed by the
endpoint/framework only, avoiding duplicate parsing and new global structural
restrictions on integration payloads. This change does not claim to bound JSON
nesting or validation CPU in production.

## Deployment audit and upstream limits

Repository review:

- `frontend/nginx.conf` serves static frontend files; it does not configure the
  externally managed API reverse proxy.
- `compose.production.yml` attaches the backend to the external proxy network.
  The VPS nginx configuration is outside this repository and was not inspected.
- `backend/vercel.json` does not set a custom payload limit. Platform environment
  settings and live runtime buffering were not inspected.

For a self-hosted API, explicitly configure the nginx API server/location, for
example `client_max_body_size 1m;` for the default production limit. Check the
**effective** `nginx -T` configuration locally, including inherited directives,
and keep the limit aligned when changing the application budget. Nginx defaults
to a 1 MiB request limit and returns its own 413 when it rejects a body:
[nginx client_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).
The response may be HTML unless the deployment configures an error response.

Nginx normally buffers the complete request before forwarding it upstream;
large bodies may spill to a temporary file. Application limits therefore cannot
prevent upstream buffering. Turning off `proxy_request_buffering` changes this
behavior, but chunked requests can still be buffered depending on upstream HTTP
version. This PR does not change deployment buffering:
[nginx proxy_request_buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering).

Vercel documents a default 4.5 MB function payload ceiling, with a separate
opt-in larger request-body mode. The app's demo limit is substantially smaller.
Requests rejected by the platform never reach ASGI and may return
`FUNCTION_PAYLOAD_TOO_LARGE` instead of the application envelope. The ASGI byte
counter remains useful even if the platform/runtime has already buffered the
body. Do not assume network-level streaming from application chunk tests:
[Vercel function limits](https://vercel.com/docs/functions/limitations).

The effective incoming limit is the smallest limit in the proxy/platform/app
chain. The app can guarantee its JSON error shape only for requests reaching it.
Live proxy settings and an actual deployment smoke test remain deployment
verification tasks, not results established by repository tests.

## Verification

`backend/tests/core/test_request_limits.py` covers exact boundaries, configurable
limits, absent/inaccurate lengths, chunked ASGI frames, early rejection,
content-type variants, demo JSON limits and decoder recursion, disconnects,
non-API paths, all methods, and valid large integration model parsing. It runs
without database access using:

```sh
cd backend
uv run pytest --confcutdir=tests/core tests/core/test_request_limits.py
```

Required application settings must be supplied as for other backend tests. The
existing demo API regression retains its previous 413 detail assertions.

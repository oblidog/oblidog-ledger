import assert from "node:assert/strict"
import { createServer } from "node:http"
import { after, test } from "node:test"
import { applicationLink, waitForEmail } from "./mailpit.ts"

let calls = 0
let mode = "delayed"
const server = createServer((request, response) => {
  calls++
  response.setHeader("Content-Type", "application/json")
  if (mode === "error") {
    response.writeHead(503).end("{}")
    return
  }
  if (mode === "hang") return
  if (request.url?.startsWith("/api/v1/message/")) {
    assert.equal(request.url, "/api/v1/message/intended")
    response.end(
      JSON.stringify({
        HTML: '<a href="https://old.test/reset-password?token=abc">Reset</a>',
      }),
    )
    return
  }
  const query = new URL(request.url!, "http://localhost").searchParams.get(
    "query",
  )
  assert.equal(query, 'to:"recipient@example.com" subject:"Password recovery"')
  const messages =
    mode === "empty" || calls === 1
      ? []
      : [
          {
            ID: "wrong-recipient",
            To: [{ Address: "other@example.com" }],
            Subject: "Password recovery",
            Created: "2026-10-15T12:00:00Z",
          },
          {
            ID: "wrong-subject",
            To: [{ Address: "recipient@example.com" }],
            Subject: "You're invited",
            Created: "2026-10-15T12:00:00Z",
          },
          {
            ID: "older",
            To: [{ Address: "recipient@example.com" }],
            Subject: "Password recovery",
            Created: "2026-10-14T12:00:00Z",
          },
          {
            ID: "intended",
            To: [{ Address: "recipient@example.com" }],
            Subject: "Password recovery",
            Created: "2026-10-15T12:00:00Z",
          },
        ]
  response.end(JSON.stringify({ messages }))
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert(address && typeof address !== "string")
const options = {
  host: `http://127.0.0.1:${address.port}`,
  recipient: "recipient@example.com",
  subject: "Password recovery",
}
after(() => {
  server.closeAllConnections()
  server.close()
})

test("waits for delayed delivery and selects the newest matching message", async () => {
  const message = await waitForEmail(options)
  assert.match(message.HTML, /token=abc/)
  assert.equal(calls, 3)
})

test("timeout stops polling and identifies recipient and subject", async () => {
  mode = "empty"
  await assert.rejects(
    waitForEmail({ ...options, timeout: 150 }),
    /150ms.*recipient@example.com.*Password recovery/,
  )
  const atTimeout = calls
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(calls, atTimeout)
})

test("deadline aborts an unresponsive HTTP request", async () => {
  mode = "hang"
  await assert.rejects(
    waitForEmail({ ...options, timeout: 100 }),
    /Timed out after 100ms/,
  )
})

test("HTTP failures are reported immediately", async () => {
  mode = "error"
  await assert.rejects(waitForEmail(options), /HTTP 503/)
})

test("requires an explicit Mailpit endpoint", async () => {
  await assert.rejects(
    waitForEmail({ ...options, host: "" }),
    /MAILPIT_HOST is required/,
  )
})

test("extracts links on the configured application origin and preserves tokens", () => {
  const html = `<a href="https://old.test/other">Other</a><a href='https://old.test/accept-invitation?token=a%2Bb&amp;extra=yes'>Accept</a>`
  const link = applicationLink(
    html,
    "/accept-invitation",
    "http://app.test:4173",
  )
  assert.equal(
    link,
    "http://app.test:4173/accept-invitation?token=a%2Bb&extra=yes",
  )
  assert.equal(new URL(link).searchParams.get("token"), "a+b")
  assert.throws(
    () => applicationLink(html, "/reset-password", options.host),
    /does not contain/,
  )
})

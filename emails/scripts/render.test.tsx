import assert from "node:assert/strict"
import { test } from "node:test"
import {
  toPlainText as componentsToPlainText,
  render as renderComponents,
} from "@react-email/components"
import { render, toPlainText } from "@react-email/render"

// Exercise both installed renderer versions: components re-exports an older one.
// html-to-text 10 replaces deepmerge; verify the API used by React Email still works.
for (const [name, renderEmail, convert] of [
  ["direct renderer", render, toPlainText],
  ["components renderer", renderComponents, componentsToPlainText],
] as const) {
  test(`${name} preserves HTML and converts links, entities and Unicode`, async () => {
    const email = (
      <html lang="pl">
        <body>
          <h1>Płatność &amp; saldo</h1>
          <p>Zażółć gęślą jaźń: 12,34 PLN</p>
          <a href="https://example.com/pay?id=1&amp;lang=pl">Zapłać</a>
        </body>
      </html>
    )
    const html = await renderEmail(email)
    assert.match(html, /Płatność &amp; saldo/)
    const text = await renderEmail(email, { plainText: true })
    assert.match(text, /PŁATNOŚĆ & SALDO/)
    assert.match(text, /Zażółć gęślą jaźń: 12,34 PLN/)
    assert.match(text, /Zapłać https:\/\/example.com\/pay\?id=1&lang=pl/)
    assert.doesNotMatch(text, /<\/?(?:html|body|p|a)\b/)
  })

  test(`${name} merges custom conversion selectors with defaults`, () => {
    const text = convert(
      '<h1>Saldo</h1><p>Visible</p><p class="hidden">Hidden</p><img alt="Ignore me" src="https://example.com/logo.png">',
      {
        selectors: [
          { selector: "h1", options: { uppercase: false } },
          { selector: ".hidden", format: "skip" },
        ],
      },
    )
    assert.match(text, /Saldo/)
    assert.match(text, /Visible/)
    assert.doesNotMatch(text, /Hidden|Ignore me/)
  })
}

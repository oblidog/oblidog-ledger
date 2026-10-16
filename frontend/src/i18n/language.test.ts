import { expect, test } from "bun:test"
import { browserLanguage, resolveLanguage } from "./language"

const base = { authenticated: false, demo: false, browserLanguages: ["pl-PL"] }

test("resolves regional browser languages and unsupported fallbacks", () => {
  expect(browserLanguage(["fr-FR", "pl-PL", "en"])).toBe("pl")
  expect(browserLanguage(["en-US", "pl"])).toBe("en")
  expect(browserLanguage(["fr"])).toBe("en")
  expect(browserLanguage([])).toBe("en")
})
test("uses explicit account preferences and browser defaults for old accounts", () => {
  expect(
    resolveLanguage({
      ...base,
      authenticated: true,
      accountLanguage: "en",
      localLanguage: "pl",
    }),
  ).toBe("en")
  expect(
    resolveLanguage({
      ...base,
      authenticated: true,
      accountLanguage: null,
      localLanguage: "en",
    }),
  ).toBe("pl")
  expect(
    resolveLanguage({ ...base, authenticated: true, accountLanguage: "xx" }),
  ).toBe("pl")
})
test("isolates shared demo and anonymous local choices from account preferences", () => {
  expect(
    resolveLanguage({
      ...base,
      authenticated: true,
      demo: true,
      accountLanguage: "en",
      localLanguage: "pl",
    }),
  ).toBe("pl")
  expect(resolveLanguage({ ...base, localLanguage: "en" })).toBe("en")
  expect(resolveLanguage({ ...base, localLanguage: "broken" })).toBe("pl")
})

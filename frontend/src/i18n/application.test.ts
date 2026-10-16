import { afterEach, expect, test } from "bun:test"
import { domainLabel } from "./domainLabels"
import { i18n } from "./index"

afterEach(async () => {
  await i18n.changeLanguage("en")
})

test("Polish screens and system labels do not depend on English fallback", async () => {
  await i18n.changeLanguage("pl")
  expect(i18n.t("app:auth.login_to_your_account")).toBe("Zaloguj się na konto")
  expect(i18n.t("app:categories.create_category")).toBe("Utwórz kategorię")
  expect(i18n.t("app:analytics.payment_schedule")).toBe("Harmonogram płatności")
  expect(domainLabel("lifecycle", "ready")).toBe("Gotowe do opłacenia")
  expect(domainLabel("valueState", "overridden")).toBe("Nadpisane ręcznie")
  expect(domainLabel("componentType", "customer_defined_type")).toBe(
    "customer_defined_type",
  )
  expect(domainLabel("task", "maintenance_cleanup")).toBe("Czyszczenie danych")
})

test("Polish quantities handle 1, 2, 5, 12 and 22 with complete messages", async () => {
  await i18n.changeLanguage("pl")
  for (const [count, expected] of [
    [1, "1 nieznana kwota"],
    [2, "2 nieznane kwoty"],
    [5, "5 nieznanych kwot"],
    [12, "12 nieznanych kwot"],
    [22, "22 nieznane kwoty"],
  ] as const)
    expect(i18n.t("app:messages.unknown_amounts", { count })).toBe(expected)
  expect(i18n.t("app:messages.months", { count: 2 })).toBe("Co 2 miesiące")
  expect(i18n.t("app:messages.schema_records", { count: 5, version: 3 })).toBe(
    "5 rekordów dla wersji schematu 3.",
  )
  expect(i18n.t("app:messages.business_days", { count: 1 })).toBe(
    "Pozostał 1 dzień roboczy",
  )
})

test("English message behavior remains available after switching back", async () => {
  await i18n.changeLanguage("pl")
  await i18n.changeLanguage("en")
  expect(i18n.t("app:messages.unknown_amounts", { count: 1 })).toBe(
    "1 amount unknown",
  )
  expect(i18n.t("app:messages.months", { count: 2 })).toBe("Every 2 months")
  expect(domainLabel("lifecycle", "ready")).toBe("Ready")
})

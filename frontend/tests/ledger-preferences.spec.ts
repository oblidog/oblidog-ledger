import { expect, type Page, test } from "@playwright/test"
import type { LedgerPublic } from "../src/client"

test.use({ storageState: { cookies: [], origins: [] } })
const ledgerId = "preferences-ledger"

async function mockLedger(page: Page, viewer = false) {
  const ledger: LedgerPublic = {
    id: ledgerId,
    owner_user_id: "owner",
    name: "Preferences ledger",
    description: null,
    business_calendar_country: "PL",
    default_currency: "EUR",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  }
  const writes: Record<string, unknown>[] = []
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (
      route.request().method() === "PATCH" &&
      path.endsWith(`/ledgers/${ledgerId}`)
    ) {
      const data = route.request().postDataJSON()
      writes.push(data)
      Object.assign(ledger, data)
      await route.fulfill({ json: ledger })
      return
    }
    let json: unknown = { data: [], count: 0 }
    if (path.endsWith("/utils/public-config"))
      json = {
        environment: "local",
        is_demo: false,
        demo_writes_enabled: true,
        demo_credentials: null,
      }
    else if (path.endsWith("/users/me"))
      json = {
        id: viewer ? "viewer" : "owner",
        email: "owner@example.com",
        is_active: true,
        is_superuser: false,
      }
    else if (path.endsWith("/ledgers/preference-options"))
      json = {
        countries: ["PL", "DE"],
        currencies: ["PLN", "EUR", "USD", "GBP", "CHF"],
        default_business_calendar_country: "PL",
        default_currency: "PLN",
      }
    else if (path.endsWith(`/ledgers/${ledgerId}`)) json = ledger
    else if (path.endsWith("/ledgers/") || path.endsWith("/ledgers"))
      json = { data: [ledger], count: 1 }
    else if (path.endsWith("/members"))
      json = {
        data: [
          {
            user_id: viewer ? "viewer" : "owner",
            email: "owner@example.com",
            role: viewer ? "viewer" : "owner",
          },
        ],
        count: 1,
      }
    else if (path.endsWith("/category-groups"))
      json = {
        data: [{ id: "group", name: "Utilities", is_active: true }],
        count: 1,
      }
    await route.fulfill({ json })
  })
  return { writes }
}

test("owner saves ledger preferences and the new-category form uses its default currency", async ({
  page,
}) => {
  const { writes } = await mockLedger(page)
  await page.goto(`/ledgers/${ledgerId}/settings`)
  await page.getByLabel("Holiday calendar").click()
  await page.getByRole("option", { name: "Germany (DE)", exact: true }).click()
  await page.getByLabel("Default currency").click()
  await page.getByRole("option", { name: "USD", exact: true }).click()
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click()
  await expect(
    page.getByText("Ledger preferences updated", { exact: true }),
  ).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    business_calendar_country: "DE",
    default_currency: "USD",
  })
  await page.goto(`/ledgers/${ledgerId}/categories`)
  await page.getByRole("button", { name: "New category", exact: true }).click()
  await expect(
    page.getByRole("dialog").getByLabel("Currency", { exact: true }),
  ).toHaveText("USD")
})

test("viewer can read preferences but cannot change them", async ({ page }) => {
  const { writes } = await mockLedger(page, true)
  await page.goto(`/ledgers/${ledgerId}/settings`)
  await expect(page.getByLabel("Holiday calendar")).toBeDisabled()
  await expect(page.getByLabel("Default currency")).toBeDisabled()
  await expect(
    page.getByText("Only the ledger owner can change these preferences."),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
})

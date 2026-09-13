import { expect, test } from "@playwright/test"

import {
  CategoriesService,
  client,
  type LedgerPublic,
  LedgersService,
  LoginService,
  ObligationsService,
} from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

async function authenticateApi() {
  client.setConfig({
    baseURL: process.env.VITE_API_URL ?? "http://localhost:8000",
  })
  const token = await LoginService.loginAccessToken({
    formData: {
      username: firstSuperuser,
      password: firstSuperuserPassword,
    },
  })
  client.setConfig({ auth: token.access_token })
}

async function createObligationFixture(): Promise<{
  ledger: LedgerPublic
  key: string
  categoryName: string
}> {
  await authenticateApi()
  const code = "WATR"
  const ledger = await LedgersService.createLedger({
    requestBody: { name: `Components ${Date.now()}` },
  })
  const group = await CategoriesService.createCategoryGroup({
    ledgerId: ledger.id,
    requestBody: { name: "Utilities" },
  })
  const categoryName = "Water"
  await CategoriesService.createCategory({
    ledgerId: ledger.id,
    requestBody: {
      category_group_id: group.id,
      name: categoryName,
      code,
      data_source_policy: "hybrid",
    },
  })
  const now = new Date()
  const obligation = await ObligationsService.createObligation({
    ledgerId: ledger.id,
    requestBody: {
      category_code: code,
      period: { year: now.getFullYear(), month: now.getMonth() + 1 },
    },
  })
  return { ledger, key: obligation.key, categoryName }
}

test("manages manual obligation components and keeps integration components read-only", async ({
  page,
}) => {
  const fixture = await createObligationFixture()
  await page.goto(`/ledgers/${fixture.ledger.id}`)

  await page.route("**/components*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  )
  await page.getByText(fixture.categoryName, { exact: true }).click()
  await expect(page.getByText("Unable to load components.")).toBeVisible({
    timeout: 15_000,
  })
  await page.unroute("**/components*")
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(
    page.getByText("No components for this obligation."),
  ).toBeVisible()

  await page.getByRole("button", { name: "Add component" }).click()
  await page.getByLabel("Label").fill("Water settlement")
  await page.getByLabel("Amount (optional)").fill("43.21")
  await page.getByRole("button", { name: "Add component" }).last().click()
  await expect(page.getByText("Component added")).toBeVisible()
  await expect(
    page.getByText("Water settlement", { exact: true }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Edit Water settlement" }).click()
  await page.getByLabel("Label").fill("Corrected water settlement")
  await page.getByRole("button", { name: "Save component" }).click()
  await expect(page.getByText("Component updated")).toBeVisible()

  await page
    .getByRole("button", { name: "Remove Corrected water settlement" })
    .click()
  await expect(
    page.getByRole("button", { name: "Remove component" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Remove component" }).click()
  await expect(page.getByText("Component removed")).toBeVisible()

  await authenticateApi()
  await ObligationsService.addObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    requestBody: {
      type: "invoice",
      label: "Synced invoice",
      source: "provider",
      external_id: "FV/2026/08/12345",
    },
  })
  await page.reload()
  await page.getByText(fixture.categoryName, { exact: true }).click()
  await expect(page.getByText("Integration", { exact: true })).toBeVisible()
  await expect(page.getByText("provider", { exact: true })).toBeVisible()
  await expect(page.getByText("FV/2026/08/12345", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Edit Synced invoice" }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Remove Synced invoice" }),
  ).toHaveCount(0)
})

test("renders monetary and informational components in a scannable table", async ({
  page,
}) => {
  const fixture = await createObligationFixture()
  await authenticateApi()
  await ObligationsService.addObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    requestBody: {
      type: "invoice_item",
      label: "Water usage",
      amount: "87.50",
    },
  })
  await ObligationsService.addObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    requestBody: {
      type: "consumption",
      label: "Meter reading",
      source: "provider",
    },
  })

  await page.goto(`/ledgers/${fixture.ledger.id}`)
  await page.getByText(fixture.categoryName, { exact: true }).click()

  const table = page.getByRole("table")
  await expect(table).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Component" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Amount" })).toBeVisible()
  await expect(
    table.getByRole("columnheader", { name: "Source / reference" }),
  ).toBeVisible()

  const monetaryRow = table.getByRole("row").filter({ hasText: "Water usage" })
  await expect(monetaryRow).toContainText("Invoice item")
  await expect(monetaryRow).toContainText("87.50")
  await expect(monetaryRow).toContainText("Manual")

  const informationalRow = table
    .getByRole("row")
    .filter({ hasText: "Meter reading" })
  await expect(informationalRow).toContainText("Consumption")
  await expect(informationalRow).toContainText("Integration")
  await expect(informationalRow).toContainText("provider")
  await expect(informationalRow).toContainText("—")
})

test("does not show component management actions to viewers", async ({
  browser,
}) => {
  const fixture = await createObligationFixture()
  const viewerEmail = randomEmail()
  const viewerPassword = `Viewer-${randomPassword()}-password`
  const viewer = await createUser({
    email: viewerEmail,
    password: viewerPassword,
  })
  await LedgersService.shareLedger({
    ledgerId: fixture.ledger.id,
    requestBody: { user_id: viewer.id, role: "viewer" },
  })

  const viewerContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const viewerPage = await viewerContext.newPage()
  await logInUser(viewerPage, viewerEmail, viewerPassword)
  await viewerPage.goto(`/ledgers/${fixture.ledger.id}`)
  await viewerPage.getByText(fixture.categoryName, { exact: true }).click()

  await expect(
    viewerPage.getByText("No components for this obligation."),
  ).toBeVisible()
  await expect(
    viewerPage.getByRole("button", { name: "Add component" }),
  ).toHaveCount(0)
  await viewerContext.close()
})

test("keeps primary and secondary navigation available on mobile", async ({
  page,
}) => {
  const fixture = await createObligationFixture()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/ledgers/${fixture.ledger.id}`)

  await expect(page.getByRole("img", { name: "Oblidog" })).toBeVisible()
  await expect(
    page.locator("header").getByText(fixture.ledger.name, { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Obligations" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Categories" })).toBeVisible()

  await page.getByRole("button", { name: "More" }).first().click()
  await page
    .getByRole("button", { name: /Components .*Current workspace/ })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Ledger settings" }),
  ).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "System Run" })).toBeVisible()
})

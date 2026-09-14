import { expect, test } from "@playwright/test"

import {
  CategoriesService,
  client,
  LedgersService,
  LoginService,
} from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function createIntegrationDataFixture() {
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

  const ledger = await LedgersService.createLedger({
    requestBody: { name: `Integration data ${Date.now()}` },
  })
  const group = await CategoriesService.createCategoryGroup({
    ledgerId: ledger.id,
    requestBody: { name: "Utilities" },
  })
  const metered = await CategoriesService.createCategory({
    ledgerId: ledger.id,
    requestBody: {
      category_group_id: group.id,
      name: "Electricity",
      code: "ELEC",
      data_source_policy: "hybrid",
    },
  })
  await CategoriesService.createCategory({
    ledgerId: ledger.id,
    requestBody: {
      category_group_id: group.id,
      name: "Streaming",
      code: "STRM",
      data_source_policy: "hybrid",
    },
  })
  await CategoriesService.createCategoryDataSchema({
    ledgerId: ledger.id,
    categoryId: metered.id,
    requestBody: {
      schema: {
        type: "object",
        properties: {
          usage_kwh: { type: "number", title: "Usage" },
        },
      },
    },
  })

  return { ledger, metered }
}

test("shows integration data as a dedicated ledger page", async ({ page }) => {
  const { ledger, metered } = await createIntegrationDataFixture()

  await page.goto(`/ledgers/${ledger.id}`)
  await page.getByRole("link", { name: "Integration Data" }).click()

  await expect(page).toHaveURL(`/ledgers/${ledger.id}/integration-data`)
  await expect(
    page.getByRole("heading", { name: "Integration Data", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Component comparison" }),
  ).toBeVisible()

  const table = page.getByTestId("integration-data-categories-table")
  await expect(table).toBeVisible()
  await expect(table.getByText("Electricity", { exact: true })).toBeVisible()
  await expect(table.getByText("ELEC", { exact: true })).toBeVisible()
  await expect(table.getByText("v1", { exact: true })).toBeVisible()
  await expect(table.getByText("Streaming", { exact: true })).toHaveCount(0)

  await table.getByRole("link", { name: "View history" }).click()
  await expect(page).toHaveURL(
    `/ledgers/${ledger.id}/categories/${metered.id}/data`,
  )
})

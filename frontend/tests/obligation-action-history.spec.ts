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

async function createFixture(): Promise<{
  ledger: LedgerPublic
  key: string
  categoryName: string
}> {
  await authenticateApi()
  const ledger = await LedgersService.createLedger({
    requestBody: { name: `Action history ${Date.now()}` },
  })
  const group = await CategoriesService.createCategoryGroup({
    ledgerId: ledger.id,
    requestBody: { name: "Utilities" },
  })
  const categoryName = "Action history water"
  await CategoriesService.createCategory({
    ledgerId: ledger.id,
    requestBody: {
      category_group_id: group.id,
      name: categoryName,
      code: "AHIS",
      data_source_policy: "hybrid",
    },
  })
  const now = new Date()
  const obligation = await ObligationsService.createObligation({
    ledgerId: ledger.id,
    requestBody: {
      category_code: "AHIS",
      period: { year: now.getFullYear(), month: now.getMonth() + 1 },
    },
  })
  return { ledger, key: obligation.key, categoryName }
}

test("renders paginated lifecycle, value, and component action history", async ({
  page,
}) => {
  const fixture = await createFixture()

  await ObligationsService.updateObligation({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    requestBody: {
      current_amount: "125.00",
      due_date: new Date().toISOString().slice(0, 10),
    },
  })
  const component = await ObligationsService.addObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    requestBody: {
      type: "charge",
      label: "Heating",
      amount: "80.00",
    },
  })
  await ObligationsService.updateObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    componentId: component.id,
    requestBody: { label: "District heating", amount: "92.40" },
  })
  await ObligationsService.removeObligationComponent({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
    componentId: component.id,
  })
  for (let index = 0; index < 8; index += 1) {
    const extra = await ObligationsService.addObligationComponent({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
      requestBody: { type: "other", label: `History item ${index}` },
    })
    await ObligationsService.removeObligationComponent({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
      componentId: extra.id,
    })
  }
  await ObligationsService.markObligationReady({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
  })
  await ObligationsService.markObligationPaid({
    ledgerId: fixture.ledger.id,
    obligationKey: fixture.key,
  })

  await page.goto(`/ledgers/${fixture.ledger.id}`)
  await page.getByLabel("Lifecycle").selectOption("")
  await page.getByText(fixture.categoryName, { exact: true }).click()
  await page.getByRole("tab", { name: "Activity" }).click()

  const history = page.getByRole("region", { name: "Action history" })
  await expect(history).toBeVisible()
  await expect(history.getByText("Marked as paid")).toBeVisible()
  await expect(history.getByText("Marked as ready")).toBeVisible()
  await expect(
    history.getByText("District heating", { exact: true }).first(),
  ).toBeVisible()
  await expect(
    history.getByText("Heating", { exact: true }).first(),
  ).toBeVisible()

  await history.getByRole("button", { name: "Load more" }).click()
  await expect(history.getByText("Updated obligation")).toBeVisible()
  await expect(history.getByText("Created obligation")).toBeVisible()
})

for (const entryPoint of ["tile", "details"] as const) {
  test(`payment from ${entryPoint} requires confirmation and can be canceled`, async ({
    page,
  }) => {
    const fixture = await createFixture()
    await ObligationsService.updateObligation({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
      requestBody: {
        current_amount: "125.00",
        due_date: new Date().toISOString().slice(0, 10),
      },
    })
    await ObligationsService.markObligationReady({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
    })
    let paymentRequests = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/mark-paid")) {
        paymentRequests += 1
      }
    })
    await page.goto(`/ledgers/${fixture.ledger.id}`)
    await page.getByLabel("Lifecycle").selectOption("")

    const openConfirmation = async () => {
      if (entryPoint === "tile") {
        await page.getByRole("button", {
          name: `Actions for ${fixture.categoryName}`,
        }).click()
        await page.getByRole("menuitem", { name: "Mark as paid" }).click()
      } else {
        const details = page.getByRole("dialog", { name: fixture.key })
        if (!(await details.isVisible())) {
          await page.getByText(fixture.categoryName, { exact: true }).click()
        }
        await details.getByRole("button", { name: "Mark as paid" }).click()
      }
    }
    const confirmation = page.getByRole("dialog", {
      name: "Mark obligation as paid?",
    })
    await openConfirmation()
    await expect(confirmation).toBeVisible()
    await expect(confirmation.getByText(fixture.key, { exact: true })).toBeVisible()
    await expect(confirmation.getByText(/125\\.00/)).toBeVisible()
    expect(paymentRequests).toBe(0)
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(confirmation).toBeHidden()
    expect(paymentRequests).toBe(0)
    expect((await ObligationsService.readObligation({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
    })).lifecycle).toBe("ready")

    await openConfirmation()
    await confirmation.getByRole("button", { name: "Mark as paid" }).click()
    await expect(confirmation).toBeHidden()
    expect(paymentRequests).toBe(1)
    expect((await ObligationsService.readObligation({
      ledgerId: fixture.ledger.id,
      obligationKey: fixture.key,
    })).lifecycle).toBe("paid")
  })
}

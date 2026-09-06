import { expect, type Page, test } from "@playwright/test"

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

async function openCategories(page: Page) {
  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Categories" })
    .click()
}

async function openCategoryAction(
  page: Page,
  categoryName: string,
  action: string,
) {
  await page
    .getByRole("button", { name: `More actions for ${categoryName}` })
    .click()
  await page.getByRole("menuitem", { name: action }).click()
}

test("renders schema-driven category history with versioning and formatters", async ({
  page,
}) => {
  const ledgerName = uniqueName("Data history")
  const groupName = uniqueName("Utilities")
  const categoryName = uniqueName("Electricity")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await page.getByRole("link", { name: ledgerName }).click()
  await openCategories(page)

  await page.getByRole("button", { name: "New group" }).click()
  await page.getByLabel("Name").fill(groupName)
  await page.getByRole("button", { name: "Create group" }).click()

  await page.getByRole("button", { name: "New category" }).click()
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: groupName }).click()
  await page.getByLabel("Name").fill(categoryName)
  await page.getByLabel("Code").fill("HIST")
  await page.getByRole("button", { name: "Create category" }).click()

  await openCategoryAction(page, categoryName, "Manage custom fields")
  await page.getByRole("button", { name: "Add field" }).click()
  await page.getByLabel("Field name").fill("reading")
  await page.getByLabel("Label").fill("Reading")
  await page.getByRole("button", { name: "Save custom fields" }).click()
  await expect(
    page.getByText("Custom fields saved as schema version 1"),
  ).toBeVisible()
  await page.getByRole("link", { name: "Back to categories" }).click()

  const schemas = {
    data: [
      {
        version: 3,
        is_active: true,
        created_at: "2026-09-06T12:00:00Z",
        schema: {
          type: "object",
          properties: {
            reading: { type: "number", title: "Meter reading" },
            visits: { type: "integer", title: "Visits" },
            active: { type: "boolean", title: "Active" },
            status: { type: "string", title: "Status", enum: ["ok", "warn"] },
            bill_date: { type: "string", format: "date", title: "Bill date" },
            captured_at: {
              type: "string",
              format: "date-time",
              title: "Captured at",
            },
            untitled: { type: "string" },
            payload: { type: "object", title: "Payload" },
            samples: { type: "array", title: "Samples" },
            missing: { type: "string", title: "Missing" },
          },
        },
      },
      {
        version: 2,
        is_active: false,
        created_at: "2026-08-01T12:00:00Z",
        schema: {
          type: "object",
          properties: {
            legacy: { type: "number", title: "Legacy reading" },
          },
        },
      },
      {
        version: 1,
        is_active: false,
        created_at: "2026-07-01T12:00:00Z",
        schema: {
          type: "object",
          properties: { reading: { type: "number", title: "Old reading" } },
        },
      },
    ],
    count: 3,
  }

  await page.route("**/data-schemas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schemas),
    })
  })

  const version3Records = Array.from({ length: 21 }, (_, index) => {
    const number = 21 - index
    return {
      id: `record-${number}`,
      schema_version: 3,
      observed_at: new Date(Date.UTC(2026, 0, number)).toISOString(),
      source: "integration",
      data: {
        reading: number === 21 ? 12345.67 : number,
        visits: number,
        active: number % 2 === 1,
        status: number === 21 ? "warn" : "ok",
        bill_date: "2026-02-03",
        captured_at: "2026-02-03T14:15:00Z",
        untitled: "raw-name fallback",
        payload: { nested: "value" },
        samples: [1, 2, 3],
      },
    }
  })

  await page.route("**/data-records*", async (route) => {
    const url = new URL(route.request().url())
    const version = Number(url.searchParams.get("schema_version"))
    const limit = Number(url.searchParams.get("limit") ?? "100")
    const offset = Number(url.searchParams.get("offset") ?? "0")

    let records: typeof version3Records = []
    if (version === 3) records = version3Records
    if (version === 2) {
      records = [
        {
          id: "legacy-record",
          schema_version: 2,
          observed_at: "2026-01-01T10:00:00Z",
          source: "manual",
          data: { legacy: 42 },
        } as (typeof version3Records)[number],
      ]
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: records.slice(offset, offset + limit),
        count: records.length,
      }),
    })
  })

  await page.setViewportSize({ width: 320, height: 800 })
  await page
    .getByRole("link", { name: `View custom data for ${categoryName}` })
    .click()

  await expect(page).toHaveURL(/\/categories\/[^/]+\/data$/)
  await expect(
    page.getByRole("heading", { name: `Custom data history for ${categoryName}` }),
  ).toBeVisible()
  await expect(page.getByText("21 records for schema version 3.")).toBeVisible()

  const table = page.getByRole("table")
  await expect(table.getByRole("columnheader", { name: "Meter reading" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Visits" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Active" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Bill date" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Captured at" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "untitled" })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Missing" })).toBeVisible()
  await expect(table.getByText("warn").first()).toBeVisible()
  await expect(table.getByText("Yes").first()).toBeVisible()
  await expect(table.getByText("—").first()).toBeVisible()
  await expect(table.getByText("raw-name fallback").first()).toBeVisible()
  await expect(table.getByText("View details").first()).toBeVisible()

  const formattedNumber = await page.evaluate(() => new Intl.NumberFormat().format(12345.67))
  await expect(table.getByText(formattedNumber).first()).toBeVisible()
  await expect(table).not.toContainText("2026-02-03T14:15:00Z")

  await expect(page.getByText("Showing 1–20 of 21")).toBeVisible()
  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasPageOverflow).toBe(false)

  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByText("Showing 21–21 of 21")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled()

  await page.getByRole("button", { name: "Observation order" }).click()
  await expect(page.getByRole("button", { name: "Observation order" })).toContainText(
    "Oldest first",
  )

  await page.getByRole("combobox", { name: "Schema version" }).click()
  await page.getByRole("option", { name: "Version 2" }).click()
  await expect(page).toHaveURL(/schema=2/)
  await expect(page.getByRole("columnheader", { name: "Legacy reading" })).toBeVisible()
  await expect(page.getByText("42")).toBeVisible()

  await page.getByRole("combobox", { name: "Schema version" }).click()
  await page.getByRole("option", { name: "Version 1" }).click()
  await expect(page).toHaveURL(/schema=1/)
  await expect(
    page.getByText("No records were saved with schema version 1 for the selected date range."),
  ).toBeVisible()

  await page.getByRole("link", { name: "Manage custom fields" }).click()
  await expect(page).toHaveURL(/\/custom-fields$/)
})

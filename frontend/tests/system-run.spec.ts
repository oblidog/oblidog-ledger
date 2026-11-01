import { expect, test } from "@playwright/test"

import { client, LedgersService, LoginService } from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function createLedgerFixture() {
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
  return LedgersService.createLedger({
    requestBody: { name: `System Run ${Date.now()}` },
  })
}

test("confirms a manual-only System Run before sending its selected tasks", async ({
  page,
}) => {
  const ledger = await createLedgerFixture()
  const startedRun = {
    id: "d3c6c679-8e8f-4ee8-a36c-04bc8ca03396",
    status: "success",
    trigger: "manual",
    effective_at: "2026-09-01T00:30:00Z",
    timezone: "UTC",
    business_date: "2026-09-01",
    summary: { succeeded_steps: 1, failed_steps: 0, skipped_steps: 0 },
    error: null,
    started_at: "2026-09-01T00:30:00Z",
    finished_at: "2026-09-01T00:30:01Z",
    steps: [],
  }
  await page.route("**/api/v1/system-runs/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { name: "ensure_obligations", mode: "scheduled" },
        { name: "manual_fixture", mode: "manual_only" },
      ]),
    }),
  )
  await page.route("**/api/v1/system-runs/", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(startedRun),
      })
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [], count: 0 }),
    })
  })

  await page.goto(`/ledgers/${ledger.id}/system-run`)
  await page.getByLabel("manual_fixture", { exact: true }).check()
  await page.getByRole("button", { name: "Start System Run" }).click()
  await expect(page.getByRole("dialog")).toContainText("Start System Run?")

  const request = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/v1/system-runs/") &&
      candidate.method() === "POST",
  )
  await page.getByRole("button", { name: "Start run" }).click()
  await expect(page.getByText("Run history")).toBeVisible()
  expect((await request).postDataJSON()).toEqual({
    manual_task_names: ["manual_fixture"],
  })
})

test("shows System Run step summaries and execution details", async ({
  page,
}) => {
  const ledger = await createLedgerFixture()
  // Historical importer steps remain readable through the generic history UI.
  const history = {
    data: [
      {
        id: "d3c6c679-8e8f-4ee8-a36c-04bc8ca03397",
        status: "partial_failure",
        trigger: "scheduled",
        effective_at: "2026-09-01T00:30:00Z",
        timezone: "UTC",
        business_date: "2026-09-01",
        summary: { succeeded_steps: 2, failed_steps: 1, skipped_steps: 1 },
        error: null,
        started_at: "2026-09-01T00:30:00Z",
        finished_at: "2026-09-01T00:30:06Z",
        steps: [
          {
            id: "c3c6c679-8e8f-4ee8-a36c-04bc8ca03391",
            task_name: "ensure_obligations",
            ledger_id: ledger.id,
            status: "succeeded",
            skip_reason: null,
            error: null,
            summary: { created_obligations: 3 },
            started_at: "2026-09-01T00:30:00Z",
            finished_at: "2026-09-01T00:30:02Z",
          },
          {
            id: "c3c6c679-8e8f-4ee8-a36c-04bc8ca03392",
            task_name: "scheduled_reports",
            ledger_id: null,
            status: "succeeded",
            skip_reason: null,
            error: null,
            summary: {
              sent: 2,
              skipped: 1,
              failed: 0,
              future_value: "visible",
            },
            started_at: "2026-09-01T00:30:02Z",
            finished_at: "2026-09-01T00:30:05Z",
          },
          {
            id: "c3c6c679-8e8f-4ee8-a36c-04bc8ca03393",
            task_name: "legacy_import",
            ledger_id: ledger.id,
            status: "skipped",
            skip_reason: "not_configured",
            error: null,
            summary: null,
            started_at: "2026-09-01T00:30:05Z",
            finished_at: "2026-09-01T00:30:05Z",
          },
          {
            id: "c3c6c679-8e8f-4ee8-a36c-04bc8ca03394",
            task_name: "legacy_import",
            ledger_id: ledger.id,
            status: "failed",
            skip_reason: null,
            error: "Task source is unavailable",
            summary: null,
            started_at: "2026-09-01T00:30:05Z",
            finished_at: "2026-09-01T00:30:06Z",
          },
        ],
      },
    ],
    count: 1,
  }
  await page.route("**/api/v1/system-runs/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  )
  await page.route("**/api/v1/system-runs/", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(history),
    }),
  )

  await page.goto(`/ledgers/${ledger.id}/system-run`)

  await expect(page.getByText("legacy_import", { exact: true })).toHaveCount(2)
  await expect(page.getByText("Created obligations")).toBeVisible()
  await expect(page.getByText("3", { exact: true })).toBeVisible()
  await expect(page.getByText("Reports sent")).toBeVisible()
  await expect(page.getByText("Reports skipped")).toBeVisible()
  await expect(page.getByText("Reports failed")).toBeVisible()
  await expect(page.getByText("Succeeded · 2s", { exact: true })).toBeVisible()
  await expect(page.getByText("Skip reason: Not configured")).toBeVisible()
  await expect(page.getByText("Task source is unavailable")).toBeVisible()
  await page.getByText("Additional details").click()
  await expect(page.getByText("future_value", { exact: true })).toBeVisible()
  await expect(page.getByText("visible", { exact: true })).toBeVisible()
})

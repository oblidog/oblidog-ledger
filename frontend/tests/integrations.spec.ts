import { expect, type Page, test } from "@playwright/test"
import type {
  IntegrationCreate,
  IntegrationCredentialPublic,
  IntegrationPublic,
} from "../src/client"

// These UI scenarios intercept every API request and never use a live database.
test.use({ storageState: { cookies: [], origins: [] } })

const ledgerId = "11111111-1111-4111-8111-111111111111"
const integrationId = "22222222-2222-4222-8222-222222222222"
const categoryId = "33333333-3333-4333-8333-333333333333"
const credentialId = "44444444-4444-4444-8444-444444444444"
const root = `/ledgers/${ledgerId}/integrations`
const now = "2026-09-08T12:00:00Z"

const credential = (): IntegrationCredentialPublic => ({
  id: credentialId,
  key_prefix: "obd_live_old",
  created_at: now,
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
})

const integration = (): IntegrationPublic => ({
  id: integrationId,
  ledger_id: ledgerId,
  name: "Phone bills",
  category_id: categoryId,
  credentials: [credential()],
  enabled: true,
  created_at: now,
  updated_at: now,
  enabled_at: now,
  stale_after_seconds: 93600,
  run_timeout_seconds: 1800,
  revision: 1,
  current_run_id: null,
  current_started_at: null,
  current_deadline_at: null,
  current_finished_at: null,
  last_finished_at: null,
  last_result: null,
  last_changes_detected: null,
  last_error_code: null,
  last_error_message: null,
  last_success_at: null,
  execution_state: "never_run",
  is_stale: false,
  health: "never_run",
})

async function mockApi(page: Page, items: IntegrationPublic[] = []) {
  const state = {
    items: structuredClone(items),
    create: null as IntegrationCreate | null,
  }
  const user = {
    id: "owner",
    email: "owner@example.com",
    full_name: "Owner",
    is_active: true,
    is_superuser: false,
  }
  const ledger = {
    id: ledgerId,
    owner_user_id: "owner",
    name: "Home",
    description: null,
    created_at: now,
    updated_at: now,
  }
  await page.addInitScript(() =>
    localStorage.setItem("access_token", "mock-session"),
  )
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/\/$/, "")
    const method = route.request().method()
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body })
    if (path.endsWith("/utils/public-config"))
      return reply({
        environment: "local",
        is_demo: false,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me")) return reply(user)
    if (path === "/api/v1/ledgers") return reply({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return reply(ledger)
    if (path.endsWith("/categories"))
      return reply({
        data: [
          {
            id: categoryId,
            ledger_id: ledgerId,
            name: "Phone",
            code: "PHONE",
            archived_at: null,
          },
        ],
        count: 1,
      })
    if (path === `/api/v1${root}`) {
      if (method === "POST") {
        state.create = route.request().postDataJSON() as IntegrationCreate
        const item = {
          ...integration(),
          ...state.create,
          credentials: [credential()],
        }
        state.items.push(item)
        return reply(
          {
            integration: item,
            credential: item.credentials[0],
            connection_key: "obd_live_created_once",
          },
          201,
        )
      }
      return reply({ data: state.items, count: state.items.length })
    }
    const match = path.match(
      new RegExp(`^/api/v1${root}/([^/]+)(?:/credentials(?:/([^/]+))?)?$`),
    )
    if (match) {
      const item = state.items.find((entry) => entry.id === match[1])
      if (!item) return reply({ detail: "Integration not found" }, 404)
      if (match[2] && method === "DELETE") {
        const found = item.credentials.find((entry) => entry.id === match[2])
        if (found) found.revoked_at = now
        return reply(null, 204)
      }
      if (path.endsWith("/credentials") && method === "POST") {
        const created = {
          ...credential(),
          id: "55555555-5555-4555-8555-555555555555",
          key_prefix: "obd_live_new",
        }
        item.credentials.push(created)
        return reply(
          { credential: created, connection_key: "obd_live_rotated_once" },
          201,
        )
      }
      return reply(item)
    }
    if (
      method === "GET" &&
      /\/(members|obligations|category-groups)$/.test(path)
    )
      return reply({ data: [], count: 0 })
    return reply({ detail: `Unexpected mock request: ${method} ${path}` }, 500)
  })
  return state
}

test("owner creates an integration and is shown its connection key once", async ({
  page,
}) => {
  const state = await mockApi(page)
  await page.goto(root)
  await page.getByRole("button", { name: "Add integration" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Phone bills")
  await page.getByLabel("Category", { exact: true }).selectOption(categoryId)
  await page.getByRole("button", { name: "Create integration" }).click()

  await expect(page.getByText("Connection key", { exact: true })).toBeVisible()
  await expect(
    page.getByText("obd_live_created_once", { exact: true }),
  ).toBeVisible()
  expect(state.create).toEqual({
    name: "Phone bills",
    category_id: categoryId,
  })
})

test("owner rotates and revokes individual connection keys", async ({
  page,
}) => {
  await mockApi(page, [integration()])
  await page.goto(`${root}/${integrationId}`)
  await page.getByRole("button", { name: "Generate new key" }).click()
  await expect(
    page.getByText("obd_live_rotated_once", { exact: true }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Revoke key" }).first().click()
  await expect(page.getByText(/obd_live_old.*revoked/)).toBeVisible()
})

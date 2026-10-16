import { afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useTranslation } from "react-i18next"
import type { UserPublic } from "@/client"
import { i18n } from "./index"

const browser = new Window({ url: "http://localhost" })
Object.defineProperty(globalThis, "window", {
  value: browser,
  configurable: true,
})
Object.defineProperty(globalThis, "document", {
  value: browser.document,
  configurable: true,
})
Object.defineProperty(globalThis, "navigator", {
  value: browser.navigator,
  configurable: true,
})
Object.defineProperty(globalThis, "localStorage", {
  value: browser.localStorage,
  configurable: true,
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(browser, {
  __OBLIDOG_CONFIG__: { VITE_API_URL: "http://localhost:8000" },
})

let root: Root | undefined
let client: QueryClient
let api: typeof import("@/client")
let Provider: typeof import("./LanguageProvider").LanguageProvider
let Selector: typeof import("@/components/Common/LanguageSelector").LanguageSelector
let patch: ReturnType<typeof spyOn>
const user: UserPublic = {
  id: "user",
  email: "test@example.com",
  full_name: null,
  is_active: true,
  is_superuser: false,
  created_at: "2026-01-01T00:00:00Z",
  language: "en",
}

beforeAll(async () => {
  api = await import("@/client")
  Provider = (await import("./LanguageProvider")).LanguageProvider
  Selector = (await import("@/components/Common/LanguageSelector"))
    .LanguageSelector
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  client?.clear()
  patch?.mockRestore()
  browser.localStorage.clear()
  browser.document.body.innerHTML = ""
  await i18n.changeLanguage("en")
})

function NavigationLabel() {
  const { t } = useTranslation()
  return <p data-testid="label">{t("navigation.obligations")}</p>
}

async function mount(account: UserPublic | null, demo = false) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(["currentUser"], account)
  client.setQueryData(["public-app-config"], { is_demo: demo })
  const container = browser.document.createElement("div")
  browser.document.body.append(container)
  root = createRoot(container as unknown as HTMLElement)
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <Provider>
          <Selector />
          <NavigationLabel />
        </Provider>
      </QueryClientProvider>,
    ),
  )
}

async function select(language: string) {
  await act(async () => {
    const select = browser.document.querySelector("select")!
    select.value = language
    select.dispatchEvent(new browser.Event("change", { bubbles: true }))
    // Query/mutation observers batch their notifications on the next task.
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

test("anonymous selection updates labels, html lang and browser storage without API writes", async () => {
  patch = spyOn(api.UsersService, "updateUserMe")
  await mount(null)
  await select("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  expect(
    browser.document.querySelector('[data-testid="label"]')!.textContent,
  ).toBe("Zobowiązania")
  expect(browser.localStorage.getItem("oblidog-language")).toBe("pl")
  expect(patch).not.toHaveBeenCalled()
})

test("account selection persists through API and overrides a different anonymous choice", async () => {
  browser.localStorage.setItem("oblidog-language", "pl")
  patch = spyOn(api.UsersService, "updateUserMe").mockResolvedValue({
    ...user,
    language: "pl",
  })
  await mount(user)
  expect(browser.document.documentElement.lang).toBe("en")
  await select("pl")
  expect(patch).toHaveBeenCalledWith({ requestBody: { language: "pl" } })
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  await act(async () => {
    client.setQueryData(["currentUser"], { ...user, language: "en" })
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(browser.document.documentElement.lang).toBe("en")
  await act(async () => {
    client.setQueryData(["currentUser"], null)
    client.clear()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(browser.document.documentElement.lang).toBe("pl")
})

test("shared demo selection never writes the account and survives remount", async () => {
  patch = spyOn(api.UsersService, "updateUserMe")
  await mount(user, true)
  await select("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  expect(patch).not.toHaveBeenCalled()
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("en")
  await act(async () => root!.unmount())
  client.clear()
  await mount(user, true)
  expect(browser.document.documentElement.lang).toBe("pl")
})

test("failed save leaves account preference, rendered language and local storage unchanged", async () => {
  patch = spyOn(api.UsersService, "updateUserMe").mockRejectedValue(
    new Error("offline"),
  )
  await mount(user)
  await select("pl")
  expect(patch).toHaveBeenCalledTimes(1)
  expect(browser.document.documentElement.lang).toBe("en")
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("en")
  expect(browser.localStorage.getItem("oblidog-language")).toBeNull()
})

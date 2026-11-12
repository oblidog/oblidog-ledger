import { afterEach, beforeAll, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Window } from "happy-dom"
import { act } from "react"
import type { Root } from "react-dom/client"
import { i18n } from "@/i18n"
import { categoryQueryKeys } from "../Categories/categoryQueryKeys"

const browser = new Window({ url: "http://localhost" })
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  MutationObserver: browser.MutationObserver,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  Node: browser.Node,
  NodeFilter: browser.NodeFilter,
  CustomEvent: browser.CustomEvent,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
Object.assign(browser, {
  __OBLIDOG_CONFIG__: { VITE_API_URL: "http://localhost:8000" },
})

let createRoot: typeof import("react-dom/client").createRoot
let root: Root | undefined
let client: QueryClient | undefined
let Create: typeof import("./CreateObligationDialog").CreateObligationDialog
let Filter: typeof import("./ObligationFilters").PeriodFilter
beforeAll(async () => {
  createRoot = (await import("react-dom/client")).createRoot
  Create = (await import("./CreateObligationDialog")).CreateObligationDialog
  Filter = (await import("./ObligationFilters")).PeriodFilter
  await i18n.changeLanguage("en")
})
afterEach(async () => {
  await act(async () => root?.unmount())
  client?.clear()
  browser.document.body.innerHTML = ""
})
function container() {
  const element = browser.document.createElement("div")
  browser.document.body.append(element)
  root = createRoot(element as unknown as HTMLElement)
}

test.each([1970, 2199, 1969, 2200])(
  "creation respects billing year %i",
  async (year) => {
    client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    })
    client.setQueryData(categoryQueryKeys.categories("ledger"), {
      data: [
        {
          id: "category",
          code: "TEST",
          name: "Test",
          data_source_policy: "manual",
          currency: "PLN",
        },
      ],
      count: 1,
    })
    container()
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client!}>
          <Create
            ledgerId="ledger"
            defaultPeriod={{ year, month: 1 }}
            onSuccess={mock()}
            onError={mock()}
            firstPayment={{
              categoryCode: "TEST",
              obligationKey: "TEST-1970-01",
              onClose: mock(),
              onResolved: mock(),
            }}
          />
        </QueryClientProvider>,
      ),
    )
    const input =
      browser.document.querySelector<HTMLInputElement>("#obligation-period")!
    expect(input.min).toBe("1970-01")
    expect(input.max).toBe("2199-12")
    const button = [...browser.document.querySelectorAll("button")].find(
      (element) =>
        element.textContent?.includes(
          i18n.t("app:obligations.create_obligation"),
        ),
    )!
    expect(button.disabled).toBe(year < 1970 || year > 2199)
  },
)

test("custom period filter rejects unsupported years", async () => {
  container()
  await act(async () => root!.render(<Filter value={[]} onChange={mock()} />))
  await act(async () => {
    const select = browser.document.querySelector("select")!
    select.value = "custom"
    select.dispatchEvent(new browser.Event("change", { bubbles: true }))
  })
  const input = browser.document.querySelector<HTMLInputElement>(
    'input[type="month"]',
  )!
  expect(input.min).toBe("1970-01")
  expect(input.max).toBe("2199-12")
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      browser.HTMLInputElement.prototype,
      "value",
    )!.set!
    input.focus()
    setter.call(input, "1969-12")
    input.dispatchEvent(new browser.Event("input", { bubbles: true }))
    input.dispatchEvent(new browser.Event("change", { bubbles: true }))
    input.dispatchEvent(new browser.KeyboardEvent("keyup", { bubbles: true }))
  })
  expect(browser.document.querySelector("button")!.disabled).toBe(true)
})

import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const browser = new Window({ url: "http://localhost/settings" })
const globals = new Map<string, PropertyDescriptor | undefined>()
let root: Root | undefined
let client: QueryClient
let api: typeof import("@/client")
let useAuth: typeof import("./useAuth").default
let readUser: ReturnType<typeof spyOn>
let logout: ReturnType<typeof spyOn>

beforeAll(async () => {
  for (const [name, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    localStorage: browser.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    scrollTo: browser.scrollTo.bind(browser),
  })) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    })
  }
  Object.assign(browser, {
    __OBLIDOG_CONFIG__: { VITE_API_URL: "http://localhost:8000" },
  })
  api = await import("@/client")
  useAuth = (await import("./useAuth")).default
})

afterAll(() => {
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  client?.clear()
  readUser?.mockRestore()
  logout?.mockRestore()
  browser.document.body.innerHTML = ""
})

const settleObservers = () => new Promise((resolve) => setTimeout(resolve, 20))

function ProtectedView() {
  const { logout } = useAuth()
  useQuery({
    queryKey: ["private-data"],
    queryFn: () => "private",
    staleTime: Infinity,
  })
  return (
    <button type="button" onClick={() => void logout()}>
      Log out
    </button>
  )
}

function LoginView() {
  useAuth()
  return <p>Login form</p>
}

test("logout waits for protected views to unmount before clearing their queries", async () => {
  readUser = spyOn(api.UsersService, "readUserMe").mockResolvedValue({
    id: "user",
  })
  logout = spyOn(api.LoginService, "logout").mockResolvedValue({
    message: "Logged out",
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(["currentUser"], { id: "user" })

  let finishNavigation!: () => void
  const navigation = new Promise<void>((resolve) => {
    finishNavigation = resolve
  })
  const rootRoute = createRootRoute()
  const protectedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: ProtectedView,
  })
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    beforeLoad: () => navigation,
    component: LoginView,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([protectedRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  })
  await router.load()
  const container = browser.document.createElement("div")
  browser.document.body.append(container)
  root = createRoot(container as unknown as HTMLElement)
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await settleObservers()
  })

  try {
    await act(async () => {
      browser.document.querySelector("button")!.click()
      await settleObservers()
    })
    expect(logout).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(["currentUser"])).toBeNull()
    expect(client.getQueryData(["private-data"])).toBe("private")
    expect(readUser).not.toHaveBeenCalled()

    await act(async () => {
      finishNavigation()
      await settleObservers()
    })
    expect(browser.document.body.textContent).toBe("Login form")
    expect(client.getQueryCache().findAll()).toHaveLength(0)
    expect(readUser).not.toHaveBeenCalled()
  } finally {
    await act(async () => {
      finishNavigation()
      await settleObservers()
    })
  }
})

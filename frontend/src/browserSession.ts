import type {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios"

import { client } from "@/client"
import { apiUrl } from "@/config"

const csrfHeader = "X-CSRF-Token"
const unsafeMethods = new Set(["post", "put", "patch", "delete"])
let csrfToken: string | null = null

function captureCsrfToken(response?: AxiosResponse) {
  const nextCsrfToken = response?.headers[csrfHeader.toLowerCase()]
  if (typeof nextCsrfToken === "string" && nextCsrfToken) {
    csrfToken = nextCsrfToken
  }
}

export function clearBrowserSessionState() {
  csrfToken = null
}

export function configureBrowserSession() {
  // Remove the token left by pre-cookie releases. It must never be used again.
  localStorage.removeItem("access_token")

  client.setConfig({
    baseURL: apiUrl,
    withCredentials: true,
  })

  client.instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const method = config.method?.toLowerCase()
      if (csrfToken && method && unsafeMethods.has(method)) {
        config.headers.set(csrfHeader, csrfToken)
      }
      return config
    },
  )
  client.instance.interceptors.response.use(
    (response) => {
      captureCsrfToken(response)
      return response
    },
    (error: AxiosError) => {
      captureCsrfToken(error.response)
      return Promise.reject(error)
    },
  )
}

export const apiUrl =
  window.__OBLIDOG_CONFIG__?.VITE_API_URL || import.meta.env.VITE_API_URL

if (!apiUrl) {
  throw new Error("VITE_API_URL must be set in the runtime configuration")
}

export interface DemoCredentials {
  email: string
  password: string
}

export interface PublicAppConfig {
  environment: "local" | "staging" | "demo" | "production"
  is_demo: boolean
  demo_credentials: DemoCredentials | null
}

export async function fetchPublicAppConfig(): Promise<PublicAppConfig> {
  const response = await fetch(`${apiUrl}/api/v1/utils/public-config`)
  if (!response.ok) {
    throw new Error(`Unable to load public app config (${response.status})`)
  }
  return response.json() as Promise<PublicAppConfig>
}

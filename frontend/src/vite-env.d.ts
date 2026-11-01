/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_DISABLE_DEVTOOLS?: string
}

interface Window {
  __OBLIDOG_CONFIG__?: {
    VITE_API_URL?: string
  }
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Public build metadata embedded by Vite; never fetched from a branch head. */
declare const __APP_BUILD__: {
  readonly label: string
  readonly commit: string | null
}

import { Info } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"

export function DemoBanner() {
  const { data: appConfig } = usePublicAppConfig()

  if (!appConfig?.is_demo) return null

  return (
    <Alert
      className="rounded-none border-x-0 border-t-0"
      data-testid="demo-banner"
    >
      <Info />
      <AlertTitle>
        {appConfig.demo_writes_enabled ? "Public demo" : "Public demo · read-only"}
      </AlertTitle>
      <AlertDescription>
        {appConfig.demo_writes_enabled
          ? "This is a shared demo environment. Changes are visible to other visitors and the demo data is periodically reset."
          : "The demo is temporarily read-only. You can sign in and explore the existing data; changes are paused."}
      </AlertDescription>
    </Alert>
  )
}

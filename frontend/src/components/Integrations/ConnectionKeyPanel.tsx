import { Button } from "@/components/ui/button"
import { apiUrl } from "@/config"

export function ConnectionKeyPanel({ connectionKey }: { connectionKey: string }) {
  const backendUrl = apiUrl.replace(/\/$/, "")
  const envConfig = `OBLIDOG_URL=${backendUrl}\nOBLIDOG_API_KEY=${connectionKey}\n`

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Connection key created</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Save this key now. For security reasons it will not be shown again.
          </p>
        </div>
        <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
          Shown once
        </span>
      </div>

      <div className="mt-4 rounded-lg border bg-background p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          API key
        </p>
        <code className="block break-all font-mono text-sm">{connectionKey}</code>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => void navigator.clipboard.writeText(connectionKey)}
        >
          Copy key
        </Button>
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(envConfig)}
        >
          Copy .env configuration
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        The configuration uses the backend API URL configured for this Oblidog
        frontend.
      </p>
    </div>
  )
}

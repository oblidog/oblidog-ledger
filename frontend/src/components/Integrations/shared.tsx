import type { IntegrationHealth, IntegrationPublic } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const healthLabels: Record<IntegrationHealth, string> = {
  disabled: "Disabled",
  timed_out: "Timed out",
  stale: "Report overdue",
  running: "Running",
  never_run: "Never run",
  error: "Failed",
  healthy: "Healthy",
}

export function HealthBadge({ health }: { health: IntegrationHealth }) {
  return (
    <Badge
      variant={
        health === "error" || health === "timed_out" || health === "stale"
          ? "destructive"
          : health === "healthy"
            ? "default"
            : "secondary"
      }
    >
      {healthLabels[health]}
    </Badge>
  )
}

export function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—"
}

export function resultLabel(item: IntegrationPublic) {
  return item.last_result === "success"
    ? "Success"
    : item.last_result === "failure"
      ? "Failure"
      : "No result yet"
}

export function changesLabel(item: IntegrationPublic) {
  if (item.last_result === null) return "No result yet"
  return item.last_changes_detected === true
    ? "Changes detected"
    : item.last_changes_detected === false
      ? "No changes"
      : "Unknown"
}

export function LoadError({
  retry,
  hasData = false,
}: {
  retry: () => void
  hasData?: boolean
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not refresh integrations</AlertTitle>
      <AlertDescription>
        <p>
          {hasData
            ? "Displayed data may be out of date."
            : "Check your connection and access to this ledger."}
        </p>
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

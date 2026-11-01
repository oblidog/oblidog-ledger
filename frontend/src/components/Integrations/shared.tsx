import { useTranslation } from "react-i18next"
import type { IntegrationHealth, IntegrationPublic } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { i18n } from "@/i18n"
import { getLocale } from "@/i18n/format"

const healthLabels: Record<IntegrationHealth, string> = {
  get disabled() {
    return i18n.t("app:integrations.disabled")
  },
  get timed_out() {
    return i18n.t("app:integrations.timed_out")
  },
  get stale() {
    return i18n.t("app:integrations.report_overdue")
  },
  get running() {
    return i18n.t("app:integrations.running")
  },
  get never_run() {
    return i18n.t("app:integrations.never_run")
  },
  get error() {
    return i18n.t("app:integrations.failed")
  },
  get healthy() {
    return i18n.t("app:integrations.healthy")
  },
}

export function needsAttention(health: IntegrationHealth) {
  return health === "error" || health === "timed_out" || health === "stale"
}

export function HealthBadge({ health }: { health: IntegrationHealth }) {
  useTranslation()

  return (
    <Badge
      className="max-w-full whitespace-normal text-left"
      variant={needsAttention(health) ? "destructive" : "secondary"}
    >
      {healthLabels[health]}
    </Badge>
  )
}

export function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(getLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—"
}

export function resultLabel(item: IntegrationPublic) {
  return item.last_result === "success"
    ? i18n.t("app:integrations.success")
    : item.last_result === "failure"
      ? i18n.t("app:integrations.failure")
      : i18n.t("app:integrations.no_result_yet")
}

export function changesLabel(item: IntegrationPublic) {
  if (item.last_result === null) return i18n.t("app:integrations.no_result_yet")
  return item.last_changes_detected === true
    ? i18n.t("app:integrations.changes_detected")
    : item.last_changes_detected === false
      ? i18n.t("app:integrations.no_changes")
      : i18n.t("app:integrations.unknown_bc7819")
}

export function LoadError({
  retry,
  hasData = false,
}: {
  retry: () => void
  hasData?: boolean
}) {
  useTranslation()

  return (
    <Alert variant="destructive">
      <AlertTitle>
        {i18n.t("app:integrations.could_not_refresh_integrations")}
      </AlertTitle>
      <AlertDescription>
        <p>
          {hasData
            ? i18n.t("app:integrations.displayed_data_may_be_out_of_date")
            : i18n.t(
                "app:integrations.check_your_connection_and_access_to_this_ledger",
              )}
        </p>
        <Button variant="outline" size="sm" onClick={retry}>
          {i18n.t("app:integrations.try_again")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

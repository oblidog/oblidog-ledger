import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { AnalyticsDashboard } from "@/components/Analytics/AnalyticsDashboard"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveLedger } from "@/hooks/useActiveLedger"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: i18n.t("app:analytics.dashboard_oblidog"),
      },
    ],
  }),
})

function Dashboard() {
  useTranslation()

  const { activeLedger, isLoading } = useActiveLedger()

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  if (activeLedger) {
    return <AnalyticsDashboard ledgerId={activeLedger.id} />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="max-w-xl truncate text-2xl font-semibold">
          {i18n.t("app:analytics.dashboard")}
        </h1>
        <p className="text-muted-foreground">
          {i18n.t("app:analytics.select_a_ledger_to_see_its_payment_analytics")}
        </p>
      </div>
      <section className="rounded-lg border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-medium">
          {i18n.t("app:analytics.no_ledger_selected")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {i18n.t("app:analytics.create_or_select_a_ledger_to_get_started")}
        </p>
        <Button className="mt-4" asChild>
          <a href="/ledgers">{i18n.t("app:analytics.manage_ledgers")}</a>
        </Button>
      </section>
    </div>
  )
}

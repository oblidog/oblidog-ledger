import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { AnalyticsDashboard } from "@/components/Analytics/AnalyticsDashboard"
import {
  DashboardEmptyLedger,
  DashboardNextSteps,
} from "@/components/Onboarding/DashboardNextSteps"
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

  const { activeLedger, isLoading, isError, refetch } = useActiveLedger()

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  if (activeLedger) {
    return (
      <div className="space-y-6">
        <DashboardNextSteps ledger={activeLedger} />
        <AnalyticsDashboard ledgerId={activeLedger.id} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="max-w-xl truncate text-2xl font-bold tracking-tight">
        {i18n.t("app:analytics.dashboard")}
      </h1>
      {isError ? (
        <div className="space-y-3" role="alert">
          <p>{i18n.t("app:common.something_went_wrong_please_try_again")}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {i18n.t("app:obligations.try_again")}
          </Button>
        </div>
      ) : (
        <DashboardEmptyLedger />
      )}
    </div>
  )
}

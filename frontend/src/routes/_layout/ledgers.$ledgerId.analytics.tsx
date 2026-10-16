import { createFileRoute } from "@tanstack/react-router"
import { BarChart3, ChartNoAxesCombined, CircleDollarSign } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ComponentHistoryExplorer } from "@/components/Analytics/ComponentHistoryTable"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/analytics")({
  component: LedgerAnalytics,
  head: () => ({ meta: [{ title: i18n.t("app:ledgers.analytics_oblidog") }] }),
})

function LedgerAnalytics() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8">
      <ComponentHistoryExplorer ledgerId={ledgerId} />
      <AnalyticsPlaceholders />
    </div>
  )
}

const plannedCharts = [
  {
    get description() {
      return i18n.t(
        "app:ledgers.see_how_recurring_component_costs_evolve_over_time",
      )
    },
    icon: ChartNoAxesCombined,
    get title() {
      return i18n.t("app:ledgers.component_cost_trend")
    },
  },
  {
    get description() {
      return i18n.t("app:ledgers.spot_which_bill_components_change_most_often")
    },
    icon: BarChart3,
    get title() {
      return i18n.t("app:ledgers.change_frequency")
    },
  },
  {
    get description() {
      return i18n.t(
        "app:ledgers.identify_the_components_driving_the_largest_cost_changes",
      )
    },
    icon: CircleDollarSign,
    get title() {
      return i18n.t("app:ledgers.largest_cost_drivers")
    },
  },
]

function AnalyticsPlaceholders() {
  useTranslation()

  return (
    <section className="space-y-4" aria-labelledby="planned-analytics-heading">
      <div>
        <h2 id="planned-analytics-heading" className="text-xl font-semibold">
          {i18n.t("app:ledgers.more_insights_are_on_the_way")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:ledgers.this_workspace_will_grow_with_focused_views_based_on_component_history",
          )}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plannedCharts.map((chart) => (
          <Card
            key={chart.title}
            className="border-dashed bg-muted/20 shadow-none"
          >
            <CardHeader className="gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                  <chart.icon className="size-5" aria-hidden="true" />
                </div>
                <Badge variant="secondary">
                  {i18n.t("app:ledgers.planned")}
                </Badge>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{chart.title}</CardTitle>
                <CardDescription>{chart.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent aria-hidden="true">
              <div className="flex h-20 items-end gap-2 rounded-md border border-dashed bg-background/70 p-3">
                {[42, 68, 51, 82, 61, 74].map((height, index) => (
                  <div
                    key={`${chart.title}-${height}-${index}`}
                    className="flex-1 rounded-sm bg-muted"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

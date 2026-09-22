import { createFileRoute } from "@tanstack/react-router"
import { BarChart3, ChartNoAxesCombined, CircleDollarSign } from "lucide-react"

import { ComponentHistoryExplorer } from "@/components/Analytics/ComponentHistoryTable"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/analytics")({
  component: LedgerAnalytics,
  head: () => ({ meta: [{ title: "Analytics - Oblidog" }] }),
})

function LedgerAnalytics() {
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
    description: "See how recurring component costs evolve over time.",
    icon: ChartNoAxesCombined,
    title: "Component cost trend",
  },
  {
    description: "Spot which bill components change most often.",
    icon: BarChart3,
    title: "Change frequency",
  },
  {
    description: "Identify the components driving the largest cost changes.",
    icon: CircleDollarSign,
    title: "Largest cost drivers",
  },
]

function AnalyticsPlaceholders() {
  return (
    <section className="space-y-4" aria-labelledby="planned-analytics-heading">
      <div>
        <h2 id="planned-analytics-heading" className="text-xl font-semibold">
          More insights are on the way
        </h2>
        <p className="text-sm text-muted-foreground">
          This workspace will grow with focused views based on component
          history.
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
                <Badge variant="secondary">Planned</Badge>
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

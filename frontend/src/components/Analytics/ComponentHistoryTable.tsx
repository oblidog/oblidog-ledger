import { useQueries, useQuery } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"
import { useMemo } from "react"

import {
  type ObligationComponentPublic,
  ObligationsService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Period = { year: number; month: number }

type ComponentColumn = {
  key: string
  type: string
  labels: string[]
  source: string | null
  externalId: string | null
  firstSeenIndex: number
}

function addMonths(period: Period, offset: number): Period {
  const monthIndex = period.year * 12 + period.month - 1 + offset
  return { year: Math.floor(monthIndex / 12), month: (monthIndex % 12) + 1 }
}

function periodKey(period: Period) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`
}

function periodLabel(period: Period) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(period.year, period.month - 1, 1))
}

function componentIdentity(component: ObligationComponentPublic) {
  if (component.source && component.external_id) {
    return `external:${component.source}:${component.external_id}`
  }
  return `label:${component.type}:${component.label.trim().toLocaleLowerCase()}`
}

function formatAmount(amount: string, currency: string | null) {
  return `${Number(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${currency ? ` ${currency}` : ""}`
}

export function ComponentHistoryTable({
  ledgerId,
  categoryCode,
  currency,
  selectedPeriod,
}: {
  ledgerId: string
  categoryCode: string | undefined
  currency: string | null | undefined
  selectedPeriod: Period
}) {
  const periods = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => addMonths(selectedPeriod, index - 5)),
    [selectedPeriod],
  )
  const obligations = useQuery({
    queryFn: () =>
      ObligationsService.readObligations({
        ledgerId,
        categoryCode,
      }),
    queryKey: ["analytics", "component-history-obligations", ledgerId, categoryCode],
    enabled: Boolean(categoryCode),
  })
  const obligationsByPeriod = useMemo(
    () =>
      new Map(
        (obligations.data?.data ?? []).map((obligation) => [
          `${obligation.period.year}-${String(obligation.period.month).padStart(2, "0")}`,
          obligation,
        ]),
      ),
    [obligations.data],
  )
  const obligationKeys = periods.map(
    (period) => obligationsByPeriod.get(periodKey(period))?.key,
  )
  const componentQueries = useQueries({
    queries: obligationKeys.map((obligationKey) => ({
      queryFn: async () => {
        if (!obligationKey) throw new Error("Missing obligation")
        return ObligationsService.readObligationComponents({
          ledgerId,
          obligationKey,
        })
      },
      queryKey: ["obligation-components", ledgerId, obligationKey],
      enabled: Boolean(obligationKey),
    })),
  })

  const isLoading =
    obligations.isLoading || componentQueries.some((query) => query.isLoading)
  const isError = obligations.isError || componentQueries.some((query) => query.isError)

  const componentsByPeriod = componentQueries.map((query) => query.data?.data ?? [])
  const columns = useMemo(() => {
    const byIdentity = new Map<string, ComponentColumn>()
    componentsByPeriod.forEach((components, periodIndex) => {
      components.forEach((component) => {
        const key = componentIdentity(component)
        const existing = byIdentity.get(key)
        if (existing) {
          if (!existing.labels.includes(component.label)) {
            existing.labels.push(component.label)
          }
          return
        }
        byIdentity.set(key, {
          key,
          type: component.type,
          labels: [component.label],
          source: component.source,
          externalId: component.external_id,
          firstSeenIndex: periodIndex,
        })
      })
    })
    return [...byIdentity.values()].sort(
      (left, right) =>
        left.firstSeenIndex - right.firstSeenIndex ||
        left.labels.at(-1)!.localeCompare(right.labels.at(-1)!) ||
        left.type.localeCompare(right.type),
    )
  }, [componentsByPeriod])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Component history</CardTitle>
        <CardDescription>
          Compare the selected category across the six periods ending in {periodLabel(selectedPeriod)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!categoryCode ? (
          <p className="text-sm text-muted-foreground">Select a category to compare its components.</p>
        ) : isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Component history is unavailable</AlertTitle>
            <AlertDescription>
              Obligations or components for the selected range could not be loaded.
            </AlertDescription>
          </Alert>
        ) : columns.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No components were recorded for this category in the selected range.
            </p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-lg border" data-testid="component-history-table">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-32 bg-background">Period</TableHead>
                  {columns.map((column) => {
                    const currentLabel = column.labels.at(-1)!
                    const previousLabels = column.labels.slice(0, -1)
                    return (
                      <TableHead key={column.key} className="min-w-44 whitespace-normal align-top">
                        <div className="space-y-1">
                          <p className="break-words font-medium text-foreground">{currentLabel}</p>
                          <Badge variant="secondary">{column.type}</Badge>
                          {previousLabels.length ? (
                            <p className="text-xs font-normal text-muted-foreground">
                              Previously: {previousLabels.join(", ")}
                            </p>
                          ) : null}
                          {column.source || column.externalId ? (
                            <p className="break-all text-xs font-normal text-muted-foreground">
                              {[column.source, column.externalId].filter(Boolean).join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </TableHead>
                    )
                  })}
                  <TableHead className="min-w-36 text-right">Shown total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period, periodIndex) => {
                  const obligation = obligationsByPeriod.get(periodKey(period))
                  const periodComponents = componentsByPeriod[periodIndex]
                  const componentMap = new Map(
                    periodComponents.map((component) => [componentIdentity(component), component]),
                  )
                  const monetaryComponents = periodComponents.filter(
                    (component) => component.amount !== null,
                  )
                  const total = monetaryComponents.reduce(
                    (sum, component) => sum + Number(component.amount),
                    0,
                  )

                  return (
                    <TableRow key={periodKey(period)}>
                      <TableCell className="sticky left-0 z-10 bg-background align-top font-medium whitespace-nowrap">
                        <div>{periodLabel(period)}</div>
                        {!obligation ? (
                          <span className="text-xs font-normal text-muted-foreground">No obligation</span>
                        ) : null}
                      </TableCell>
                      {columns.map((column) => {
                        const component = componentMap.get(column.key)
                        const previousComponents = periodIndex > 0 ? componentsByPeriod[periodIndex - 1] : []
                        const existedPreviously = previousComponents.some(
                          (item) => componentIdentity(item) === column.key,
                        )
                        const nextObligationExists = Boolean(obligation)
                        const state = component
                          ? !existedPreviously && periodIndex > 0
                            ? "added"
                            : "present"
                          : existedPreviously && nextObligationExists
                            ? "removed"
                            : "missing"

                        return (
                          <TableCell key={column.key} className="align-top">
                            {component ? (
                              <div className="space-y-1">
                                <span className="font-medium tabular-nums whitespace-nowrap">
                                  {component.amount === null
                                    ? "Present"
                                    : formatAmount(component.amount, currency ?? null)}
                                </span>
                                {state === "added" ? <Badge variant="outline">Added</Badge> : null}
                              </div>
                            ) : state === "removed" ? (
                              <div className="space-y-1">
                                <span className="text-muted-foreground">—</span>
                                <Badge variant="outline">Removed</Badge>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                        {monetaryComponents.length > 0 ? formatAmount(total.toFixed(2), currency ?? null) : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              “Shown total” sums only component amounts displayed in the row; informational components are excluded.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

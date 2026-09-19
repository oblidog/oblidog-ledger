import { useQuery } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { CategoriesService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  type ComponentHistoryMatchBy,
  readComponentHistory,
} from "@/features/analytics/componentHistoryApi"

type Period = { year: number; month: number }

function currentPeriod(): Period {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
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

function formatAmount(amount: string, currency: string | null) {
  return `${Number(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${currency ? ` ${currency}` : ""}`
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "detail" in error) {
    return String((error as { detail: unknown }).detail)
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "object"
  ) {
    const nested = (error as { error: { detail?: unknown } }).error
    if (nested.detail) return String(nested.detail)
  }
  return "The selected comparison could not be loaded."
}

export function ComponentHistoryExplorer({ ledgerId }: { ledgerId: string }) {
  const [selectedPeriod, setSelectedPeriod] = useState(currentPeriod)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>()
  const [matchBy, setMatchBy] = useState<ComponentHistoryMatchBy>("label")
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: ["categories", ledgerId],
  })
  const selectablePeriods = useMemo(
    () =>
      Array.from({ length: 25 }, (_, index) =>
        addMonths(currentPeriod(), index - 12),
      ),
    [],
  )

  useEffect(() => {
    const availableCategories = categories.data?.data
    if (!availableCategories?.length) return
    if (!availableCategories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId(availableCategories[0].id)
    }
  }, [categories.data, selectedCategoryId])

  const selectedCategory = categories.data?.data.find(
    (category) => category.id === selectedCategoryId,
  )

  return (
    <section className="space-y-4" aria-labelledby="component-history-heading">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 id="component-history-heading" className="text-xl font-semibold">
            Component comparison
          </h2>
          <p className="text-sm text-muted-foreground">
            Track how recurring bill components change across recent periods.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium">
            <span>Category</span>
            <Select
              value={selectedCategoryId}
              onValueChange={setSelectedCategoryId}
              disabled={categories.isLoading || categories.isError}
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.data?.data.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>Compare by</span>
            <Select
              value={matchBy}
              onValueChange={(value) =>
                setMatchBy(value as ComponentHistoryMatchBy)
              }
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Compare by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="label">Component label</SelectItem>
                <SelectItem value="external_id">External ID</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>Range ending</span>
            <Select
              value={periodKey(selectedPeriod)}
              onValueChange={(value) => {
                const next = selectablePeriods.find(
                  (period) => periodKey(period) === value,
                )
                if (next) setSelectedPeriod(next)
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Range ending">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectablePeriods.map((period) => (
                  <SelectItem key={periodKey(period)} value={periodKey(period)}>
                    {periodLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>

      {categories.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Categories are unavailable</AlertTitle>
          <AlertDescription>
            Component comparison cannot be loaded until categories are available.
          </AlertDescription>
        </Alert>
      ) : (
        <ComponentHistoryTable
          ledgerId={ledgerId}
          categoryId={selectedCategory?.id}
          currency={selectedCategory?.currency}
          selectedPeriod={selectedPeriod}
          matchBy={matchBy}
        />
      )}
    </section>
  )
}

export function ComponentHistoryTable({
  ledgerId,
  categoryId,
  currency,
  selectedPeriod,
  matchBy,
}: {
  ledgerId: string
  categoryId: string | undefined
  currency: string | null | undefined
  selectedPeriod: Period
  matchBy: ComponentHistoryMatchBy
}) {
  const history = useQuery({
    queryFn: () =>
      readComponentHistory({
        ledgerId,
        categoryId: categoryId!,
        endYear: selectedPeriod.year,
        endMonth: selectedPeriod.month,
        periods: 6,
        matchBy,
      }),
    queryKey: [
      "analytics",
      "component-history",
      ledgerId,
      categoryId,
      selectedPeriod,
      matchBy,
    ],
    enabled: Boolean(categoryId),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Component history</CardTitle>
        <CardDescription>
          Compare the selected category across the six periods ending in{" "}
          {periodLabel(selectedPeriod)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!categoryId ? (
          <p className="text-sm text-muted-foreground">
            Select a category to compare its components.
          </p>
        ) : history.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : history.isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Component history is unavailable</AlertTitle>
            <AlertDescription>
              {errorMessage(history.error)} Try another comparison criterion if
              component identities are ambiguous.
            </AlertDescription>
          </Alert>
        ) : !history.data?.components.length ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No components were recorded for this category in the selected range.
            </p>
          </div>
        ) : (
          <div
            className="max-w-full overflow-x-auto rounded-lg border"
            data-testid="component-history-table"
          >
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-32 bg-background">
                    Period
                  </TableHead>
                  {history.data.components.map((component) => (
                    <TableHead
                      key={component.identity}
                      className="min-w-44 whitespace-normal align-top"
                    >
                      <div className="space-y-1">
                        <p className="break-words font-medium text-foreground">
                          {component.label}
                        </p>
                        <Badge variant="secondary">{component.type}</Badge>
                        {component.source || component.external_id ? (
                          <p className="break-all text-xs font-normal text-muted-foreground">
                            {[component.source, component.external_id]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="min-w-36 text-right">
                    Shown total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.periods.map((period, periodIndex) => {
                  const total = history.data.totals[periodIndex]?.amount
                  return (
                    <TableRow key={periodKey(period)}>
                      <TableCell className="sticky left-0 z-10 bg-background align-top font-medium whitespace-nowrap">
                        {periodLabel(period)}
                      </TableCell>
                      {history.data.components.map((component) => {
                        const value = component.values[periodIndex]
                        return (
                          <TableCell key={component.identity} className="align-top">
                            {value?.amount !== null && value?.amount !== undefined ? (
                              <div className="space-y-1">
                                <span className="font-medium tabular-nums whitespace-nowrap">
                                  {formatAmount(value.amount, currency ?? null)}
                                </span>
                                {value.state !== "present" ? (
                                  <Badge variant="outline">
                                    {value.state[0].toUpperCase() + value.state.slice(1)}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : value?.state === "removed" ? (
                              <div className="space-y-1">
                                <span className="text-muted-foreground">—</span>
                                <Badge variant="outline">Removed</Badge>
                              </div>
                            ) : value?.state === "added" ||
                              value?.state === "changed" ||
                              value?.state === "present" ? (
                              <div className="space-y-1">
                                <span className="font-medium">Present</span>
                                {value.state !== "present" ? (
                                  <Badge variant="outline">
                                    {value.state[0].toUpperCase() + value.state.slice(1)}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                        {total === null || total === undefined
                          ? "—"
                          : formatAmount(total, currency ?? null)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              “Shown total” sums only component amounts displayed in the row;
              informational components are excluded.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

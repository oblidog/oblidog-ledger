import { useQuery } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CategoriesService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { costChange } from "@/features/analytics/comparison"
import {
  type ComponentHistoryMatchBy,
  type ComponentHistoryResponse,
  readComponentHistory,
  readHistoryPeriods,
} from "@/features/analytics/componentHistoryApi"
import {
  defaultHistoryCategoryId,
  HISTORY_PAGE_SIZE,
} from "@/features/analytics/historySelection"
import { i18n } from "@/i18n"
import { getApiErrorMessage } from "@/i18n/apiErrors"
import { domainLabel } from "@/i18n/domainLabels"
import {
  formatAmount as exactAmount,
  formatPercentage,
  getLocale,
} from "@/i18n/format"

type Period = { year: number; month: number }

function periodKey(period: Period) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`
}

function periodLabel(period: Period) {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    year: "numeric",
  }).format(new Date(period.year, period.month - 1, 1))
}

function formatAmount(amount: string, currency: string | null) {
  return exactAmount(amount, currency)
}

export function ComponentHistoryExplorer({ ledgerId }: { ledgerId: string }) {
  useTranslation()

  const [selection, setSelection] = useState<{
    categoryId?: string
    period?: string
  }>({})
  const [matchBy, setMatchBy] = useState<ComponentHistoryMatchBy>("label")
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: ["categories", ledgerId],
  })
  const availability = useQuery({
    queryFn: () => readHistoryPeriods(ledgerId),
    queryKey: ["analytics", "history-periods", ledgerId],
  })
  const availableCategories = categories.data?.data ?? []
  const selectedCategoryId = availableCategories.some(
    (item) => item.id === selection.categoryId,
  )
    ? selection.categoryId
    : defaultHistoryCategoryId(availableCategories, availability.data ?? [])
  const selectedCategory = availableCategories.find(
    (item) => item.id === selectedCategoryId,
  )
  const selectablePeriods = (availability.data ?? [])
    .filter((item) => item.category_id === selectedCategoryId)
    .map((item) => item.period)
    .sort((a, b) => periodKey(a).localeCompare(periodKey(b)))
  const selectedPeriod =
    selectablePeriods.find((item) => periodKey(item) === selection.period) ??
    selectablePeriods.slice(-1)[0]
  const loading = categories.isPending || availability.isPending

  return (
    <section className="space-y-4" aria-labelledby="component-history-heading">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 id="component-history-heading" className="text-xl font-semibold">
            {i18n.t("app:analytics.component_comparison")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:analytics.track_how_recurring_bill_components_change_across_recent_periods",
            )}
          </p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="grid gap-1 text-sm font-medium">
            <span>{i18n.t("app:analytics.category")}</span>
            <Select
              value={selectedCategoryId ?? ""}
              onValueChange={(categoryId) => setSelection({ categoryId })}
              disabled={loading || categories.isError || availability.isError}
            >
              <SelectTrigger
                className="w-full sm:w-48"
                aria-label={i18n.t("app:analytics.category")}
              >
                <SelectValue
                  placeholder={i18n.t("app:analytics.select_category")}
                />
              </SelectTrigger>
              <SelectContent>
                {categories.data?.data.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 text-sm font-medium">
            <span>{i18n.t("app:analytics.range_ending")}</span>
            <Select
              value={selectedPeriod ? periodKey(selectedPeriod) : ""}
              disabled={loading || !selectablePeriods.length}
              onValueChange={(value) => {
                const next = selectablePeriods.find(
                  (period) => periodKey(period) === value,
                )
                if (next)
                  setSelection({
                    categoryId: selectedCategoryId,
                    period: value,
                  })
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={i18n.t("app:analytics.range_ending")}
              >
                <SelectValue
                  placeholder={i18n.t("app:analytics.no_periods_to_display")}
                />
              </SelectTrigger>
              <SelectContent>
                {selectablePeriods.map((period) => (
                  <SelectItem key={periodKey(period)} value={periodKey(period)}>
                    {periodLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-2">
          {i18n.t("app:analytics.comparison_options")}
        </summary>
        <div className="mt-2">
          <div className="grid gap-1 text-sm font-medium">
            <span>{i18n.t("app:analytics.compare_by")}</span>
            <Select
              value={matchBy}
              onValueChange={(value) =>
                setMatchBy(value as ComponentHistoryMatchBy)
              }
            >
              <SelectTrigger
                className="w-full sm:w-44"
                aria-label={i18n.t("app:analytics.compare_by")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="label">
                  {i18n.t("app:analytics.component_label")}
                </SelectItem>
                <SelectItem value="external_id">
                  {i18n.t("app:analytics.external_id")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </details>

      {categories.isError || availability.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>
            {i18n.t("app:analytics.categories_are_unavailable")}
          </AlertTitle>
          <AlertDescription>
            {i18n.t(
              "app:analytics.component_comparison_cannot_be_loaded_until_categories_are_available",
            )}
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <ComponentHistoryTable
          ledgerId={ledgerId}
          categoryId={selectedCategory?.id}
          selectedPeriod={selectedPeriod}
          matchBy={matchBy}
          onOlder={(first) => {
            const older = selectablePeriods
              .filter((item) => periodKey(item) < periodKey(first))
              .slice(-1)[0]
            if (older)
              setSelection({
                categoryId: selectedCategoryId,
                period: periodKey(older),
              })
          }}
          firstAvailable={selectablePeriods[0]}
        />
      )}
    </section>
  )
}

export function ComponentHistoryTable({
  ledgerId,
  categoryId,
  selectedPeriod,
  matchBy,
  firstAvailable,
  onOlder,
}: {
  ledgerId: string
  categoryId: string | undefined
  selectedPeriod: Period | undefined
  firstAvailable: Period | undefined
  onOlder: (first: Period) => void
  matchBy: ComponentHistoryMatchBy
}) {
  useTranslation()

  const history = useQuery({
    queryFn: () =>
      readComponentHistory({
        ledgerId,
        categoryId: categoryId!,
        endYear: selectedPeriod!.year,
        endMonth: selectedPeriod!.month,
        periods: HISTORY_PAGE_SIZE,
        availableOnly: true,
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
    enabled: Boolean(categoryId && selectedPeriod),
    retry: false,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18n.t("app:analytics.component_history")}</CardTitle>
        <CardDescription>
          {i18n.t("app:analytics.recorded_periods_only")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!categoryId || !selectedPeriod ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:analytics.no_recorded_periods")}
          </p>
        ) : history.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : history.isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
              {i18n.t("app:analytics.component_history_is_unavailable")}
            </AlertTitle>
            <AlertDescription>
              {getApiErrorMessage(history.error)}{" "}
              {i18n.t(
                "app:analytics.try_another_comparison_criterion_if_component_identities_are_ambiguous",
              )}
            </AlertDescription>
          </Alert>
        ) : !history.data ? null : (
          <div className="space-y-4">
            <CostComparison totals={history.data.totals} />
            {!history.data.components.length ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {i18n.t(
                    "app:analytics.no_components_were_recorded_for_this_category_in_the_selected_range",
                  )}
                </p>
              </div>
            ) : (
              <div
                className="max-w-full overflow-x-auto rounded-lg border"
                data-testid="component-history-table"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-32 bg-background">
                        {i18n.t("app:analytics.period")}
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
                            <details className="text-xs font-normal text-muted-foreground">
                              <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2">
                                {i18n.t("app:analytics.component_details")}
                              </summary>
                              <div className="mt-2 space-y-1">
                                {" "}
                                <Badge variant="secondary">
                                  {domainLabel("componentType", component.type)}
                                </Badge>
                                {(() => {
                                  const previousLabels = [
                                    ...new Set(
                                      component.values
                                        .map((value) => value.label)
                                        .filter(
                                          (label): label is string =>
                                            Boolean(label) &&
                                            label !== component.label,
                                        ),
                                    ),
                                  ]
                                  return previousLabels.length ? (
                                    <p className="text-xs font-normal text-muted-foreground">
                                      {i18n.t("app:analytics.previously")}{" "}
                                      {previousLabels.join(", ")}
                                    </p>
                                  ) : null
                                })()}
                                {component.source || component.external_id ? (
                                  <p className="break-all text-xs font-normal text-muted-foreground">
                                    {[component.source, component.external_id]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="min-w-36 text-right">
                        {i18n.t("app:analytics.known_component_total")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.periods.map((period, periodIndex) => {
                      const total = history.data.totals[periodIndex]
                      return (
                        <TableRow key={periodKey(period)}>
                          <TableCell className="sticky left-0 z-10 bg-background align-top font-medium whitespace-nowrap">
                            {periodLabel(period)}
                          </TableCell>
                          {history.data.components.map((component) => {
                            const value = component.values[periodIndex]
                            return (
                              <TableCell
                                key={component.identity}
                                className="align-top"
                              >
                                {value?.amount !== null &&
                                value?.amount !== undefined ? (
                                  <div className="space-y-1">
                                    <span className="font-medium tabular-nums whitespace-nowrap">
                                      {formatAmount(
                                        value.amount,
                                        total?.currency ?? null,
                                      )}
                                    </span>
                                    {value.state !== "present" ? (
                                      <Badge variant="outline">
                                        {domainLabel("difference", value.state)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : value?.state === "removed" ? (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                    <Badge variant="outline">
                                      {i18n.t("app:analytics.removed")}
                                    </Badge>
                                  </div>
                                ) : value?.state === "added" ||
                                  value?.state === "changed" ||
                                  value?.state === "present" ? (
                                  <div className="space-y-1">
                                    <span className="font-medium">
                                      {i18n.t(
                                        "app:analytics.component_without_amount",
                                      )}
                                    </span>
                                    {value.state !== "present" ? (
                                      <Badge variant="outline">
                                        {domainLabel("difference", value.state)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </TableCell>
                            )
                          })}
                          <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                            {total?.amount === null ||
                            total?.amount === undefined
                              ? "—"
                              : formatAmount(total.amount, total.currency)}
                            {Boolean(total?.unpriced_component_count) && (
                              <p className="text-xs font-normal text-muted-foreground">
                                {i18n.t(
                                  "app:analytics.unpriced_components_omitted",
                                )}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  {i18n.t("app:analytics.known_component_total_explanation")}
                </p>
              </div>
            )}
            {history.data.periods[0] &&
              firstAvailable &&
              periodKey(history.data.periods[0]) >
                periodKey(firstAvailable) && (
                <Button
                  variant="outline"
                  onClick={() => onOlder(history.data!.periods[0])}
                >
                  {i18n.t("app:analytics.show_older_periods")}
                </Button>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CostComparison({
  totals,
}: {
  totals: ComponentHistoryResponse["totals"]
}) {
  const current = totals.slice(-1)[0]
  const previous = totals.slice(-2, -1)[0]
  if (!current) return null
  const change = costChange(previous, current)
  const amount = (item: typeof current) =>
    item.obligation_amount === null
      ? i18n.t("app:analytics.amount_unknown")
      : formatAmount(item.obligation_amount, item.currency)
  return (
    <div className="space-y-2 border-b pb-4" data-testid="cost-comparison">
      <p className="text-sm text-muted-foreground">
        {previous
          ? i18n.t("app:analytics.period_comparison", {
              current: periodLabel(current.period),
              previous: periodLabel(previous.period),
            })
          : periodLabel(current.period)}
      </p>
      <p className="flex flex-wrap items-baseline gap-2 text-lg tabular-nums">
        {previous && (
          <>
            <span className="text-muted-foreground">{amount(previous)}</span>
            <span aria-hidden="true">→</span>
          </>
        )}
        <strong>{amount(current)}</strong>
        {change && (
          <span className="text-sm">
            ({change.positive ? "+" : ""}
            {formatAmount(change.amount, current.currency)}
            {change.percentage !== null
              ? ` · ${change.positive ? "+" : ""}${formatPercentage(change.percentage)}`
              : ""}
            )
          </span>
        )}
      </p>
      {!change && (
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            previous
              ? "app:analytics.comparison_unavailable"
              : "app:analytics.only_one_period",
          )}
        </p>
      )}
    </div>
  )
}

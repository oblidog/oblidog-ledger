import { useQuery } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount as exactAmount, getLocale } from "@/i18n/format"

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
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    year: "numeric",
  }).format(new Date(period.year, period.month - 1, 1))
}

function formatAmount(amount: string, currency: string | null) {
  return exactAmount(amount, currency)
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
  return i18n.t("app:analytics.the_selected_comparison_could_not_be_loaded")
}

export function ComponentHistoryExplorer({ ledgerId }: { ledgerId: string }) {
  useTranslation()

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
    if (
      !availableCategories.some(
        (category) => category.id === selectedCategoryId,
      )
    ) {
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
            {i18n.t("app:analytics.component_comparison")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:analytics.track_how_recurring_bill_components_change_across_recent_periods",
            )}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1 text-sm font-medium">
            <span>{i18n.t("app:analytics.category")}</span>
            <Select
              value={selectedCategoryId}
              onValueChange={setSelectedCategoryId}
              disabled={categories.isLoading || categories.isError}
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
          <div className="grid gap-1 text-sm font-medium">
            <span>{i18n.t("app:analytics.range_ending")}</span>
            <Select
              value={periodKey(selectedPeriod)}
              onValueChange={(value) => {
                const next = selectablePeriods.find(
                  (period) => periodKey(period) === value,
                )
                if (next) setSelectedPeriod(next)
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={i18n.t("app:analytics.range_ending")}
              >
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
          </div>
        </div>
      </div>

      {categories.isError ? (
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
  useTranslation()

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
    retry: false,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18n.t("app:analytics.component_history")}</CardTitle>
        <CardDescription>
          {i18n.t(
            "app:analytics.compare_the_selected_category_across_the_six_periods_ending_in",
          )}{" "}
          {periodLabel(selectedPeriod)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!categoryId ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:analytics.select_a_category_to_compare_its_components",
            )}
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
              {errorMessage(history.error)}{" "}
              {i18n.t(
                "app:analytics.try_another_comparison_criterion_if_component_identities_are_ambiguous",
              )}
            </AlertDescription>
          </Alert>
        ) : !history.data?.components.length ? (
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
            <Table className="min-w-[960px]">
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
                                    Boolean(label) && label !== component.label,
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
                    </TableHead>
                  ))}
                  <TableHead className="min-w-36 text-right">
                    {i18n.t("app:analytics.shown_total")}
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
                          <TableCell
                            key={component.identity}
                            className="align-top"
                          >
                            {value?.amount !== null &&
                            value?.amount !== undefined ? (
                              <div className="space-y-1">
                                <span className="font-medium tabular-nums whitespace-nowrap">
                                  {formatAmount(value.amount, currency ?? null)}
                                </span>
                                {value.state !== "present" ? (
                                  <Badge variant="outline">
                                    {domainLabel("difference", value.state)}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : value?.state === "removed" ? (
                              <div className="space-y-1">
                                <span className="text-muted-foreground">—</span>
                                <Badge variant="outline">
                                  {i18n.t("app:analytics.removed")}
                                </Badge>
                              </div>
                            ) : value?.state === "added" ||
                              value?.state === "changed" ||
                              value?.state === "present" ? (
                              <div className="space-y-1">
                                <span className="font-medium">
                                  {i18n.t("app:analytics.present")}
                                </span>
                                {value.state !== "present" ? (
                                  <Badge variant="outline">
                                    {domainLabel("difference", value.state)}
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
              {i18n.t(
                "app:analytics.shown_total_sums_only_component_amounts_displayed_in_the_row_informational_components",
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertCircle, ArrowRight, BarChart3 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts"

import { AnalyticsService, CategoriesService } from "@/client"
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
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type Period = { year: number; month: number }

const paymentScheduleChartConfig = {
  amount: { label: "Due", color: "var(--chart-1)" },
} satisfies ChartConfig

const periodTotalsChartConfig = {
  amount: { label: "Total", color: "var(--chart-1)" },
} satisfies ChartConfig

const categoryHistoryChartConfig = {
  amount: { label: "Amount", color: "var(--chart-3)" },
} satisfies ChartConfig

function currentPeriod(): Period {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function periodValue({ year, month }: Period) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
}

function addMonths(period: Period, offset: number): Period {
  const monthIndex = period.year * 12 + period.month - 1 + offset
  return { year: Math.floor(monthIndex / 12), month: (monthIndex % 12) + 1 }
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

function formatPercentage(value: string | null) {
  if (value === null) return "—"
  return Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: 0,
  })
}

function obligationsHref(ledgerId: string, period: Period) {
  return `/ledgers/${ledgerId}?year=${period.year}&month=${period.month}`
}

function QueryState({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Analytics are unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function AnalyticsDashboard({ ledgerId }: { ledgerId: string }) {
  const [selectedPeriod, setSelectedPeriod] = useState(currentPeriod)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>()
  const selectablePeriods = useMemo(
    () =>
      Array.from({ length: 25 }, (_, index) =>
        addMonths(currentPeriod(), index - 12),
      ),
    [],
  )
  const rangeStart = useMemo(
    () => addMonths(selectedPeriod, -5),
    [selectedPeriod],
  )
  const summary = useQuery({
    queryFn: () =>
      AnalyticsService.readPeriodPaymentSummary({
        ledgerId,
        year: selectedPeriod.year,
        month: selectedPeriod.month,
      }),
    queryKey: ["analytics", "period-summary", ledgerId, selectedPeriod],
  })
  const totals = useQuery({
    queryFn: () =>
      AnalyticsService.readObligationPeriodTotals({
        ledgerId,
        from: periodValue(rangeStart),
        to: periodValue(selectedPeriod),
      }),
    queryKey: [
      "analytics",
      "period-totals",
      ledgerId,
      rangeStart,
      selectedPeriod,
    ],
  })
  const cashflow = useQuery({
    queryFn: () =>
      AnalyticsService.readRemainingPeriodCashflow({
        ledgerId,
        year: selectedPeriod.year,
        month: selectedPeriod.month,
      }),
    queryKey: ["analytics", "cashflow", ledgerId, selectedPeriod],
  })
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: ["categories", ledgerId],
  })

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

  const categoryHistory = useQuery({
    queryFn: () =>
      AnalyticsService.readCategoryAmountHistory({
        ledgerId,
        categoryId: selectedCategoryId!,
        from: periodValue(rangeStart),
        to: periodValue(selectedPeriod),
      }),
    queryKey: [
      "analytics",
      "category-history",
      ledgerId,
      selectedCategoryId,
      rangeStart,
      selectedPeriod,
    ],
    enabled: Boolean(selectedCategoryId),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <Badge variant="outline">Dashboard</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Review payment progress, the payment schedule, and period totals.
          </p>
          <Link
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            to="/ledgers/$ledgerId/categories"
            params={{ ledgerId }}
          >
            Explore category history <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="grid gap-1 text-sm font-medium">
          Selected period
          <Select
            value={periodValue(selectedPeriod)}
            onValueChange={(value) => {
              const period = selectablePeriods.find(
                (item) => periodValue(item) === value,
              )
              if (period) setSelectedPeriod(period)
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectablePeriods.map((period) => (
                <SelectItem
                  key={periodValue(period)}
                  value={periodValue(period)}
                >
                  {periodLabel(period)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PaymentProgressCard
          data={summary.data}
          isError={summary.isError}
          isLoading={summary.isLoading}
          ledgerId={ledgerId}
          period={selectedPeriod}
        />
        <CashflowOverviewCards
          data={cashflow.data}
          isError={cashflow.isError}
          isLoading={cashflow.isLoading}
        />
      </section>

      <CashflowChart
        data={cashflow.data}
        isError={cashflow.isError}
        isLoading={cashflow.isLoading}
        ledgerId={ledgerId}
        period={selectedPeriod}
      />

      <PeriodTotalsCard
        data={totals.data}
        isError={totals.isError}
        isLoading={totals.isLoading}
        ledgerId={ledgerId}
      />

      <CategoryHistoryCard
        categories={categories.data}
        categoriesError={categories.isError}
        categoriesLoading={categories.isLoading}
        data={categoryHistory.data}
        isError={categoryHistory.isError}
        isLoading={categoryHistory.isLoading}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
      />
    </div>
  )
}

function PaymentProgressCard({
  data,
  isError,
  isLoading,
  ledgerId,
  period,
}: {
  data:
    | Awaited<ReturnType<typeof AnalyticsService.readPeriodPaymentSummary>>
    | undefined
  isError: boolean
  isLoading: boolean
  ledgerId: string
  period: Period
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-1">
        <CardTitle>Payment progress</CardTitle>
        <CardDescription>{periodLabel(period)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : isError || !data ? (
          <QueryState message="Payment progress could not be loaded." />
        ) : (
          <>
            <p className="text-[28px] font-bold">
              {formatPercentage(data.paid_percentage)}
              {data.paid_percentage !== null && "%"}
            </p>
            <div
              aria-label="Payment progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={
                data.paid_percentage === null
                  ? undefined
                  : Number(data.paid_percentage)
              }
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(Math.max(Number(data.paid_percentage ?? 0), 0), 100)}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {data.paid_obligation_count} of {data.total_obligation_count}{" "}
              obligations paid
            </p>
            {!data.is_complete && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {data.unknown_amount_count} amount
                {data.unknown_amount_count === 1 ? "" : "s"} unknown
              </p>
            )}
            <Button className="mt-2 px-0" variant="link" size="sm" asChild>
              <a href={obligationsHref(ledgerId, period)}>
                View obligations
                <ArrowRight />
              </a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function CashflowOverviewCards({
  data,
  isError,
  isLoading,
}: {
  data:
    | Awaited<ReturnType<typeof AnalyticsService.readRemainingPeriodCashflow>>
    | undefined
  isError: boolean
  isLoading: boolean
}) {
  if (isLoading) {
    return Array.from({ length: 3 }, (_, index) => (
      <Card className="gap-3 py-4" key={index}>
        <CardHeader className="gap-1">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    ))
  }

  if (isError || !data) {
    return (
      <Card className="gap-3 py-4 sm:col-span-2 xl:col-span-3">
        <CardContent className="pt-6">
          <QueryState message="Payment schedule could not be loaded." />
        </CardContent>
      </Card>
    )
  }

  const nextDueDate = data.currency_summaries
    .flatMap((summary) => summary.daily)
    .filter((point) => !point.is_overdue)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.due_date

  return (
    <>
      <CashflowMetricCard
        label="Remaining to pay"
        values={data.currency_summaries.map((summary) => ({
          amount: summary.total_known_amount,
          currency: summary.currency,
        }))}
        emptyLabel="0"
        emptyDescription="No known unpaid amounts"
      />
      <CashflowMetricCard
        label="Overdue"
        values={data.currency_summaries
          .filter((summary) => Number(summary.overdue_known_amount) > 0)
          .map((summary) => ({
            amount: summary.overdue_known_amount,
            currency: summary.currency,
          }))}
        emptyLabel="0"
        emptyDescription="No overdue obligations"
        tone={
          data.currency_summaries.some(
            (summary) => Number(summary.overdue_known_amount) > 0,
          )
            ? "destructive"
            : undefined
        }
      />
      <Card className="gap-3 py-4">
        <CardHeader className="gap-1">
          <CardDescription>Next payment due</CardDescription>
          <CardTitle className="text-[28px] font-bold">
            {nextDueDate ? formatDueDate(nextDueDate) : "0"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {nextDueDate
              ? "Earliest upcoming unpaid obligation."
              : "No scheduled payment"}
          </p>
        </CardContent>
      </Card>
    </>
  )
}

function CashflowMetricCard({
  label,
  values,
  emptyLabel,
  emptyDescription,
  tone,
}: {
  label: string
  values: { amount: string; currency: string | null }[]
  emptyLabel: string
  emptyDescription?: string
  tone?: "destructive"
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`text-[28px] font-bold ${tone === "destructive" && values.length > 0 ? "text-destructive" : ""}`}
        >
          {values.length === 0
            ? emptyLabel
            : values.map((value) => (
                <span className="block" key={value.currency ?? "none"}>
                  {formatAmount(value.amount, value.currency)}
                </span>
              ))}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {values.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {values.length} currenc{values.length === 1 ? "y" : "ies"}
          </p>
        ) : emptyDescription ? (
          <p className="text-sm text-muted-foreground">{emptyDescription}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CashflowChart({
  data,
  isError,
  isLoading,
  ledgerId,
  period,
}: {
  data:
    | Awaited<ReturnType<typeof AnalyticsService.readRemainingPeriodCashflow>>
    | undefined
  isError: boolean
  isLoading: boolean
  ledgerId: string
  period: Period
}) {
  return (
    <Card className="min-w-0 gap-4 py-5">
      <CardHeader>
        <CardTitle>Payment schedule</CardTitle>
        <CardDescription>
          Unpaid amounts grouped by due date in {periodLabel(period)}. Each
          currency is shown separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : isError || !data ? (
          <QueryState message="Cashflow could not be loaded." />
        ) : data.currency_summaries.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No unpaid known amounts.
            </p>
            <ScheduleCompletenessStatus data={data} />
          </div>
        ) : (
          <div className="space-y-6">
            <ScheduleCompletenessStatus data={data} />
            <div className="grid gap-8 xl:grid-cols-2">
              {data.currency_summaries.map((summary) => (
                <div
                  className={
                    data.currency_summaries.length === 1
                      ? "min-w-0 xl:col-span-2"
                      : "min-w-0"
                  }
                  key={summary.currency}
                >
                  <CashflowCurrencyChart summary={summary} />
                </div>
              ))}
            </div>
            <Button className="px-0" variant="link" size="sm" asChild>
              <a href={obligationsHref(ledgerId, period)}>
                Review unpaid obligations
                <ArrowRight />
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScheduleCompletenessStatus({
  data,
}: {
  data: Awaited<ReturnType<typeof AnalyticsService.readRemainingPeriodCashflow>>
}) {
  if (data.is_complete) return null

  return (
    <div className="flex flex-wrap gap-2">
      {data.unknown_amount_count > 0 && (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-700 dark:text-amber-300"
        >
          {data.unknown_amount_count} amount
          {data.unknown_amount_count === 1 ? "" : "s"} unknown
        </Badge>
      )}
      {data.without_due_date_count > 0 && (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-700 dark:text-amber-300"
        >
          {data.without_due_date_count} obligation
          {data.without_due_date_count === 1 ? "" : "s"} without a due date
        </Badge>
      )}
    </div>
  )
}

function CashflowCurrencyChart({
  summary,
}: {
  summary: Awaited<
    ReturnType<typeof AnalyticsService.readRemainingPeriodCashflow>
  >["currency_summaries"][number]
}) {
  const currency = summary.currency
  const chartData = summary.daily.map((point) => ({
    amount: Number(point.amount),
    cumulative: Number(point.cumulative_amount),
    date: point.due_date,
    fill: point.is_overdue
      ? "var(--destructive)"
      : "var(--color-amount)",
  }))
  const showValueLabels = chartData.length <= 8

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{summary.currency ?? "No currency"}</h3>
        <strong>
          {formatAmount(summary.total_known_amount, summary.currency)}
        </strong>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Scheduled</p>
          <p className="font-medium">
            {formatAmount(summary.scheduled_known_amount, summary.currency)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Unscheduled</p>
          <p className="font-medium">
            {formatAmount(summary.unscheduled_known_amount, summary.currency)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Overdue</p>
          <p className="font-medium">
            <span
              className={
                Number(summary.overdue_known_amount) > 0
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {formatAmount(summary.overdue_known_amount, summary.currency)}
            </span>
          </p>
        </div>
      </div>
      {summary.daily.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No scheduled payments in this period.
        </p>
      ) : (
        <ChartContainer
          aria-label={`Scheduled payments for ${currency ?? "no currency"}`}
          className="mt-4 h-64 w-full"
          config={paymentScheduleChartConfig}
          data-testid="payment-schedule-chart"
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ top: showValueLabels ? 24 : 8, right: 4, left: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={16}
              tickFormatter={formatShortDueDate}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              axisLine={false}
              tickFormatter={formatCompactNumber}
              tickLine={false}
              width={48}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <div className="flex min-w-32 flex-1 items-center justify-between gap-4">
                      <span className="text-muted-foreground">Due</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatAmount(String(value), currency)}
                      </span>
                    </div>
                  )}
                  labelFormatter={(value, payload) => {
                    const cumulative = payload[0]?.payload?.cumulative
                    return (
                      <div className="grid gap-1">
                        <span>{formatDueDate(String(value))}</span>
                        {cumulative !== undefined && (
                          <span className="font-normal text-muted-foreground">
                            {formatAmount(String(cumulative), currency)}{" "}
                            cumulative
                          </span>
                        )}
                      </div>
                    )
                  }}
                />
              }
            />
            <Bar dataKey="amount" maxBarSize={36} radius={[4, 4, 0, 0]}>
              {chartData.map((point) => (
                <Cell fill={point.fill} key={point.date} />
              ))}
              {showValueLabels && (
                <LabelList
                  className="fill-foreground"
                  dataKey="amount"
                  fontSize={11}
                  formatter={formatCompactNumber}
                  position="top"
                />
              )}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Tap, hover, or focus a bar for exact and cumulative amounts.
      </p>
    </section>
  )
}

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`))
}

function formatShortDueDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`))
}

function formatCompactNumber(amount: number) {
  return amount.toLocaleString("en-GB", {
    maximumFractionDigits: 1,
    notation: "compact",
  })
}

function CategoryHistoryCard({
  categories,
  categoriesError,
  categoriesLoading,
  data,
  isError,
  isLoading,
  selectedCategoryId,
  setSelectedCategoryId,
}: {
  categories:
    | Awaited<ReturnType<typeof CategoriesService.readCategories>>
    | undefined
  categoriesError: boolean
  categoriesLoading: boolean
  data:
    | Awaited<ReturnType<typeof AnalyticsService.readCategoryAmountHistory>>
    | undefined
  isError: boolean
  isLoading: boolean
  selectedCategoryId: string | undefined
  setSelectedCategoryId: (categoryId: string) => void
}) {
  const knownPoints =
    data?.points.filter((point) => point.state === "known") ?? []
  const currency = knownPoints[0]?.currency ?? null
  const chartData =
    data?.points.map((point) => {
      const amount =
        point.state === "known" ? Number(point.current_amount) : 0
      return {
        amount,
        fill:
          point.state === "unknown"
            ? "var(--color-amber-500)"
            : point.state === "missing"
              ? "var(--muted)"
              : "var(--color-amount)",
        period: periodValue(point.period),
        periodLabel: periodLabel(point.period),
        state: point.state,
        valueLabel:
          point.state === "unknown"
            ? "?"
            : point.state === "missing"
              ? "—"
              : formatCompactNumber(amount),
      }
    }) ?? []

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Category amount history</CardTitle>
          <CardDescription>
            Last six periods. Missing and unknown amounts remain explicit.
          </CardDescription>
        </div>
        {categoriesLoading ? (
          <Skeleton className="h-9 w-48" />
        ) : categoriesError || !categories ? null : categories.data.length ===
          0 ? null : (
          <Select
            value={selectedCategoryId}
            onValueChange={setSelectedCategoryId}
          >
            <SelectTrigger aria-label="Select category" className="w-56">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.data.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="min-w-0">
        {categoriesLoading || (selectedCategoryId && isLoading) ? (
          <Skeleton className="h-56 w-full" />
        ) : categoriesError || !categories ? (
          <QueryState message="Categories could not be loaded." />
        ) : categories.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a category to view its amount history.
          </p>
        ) : isError || !data ? (
          <QueryState message="Category history could not be loaded." />
        ) : (
          <>
            <ChartContainer
              aria-label="Category amount history"
              className="h-64 w-full"
              config={categoryHistoryChartConfig}
              data-testid="category-history-chart"
            >
              <BarChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 28, right: 4, left: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="periodLabel"
                  interval={0}
                  tickFormatter={formatMobilePeriodLabel}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={formatCompactNumber}
                  tickLine={false}
                  width={48}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(_value, _name, item) =>
                        item.payload.state === "unknown"
                          ? "Amount unknown"
                          : item.payload.state === "missing"
                            ? "No obligation"
                            : formatAmount(
                                String(item.payload.amount),
                                currency,
                              )
                      }
                      labelFormatter={(value) => String(value)}
                    />
                  }
                />
                <Bar
                  dataKey="amount"
                  maxBarSize={72}
                  minPointSize={4}
                  radius={[4, 4, 0, 0]}
                >
                  {chartData.map((point) => (
                    <Cell fill={point.fill} key={point.period} />
                  ))}
                  <LabelList
                    className="fill-foreground"
                    dataKey="valueLabel"
                    fontSize={11}
                    position="top"
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              {currency ? `Amounts shown in ${currency}. ` : ""}
              Tap, hover, or focus a bar for the exact value.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function formatMobilePeriodLabel(value: string) {
  return value.split(" ")[0]
}

function PeriodTotalsCard({
  data,
  isError,
  isLoading,
  ledgerId,
}: {
  data:
    | Awaited<ReturnType<typeof AnalyticsService.readObligationPeriodTotals>>
    | undefined
  isError: boolean
  isLoading: boolean
  ledgerId: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Obligation totals by period</CardTitle>
        <CardDescription>
          Last six periods. Each currency is shown separately and is never
          combined.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : isError || !data ? (
          <QueryState message="Period totals could not be loaded." />
        ) : data.points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No periods to display.
          </p>
        ) : !data.points.some(
            (point) => point.currency_summaries.length > 0,
          ) ? (
          <p className="text-sm text-muted-foreground">
            No known obligation amounts in this range.
          </p>
        ) : (
          <div className="space-y-8">
            {Array.from(
              new Set(
                data.points.flatMap((point) =>
                  point.currency_summaries.map(
                    (summary) => summary.currency ?? "No currency",
                  ),
                ),
              ),
            ).map((currency) => {
              const amounts = data.points.map((point) => {
                const summary = point.currency_summaries.find(
                  (item) => (item.currency ?? "No currency") === currency,
                )
                return Number(summary?.total_known_amount ?? 0)
              })
              const chartData = data.points.map((point, index) => ({
                amount: amounts[index],
                href: obligationsHref(ledgerId, point.period),
                incomplete: !point.is_complete,
                period: periodValue(point.period),
                periodLabel: periodLabel(point.period),
              }))
              return (
                <section key={currency}>
                  <h3 className="mb-3 text-sm font-medium">{currency}</h3>
                  <ChartContainer
                    aria-label={`Obligation totals in ${currency}`}
                    className="h-64 w-full"
                    config={periodTotalsChartConfig}
                    data-testid="period-totals-chart"
                  >
                    <BarChart
                      accessibilityLayer
                      data={chartData}
                      margin={{ top: 28, right: 4, left: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        axisLine={false}
                        dataKey="periodLabel"
                        interval={0}
                        tickFormatter={formatMobilePeriodLabel}
                        tickLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        axisLine={false}
                        tickFormatter={formatCompactNumber}
                        tickLine={false}
                        width={48}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value, _name, item) => (
                              <div className="grid gap-1">
                                <span>
                                  {formatAmount(
                                    String(value),
                                    currency === "No currency" ? null : currency,
                                  )}
                                </span>
                                {item.payload.incomplete && (
                                  <span className="text-amber-700 dark:text-amber-300">
                                    Incomplete period
                                  </span>
                                )}
                              </div>
                            )}
                            labelFormatter={(value) => String(value)}
                          />
                        }
                      />
                      <Bar
                        className="cursor-pointer"
                        dataKey="amount"
                        maxBarSize={72}
                        onClick={(entry) => {
                          window.location.assign(String(entry.payload.href))
                        }}
                        radius={[4, 4, 0, 0]}
                      >
                        <LabelList
                          className="fill-foreground"
                          dataKey="amount"
                          fontSize={11}
                          formatter={(value) =>
                            formatCompactNumber(Number(value))
                          }
                          position="top"
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <div className="sr-only">
                    {chartData.map((point) => (
                      <a href={point.href} key={point.period}>
                        View obligations for {point.periodLabel}:{" "}
                        {formatAmount(
                          String(point.amount),
                          currency === "No currency" ? null : currency,
                        )}
                        {point.incomplete ? " (incomplete)" : ""}
                      </a>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Tap a bar to view the period. Hover or focus for the exact
                    total.
                  </p>
                </section>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

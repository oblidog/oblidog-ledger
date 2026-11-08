import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { type ObligationPublic, ObligationsService } from "@/client"
import { obligationQueryKeys } from "@/components/Obligations/obligationQueries"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBillingPeriod, formatDate, getLocale } from "@/i18n/format"
import { cn } from "@/lib/utils"

const dayStyles = {
  overdue: "bg-destructive",
  incomplete: "bg-amber-500",
  due: "bg-amber-500",
  paid: "bg-emerald-600",
}
const statusOrder = ["overdue", "incomplete", "due", "paid"] as const

function calendarDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function obligationStatus(item: ObligationPublic, today: string) {
  if (item.lifecycle === "paid") return "paid"
  if (
    item.lifecycle === "error" ||
    item.lifecycle === "draft" ||
    item.lifecycle === "collecting_data"
  )
    return "incomplete"
  if (item.due_date && item.due_date < today) return "overdue"
  return item.amount_state === "unknown" || item.due_date_state === "unknown"
    ? "incomplete"
    : "due"
}

function obligationHref(ledgerId: string, item: ObligationPublic) {
  const search = new URLSearchParams({
    year: String(item.period.year),
    month: String(item.period.month),
    lifecycle: "",
    obligation: item.key,
  })
  return `/ledgers/${ledgerId}?${search}`
}

export function DueCalendar({
  ledgerId,
  businessDate,
}: {
  ledgerId: string
  businessDate?: string
}) {
  const { t } = useTranslation("app", { keyPrefix: "analytics" })
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState<string>()
  const now = new Date()
  const today =
    businessDate ??
    calendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const currentMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  currentMonth.setUTCMonth(currentMonth.getUTCMonth() + monthOffset)
  const year = currentMonth.getUTCFullYear()
  const month = currentMonth.getUTCMonth() + 1
  const first = (currentMonth.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const dueFrom = calendarDate(year, month, 1)
  const dueTo = calendarDate(year, month, days)
  const selected =
    selectedDay?.slice(0, 7) === dueFrom.slice(0, 7)
      ? selectedDay
      : monthOffset === 0
        ? today
        : dueFrom
  const key = obligationQueryKeys.list(ledgerId)
  const query = useQuery({
    queryKey: [...key, "due-calendar", dueFrom, dueTo],
    queryFn: () =>
      ObligationsService.readObligations({ ledgerId, dueFrom, dueTo }),
  })
  const missingDates = useQuery({
    queryKey: [...key, { year, month }],
    queryFn: () =>
      ObligationsService.readObligations({ ledgerId, year, month }),
  })
  const undated = (missingDates.data?.data ?? []).filter(
    (item) => !item.due_date && item.lifecycle !== "canceled",
  )
  const byDate = useMemo(() => {
    const grouped = new Map<string, ObligationPublic[]>()
    for (const item of query.data?.data ?? []) {
      if (!item.due_date || item.lifecycle === "canceled") continue
      const items = grouped.get(item.due_date) ?? []
      items.push(item)
      grouped.set(item.due_date, items)
    }
    return grouped
  }, [query.data])
  const items = byDate.get(selected) ?? []
  const weekdayFormat = new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    timeZone: "UTC",
  })
  const weekdayStart = Date.UTC(2024, 0, 1)
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    weekdayFormat.format(weekdayStart + day * 86_400_000),
  )

  return (
    <Card className="gap-3 py-4" aria-labelledby="due-calendar-title">
      <CardHeader>
        <CardTitle>
          <h2 id="due-calendar-title">{t("due_calendar_title")}</h2>
        </CardTitle>
        <CardDescription>{t("due_calendar_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("due_calendar_previous")}
            onClick={() => {
              setMonthOffset((offset) => offset - 1)
              setSelectedDay(undefined)
            }}
          >
            <ChevronLeft />
          </Button>
          <span className="font-medium" aria-live="polite">
            {formatBillingPeriod({ year, month })}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("due_calendar_next")}
            onClick={() => {
              setMonthOffset((offset) => offset + 1)
              setSelectedDay(undefined)
            }}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMonthOffset(0)
              setSelectedDay(undefined)
            }}
          >
            {t("due_calendar_today")}
          </Button>
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <p role="alert" className="text-destructive">
            {t("due_calendar_failed")}
          </p>
        ) : (
          <>
            <fieldset className="grid min-w-0 grid-cols-7 gap-1">
              <legend className="sr-only">{t("due_calendar_title")}</legend>
              {weekdays.map((day, index) => (
                <span
                  aria-hidden="true"
                  key={index}
                  className="text-center text-xs text-muted-foreground"
                >
                  {day}
                </span>
              ))}
              {Array.from({ length: first }, (_, index) => (
                <span key={`blank-${index}`} />
              ))}
              {Array.from({ length: days }, (_, index) => {
                const date = calendarDate(year, month, index + 1)
                const entries = byDate.get(date) ?? []
                const statuses = new Set(
                  entries.map((item) => obligationStatus(item, today)),
                )
                const status = statusOrder.find((value) => statuses.has(value))
                const label = t("due_calendar_day", {
                  date: formatDate(date, { dateStyle: "full" }),
                  count: entries.length,
                })

                return (
                  <button
                    type="button"
                    key={date}
                    aria-current={date === today ? "date" : undefined}
                    aria-pressed={selected === date}
                    aria-label={
                      status
                        ? `${label} · ${t(`due_calendar_${status}`)}`
                        : label
                    }
                    onClick={() => setSelectedDay(date)}
                    className={cn(
                      "flex min-h-11 flex-col items-center justify-center gap-1 rounded-md border text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                      selected === date
                        ? "border-primary bg-accent"
                        : "border-transparent",
                      date === today && "font-bold",
                    )}
                  >
                    {index + 1}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        status && dayStyles[status],
                      )}
                    />
                  </button>
                )
              })}
            </fieldset>
            <div className="space-y-2 border-t pt-3">
              <h3 className="font-medium" aria-live="polite">
                {formatDate(selected)}
              </h3>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("due_calendar_empty")}
                </p>
              ) : (
                <ul className="divide-y">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <a
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                        href={obligationHref(ledgerId, item)}
                      >
                        {item.name}
                      </a>
                      <span className="shrink-0 text-muted-foreground">
                        {t(`due_calendar_${obligationStatus(item, today)}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        {missingDates.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("due_calendar_undated_failed")}
          </p>
        ) : undated.length > 0 ? (
          <section
            className="space-y-2 border-t pt-3"
            aria-labelledby="due-calendar-undated"
          >
            <h3 id="due-calendar-undated" className="text-sm font-medium">
              {t("due_calendar_undated")} ({undated.length})
            </h3>
            <ul className="space-y-1">
              {undated.map((item) => (
                <li key={item.id} className="text-sm">
                  <a
                    className="underline-offset-4 hover:underline"
                    href={obligationHref(ledgerId, item)}
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

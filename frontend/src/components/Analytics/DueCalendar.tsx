import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { client, ObligationsService, type ObligationsPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getLocale, formatDate } from "@/i18n/format"

type Obligation = ObligationsPublic["data"][number]
const labels = {
  en: { title: "Due Calendar", description: "Dates with scheduled obligations", today: "Today", empty: "No payments on this day", failed: "Calendar could not be loaded", unknown: "Obligations without a due date in this billing period", previous: "Previous month", next: "Next month", paid: "Paid", overdue: "Overdue", due: "Due", incomplete: "Needs review" },
  pl: { title: "Kalendarz płatności", description: "Dni z zaplanowanymi zobowiązaniami", today: "Dzisiaj", empty: "Brak płatności w tym dniu", failed: "Nie udało się pobrać kalendarza", unknown: "Zobowiązania bez terminu w tym okresie rozliczeniowym", previous: "Poprzedni miesiąc", next: "Następny miesiąc", paid: "Opłacone", overdue: "Zaległe", due: "Do zapłaty", incomplete: "Do sprawdzenia" },
  de: { title: "Fälligkeitskalender", description: "Tage mit fälligen Zahlungen", today: "Heute", empty: "Keine Zahlungen an diesem Tag", failed: "Kalender konnte nicht geladen werden", unknown: "Verpflichtungen ohne Fälligkeitsdatum in diesem Abrechnungszeitraum", previous: "Vorheriger Monat", next: "Nächster Monat", paid: "Bezahlt", overdue: "Überfällig", due: "Fällig", incomplete: "Prüfen" },
}
const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
const localToday = () => {
  const now = new Date()
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}
const dayStatus = (item: Obligation, today: string) => {
  if (item.lifecycle === "paid") return "paid"
  if (item.lifecycle === "error" || item.lifecycle === "draft" || item.lifecycle === "collecting_data") return "incomplete"
  return item.due_date && item.due_date < today ? "overdue" : "due"
}
const priority: Record<string, number> = { overdue: 4, incomplete: 3, due: 2, paid: 1 }
const dot: Record<string, string> = { overdue: "bg-destructive", incomplete: "bg-amber-500", due: "bg-amber-500", paid: "bg-emerald-600" }

export function DueCalendar({ ledgerId }: { ledgerId: string }) {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.split("-")[0] as keyof typeof labels
  const t = labels[lang] ?? labels.en
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [selected, setSelected] = useState(() => localToday())
  const today = localToday()
  const days = new Date(year, month + 1, 0).getDate()
  const first = (new Date(year, month, 1).getDay() + 6) % 7
  const from = iso(year, month + 1, 1)
  const to = iso(year, month + 1, days)
  const query = useQuery({
    queryKey: ["obligations", "due-calendar", ledgerId, from, to],
    queryFn: async () => {
      const response = await client.get({
        url: "/api/v1/ledgers/{ledger_id}/obligations",
        path: { ledger_id: ledgerId },
        query: { due_from: from, due_to: to },
        throwOnError: true,
      })
      return response.data as ObligationsPublic
    },
  })
  const missingDates = useQuery({
    queryKey: ["obligations", "due-calendar-missing", ledgerId, year, month],
    queryFn: () => ObligationsService.readObligations({ ledgerId, year, month: month + 1 }),
  })
  const undated = (missingDates.data?.data ?? []).filter(item => !item.due_date && item.lifecycle !== "canceled" && item.lifecycle !== "paid")
  const byDate = useMemo(() => {
    const grouped = new Map<string, Obligation[]>()
    for (const item of query.data?.data ?? []) {
      if (!item.due_date || item.lifecycle === "canceled") continue
      const items = grouped.get(item.due_date) ?? []
      items.push(item)
      grouped.set(item.due_date, items)
    }
    return grouped
  }, [query.data])
  const changeMonth = (delta: number) => {
    const date = new Date(year, month + delta, 1)
    setYear(date.getFullYear())
    setMonth(date.getMonth())
    setSelected(iso(date.getFullYear(), date.getMonth() + 1, 1))
  }
  const items = byDate.get(selected) ?? []
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(getLocale(), { weekday: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2024, 0, 1 + i))),
  )
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" aria-label={t.previous} onClick={() => changeMonth(-1)}><ChevronLeft /></Button>
          <span className="font-medium">{new Intl.DateTimeFormat(getLocale(), { month: "long", year: "numeric" }).format(new Date(year, month, 1))}</span>
          <Button variant="outline" size="icon" aria-label={t.next} onClick={() => changeMonth(1)}><ChevronRight /></Button>
          <Button variant="outline" size="sm" onClick={() => {
            const now = new Date()
            setMonth(now.getMonth())
            setYear(now.getFullYear())
            setSelected(localToday())
          }}>{t.today}</Button>
        </div>
        {query.isPending ? <Skeleton className="h-64 w-full" /> : query.isError ? <p role="alert" className="text-destructive">{t.failed}</p> : (
          <>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={t.title}>
              {weekdays.map((day, i) => <span key={i} className="text-center text-xs text-muted-foreground">{day}</span>)}
              {Array.from({ length: first }, (_, i) => <span key={`blank-${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const date = iso(year, month + 1, i + 1)
                const entries = byDate.get(date) ?? []
                const status = entries.map(item => dayStatus(item, today)).sort((a,b) => priority[b] - priority[a])[0]
                return <button type="button" key={date} aria-pressed={selected === date} aria-label={`${formatDate(date)}: ${entries.length}`} onClick={() => setSelected(date)} className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-md border text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${selected === date ? "border-primary bg-accent" : "border-transparent"} ${date === today ? "font-bold" : ""}`}>
                  {i + 1}
                  <span className={`size-1.5 rounded-full ${status ? dot[status] : "bg-transparent"}`} />
                </button>
              })}
            </div>
            <div className="space-y-2 border-t pt-3">
              <h3 className="font-medium">{formatDate(selected)}</h3>
              {items.length === 0 ? <p className="text-sm text-muted-foreground">{t.empty}</p> : (
                <ul className="divide-y">
                  {items.map(item => {
                    const status = dayStatus(item, today)
                    return <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <a className="min-w-0 truncate underline-offset-4 hover:underline" href={`/ledgers/${ledgerId}?year=${item.period.year}&month=${item.period.month}`}>{item.name}</a>
                      <span className="shrink-0 text-muted-foreground">{t[status as keyof typeof t]}</span>
                    </li>
                  })}
                </ul>
              )}
            </div>
            {missingDates.isError ? <p role="alert" className="text-sm text-destructive">{t.failed}</p> : undated.length > 0 ? (
              <section className="space-y-2 border-t pt-3" aria-label={t.unknown}>
                <h3 className="text-sm font-medium">{t.unknown} ({undated.length})</h3>
                <ul className="space-y-1">{undated.map(item => <li key={item.id} className="text-sm"><a className="underline-offset-4 hover:underline" href={`/ledgers/${ledgerId}?year=${item.period.year}&month=${item.period.month}`}>{item.name}</a></li>)}</ul>
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

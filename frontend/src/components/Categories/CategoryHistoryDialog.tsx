import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { AnalyticsService, type CategoryPublic } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { i18n } from "@/i18n"
import { formatAmount, getLocale } from "@/i18n/format"

function historyRange() {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
  const toPeriod = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  return { from: toPeriod(start), to: toPeriod(end) }
}

export function CategoryHistoryDialog({
  ledgerId,
  category,
  trigger,
}: {
  ledgerId: string
  category: CategoryPublic
  trigger: ReactNode
}) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const range = historyRange()
  const history = useQuery({
    queryFn: () =>
      AnalyticsService.readCategoryAmountHistory({
        ledgerId,
        categoryId: category.id,
        from: range.from,
        to: range.to,
      }),
    queryKey: ["analytics", "category-history", ledgerId, category.id, range],
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {category.name} {i18n.t("app:categories.amount_history")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:categories.last_six_periods_missing_and_unknown_amounts_are_kept_distinct",
            )}
          </DialogDescription>
        </DialogHeader>
        {history.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : history.isError || !history.data ? (
          <Alert variant="destructive">
            <AlertTitle>
              {i18n.t("app:categories.history_is_unavailable")}
            </AlertTitle>
            <AlertDescription>
              {i18n.t(
                "app:categories.the_category_history_could_not_be_loaded_right_now",
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {history.data.points.map((point) => (
              <div
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2"
                key={`${point.period.year}-${point.period.month}`}
              >
                <span className="text-sm font-medium">
                  {new Intl.DateTimeFormat(getLocale(), {
                    month: "long",
                    year: "numeric",
                  }).format(
                    new Date(point.period.year, point.period.month - 1, 1),
                  )}
                </span>
                {point.state === "known" ? (
                  <span>
                    {formatAmount(String(point.current_amount), point.currency)}
                  </span>
                ) : (
                  <Badge
                    variant={
                      point.state === "unknown" ? "outline" : "secondary"
                    }
                  >
                    {point.state === "unknown"
                      ? i18n.t("app:categories.amount_unknown")
                      : i18n.t("app:categories.no_obligation")}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

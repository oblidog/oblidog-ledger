import type { ObligationLifecycle, ObligationPublic } from "@/client"
import type { ObligationWithCounterparty } from "@/features/counterparties/api"
import { i18n } from "@/i18n"
import { formatDate } from "@/i18n/format"
import { isValidPeriod, type LifecycleFilter } from "./obligationLogic"

export const touchDialogClasses =
  "[&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:top-2 [&_[data-slot=dialog-close]]:right-2 [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center"

export const stateBadgeClasses: Record<string, string> = {
  unknown:
    "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-300",
  estimated:
    "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  confirmed:
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  overridden:
    "border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-300",
}

export const sourceBadgeClasses: Record<string, string> = {
  unknown: stateBadgeClasses.unknown,
  automatic: "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-300",
  manual:
    "border-indigo-500/30 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300",
  mixed:
    "border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-300",
}

export const lifecycleBadgeClasses: Record<ObligationLifecycle, string> = {
  draft:
    "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-300",
  collecting_data:
    "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  ready: "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-300",
  paid: "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  canceled:
    "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-300",
  error: "border-red-500/30 bg-red-500/15 text-red-800 dark:text-red-300",
}

export const dueDateStatusClasses = {
  unknown: "text-muted-foreground",
  safe: "text-emerald-700 dark:text-emerald-300",
  soon: "text-amber-700 dark:text-amber-300",
  urgent: "text-red-700 dark:text-red-300",
}

export function currentPeriod() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function periodFromSearch() {
  if (typeof window === "undefined") return currentPeriod()
  const params = new URLSearchParams(window.location.search)
  const year = Number(params.get("year"))
  const month = Number(params.get("month"))
  return isValidPeriod(year, month) ? { year, month } : currentPeriod()
}

export function counterpartyFor(obligation: ObligationPublic) {
  return (obligation as ObligationPublic & ObligationWithCounterparty)
    .counterparty
}

export function businessDaysUntil(dueDate: string | null, now = new Date()) {
  if (dueDate === null) {
    return {
      label: i18n.t("app:obligations.due_date_unknown"),
      className: dueDateStatusClasses.unknown,
      isUrgent: false,
    }
  }
  const [year, month, day] = dueDate.split("-").map(Number)
  const dueAt = new Date(Date.UTC(year, month - 1, day))
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  if (dueAt < today) {
    return {
      label: i18n.t("app:obligations.overdue"),
      className: dueDateStatusClasses.urgent,
      isUrgent: true,
    }
  }

  let businessDays = 0
  const cursor = new Date(today)
  while (cursor < dueAt) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      businessDays += 1
    }
  }
  return {
    label: i18n.t("app:messages.business_days", { count: businessDays }),
    className:
      businessDays <= 2
        ? dueDateStatusClasses.urgent
        : businessDays <= 5
          ? dueDateStatusClasses.soon
          : dueDateStatusClasses.safe,
    isUrgent: businessDays <= 2,
  }
}

export function paidDateLabel(paidAt: string | null) {
  return paidAt
    ? formatDate(paidAt.slice(0, 10))
    : i18n.t("app:obligations.date_unavailable")
}

export function visibleObligationRows(
  obligations: ObligationPublic[] | undefined,
  lifecycle: LifecycleFilter,
) {
  return obligations
    ?.filter(
      (obligation) =>
        lifecycle !== "unpaid" ||
        (obligation.lifecycle !== "paid" &&
          obligation.lifecycle !== "canceled"),
    )
    .sort((first, second) => {
      if (first.due_date === null) return second.due_date === null ? 0 : -1
      if (second.due_date === null) return 1
      return first.due_date.localeCompare(second.due_date)
    })
}

export function isObligationOverdue(
  obligation: ObligationPublic,
  now = new Date(),
) {
  if (
    obligation.lifecycle === "paid" ||
    obligation.lifecycle === "canceled" ||
    !obligation.due_date
  )
    return false
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  return obligation.due_date < today
}

export function obligationSurfaceClasses(
  obligation: ObligationPublic,
  now = new Date(),
) {
  return obligation.lifecycle === "error" ||
    isObligationOverdue(obligation, now)
    ? "border-destructive/50 bg-destructive/5 hover:bg-destructive/10"
    : "bg-card hover:bg-muted/50"
}

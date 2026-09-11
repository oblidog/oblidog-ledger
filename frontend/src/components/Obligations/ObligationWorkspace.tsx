import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Ban,
  Building2,
  CircleCheck,
  CreditCard,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react"
import { useEffect, useState } from "react"

import {
  CategoriesService,
  type ObligationLifecycle,
  type ObligationPublic,
  ObligationsService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import type { ObligationWithCounterparty } from "@/features/counterparties/api"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { ObligationCounterpartyDialog } from "@/features/counterparties/ObligationCounterpartyDialog"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { ObligationComponentsSection } from "./ObligationComponentsSection"

type LifecycleFilter = ObligationLifecycle | "" | "unpaid"

const lifecycleOptions: LifecycleFilter[] = [
  "",
  "unpaid",
  "draft",
  "collecting_data",
  "ready",
  "paid",
  "canceled",
  "error",
]

const stateBadgeClasses: Record<string, string> = {
  unknown:
    "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-300",
  estimated:
    "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  confirmed:
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  overridden:
    "border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-300",
}

const sourceBadgeClasses: Record<string, string> = {
  unknown: stateBadgeClasses.unknown,
  automatic: "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-300",
  manual:
    "border-indigo-500/30 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300",
  mixed:
    "border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-300",
}

const lifecycleBadgeClasses: Record<ObligationLifecycle, string> = {
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

const dueDateStatusClasses = {
  unknown: "text-muted-foreground",
  safe: "text-emerald-700 dark:text-emerald-300",
  soon: "text-amber-700 dark:text-amber-300",
  urgent: "text-red-700 dark:text-red-300",
}

function currentPeriod() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function periodFromSearch() {
  if (typeof window === "undefined") return currentPeriod()
  const params = new URLSearchParams(window.location.search)
  const year = Number(params.get("year"))
  const month = Number(params.get("month"))
  return isValidPeriod(year, month) ? { year, month } : currentPeriod()
}

function dueDateRange(year: number, month: number) {
  const minimum = new Date(Date.UTC(year, month - 1, 1))
  const maximum = new Date(Date.UTC(year, month, 0))
  let businessDays = 0

  while (businessDays < 7) {
    maximum.setUTCDate(maximum.getUTCDate() + 1)
    const day = maximum.getUTCDay()
    if (day !== 0 && day !== 6) {
      businessDays += 1
    }
  }

  return {
    min: minimum.toISOString().slice(0, 10),
    max: maximum.toISOString().slice(0, 10),
  }
}

function isValidPeriod(year: number, month: number) {
  return (
    Number.isInteger(year) &&
    year >= 1 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  )
}

function monthInputValue(year: string, month: string) {
  const parsedYear = Number(year)
  const parsedMonth = Number(month)
  if (!isValidPeriod(parsedYear, parsedMonth)) {
    return ""
  }
  return `${String(parsedYear).padStart(4, "0")}-${String(parsedMonth).padStart(2, "0")}`
}

function parseMonthInput(value: string) {
  const [year, month] = value.split("-").map(Number)
  if (!isValidPeriod(year, month)) {
    return null
  }
  return { year: String(year), month: String(month) }
}

function canMarkObligationReady(obligation: ObligationPublic) {
  return (
    obligation.lifecycle === "collecting_data" &&
    obligation.current_amount !== null &&
    obligation.due_date !== null &&
    obligation.amount_state !== "unknown" &&
    obligation.due_date_state !== "unknown"
  )
}

function canEditObligation(obligation: ObligationPublic) {
  return (
    obligation.lifecycle === "draft" ||
    obligation.lifecycle === "collecting_data"
  )
}

function canCancelObligation(obligation: ObligationPublic) {
  return obligation.lifecycle === "collecting_data"
}

function canMarkObligationPaid(obligation: ObligationPublic) {
  return obligation.lifecycle === "ready"
}

function canReopenObligation(obligation: ObligationPublic) {
  return ["ready", "paid", "canceled", "error"].includes(obligation.lifecycle)
}

function counterpartyFor(obligation: ObligationPublic) {
  return (obligation as ObligationPublic & ObligationWithCounterparty)
    .counterparty
}

export function ObligationWorkspace({
  ledgerId,
  canManageComponents,
}: {
  ledgerId: string
  canManageComponents: boolean
}) {
  const period = periodFromSearch()
  const [year, setYear] = useState(String(period.year))
  const [month, setMonth] = useState(String(period.month))
  const [filterByPeriod, setFilterByPeriod] = useState(true)
  const [categoryCode, setCategoryCode] = useState("")
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("unpaid")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingObligation, setEditingObligation] =
    useState<ObligationPublic | null>(null)
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const filterYear = Number(year)
  const filterMonth = Number(month)
  const hasValidPeriodFilter =
    !filterByPeriod || isValidPeriod(filterYear, filterMonth)

  const obligations = useQuery({
    queryFn: () =>
      ObligationsService.readObligations({
        ledgerId,
        year: filterByPeriod ? filterYear : undefined,
        month: filterByPeriod ? filterMonth : undefined,
        categoryCode: categoryCode || undefined,
        lifecycle: lifecycle === "unpaid" ? undefined : lifecycle || undefined,
      }),
    enabled: hasValidPeriodFilter,
    queryKey: [
      "obligations",
      ledgerId,
      filterByPeriod,
      year,
      month,
      categoryCode,
      lifecycle,
    ],
  })
  const selected = useQuery({
    enabled: selectedKey !== null,
    queryFn: () =>
      ObligationsService.readObligation({
        ledgerId,
        obligationKey: selectedKey!,
      }),
    queryKey: ["obligation", ledgerId, selectedKey],
  })
  const visibleObligations = obligations.data?.data
    .filter(
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
  const markReady = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.markObligationReady({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: (_, obligation) => {
      showSuccessToast("Obligation marked as ready")
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })
  const reopen = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.reopenObligation({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: (_, obligation) => {
      showSuccessToast("Obligation reopened")
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })
  const cancel = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.cancelObligation({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: (_, obligation) => {
      showSuccessToast("Obligation canceled")
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })
  const markPaid = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.markObligationPaid({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: (_, obligation) => {
      showSuccessToast("Obligation marked as paid")
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Obligations</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground md:block">
            Review and add manual obligations for this ledger.
          </p>
        </div>
        <CreateObligationDialog
          ledgerId={ledgerId}
          defaultPeriod={
            filterByPeriod && hasValidPeriodFilter
              ? { year: filterYear, month: filterMonth }
              : period
          }
          onError={showErrorToast}
          onSuccess={showSuccessToast}
        />
      </div>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            aria-label="Billing period"
            type="month"
            disabled={!filterByPeriod}
            value={monthInputValue(year, month)}
            onChange={(event) => {
              const selectedPeriod = parseMonthInput(event.target.value)
              setYear(selectedPeriod?.year ?? "")
              setMonth(selectedPeriod?.month ?? "")
            }}
          />
          <Input
            aria-label="Category code"
            placeholder="Category code"
            value={categoryCode}
            maxLength={4}
            onChange={(event) =>
              setCategoryCode(event.target.value.toUpperCase())
            }
          />
          <select
            className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
            value={lifecycle}
            onChange={(event) =>
              setLifecycle(event.target.value as LifecycleFilter)
            }
          >
            {lifecycleOptions.map((option) => (
              <option
                key={option || "all"}
                value={option}
                className="bg-background text-foreground"
              >
                {option === ""
                  ? "All lifecycles"
                  : option === "unpaid"
                    ? "Unpaid"
                    : option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="obligation-filter-by-period"
            checked={filterByPeriod}
            onCheckedChange={(checked) => setFilterByPeriod(checked === true)}
          />
          <Label htmlFor="obligation-filter-by-period">Filter by period</Label>
        </div>
        {filterByPeriod && !hasValidPeriodFilter ? (
          <p className="text-sm text-muted-foreground">
            Enter a valid year and month to load obligations.
          </p>
        ) : null}
        {hasValidPeriodFilter && obligations.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading obligations…</p>
        ) : null}
        {hasValidPeriodFilter && obligations.isError ? (
          <div className="flex items-center gap-3 text-sm text-destructive">
            <span>Unable to load obligations.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void obligations.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {hasValidPeriodFilter &&
        !obligations.isError &&
        visibleObligations?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No obligations match these filters.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {!obligations.isError
            ? visibleObligations?.map((obligation) => (
                <ObligationTile
                  key={obligation.key}
                  ledgerId={ledgerId}
                  obligation={obligation}
                  canEditCounterparty={canManageComponents}
                  onEdit={() => setEditingObligation(obligation)}
                  onCancel={() => cancel.mutate(obligation)}
                  onMarkPaid={() => markPaid.mutate(obligation)}
                  onMarkReady={() => markReady.mutate(obligation)}
                  onReopen={() => reopen.mutate(obligation)}
                  onSelect={() => setSelectedKey(obligation.key)}
                  markingReady={markReady.isPending}
                  canceling={cancel.isPending}
                  markingPaid={markPaid.isPending}
                  reopening={reopen.isPending}
                />
              ))
            : null}
        </div>
        <Dialog
          open={selectedKey !== null}
          onOpenChange={(open) => !open && setSelectedKey(null)}
        >
          <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{selected.data?.key ?? "Obligation"}</DialogTitle>
              <DialogDescription>Obligation details.</DialogDescription>
            </DialogHeader>
            {selected.data ? (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Lifecycle</span>
                    <Badge variant="secondary">{selected.data.lifecycle}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      Effective value source
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        sourceBadgeClasses[
                          selected.data.effective_value_source
                        ] ?? sourceBadgeClasses.unknown
                      }
                    >
                      {selected.data.effective_value_source}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <CounterpartyLogo
                    counterparty={counterpartyFor(selected.data) ?? null}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Counterparty
                    </p>
                    <p className="truncate font-medium">
                      {counterpartyFor(selected.data)?.short_name ||
                        counterpartyFor(selected.data)?.name ||
                        "Not assigned"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canMarkObligationReady(selected.data) ? (
                    <Button
                      size="sm"
                      disabled={markReady.isPending}
                      onClick={() => markReady.mutate(selected.data)}
                    >
                      <CircleCheck />
                      Mark as ready
                    </Button>
                  ) : null}
                  {canCancelObligation(selected.data) ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(selected.data)}
                    >
                      <Ban />
                      Cancel
                    </Button>
                  ) : null}
                  {canMarkObligationPaid(selected.data) ? (
                    <Button
                      size="sm"
                      disabled={markPaid.isPending}
                      onClick={() => markPaid.mutate(selected.data)}
                    >
                      <CreditCard />
                      Mark as paid
                    </Button>
                  ) : null}
                  {canReopenObligation(selected.data) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reopen.isPending}
                      onClick={() => reopen.mutate(selected.data)}
                    >
                      <RotateCcw />
                      Reopen
                    </Button>
                  ) : null}
                  {canEditObligation(selected.data) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingObligation(selected.data)}
                    >
                      <Pencil />
                      Edit
                    </Button>
                  ) : null}
                </div>
                {selected.data.notes ? (
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-medium">Notes</p>
                    <p className="whitespace-pre-wrap">{selected.data.notes}</p>
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground border-b text-xs uppercase">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">Field</th>
                        <th className="pb-2 pr-4 font-medium">Value</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ObligationFieldDetails
                        label="Current amount"
                        value={`${selected.data.current_amount ?? "Unknown"} ${
                          selected.data.currency ?? ""
                        }`.trim()}
                        state={selected.data.amount_state}
                        source={selected.data.amount_source}
                      />
                      <ObligationFieldDetails
                        label="Issue date"
                        value={selected.data.issue_date ?? "Unknown"}
                        state={selected.data.issue_date_state}
                        source={selected.data.issue_date_source}
                      />
                      <ObligationFieldDetails
                        label="Due date"
                        value={selected.data.due_date ?? "Unknown"}
                        state={selected.data.due_date_state}
                        source={selected.data.due_date_source}
                      />
                    </tbody>
                  </table>
                </div>
                <ObligationComponentsSection
                  ledgerId={ledgerId}
                  obligationKey={selected.data.key}
                  currency={selected.data.currency}
                  canManage={canManageComponents}
                  onError={showErrorToast}
                  onSuccess={showSuccessToast}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading details…</p>
            )}
          </DialogContent>
        </Dialog>
        {editingObligation ? (
          <EditObligationDialog
            ledgerId={ledgerId}
            obligation={editingObligation}
            open={editingObligation !== null}
            onError={showErrorToast}
            onOpenChange={(open) => !open && setEditingObligation(null)}
            onSuccess={showSuccessToast}
          />
        ) : null}
      </div>
    </section>
  )
}

function businessDaysUntil(dueDate: string | null) {
  if (dueDate === null) {
    return {
      label: "Due date unknown",
      className: dueDateStatusClasses.unknown,
      isUrgent: false,
    }
  }
  const [year, month, day] = dueDate.split("-").map(Number)
  const dueAt = new Date(Date.UTC(year, month - 1, day))
  const now = new Date()
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  if (dueAt < today) {
    return {
      label: "Overdue",
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
    label: `${businessDays} business ${businessDays === 1 ? "day" : "days"} left`,
    className:
      businessDays <= 2
        ? dueDateStatusClasses.urgent
        : businessDays <= 5
          ? dueDateStatusClasses.soon
          : dueDateStatusClasses.safe,
    isUrgent: businessDays <= 2,
  }
}

function paidDateLabel(paidAt: string | null) {
  return paidAt ? paidAt.slice(0, 10) : "Date unavailable"
}

function ObligationTile({
  ledgerId,
  obligation,
  canEditCounterparty,
  onEdit,
  onCancel,
  onMarkPaid,
  onMarkReady,
  onReopen,
  onSelect,
  markingReady,
  canceling,
  markingPaid,
  reopening,
}: {
  ledgerId: string
  obligation: ObligationPublic
  canEditCounterparty: boolean
  onEdit: () => void
  onCancel: () => void
  onMarkPaid: () => void
  onMarkReady: () => void
  onReopen: () => void
  onSelect: () => void
  markingReady: boolean
  canceling: boolean
  markingPaid: boolean
  reopening: boolean
}) {
  const amount =
    obligation.current_amount !== null
      ? `${obligation.current_amount} ${obligation.currency ?? ""}`.trim()
      : "Amount unknown"
  const dueDateStatus = businessDaysUntil(obligation.due_date)
  const isPaid = obligation.lifecycle === "paid"
  const canCancel = canCancelObligation(obligation)
  const canMarkPaid = canMarkObligationPaid(obligation)
  const canMarkReady = canMarkObligationReady(obligation)
  const canEdit = canEditObligation(obligation)
  const canReopen = canReopenObligation(obligation)
  const counterparty = counterpartyFor(obligation) ?? null

  return (
    <div
      className={`group rounded-xl border p-4 text-card-foreground shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${
        isPaid
          ? "border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15"
          : dueDateStatus.isUrgent
            ? "border-destructive/70 bg-destructive/10 hover:bg-destructive/15"
            : "bg-card hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 text-left"
          onClick={onSelect}
        >
          <CounterpartyLogo counterparty={counterparty} className="size-10" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{obligation.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {counterparty?.short_name || counterparty?.name || obligation.key}
            </p>
          </div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${obligation.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEditCounterparty ? (
              <ObligationCounterpartyDialog
                ledgerId={ledgerId}
                obligation={obligation}
                trigger={
                  <DropdownMenuItem
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Building2 />
                    Counterparty
                  </DropdownMenuItem>
                }
              />
            ) : null}
            {canMarkReady ? (
              <DropdownMenuItem disabled={markingReady} onSelect={onMarkReady}>
                <CircleCheck />
                Mark as ready
              </DropdownMenuItem>
            ) : null}
            {canCancel ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={canceling}
                onSelect={onCancel}
              >
                <Ban />
                Cancel
              </DropdownMenuItem>
            ) : null}
            {canMarkPaid ? (
              <DropdownMenuItem disabled={markingPaid} onSelect={onMarkPaid}>
                <CreditCard />
                Mark as paid
              </DropdownMenuItem>
            ) : null}
            {canReopen ? (
              <DropdownMenuItem disabled={reopening} onSelect={onReopen}>
                <RotateCcw />
                Reopen
              </DropdownMenuItem>
            ) : null}
            {canEdit ? (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                Edit
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-xl font-semibold tabular-nums">{amount}</p>
          <Badge
            variant="outline"
            className={lifecycleBadgeClasses[obligation.lifecycle]}
          >
            {obligation.lifecycle}
          </Badge>
        </div>
        {isPaid ? (
          <div className="mt-4 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              Paid on
            </p>
            <p className="mt-1 font-medium tabular-nums">
              {paidDateLabel(obligation.paid_at)}
            </p>
          </div>
        ) : (
          <div className="mt-4 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              Due date
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p className="font-medium tabular-nums">
                {obligation.due_date ?? "Unknown"}
              </p>
              <p
                className={`text-xs whitespace-nowrap ${dueDateStatus.className}`}
              >
                {dueDateStatus.label}
              </p>
            </div>
          </div>
        )}
      </button>
    </div>
  )
}

function EditObligationDialog({
  ledgerId,
  obligation,
  open,
  onSuccess,
  onError,
  onOpenChange,
}: {
  ledgerId: string
  obligation: ObligationPublic
  open: boolean
  onSuccess: (message: string) => void
  onError: (message: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const [currentAmount, setCurrentAmount] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const queryClient = useQueryClient()
  const dueDateLimits = dueDateRange(
    obligation.period.year,
    obligation.period.month,
  )
  const originalCurrentAmount = obligation.current_amount?.toString() ?? ""
  const originalIssueDate = obligation.issue_date ?? ""
  const originalDueDate = obligation.due_date ?? ""
  const originalNotes = obligation.notes ?? ""

  useEffect(() => {
    if (!open) {
      return
    }
    setCurrentAmount(originalCurrentAmount)
    setIssueDate(originalIssueDate)
    setDueDate(originalDueDate)
    setNotes(originalNotes)
  }, [
    open,
    originalCurrentAmount,
    originalDueDate,
    originalIssueDate,
    originalNotes,
  ])

  const dueDateOutOfRange =
    dueDate !== "" &&
    (dueDate < dueDateLimits.min || dueDate > dueDateLimits.max)
  const issueDateAfterDueDate =
    issueDate !== "" && dueDate !== "" && issueDate > dueDate
  const hasChanges =
    currentAmount !== originalCurrentAmount ||
    issueDate !== originalIssueDate ||
    dueDate !== originalDueDate ||
    notes !== originalNotes
  const mutation = useMutation({
    mutationFn: () => {
      const requestBody: {
        current_amount?: string | null
        issue_date?: string | null
        due_date?: string | null
        notes?: string | null
      } = {}
      if (currentAmount !== originalCurrentAmount) {
        requestBody.current_amount = currentAmount || null
      }
      if (issueDate !== originalIssueDate) {
        requestBody.issue_date = issueDate || null
      }
      if (dueDate !== originalDueDate) {
        requestBody.due_date = dueDate || null
      }
      if (notes !== originalNotes) {
        requestBody.notes = notes || null
      }
      return ObligationsService.updateObligation({
        ledgerId,
        obligationKey: obligation.key,
        requestBody,
      })
    },
    onError: handleError.bind(onError),
    onSuccess: () => {
      onSuccess("Obligation updated")
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit obligation</DialogTitle>
          <DialogDescription>
            Update manually entered values and notes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="edit-obligation-current-amount">
                Current amount
              </Label>
              <div className="relative">
                <Input
                  id="edit-obligation-current-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="pr-14 text-right tabular-nums"
                  value={currentAmount}
                  onChange={(event) => setCurrentAmount(event.target.value)}
                />
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium">
                  {obligation.currency ?? "—"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-obligation-issue-date">Issue date</Label>
              <Input
                id="edit-obligation-issue-date"
                type="date"
                max={dueDate || undefined}
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-obligation-due-date">Due date</Label>
              <Input
                id="edit-obligation-due-date"
                type="date"
                min={
                  issueDate && issueDate > dueDateLimits.min
                    ? issueDate
                    : dueDateLimits.min
                }
                max={dueDateLimits.max}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Between {dueDateLimits.min} and {dueDateLimits.max}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-obligation-notes">Notes</Label>
            <textarea
              id="edit-obligation-notes"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <LoadingButton
            className="w-full"
            loading={mutation.isPending}
            disabled={!hasChanges || dueDateOutOfRange || issueDateAfterDueDate}
            onClick={() => mutation.mutate()}
          >
            Save changes
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ObligationFieldDetails({
  label,
  value,
  state,
  source,
}: {
  label: string
  value: string
  state: string
  source: string
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="text-muted-foreground whitespace-nowrap py-3 pr-4 font-medium">
        {label}
      </td>
      <td className="whitespace-nowrap py-3 pr-4 font-semibold tabular-nums">
        {value}
      </td>
      <td className="whitespace-nowrap py-3 pr-4">
        <Badge
          variant="outline"
          className={stateBadgeClasses[state] ?? stateBadgeClasses.unknown}
        >
          {state}
        </Badge>
      </td>
      <td className="whitespace-nowrap py-3">
        <Badge
          variant="outline"
          className={sourceBadgeClasses[source] ?? sourceBadgeClasses.unknown}
        >
          {source}
        </Badge>
      </td>
    </tr>
  )
}

function CreateObligationDialog({
  ledgerId,
  defaultPeriod,
  onSuccess,
  onError,
}: {
  ledgerId: string
  defaultPeriod: { year: number; month: number }
  onSuccess: (message: string) => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [categoryCode, setCategoryCode] = useState("")
  const [year, setYear] = useState(String(defaultPeriod.year))
  const [month, setMonth] = useState(String(defaultPeriod.month))
  const [dataReady, setDataReady] = useState(false)
  const [currentAmount, setCurrentAmount] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  useEffect(() => {
    if (!open) {
      return
    }
    setYear(String(defaultPeriod.year))
    setMonth(String(defaultPeriod.month))
  }, [defaultPeriod.month, defaultPeriod.year, open])
  const queryClient = useQueryClient()
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: ["categories", ledgerId],
  })
  const manualCategories = categories.data?.data.filter(
    (category) => category.data_source_policy !== "automatic",
  )
  const selectedCategory = categories.data?.data.find(
    (category) => category.code === categoryCode,
  )
  const periodYear = Number(year)
  const periodMonth = Number(month)
  const dueDateLimits = dueDateRange(
    Number.isInteger(periodYear) && periodYear > 0
      ? periodYear
      : defaultPeriod.year,
    Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12
      ? periodMonth
      : defaultPeriod.month,
  )
  const dueDateOutOfRange =
    dueDate !== "" &&
    (dueDate < dueDateLimits.min || dueDate > dueDateLimits.max)
  const issueDateAfterDueDate =
    issueDate !== "" && dueDate !== "" && issueDate > dueDate
  const mutation = useMutation({
    mutationFn: () =>
      ObligationsService.createObligation({
        ledgerId,
        requestBody: {
          category_code: categoryCode,
          period: { year: Number(year), month: Number(month) },
          data_ready: dataReady,
          current_amount: currentAmount || undefined,
          issue_date: issueDate || undefined,
          due_date: dueDate || undefined,
          notes: notes || undefined,
        },
      }),
    onError: handleError.bind(onError),
    onSuccess: () => {
      onSuccess("Obligation created")
      setOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New obligation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create manual obligation</DialogTitle>
          <DialogDescription>
            Choose a category and billing period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="obligation-category">Category</Label>
            <select
              id="obligation-category"
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
            >
              <option value="" className="bg-background text-foreground">
                Choose a category
              </option>
              {manualCategories?.map((category) => (
                <option
                  key={category.id}
                  value={category.code}
                  className="bg-background text-foreground"
                >
                  {category.name} ({category.code} · {category.currency})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obligation-period">Billing period</Label>
            <Input
              id="obligation-period"
              type="month"
              value={monthInputValue(year, month)}
              onChange={(event) => {
                const selectedPeriod = parseMonthInput(event.target.value)
                setYear(selectedPeriod?.year ?? "")
                setMonth(selectedPeriod?.month ?? "")
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="obligation-data-ready"
              checked={dataReady}
              onCheckedChange={(checked) => setDataReady(checked === true)}
            />
            <Label htmlFor="obligation-data-ready">Is the data ready?</Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="obligation-current-amount">
                Current amount{dataReady ? " *" : ""}
              </Label>
              <div className="relative">
                <Input
                  id="obligation-current-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="pr-14 text-right tabular-nums"
                  value={currentAmount}
                  onChange={(event) => setCurrentAmount(event.target.value)}
                />
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium">
                  {selectedCategory?.currency ?? "—"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="obligation-issue-date">Issue date</Label>
              <Input
                id="obligation-issue-date"
                type="date"
                max={dueDate || undefined}
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obligation-due-date">
                Due date{dataReady ? " *" : ""}
              </Label>
              <Input
                id="obligation-due-date"
                type="date"
                min={
                  issueDate && issueDate > dueDateLimits.min
                    ? issueDate
                    : dueDateLimits.min
                }
                max={dueDateLimits.max}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Between {dueDateLimits.min} and {dueDateLimits.max}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obligation-notes">Notes</Label>
            <textarea
              id="obligation-notes"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <LoadingButton
            className="w-full"
            loading={mutation.isPending}
            disabled={
              !categoryCode ||
              !year ||
              !month ||
              dueDateOutOfRange ||
              issueDateAfterDueDate ||
              (dataReady && (!currentAmount || !dueDate))
            }
            onClick={() => mutation.mutate()}
          >
            Create obligation
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

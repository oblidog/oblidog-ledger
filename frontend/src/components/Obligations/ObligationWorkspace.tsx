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
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CategoriesService,
  type ObligationLifecycle,
  type ObligationPublic,
  ObligationsService,
} from "@/client"
import {
  type ActiveFilter,
  ActiveFilterBadges,
} from "@/components/ActiveFilterBadges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ObligationWithCounterparty } from "@/features/counterparties/api"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { ObligationCounterpartyDialog } from "@/features/counterparties/ObligationCounterpartyDialog"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount, formatDate } from "@/i18n/format"
import { handleError } from "@/utils"
import { ObligationActionHistory } from "./ObligationActionHistory"
import { ObligationComponentsSection } from "./ObligationComponentsSection"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
  dueDateRange,
  isValidPeriod,
  type LifecycleFilter,
  lifecycleFilterLabel,
  lifecycleOptions,
  monthInputValue,
  parseMonthInput,
  parseObligationFilters,
  serializeObligationFilters,
} from "./obligationLogic"

const touchDialogClasses =
  "[&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:top-2 [&_[data-slot=dialog-close]]:right-2 [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center"

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

function counterpartyFor(obligation: ObligationPublic) {
  return (obligation as ObligationPublic & ObligationWithCounterparty)
    .counterparty
}

export function ObligationWorkspace({
  ledgerId,
  canEdit,
  defaultLifecycle = "unpaid",
}: {
  ledgerId: string
  canEdit: boolean
  defaultLifecycle?: LifecycleFilter
}) {
  useTranslation()

  const period = periodFromSearch()
  const initialFilters = parseObligationFilters(
    typeof window === "undefined" ? "" : window.location.search,
    defaultLifecycle,
    period,
  )
  const [year, setYear] = useState(initialFilters.year)
  const [month, setMonth] = useState(initialFilters.month)
  const [filterByPeriod, setFilterByPeriod] = useState(
    initialFilters.filterByPeriod,
  )
  const [categoryCode, setCategoryCode] = useState(initialFilters.categoryCode)
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(
    initialFilters.lifecycle,
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingObligation, setEditingObligation] =
    useState<ObligationPublic | null>(null)
  const [paymentConfirmation, setPaymentConfirmation] =
    useState<ObligationPublic | null>(null)
  const actionLock = useRef(false)
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
  const actionPending = pendingActionKey !== null
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const invalidateActionHistory = (obligationKey: string) =>
    void queryClient.invalidateQueries({
      queryKey: ["obligation-actions", ledgerId, obligationKey],
    })
  const filterYear = Number(year)
  const filterMonth = Number(month)
  const hasValidPeriodFilter =
    !filterByPeriod || isValidPeriod(filterYear, filterMonth)

  useEffect(() => {
    if (typeof window === "undefined") return

    const search = serializeObligationFilters(window.location.search, {
      year,
      month,
      filterByPeriod,
      categoryCode,
      lifecycle,
    })
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
    window.history.replaceState(window.history.state, "", nextUrl)
  }, [categoryCode, filterByPeriod, month, year, lifecycle])

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
  const activeFilters: ActiveFilter[] = []
  if (filterByPeriod && hasValidPeriodFilter) {
    activeFilters.push({
      key: "period",
      label: i18n.t("app:messages.filter_period", {
        value: monthInputValue(year, month),
      }),
      onRemove: () => setFilterByPeriod(false),
    })
  }
  if (categoryCode) {
    activeFilters.push({
      key: "category",
      label: i18n.t("app:messages.filter_category", { value: categoryCode }),
      onRemove: () => setCategoryCode(""),
    })
  }
  if (lifecycle) {
    activeFilters.push({
      key: "lifecycle",
      label: i18n.t("app:messages.filter_status", {
        value: lifecycleFilterLabel(lifecycle),
      }),
      onRemove: () => setLifecycle(""),
    })
  }
  const clearFilters = () => {
    setFilterByPeriod(false)
    setCategoryCode("")
    setLifecycle("")
  }

  const markReady = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.markObligationReady({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_marked_as_ready"))
      invalidateActionHistory(obligation.key)
      await queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      await queryClient.invalidateQueries({
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
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_reopened"))
      invalidateActionHistory(obligation.key)
      await queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      await queryClient.invalidateQueries({
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
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_canceled"))
      invalidateActionHistory(obligation.key)
      await queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      await queryClient.invalidateQueries({
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
    onSuccess: async (_, obligation) => {
      setPaymentConfirmation(null)
      showSuccessToast(i18n.t("app:obligations.obligation_marked_as_paid"))
      invalidateActionHistory(obligation.key)
      await queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      await queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })

  const runAction = async (
    action: typeof markReady,
    obligation: ObligationPublic,
  ) => {
    if (!canEdit || actionLock.current) return
    actionLock.current = true
    setPendingActionKey(obligation.key)
    try {
      await action.mutateAsync(obligation)
    } catch {
      // The mutation reports the error; keep the current view for retry.
    } finally {
      actionLock.current = false
      setPendingActionKey(null)
    }
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">
            {i18n.t("app:obligations.obligations")}
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground md:block">
            {i18n.t(
              "app:obligations.review_and_add_manual_obligations_for_this_ledger",
            )}
          </p>
        </div>
        {canEdit ? (
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
        ) : null}
      </div>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            aria-label={i18n.t("app:obligations.billing_period")}
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
            aria-label={i18n.t("app:obligations.category_code")}
            placeholder={i18n.t("app:obligations.category_code")}
            value={categoryCode}
            maxLength={4}
            onChange={(event) =>
              setCategoryCode(event.target.value.toUpperCase())
            }
          />
          <select
            aria-label={i18n.t("app:obligations.lifecycle")}
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
                  ? i18n.t("app:obligations.all_lifecycles")
                  : option === "unpaid"
                    ? i18n.t("app:obligations.unpaid")
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
          <Label htmlFor="obligation-filter-by-period">
            {i18n.t("app:obligations.filter_by_period")}
          </Label>
        </div>
        <ActiveFilterBadges filters={activeFilters} onClearAll={clearFilters} />
        {filterByPeriod && !hasValidPeriodFilter ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:obligations.enter_a_valid_year_and_month_to_load_obligations",
            )}
          </p>
        ) : null}
        {hasValidPeriodFilter && obligations.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:obligations.loading_obligations")}
          </p>
        ) : null}
        {hasValidPeriodFilter && obligations.isError ? (
          <div className="flex items-center gap-3 text-sm text-destructive">
            <span>{i18n.t("app:obligations.unable_to_load_obligations")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void obligations.refetch()}
            >
              {i18n.t("app:obligations.try_again")}
            </Button>
          </div>
        ) : null}
        {hasValidPeriodFilter &&
        !obligations.isError &&
        visibleObligations?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:obligations.no_obligations_match_these_filters")}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {!obligations.isError
            ? visibleObligations?.map((obligation) => (
                <ObligationTile
                  key={obligation.key}
                  ledgerId={ledgerId}
                  obligation={obligation}
                  canWrite={canEdit}
                  disabled={actionPending}
                  loading={pendingActionKey === obligation.key}
                  onEdit={() => setEditingObligation(obligation)}
                  onCancel={() => void runAction(cancel, obligation)}
                  onMarkPaid={() => setPaymentConfirmation(obligation)}
                  onMarkReady={() => void runAction(markReady, obligation)}
                  onReopen={() => void runAction(reopen, obligation)}
                  onSelect={() => setSelectedKey(obligation.key)}
                />
              ))
            : null}
        </div>
        <Dialog
          open={selectedKey !== null}
          onOpenChange={(open) => !open && setSelectedKey(null)}
        >
          <DialogContent
            className={`flex max-h-[min(90dvh,calc(100vh-2rem))] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl ${touchDialogClasses}`}
          >
            <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6">
              <DialogTitle className="break-all">
                {selected.data?.key ?? i18n.t("app:obligations.obligation")}
              </DialogTitle>
              <DialogDescription>
                {i18n.t("app:obligations.obligation_details")}
              </DialogDescription>
            </DialogHeader>
            {selected.data ? (
              <Tabs
                key={selected.data.key}
                defaultValue="details"
                className="min-h-0 min-w-0 flex-1 gap-0"
              >
                <TabsList className="mx-4 my-3 h-14 w-fit max-w-[calc(100%-2rem)] shrink-0 sm:mx-6">
                  <TabsTrigger value="details">
                    {i18n.t("app:obligations.details")}
                  </TabsTrigger>
                  <TabsTrigger value="components">
                    {i18n.t("app:obligations.components")}
                  </TabsTrigger>
                  <TabsTrigger value="activity">
                    {i18n.t("app:obligations.activity")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="details"
                  className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
                >
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {i18n.t("app:obligations.lifecycle")}
                        </span>
                        <Badge variant="secondary">
                          {domainLabel("lifecycle", selected.data.lifecycle)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {i18n.t("app:obligations.effective_value_source")}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            sourceBadgeClasses[
                              selected.data.effective_value_source
                            ] ?? sourceBadgeClasses.unknown
                          }
                        >
                          {domainLabel(
                            "source",
                            selected.data.effective_value_source,
                          )}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      <CounterpartyLogo
                        counterparty={counterpartyFor(selected.data) ?? null}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {i18n.t("app:obligations.counterparty")}
                        </p>
                        <p className="truncate font-medium">
                          {counterpartyFor(selected.data)?.short_name ||
                            counterpartyFor(selected.data)?.name ||
                            i18n.t("app:obligations.not_assigned")}
                        </p>
                      </div>
                    </div>
                    {selected.data.notes ? (
                      <div className="space-y-1">
                        <p className="text-muted-foreground font-medium">
                          {i18n.t("app:obligations.notes")}
                        </p>
                        <p className="whitespace-pre-wrap break-words">
                          {selected.data.notes}
                        </p>
                      </div>
                    ) : null}
                    <div className="overflow-x-auto">
                      <table className="block w-full text-left text-sm md:table">
                        <thead className="hidden text-muted-foreground border-b text-xs uppercase md:table-header-group">
                          <tr>
                            <th className="pb-2 pr-4 font-medium">
                              {i18n.t("app:obligations.field")}
                            </th>
                            <th className="pb-2 pr-4 font-medium">
                              {i18n.t("app:obligations.value")}
                            </th>
                            <th className="pb-2 pr-4 font-medium">
                              {i18n.t("app:obligations.status")}
                            </th>
                            <th className="pb-2 font-medium">
                              {i18n.t("app:obligations.source_6da13a")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="block space-y-3 md:table-row-group md:space-y-0">
                          <ObligationFieldDetails
                            label={i18n.t("app:obligations.current_amount")}
                            value={
                              selected.data.current_amount === null
                                ? i18n.t("app:obligations.unknown")
                                : formatAmount(
                                    String(selected.data.current_amount),
                                    selected.data.currency,
                                  )
                            }
                            state={selected.data.amount_state}
                            source={selected.data.amount_source}
                          />
                          <ObligationFieldDetails
                            label={i18n.t("app:obligations.issue_date")}
                            value={
                              selected.data.issue_date
                                ? formatDate(selected.data.issue_date)
                                : i18n.t("app:obligations.unknown")
                            }
                            state={selected.data.issue_date_state}
                            source={selected.data.issue_date_source}
                          />
                          <ObligationFieldDetails
                            label={i18n.t("app:obligations.due_date")}
                            value={
                              selected.data.due_date
                                ? formatDate(selected.data.due_date)
                                : i18n.t("app:obligations.unknown")
                            }
                            state={selected.data.due_date_state}
                            source={selected.data.due_date_source}
                          />
                        </tbody>
                      </table>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent
                  value="components"
                  className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
                >
                  <ObligationComponentsSection
                    ledgerId={ledgerId}
                    obligationKey={selected.data.key}
                    currency={selected.data.currency}
                    canManage={canEdit}
                    onError={showErrorToast}
                    onSuccess={showSuccessToast}
                  />
                </TabsContent>
                <TabsContent
                  value="activity"
                  className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
                >
                  <ObligationActionHistory
                    ledgerId={ledgerId}
                    obligationKey={selected.data.key}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="px-4 py-4 text-sm sm:px-6">
                {selected.isError ? (
                  <>
                    <p role="alert">
                      {i18n.t(
                        "app:obligations.unable_to_load_obligation_details",
                      )}
                    </p>
                    <Button
                      className="mt-2 min-h-11"
                      variant="outline"
                      onClick={() => void selected.refetch()}
                    >
                      {i18n.t("app:obligations.try_again")}
                    </Button>
                  </>
                ) : (
                  <p>{i18n.t("app:obligations.loading_details")}</p>
                )}
              </div>
            )}
            {selected.data && canEdit ? (
              <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
                <div className="flex flex-wrap gap-2">
                  {canMarkObligationReady(selected.data) ? (
                    <Button
                      size="sm"
                      className="min-h-11"
                      disabled={actionPending}
                      onClick={() => void runAction(markReady, selected.data)}
                    >
                      <CircleCheck />
                      {i18n.t("app:obligations.mark_as_ready")}
                    </Button>
                  ) : null}
                  {canCancelObligation(selected.data) ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="min-h-11"
                      disabled={actionPending}
                      onClick={() => void runAction(cancel, selected.data)}
                    >
                      <Ban />
                      {i18n.t("app:obligations.cancel")}
                    </Button>
                  ) : null}
                  {canMarkObligationPaid(selected.data) ? (
                    <Button
                      size="sm"
                      className="min-h-11"
                      disabled={actionPending}
                      onClick={() => setPaymentConfirmation(selected.data)}
                    >
                      <CreditCard />
                      {i18n.t("app:obligations.mark_as_paid")}
                    </Button>
                  ) : null}
                  {canReopenObligation(selected.data) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={actionPending}
                      onClick={() => void runAction(reopen, selected.data)}
                    >
                      <RotateCcw />
                      {i18n.t("app:obligations.reopen")}
                    </Button>
                  ) : null}
                  {canEditObligation(selected.data) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={actionPending}
                      onClick={() => setEditingObligation(selected.data)}
                    >
                      <Pencil />
                      {i18n.t("app:obligations.edit_530164")}
                    </Button>
                  ) : null}
                </div>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
        <Dialog
          open={paymentConfirmation !== null}
          onOpenChange={(open) => {
            if (!open && !actionPending) setPaymentConfirmation(null)
          }}
        >
          <DialogContent
            className={touchDialogClasses}
            onEscapeKeyDown={(event) => {
              if (actionPending) event.preventDefault()
            }}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHeader className="pr-10">
              <DialogTitle>
                {i18n.t("app:obligations.mark_obligation_as_paid")}
              </DialogTitle>
              <DialogDescription>
                {i18n.t(
                  "app:obligations.confirm_that_you_have_paid_this_obligation",
                )}
              </DialogDescription>
            </DialogHeader>
            {paymentConfirmation ? (
              <div className="min-w-0 space-y-1">
                <p className="break-words font-medium">
                  {paymentConfirmation.name}
                </p>
                <p className="break-all text-sm text-muted-foreground">
                  {paymentConfirmation.key}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {paymentConfirmation.current_amount}{" "}
                  {paymentConfirmation.currency}
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                className="min-h-11"
                variant="outline"
                disabled={actionPending}
                onClick={() => setPaymentConfirmation(null)}
              >
                {i18n.t("app:obligations.cancel")}
              </Button>
              <LoadingButton
                className="min-h-11"
                loading={actionPending}
                disabled={
                  paymentConfirmation === null ||
                  !canMarkObligationPaid(paymentConfirmation)
                }
                onClick={() => {
                  if (
                    paymentConfirmation !== null &&
                    canMarkObligationPaid(paymentConfirmation) &&
                    !actionPending
                  ) {
                    void runAction(markPaid, paymentConfirmation)
                  }
                }}
              >
                {i18n.t("app:obligations.mark_as_paid")}
              </LoadingButton>
            </DialogFooter>
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
      label: i18n.t("app:obligations.due_date_unknown"),
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

function paidDateLabel(paidAt: string | null) {
  return paidAt
    ? formatDate(paidAt.slice(0, 10))
    : i18n.t("app:obligations.date_unavailable")
}

function ObligationTile({
  ledgerId,
  obligation,
  canWrite,
  disabled,
  loading,
  onEdit,
  onCancel,
  onMarkPaid,
  onMarkReady,
  onReopen,
  onSelect,
}: {
  ledgerId: string
  obligation: ObligationPublic
  canWrite: boolean
  disabled: boolean
  loading: boolean
  onEdit: () => void
  onCancel: () => void
  onMarkPaid: () => void
  onMarkReady: () => void
  onReopen: () => void
  onSelect: () => void
}) {
  useTranslation()

  const amount =
    obligation.current_amount !== null
      ? formatAmount(String(obligation.current_amount), obligation.currency)
      : i18n.t("app:obligations.amount_unknown")
  const dueDateStatus = businessDaysUntil(obligation.due_date)
  const isPaid = obligation.lifecycle === "paid"
  const canCancel = canWrite && canCancelObligation(obligation)
  const canMarkPaid = canWrite && canMarkObligationPaid(obligation)
  const canMarkReady = canWrite && canMarkObligationReady(obligation)
  const canEdit = canWrite && canEditObligation(obligation)
  const canReopen = canWrite && canReopenObligation(obligation)
  const counterparty = counterpartyFor(obligation) ?? null

  return (
    <div
      className={`group min-w-0 rounded-xl border p-4 text-card-foreground shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${
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
        {canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11"
                disabled={disabled}
                aria-label={i18n.t("app:obligations.actions_for", {
                  value1: obligation.name,
                })}
                onClick={(event) => event.stopPropagation()}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="[&_[role=menuitem]]:min-h-11"
            >
              {canWrite ? (
                <ObligationCounterpartyDialog
                  ledgerId={ledgerId}
                  obligation={obligation}
                  trigger={
                    <DropdownMenuItem
                      onSelect={(event) => event.preventDefault()}
                    >
                      <Building2 />
                      {i18n.t("app:obligations.counterparty")}
                    </DropdownMenuItem>
                  }
                />
              ) : null}
              {canMarkReady ? (
                <DropdownMenuItem disabled={disabled} onSelect={onMarkReady}>
                  <CircleCheck />
                  {i18n.t("app:obligations.mark_as_ready")}
                </DropdownMenuItem>
              ) : null}
              {canCancel ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={disabled}
                  onSelect={onCancel}
                >
                  <Ban />
                  {i18n.t("app:obligations.cancel")}
                </DropdownMenuItem>
              ) : null}
              {canMarkPaid ? (
                <DropdownMenuItem disabled={disabled} onSelect={onMarkPaid}>
                  <CreditCard />
                  {i18n.t("app:obligations.mark_as_paid")}
                </DropdownMenuItem>
              ) : null}
              {canReopen ? (
                <DropdownMenuItem disabled={disabled} onSelect={onReopen}>
                  <RotateCcw />
                  {i18n.t("app:obligations.reopen")}
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <DropdownMenuItem disabled={disabled} onSelect={onEdit}>
                  <Pencil />
                  {i18n.t("app:obligations.edit_530164")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="break-all text-xl font-semibold tabular-nums">
            {amount}
          </p>
          <Badge
            variant="outline"
            className={lifecycleBadgeClasses[obligation.lifecycle]}
          >
            {domainLabel("lifecycle", obligation.lifecycle)}
          </Badge>
        </div>
        {isPaid ? (
          <div className="mt-4 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              {i18n.t("app:obligations.paid_on")}
            </p>
            <p className="mt-1 font-medium tabular-nums">
              {paidDateLabel(obligation.paid_at)}
            </p>
          </div>
        ) : (
          <div className="mt-4 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              {i18n.t("app:obligations.due_date")}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-medium tabular-nums">
                {obligation.due_date
                  ? formatDate(obligation.due_date)
                  : i18n.t("app:obligations.unknown")}
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
      {canMarkReady || canMarkPaid || canEdit ? (
        <LoadingButton
          className="mt-4 min-h-11 w-full md:hidden"
          loading={loading}
          disabled={disabled}
          onClick={
            canMarkPaid ? onMarkPaid : canMarkReady ? onMarkReady : onEdit
          }
        >
          {canMarkPaid ? (
            <CreditCard />
          ) : canMarkReady ? (
            <CircleCheck />
          ) : (
            <Pencil />
          )}
          {canMarkPaid
            ? i18n.t("app:obligations.mark_as_paid")
            : canMarkReady
              ? i18n.t("app:obligations.mark_as_ready")
              : i18n.t("app:obligations.complete_data")}
        </LoadingButton>
      ) : null}
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
  useTranslation()

  const [currentAmount, setCurrentAmount] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const submitLock = useRef(false)
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
      onSuccess(i18n.t("app:obligations.obligation_updated"))
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: ["obligation-actions", ledgerId, obligation.key],
      })
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
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${touchDialogClasses}`}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>{i18n.t("app:obligations.edit_obligation")}</DialogTitle>
          <DialogDescription>
            {i18n.t("app:obligations.update_manually_entered_values_and_notes")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="edit-obligation-current-amount">
                {i18n.t("app:obligations.current_amount")}
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
              <Label htmlFor="edit-obligation-issue-date">
                {i18n.t("app:obligations.issue_date")}
              </Label>
              <Input
                id="edit-obligation-issue-date"
                type="date"
                max={dueDate || undefined}
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-obligation-due-date">
                {i18n.t("app:obligations.due_date")}
              </Label>
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
                {i18n.t("app:obligations.between")} {dueDateLimits.min}{" "}
                {i18n.t("app:obligations.and")} {dueDateLimits.max}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-obligation-notes">
              {i18n.t("app:obligations.notes")}
            </Label>
            <textarea
              id="edit-obligation-notes"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <LoadingButton
            className="min-h-11 w-full"
            loading={mutation.isPending}
            disabled={!hasChanges || dueDateOutOfRange || issueDateAfterDueDate}
            onClick={() => {
              if (submitLock.current) return
              submitLock.current = true
              void mutation
                .mutateAsync()
                .catch(() => {})
                .finally(() => {
                  submitLock.current = false
                })
            }}
          >
            {i18n.t("app:obligations.save_changes")}
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
  useTranslation()

  return (
    <tr className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:table-row md:rounded-none md:border-x-0 md:border-t-0 md:p-0 md:last:border-0">
      <td className="col-span-2 text-muted-foreground font-medium md:whitespace-nowrap md:py-3 md:pr-4">
        {label}
      </td>
      <td className="col-span-2 break-words font-semibold tabular-nums md:whitespace-nowrap md:py-3 md:pr-4">
        {value}
      </td>
      <td className="min-w-0 md:whitespace-nowrap md:py-3 md:pr-4">
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">
          {i18n.t("app:obligations.status")}
        </span>
        <Badge
          variant="outline"
          className={stateBadgeClasses[state] ?? stateBadgeClasses.unknown}
        >
          {domainLabel("valueState", state)}
        </Badge>
      </td>
      <td className="min-w-0 md:whitespace-nowrap md:py-3">
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">
          {i18n.t("app:obligations.source_6da13a")}
        </span>
        <Badge
          variant="outline"
          className={sourceBadgeClasses[source] ?? sourceBadgeClasses.unknown}
        >
          {domainLabel("source", source)}
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
  useTranslation()

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
  const submitLock = useRef(false)
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
      onSuccess(i18n.t("app:obligations.obligation_created"))
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
          {i18n.t("app:obligations.new_obligation")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${touchDialogClasses}`}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>
            {i18n.t("app:obligations.create_manual_obligation")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:obligations.choose_a_category_and_billing_period")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="obligation-category">
              {i18n.t("app:obligations.category")}
            </Label>
            <select
              id="obligation-category"
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
            >
              <option value="" className="bg-background text-foreground">
                {i18n.t("app:obligations.choose_a_category")}
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
            <Label htmlFor="obligation-period">
              {i18n.t("app:obligations.billing_period")}
            </Label>
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
            <Label htmlFor="obligation-data-ready">
              {i18n.t("app:obligations.is_the_data_ready")}
            </Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="obligation-current-amount">
                {i18n.t("app:obligations.current_amount")}
                {dataReady ? " *" : ""}
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
              <Label htmlFor="obligation-issue-date">
                {i18n.t("app:obligations.issue_date")}
              </Label>
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
                {i18n.t("app:obligations.due_date")}
                {dataReady ? " *" : ""}
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
                {i18n.t("app:obligations.between")} {dueDateLimits.min}{" "}
                {i18n.t("app:obligations.and")} {dueDateLimits.max}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obligation-notes">
              {i18n.t("app:obligations.notes")}
            </Label>
            <textarea
              id="obligation-notes"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <LoadingButton
            className="min-h-11 w-full"
            loading={mutation.isPending}
            disabled={
              !categoryCode ||
              !year ||
              !month ||
              dueDateOutOfRange ||
              issueDateAfterDueDate ||
              (dataReady && (!currentAmount || !dueDate))
            }
            onClick={() => {
              if (submitLock.current) return
              submitLock.current = true
              void mutation
                .mutateAsync()
                .catch(() => {})
                .finally(() => {
                  submitLock.current = false
                })
            }}
          >
            {i18n.t("app:obligations.create_obligation")}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

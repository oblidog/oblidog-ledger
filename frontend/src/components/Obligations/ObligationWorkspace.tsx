import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CategoriesService, type ObligationPublic } from "@/client"
import {
  type ActiveFilter,
  ActiveFilterBadges,
} from "@/components/ActiveFilterBadges"
import { firstScheduledPeriod } from "@/components/Categories/categoryPresentation"
import { PageHeader } from "@/components/Common/PageHeader"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useIsMobile } from "@/hooks/useMobile"
import { i18n } from "@/i18n"
import { formatBillingPeriod } from "@/i18n/format"
import { CreateObligationDialog } from "./CreateObligationDialog"
import { EditObligationDialog } from "./EditObligationDialog"
import type { ObligationItemProps } from "./ObligationActions"
import { ObligationDetailsDialog } from "./ObligationDetailsDialog"
import { CategoryFilter, PeriodFilter } from "./ObligationFilters"
import { ObligationList } from "./ObligationList"
import { ObligationPaymentDialog } from "./ObligationPaymentDialog"
import { ObligationTile } from "./ObligationTile"
import {
  isValidPeriod,
  type LifecycleFilter,
  lifecycleFilterLabel,
  lifecycleOptions,
  monthInputValue,
  parseMonthInput,
} from "./obligationLogic"
import {
  periodFromSearch,
  visibleObligationRows,
} from "./obligationPresentation"
import {
  obligationQueryKeys,
  useFirstScheduledObligation,
  useObligationList,
} from "./obligationQueries"
import { useObligationActions } from "./useObligationActions"
import { useObligationFilters } from "./useObligationFilters"

export function ObligationWorkspace({
  ledgerId,
  canEdit,
  demoPreview,
  defaultLifecycle = "unpaid",
}: {
  ledgerId: string
  canEdit: boolean
  demoPreview: boolean
  defaultLifecycle?: LifecycleFilter
}) {
  useTranslation()

  const period = periodFromSearch()
  const { filters, search, update } = useObligationFilters(defaultLifecycle)
  const { year, month, filterByPeriod, categoryCode, lifecycle } = filters
  const isMobile = useIsMobile()
  const categories = useQuery({
    queryKey: ["categories", ledgerId, "obligation-filters"],
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
  })
  const { history } = useRouter()
  const [selectedKey, setSelectedKey] = useState(() =>
    new URLSearchParams(history.location.search).get("obligation"),
  )
  const queryClient = useQueryClient()
  const firstPaymentCode = new URLSearchParams(search).get("firstPayment")
  const firstPaymentCategory = categories.data?.data.find(
    (category) => category.code === firstPaymentCode && category.is_active,
  )
  const firstPeriod =
    firstPaymentCategory && firstScheduledPeriod(firstPaymentCategory)
  const firstKey =
    firstPaymentCategory && firstPeriod
      ? `${firstPaymentCategory.code}-${monthInputValue(String(firstPeriod.year), String(firstPeriod.month))}`
      : null
  const firstObligation = useFirstScheduledObligation(
    ledgerId,
    firstKey,
    demoPreview || firstPaymentCategory?.data_source_policy === "automatic"
      ? firstPaymentCategory?.code
      : undefined,
  )
  const checkingFirstPayment =
    !!firstPaymentCode &&
    (categories.isPending ||
      (!!firstKey && !firstObligation.isFetchedAfterMount))
  const canCreateFirstPayment =
    selectedKey === null &&
    !!firstPeriod &&
    firstObligation.data === null &&
    firstPaymentCategory?.data_source_policy === "hybrid" &&
    canEdit &&
    !checkingFirstPayment &&
    !firstObligation.isError &&
    !categories.isError
  const previewWithoutPayment =
    demoPreview && !firstObligation.isError && !categories.isError
  const firstPaymentDetails =
    !checkingFirstPayment && !categories.isError && !firstObligation.isError
      ? firstObligation.data?.key
      : undefined

  function clearDialogSearch(...names: string[]) {
    const location = history.location
    const params = new URLSearchParams(location.search)
    if (!names.some((name) => params.has(name))) return
    for (const name of names) params.delete(name)

    const next = params.toString()
    history.replace(
      `${location.pathname}${next ? `?${next}` : ""}${location.hash}`,
      location.state,
    )
  }

  function closeObligationDetails() {
    setSelectedKey(null)
    clearDialogSearch("obligation", "firstPayment")
  }

  const [editingObligation, setEditingObligation] =
    useState<ObligationPublic | null>(null)
  const [paymentConfirmation, setPaymentConfirmation] =
    useState<ObligationPublic | null>(null)
  const workspace = useRef<HTMLElement>(null)
  const paymentTrigger = useRef<HTMLButtonElement | null>(null)
  const actions = useObligationActions(
    ledgerId,
    canEdit,
    setPaymentConfirmation,
  )
  const {
    markReady,
    reopen,
    cancel,
    runAction,
    pendingActionKey,
    actionPending,
    showErrorToast,
    showSuccessToast,
  } = actions
  const filterYear = Number(year)
  const filterMonth = Number(month)
  const hasValidPeriodFilter =
    !filterByPeriod || isValidPeriod(filterYear, filterMonth)

  const obligations = useObligationList(
    ledgerId,
    filterByPeriod,
    year,
    month,
    categoryCode,
    lifecycle,
  )
  const visibleObligations = visibleObligationRows(
    obligations.data?.data,
    lifecycle,
  )
  const clearFilters = () =>
    update({ filterByPeriod: false, categoryCode: "", lifecycle: "" })
  const activeFilters: ActiveFilter[] = []
  if (filterByPeriod && hasValidPeriodFilter) {
    activeFilters.push({
      key: "period",
      label: i18n.t("app:messages.filter_period", {
        value: formatBillingPeriod({ year: filterYear, month: filterMonth }),
      }),
      onRemove: () => update({ filterByPeriod: false }),
    })
  }
  if (categoryCode) {
    const categoryName =
      categories.data?.data.find((category) => category.code === categoryCode)
        ?.name ?? categoryCode
    activeFilters.push({
      key: "category",
      label: i18n.t("app:messages.filter_category", { value: categoryName }),
      onRemove: () => update({ categoryCode: "" }),
    })
  }
  if (lifecycle) {
    activeFilters.push({
      key: "lifecycle",
      label: i18n.t("app:messages.filter_status", {
        value: lifecycleFilterLabel(lifecycle),
      }),
      onRemove: () => update({ lifecycle: "" }),
    })
  }
  const items: ObligationItemProps[] = !obligations.isError
    ? (visibleObligations?.map((obligation) => ({
        ledgerId,
        obligation,
        canWrite: canEdit,
        disabled: actionPending,
        loading: pendingActionKey === obligation.key,
        onEdit: () => setEditingObligation(obligation),
        onCancel: () => void runAction(cancel, obligation),
        onMarkPaid: (trigger) => {
          paymentTrigger.current = trigger ?? null
          setPaymentConfirmation(obligation)
        },
        onMarkReady: () => void runAction(markReady, obligation),
        onReopen: () => void runAction(reopen, obligation),
        onSelect: () => {
          clearDialogSearch("firstPayment")
          setSelectedKey(obligation.key)
        },
      })) ?? [])
    : []

  return (
    <section ref={workspace} tabIndex={-1} className="min-w-0">
      <PageHeader
        title={i18n.t("app:obligations.obligations")}
        actions={
          canEdit ? (
            <CreateObligationDialog
              key={canCreateFirstPayment ? firstKey : undefined}
              ledgerId={ledgerId}
              defaultPeriod={
                canCreateFirstPayment && firstPeriod
                  ? firstPeriod
                  : filterByPeriod && hasValidPeriodFilter
                    ? { year: filterYear, month: filterMonth }
                    : period
              }
              onError={showErrorToast}
              onSuccess={showSuccessToast}
              firstPayment={
                canCreateFirstPayment && firstKey && firstPaymentCategory
                  ? {
                      categoryCode: firstPaymentCategory.code,
                      obligationKey: firstKey,
                      onClose: () => clearDialogSearch("firstPayment"),
                      onResolved: (key) => {
                        queryClient.removeQueries({
                          queryKey: obligationQueryKeys.firstScheduled(
                            ledgerId,
                            firstKey,
                          ),
                        })
                        setSelectedKey(key)
                        clearDialogSearch("firstPayment")
                      },
                    }
                  : undefined
              }
            />
          ) : null
        }
      />
      <div className="mt-6 space-y-4">
        {canEdit &&
          categories.isSuccess &&
          !categories.data.data.some((category) => category.is_active) && (
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                {i18n.t("app:obligations.first_category_help")}
              </p>
              <Button asChild variant="outline">
                <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
                  {i18n.t("app:categories.add_first_category")}
                </Link>
              </Button>
            </div>
          )}
        {firstPaymentCode && !firstPaymentDetails && !canCreateFirstPayment && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm"
            role="status"
          >
            <p>
              {i18n.t(
                checkingFirstPayment
                  ? "app:obligations.checking_first_payment"
                  : firstObligation.isError || categories.isError
                    ? "app:obligations.could_not_check_first_payment"
                    : previewWithoutPayment
                      ? "app:onboarding.demo_payment_unavailable"
                      : firstPaymentCategory?.data_source_policy ===
                            "automatic" && firstPeriod
                        ? "app:obligations.first_automatic_payment_pending"
                        : "app:obligations.first_payment_unavailable",
              )}
            </p>
            {!checkingFirstPayment && previewWithoutPayment && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/ledgers/$ledgerId/categories"
                  params={{ ledgerId }}
                  search={{ setupPreview: true }}
                >
                  {i18n.t("app:onboarding.open_categories")}
                </Link>
              </Button>
            )}
            {!checkingFirstPayment && !previewWithoutPayment && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (categories.isError) void categories.refetch()
                  else if (firstKey) void firstObligation.refetch()
                  else clearDialogSearch("firstPayment")
                }}
              >
                {i18n.t(
                  firstKey || categories.isError
                    ? "app:obligations.try_again"
                    : "common:actions.close",
                )}
              </Button>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <Label>{i18n.t("app:obligations.billing_period")}</Label>
            <PeriodFilter
              key={filterByPeriod ? monthInputValue(year, month) : "all"}
              value={filterByPeriod ? monthInputValue(year, month) : ""}
              onChange={(value) => {
                const selected = parseMonthInput(value)
                update(
                  selected
                    ? {
                        year: selected.year,
                        month: selected.month,
                        filterByPeriod: true,
                      }
                    : { filterByPeriod: false },
                )
              }}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label>{i18n.t("app:obligations.category_filter")}</Label>
            <CategoryFilter
              categories={categories.data?.data ?? []}
              value={categoryCode}
              onChange={(code) => update({ categoryCode: code })}
              unavailable={categories.isError}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="obligation-lifecycle-filter">
              {i18n.t("app:obligations.status")}
            </Label>
            <select
              id="obligation-lifecycle-filter"
              aria-label={i18n.t("app:obligations.lifecycle")}
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={lifecycle}
              onChange={(event) =>
                update({ lifecycle: event.target.value as LifecycleFilter })
              }
            >
              {lifecycleOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option === ""
                    ? i18n.t("app:obligations.all_lifecycles")
                    : option === "unpaid"
                      ? i18n.t("app:obligations.unpaid")
                      : lifecycleFilterLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ActiveFilterBadges filters={activeFilters} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={clearFilters}
            disabled={!filterByPeriod && !categoryCode && !lifecycle}
          >
            {i18n.t("app:filters.clear_all")}
          </Button>
        </div>
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
        {items.length > 0 &&
          (isMobile ? (
            <div className="grid grid-cols-1 gap-3">
              {items.map((item) => (
                <ObligationTile key={item.obligation.key} {...item} />
              ))}
            </div>
          ) : (
            <ObligationList items={items} />
          ))}
        <ObligationDetailsDialog
          ledgerId={ledgerId}
          selectedKey={selectedKey ?? firstPaymentDetails ?? null}
          onClose={closeObligationDetails}
          canEdit={canEdit}
          actions={actions}
          setPaymentConfirmation={setPaymentConfirmation}
          setEditingObligation={setEditingObligation}
        />
        <ObligationPaymentDialog
          paymentConfirmation={paymentConfirmation}
          setPaymentConfirmation={setPaymentConfirmation}
          onCloseAutoFocus={(event) => {
            const trigger = paymentTrigger.current
            paymentTrigger.current = null
            if (!trigger) return

            event.preventDefault()
            if (trigger.isConnected && !trigger.disabled) trigger.focus()
            else workspace.current?.focus({ preventScroll: true })
          }}
          actions={actions}
        />
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

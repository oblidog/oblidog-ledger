import { CircleCheck, CreditCard, Pencil } from "lucide-react"
import { useTranslation } from "react-i18next"
import { LoadingButton } from "@/components/ui/loading-button"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { i18n } from "@/i18n"
import { formatAmount, formatDate } from "@/i18n/format"
import {
  ObligationActions,
  type ObligationItemProps,
} from "./ObligationActions"
import { ObligationStatus } from "./ObligationStatus"
import {
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
} from "./obligationLogic"
import {
  businessDaysUntil,
  counterpartyFor,
  obligationSurfaceClasses,
  paidDateLabel,
} from "./obligationPresentation"

export function ObligationTile(props: ObligationItemProps) {
  const {
    obligation,
    canWrite,
    disabled,
    loading,
    onEdit,
    onMarkPaid,
    onMarkReady,
    onSelect,
  } = props
  useTranslation()

  const amount =
    obligation.current_amount !== null
      ? formatAmount(String(obligation.current_amount), obligation.currency)
      : i18n.t("app:obligations.amount_unknown")
  const dueDateStatus = businessDaysUntil(obligation.due_date)
  const isPaid = obligation.lifecycle === "paid"
  const canMarkPaid = canWrite && canMarkObligationPaid(obligation)
  const canMarkReady = canWrite && canMarkObligationReady(obligation)
  const canEdit = canWrite && canEditObligation(obligation)
  const counterparty = counterpartyFor(obligation) ?? null

  return (
    <div
      data-testid="obligation-card"
      className={`group min-w-0 rounded-xl border p-3 text-card-foreground shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${obligationSurfaceClasses(obligation)}`}
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
        <ObligationActions {...props} />
      </div>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="break-all text-xl font-semibold tabular-nums">
            {amount}
          </p>
          <ObligationStatus obligation={obligation} />
        </div>
        {isPaid ? (
          <div className="mt-3 border-t pt-2">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              {i18n.t("app:obligations.paid_on")}
            </p>
            <p className="mt-1 font-medium tabular-nums">
              {paidDateLabel(obligation.paid_at)}
            </p>
          </div>
        ) : (
          <div className="mt-3 border-t pt-2">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              {i18n.t("app:obligations.due_date")}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-medium tabular-nums">
                {obligation.due_date
                  ? formatDate(obligation.due_date)
                  : i18n.t("app:obligations.unknown")}
              </p>
              {obligation.lifecycle !== "canceled" && (
                <p
                  className={`text-xs whitespace-nowrap ${dueDateStatus.className}`}
                >
                  {dueDateStatus.label}
                </p>
              )}
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

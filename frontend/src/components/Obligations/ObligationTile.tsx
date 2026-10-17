import {
  Ban,
  Building2,
  CircleCheck,
  CreditCard,
  EllipsisVertical,
  Pencil,
  RotateCcw,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { ObligationCounterpartyDialog } from "@/features/counterparties/ObligationCounterpartyDialog"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount, formatDate } from "@/i18n/format"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
} from "./obligationLogic"

import {
  businessDaysUntil,
  counterpartyFor,
  lifecycleBadgeClasses,
  paidDateLabel,
} from "./obligationPresentation"

export function ObligationTile({
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

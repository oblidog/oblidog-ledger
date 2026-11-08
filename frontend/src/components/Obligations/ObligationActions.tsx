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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ObligationCounterpartyDialog } from "@/features/counterparties/ObligationCounterpartyDialog"
import { i18n } from "@/i18n"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
} from "./obligationLogic"

export type ObligationItemProps = {
  ledgerId: string
  obligation: ObligationPublic
  canWrite: boolean
  disabled: boolean
  loading: boolean
  onEdit: () => void
  onCancel: () => void
  onMarkPaid: (trigger?: HTMLButtonElement) => void
  onMarkReady: () => void
  onReopen: () => void
  onSelect: () => void
}

export function ObligationActions({
  ledgerId,
  obligation,
  canWrite,
  disabled,
  loading,
  inlinePayment = false,
  onEdit,
  onCancel,
  onMarkPaid,
  onMarkReady,
  onReopen,
}: ObligationItemProps & { inlinePayment?: boolean }) {
  useTranslation()
  const canCancel = canWrite && canCancelObligation(obligation)
  const canMarkPaid = canWrite && canMarkObligationPaid(obligation)
  const canMarkReady = canWrite && canMarkObligationReady(obligation)
  const canEdit = canWrite && canEditObligation(obligation)
  const canReopen = canWrite && canReopenObligation(obligation)
  return (
    <>
      {inlinePayment && canMarkPaid ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <LoadingButton
              type="button"
              size="sm"
              variant="outline"
              aria-haspopup="dialog"
              loading={loading}
              disabled={disabled}
              onClick={(event) => onMarkPaid(event.currentTarget)}
            >
              <CreditCard />
              <span className="sr-only @min-[68rem]:not-sr-only">
                {i18n.t("app:obligations.mark_as_paid")}
              </span>
            </LoadingButton>
          </TooltipTrigger>
          <TooltipContent>
            {i18n.t("app:obligations.mark_as_paid")}
          </TooltipContent>
        </Tooltip>
      ) : null}
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
            {canMarkPaid && !inlinePayment ? (
              <DropdownMenuItem
                disabled={disabled}
                onSelect={() => onMarkPaid()}
              >
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
    </>
  )
}

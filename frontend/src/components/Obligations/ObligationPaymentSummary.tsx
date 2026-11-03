import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount, formatDate } from "@/i18n/format"
import {
  counterpartyFor,
  isObligationOverdue,
  lifecycleBadgeClasses,
  paidDateLabel,
  stateBadgeClasses,
} from "./obligationPresentation"

function ValueCaveat({ state }: { state: string }) {
  return state === "confirmed" ? null : (
    <Badge
      variant="outline"
      className={stateBadgeClasses[state] ?? stateBadgeClasses.unknown}
    >
      {domainLabel("valueState", state)}
    </Badge>
  )
}

export function ObligationPaymentSummary({
  obligation,
}: {
  obligation: ObligationPublic
}) {
  useTranslation()
  const counterparty = counterpartyFor(obligation)
  return (
    <section
      aria-label={i18n.t("app:obligations.payment_summary")}
      className="min-w-0 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            {i18n.t("app:obligations.current_amount")}
          </p>
          <p className="break-words text-3xl font-semibold tabular-nums tracking-tight [overflow-wrap:anywhere]">
            {obligation.current_amount === null
              ? i18n.t("app:obligations.amount_unknown")
              : formatAmount(obligation.current_amount, obligation.currency)}
          </p>
          {obligation.current_amount !== null ? (
            <ValueCaveat state={obligation.amount_state} />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={lifecycleBadgeClasses[obligation.lifecycle]}
          >
            {domainLabel("lifecycle", obligation.lifecycle)}
          </Badge>
          {isObligationOverdue(obligation) ? (
            <Badge variant="destructive">
              {i18n.t("app:obligations.overdue")}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <CounterpartyLogo counterparty={counterparty ?? null} />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {i18n.t("app:obligations.counterparty")}
          </p>
          <p className="break-words font-medium [overflow-wrap:anywhere]">
            {counterparty?.name ||
              counterparty?.short_name ||
              i18n.t("app:obligations.not_assigned")}
          </p>
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-4 border-y py-4 sm:grid-cols-3">
        {(
          [
            ["issue_date", obligation.issue_date, obligation.issue_date_state],
            ["due_date", obligation.due_date, obligation.due_date_state],
          ] as const
        ).map(([field, date, state]) => (
          <div key={field} className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">
              {i18n.t(`app:obligations.${field}`)}
            </dt>
            <dd className="flex flex-wrap items-center gap-2 font-medium">
              {date ? formatDate(date) : i18n.t("app:obligations.unknown")}
              {date ? <ValueCaveat state={state} /> : null}
            </dd>
          </div>
        ))}
        {obligation.lifecycle === "paid" ? (
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">
              {i18n.t("app:obligations.paid_on")}
            </dt>
            <dd className="font-medium">{paidDateLabel(obligation.paid_at)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="min-w-0 text-xs text-muted-foreground">
        <p>{i18n.t("app:obligations.obligation_code")}</p>
        <p className="select-text break-all font-mono">{obligation.key}</p>
      </div>
    </section>
  )
}

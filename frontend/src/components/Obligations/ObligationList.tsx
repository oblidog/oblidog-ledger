import { useTranslation } from "react-i18next"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { i18n } from "@/i18n"
import { formatAmount, formatDate } from "@/i18n/format"
import {
  ObligationActions,
  type ObligationItemProps,
} from "./ObligationActions"
import { ObligationStatus } from "./ObligationStatus"
import {
  counterpartyFor,
  obligationSurfaceClasses,
  paidDateLabel,
} from "./obligationPresentation"

export function ObligationList({ items }: { items: ObligationItemProps[] }) {
  useTranslation()
  const showActions = items.some((item) => item.canWrite)
  return (
    <div data-testid="obligation-list" className="@container min-w-0">
      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>{i18n.t("app:obligations.obligation")}</TableHead>
            <TableHead>{i18n.t("app:obligations.counterparty")}</TableHead>
            <TableHead>{i18n.t("app:obligations.due_or_paid_date")}</TableHead>
            <TableHead className="text-right">
              {i18n.t("app:obligations.amount")}
            </TableHead>
            <TableHead>{i18n.t("app:obligations.status")}</TableHead>
            {showActions ? (
              <TableHead className="sticky right-0 z-10 border-l bg-muted px-2">
                <span className="sr-only">
                  {i18n.t("app:obligations.actions")}
                </span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const { obligation } = item
            const counterparty = counterpartyFor(obligation)
            const paid = obligation.lifecycle === "paid"
            return (
              <TableRow
                key={obligation.key}
                hoverable={false}
                data-testid="obligation-row"
                className={obligationSurfaceClasses(obligation, {
                  hoverable: false,
                })}
              >
                <TableCell className="min-w-36 max-w-64 whitespace-normal">
                  <button
                    type="button"
                    className="cursor-pointer text-left font-medium text-primary underline decoration-primary/50 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
                    aria-haspopup="dialog"
                    onClick={item.onSelect}
                  >
                    {obligation.name}
                  </button>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {obligation.key}
                  </p>
                </TableCell>
                <TableCell className="max-w-52 whitespace-normal">
                  <div className="flex items-center gap-2">
                    <CounterpartyLogo
                      counterparty={counterparty ?? null}
                      className="size-7 shrink-0"
                    />
                    <span>
                      {counterparty?.short_name ||
                        counterparty?.name ||
                        i18n.t("app:obligations.not_assigned")}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <p className="text-xs text-muted-foreground">
                    {i18n.t(
                      paid
                        ? "app:obligations.paid_on"
                        : "app:obligations.due_date",
                    )}
                  </p>
                  {paid
                    ? paidDateLabel(obligation.paid_at)
                    : obligation.due_date
                      ? formatDate(obligation.due_date)
                      : i18n.t("app:obligations.unknown")}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                  {obligation.current_amount === null
                    ? i18n.t("app:obligations.amount_unknown")
                    : formatAmount(
                        String(obligation.current_amount),
                        obligation.currency,
                      )}
                </TableCell>
                <TableCell className="min-w-32">
                  <ObligationStatus obligation={obligation} />
                </TableCell>
                {showActions ? (
                  <TableCell className="sticky right-0 z-10 w-12 border-l bg-card px-2">
                    <div className="flex items-center justify-end gap-1">
                      <ObligationActions {...item} inlinePayment />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

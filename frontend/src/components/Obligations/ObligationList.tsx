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
  return (
    <div data-testid="obligation-list" className="min-w-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{i18n.t("app:obligations.obligation")}</TableHead>
            <TableHead>{i18n.t("app:obligations.counterparty")}</TableHead>
            <TableHead>{i18n.t("app:obligations.due_or_paid_date")}</TableHead>
            <TableHead className="text-right">
              {i18n.t("app:obligations.amount")}
            </TableHead>
            <TableHead>{i18n.t("app:obligations.status")}</TableHead>
            <TableHead>
              <span className="sr-only">
                {i18n.t("app:obligations.actions")}
              </span>
            </TableHead>
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
                data-testid="obligation-row"
                className={obligationSurfaceClasses(obligation)}
              >
                <TableCell className="min-w-36 max-w-64 whitespace-normal">
                  <button
                    type="button"
                    className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
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
                <TableCell className="w-12">
                  <ObligationActions {...item} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

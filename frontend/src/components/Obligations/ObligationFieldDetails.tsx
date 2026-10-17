import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"

import { sourceBadgeClasses, stateBadgeClasses } from "./obligationPresentation"

export function ObligationFieldDetails({
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

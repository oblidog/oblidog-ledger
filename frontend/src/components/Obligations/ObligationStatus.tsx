import { AlertCircle, Ban, CircleCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import {
  isObligationOverdue,
  lifecycleBadgeClasses,
} from "./obligationPresentation"

export function ObligationStatus({
  obligation,
}: {
  obligation: ObligationPublic
}) {
  useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant="outline"
        className={lifecycleBadgeClasses[obligation.lifecycle]}
      >
        {obligation.lifecycle === "error" ? (
          <AlertCircle aria-hidden="true" />
        ) : obligation.lifecycle === "paid" ? (
          <CircleCheck aria-hidden="true" />
        ) : obligation.lifecycle === "canceled" ? (
          <Ban aria-hidden="true" />
        ) : null}
        {domainLabel("lifecycle", obligation.lifecycle)}
      </Badge>
      {isObligationOverdue(obligation) && (
        <Badge
          variant="outline"
          className="border-destructive/40 text-destructive"
        >
          <AlertCircle aria-hidden="true" />
          {i18n.t("app:obligations.overdue")}
        </Badge>
      )}
    </div>
  )
}

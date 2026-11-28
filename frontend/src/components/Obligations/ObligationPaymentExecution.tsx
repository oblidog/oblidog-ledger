import { useTranslation } from "react-i18next"
import type { ObligationPublic, PaymentExecution } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { i18n } from "@/i18n"

export function ObligationPaymentExecution({
  obligation,
}: {
  obligation: ObligationPublic
}) {
  return (
    <PaymentExecutionField
      value={obligation.payment_execution ?? null}
      readOnly
      onChange={() => {}}
    />
  )
}

export function PaymentExecutionField({
  value,
  onChange,
  readOnly = false,
  disabled = false,
}: {
  value: PaymentExecution | null
  onChange: (value: PaymentExecution | null) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  useTranslation()
  const selected = value ?? "manual"
  return (
    <div className="space-y-2">
      <Label htmlFor={readOnly ? undefined : "obligation-payment-execution"}>
        {i18n.t("app:obligations.payment_execution")}
      </Label>
      {readOnly ? (
        <p>{i18n.t(`app:obligations.payment_execution_${selected}`)}</p>
      ) : (
        <Select
          value={selected}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === selected) return
            if (next === "manual") onChange(null)
            else if (
              next === "scheduled_transfer" ||
              next === "automatic_collection"
            )
              onChange(next)
          }}
        >
          <SelectTrigger
            id="obligation-payment-execution"
            className="min-h-11 w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["manual", "scheduled_transfer", "automatic_collection"] as const
            ).map((option) => (
              <SelectItem key={option} value={option}>
                {i18n.t(`app:obligations.payment_execution_${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        {i18n.t("app:obligations.payment_execution_help")}
      </p>
    </div>
  )
}

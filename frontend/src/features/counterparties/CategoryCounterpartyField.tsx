import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import { i18n } from "@/i18n"

import type { CounterpartySummary } from "./api"
import { CounterpartyPicker } from "./CounterpartyPicker"

export function CategoryCounterpartyField({
  value,
  onChange,
  disabled = false,
}: {
  value: CounterpartySummary | null
  onChange: (counterparty: CounterpartySummary | null) => void
  disabled?: boolean
}) {
  useTranslation()

  return (
    <div className="space-y-2 border-t pt-4">
      <div>
        <Label>{i18n.t("app:counterparties.counterparty_97b2be")}</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {i18n.t(
            "app:counterparties.used_as_the_default_for_newly_created_obligations_changing_it_does_not_rewrite_existi",
          )}
        </p>
      </div>
      <CounterpartyPicker
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}

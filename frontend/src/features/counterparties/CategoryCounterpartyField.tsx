import { Label } from "@/components/ui/label"

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
  return (
    <div className="space-y-2 border-t pt-4">
      <div>
        <Label>Counterparty</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Used as the default for newly created obligations. Changing it does
          not rewrite existing obligations.
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

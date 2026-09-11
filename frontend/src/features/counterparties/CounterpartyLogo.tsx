import { Building2 } from "lucide-react"
import { useEffect, useState } from "react"

import type { CounterpartySummary } from "./api"

export function CounterpartyLogo({
  counterparty,
  className = "size-9",
}: {
  counterparty: CounterpartySummary | null
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [])

  if (counterparty?.logo_url && !failed) {
    return (
      <img
        src={counterparty.logo_url}
        alt=""
        className={`${className} shrink-0 rounded-md border bg-background object-contain p-1`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground`}
      aria-hidden="true"
    >
      <Building2 className="size-4" />
    </div>
  )
}

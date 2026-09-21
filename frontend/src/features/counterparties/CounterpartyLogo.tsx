import { Building2 } from "lucide-react"
import { useState } from "react"

import type { CounterpartySummary } from "./api"

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function CounterpartyLogo({
  counterparty,
  className = "size-9",
}: {
  counterparty: CounterpartySummary | null
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (counterparty?.logo_url && counterparty.logo_url !== failedUrl) {
    return (
      <img
        src={counterparty.logo_url}
        alt=""
        className={`${className} shrink-0 rounded-md border bg-background object-contain p-1`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(counterparty.logo_url)}
      />
    )
  }

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-md border bg-primary/10 text-xs font-semibold text-primary`}
      aria-hidden="true"
    >
      {counterparty ? (
        initials(counterparty.short_name || counterparty.name)
      ) : (
        <Building2 className="size-4" />
      )}
    </div>
  )
}

import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type ActiveFilter = {
  key: string
  label: string
  onRemove: () => void
}

export function ActiveFilterBadges({
  filters,
  onClearAll,
}: {
  filters: ActiveFilter[]
  onClearAll: () => void
}) {
  if (filters.length === 0) {
    return null
  }

  return (
    <div
      role="group"
      className="flex min-w-0 flex-wrap items-center gap-2"
      aria-label="Active filters"
    >
      {filters.map((filter) => (
        <Badge
          key={filter.key}
          variant="secondary"
          className="max-w-full gap-1.5 py-1 pl-2.5 pr-1"
        >
          <span className="truncate">{filter.label}</span>
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove filter: ${filter.label}`}
            onClick={filter.onRemove}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {filters.length > 1 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={onClearAll}
        >
          Clear all
        </Button>
      ) : null}
    </div>
  )
}

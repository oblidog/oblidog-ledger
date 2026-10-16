import { useQuery } from "@tanstack/react-query"
import { Check, Search, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { i18n } from "@/i18n"

import { type CounterpartySummary, searchCounterparties } from "./api"
import { CounterpartyLogo } from "./CounterpartyLogo"

export function CounterpartyPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: CounterpartySummary | null
  disabled?: boolean
  onChange: (counterparty: CounterpartySummary | null) => Promise<void> | void
}) {
  useTranslation()

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const results = useQuery({
    queryKey: ["counterparties", "search", debouncedQuery],
    queryFn: () => searchCounterparties(debouncedQuery, 10),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 60_000,
  })

  const choose = async (counterparty: CounterpartySummary | null) => {
    setSaving(true)
    try {
      await onChange(counterparty)
      setQuery("")
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative space-y-2">
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-2">
          <div className="flex min-w-0 items-center gap-2">
            <CounterpartyLogo counterparty={value} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {value.short_name || value.name}
              </p>
              {value.short_name ? (
                <p className="truncate text-xs text-muted-foreground">
                  {value.name}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={i18n.t("app:counterparties.clear_counterparty")}
            disabled={disabled || saving}
            onClick={() => void choose(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          disabled={disabled || saving}
          placeholder={
            value
              ? i18n.t("app:counterparties.change_counterparty")
              : i18n.t("app:counterparties.search_counterparty")
          }
          className="pl-8"
          aria-label={i18n.t("app:counterparties.search_counterparty_4ff8a2")}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
        />
      </div>

      {open && query.trim().length > 0 ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {query.trim().length < 2 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {i18n.t("app:counterparties.type_at_least_2_characters")}
            </p>
          ) : results.isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {i18n.t("app:counterparties.searching")}
            </p>
          ) : results.isError ? (
            <p className="px-3 py-2 text-xs text-destructive">
              {i18n.t("app:counterparties.unable_to_search_counterparties")}
            </p>
          ) : results.data?.items.length ? (
            results.data.items.map((counterparty) => (
              <button
                key={counterparty.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                disabled={saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(counterparty)}
              >
                <CounterpartyLogo
                  counterparty={counterparty}
                  className="size-8"
                />
                <span className="min-w-0 flex-1 truncate">
                  {counterparty.short_name || counterparty.name}
                </span>
                {value?.id === counterparty.id ? (
                  <Check className="size-4 text-muted-foreground" />
                ) : null}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {i18n.t("app:counterparties.no_counterparties_found")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

import { Check, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { i18n } from "@/i18n"
import { formatBillingPeriod } from "@/i18n/format"
import {
  type FilterCategory,
  matchingCategories,
  maxSelectedPeriods,
  monthInputValue,
  parseMonthInput,
} from "./obligationLogic"

export function CategoryFilter({
  categories,
  value,
  onChange,
  unavailable,
}: {
  categories: FilterCategory[]
  value: string
  onChange: (code: string) => void
  unavailable: boolean
}) {
  useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const selected = categories.find((category) => category.code === value)
  const options = [
    ...(!query.trim()
      ? [{ code: "", name: i18n.t("app:obligations.all_categories") }]
      : []),
    ...matchingCategories(categories, query),
  ]
  const activeOptionId =
    open && options[active] ? `${id}-${options[active].code}` : undefined
  useEffect(() => {
    if (activeOptionId)
      document
        .getElementById(activeOptionId)
        ?.scrollIntoView({ block: "nearest" })
  }, [activeOptionId])
  const choose = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery("")
    setActive(0)
  }
  return (
    <div className="relative min-w-0">
      <div className="relative">
        <Input
          role="combobox"
          aria-label={i18n.t("app:obligations.category_filter")}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={activeOptionId}
          placeholder={i18n.t("app:obligations.all_categories")}
          value={open ? query : selected?.name || value}
          className="pr-10"
          onFocus={() => {
            setOpen(true)
            setQuery("")
            setActive(0)
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              setOpen(false)
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              setOpen(true)
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              )
            } else if (event.key === "Enter" && open) {
              event.preventDefault()
              if (options[active]) choose(options[active].code)
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2"
            aria-label={i18n.t("app:obligations.clear_category")}
            onClick={() => choose("")}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div
          id={`${id}-options`}
          role="listbox"
          aria-label={i18n.t("app:obligations.category_filter")}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((category, index) => (
            <div
              id={`${id}-${category.code}`}
              key={category.code}
              role="option"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  choose(category.code)
                }
              }}
              aria-selected={value === category.code}
              className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm ${index === active ? "bg-accent text-accent-foreground" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(category.code)}
            >
              <span className="min-w-0 break-words">
                {category.name}
                {category.code && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {category.code}
                  </span>
                )}
              </span>
              {value === category.code && <Check className="size-4 shrink-0" />}
            </div>
          ))}
          {!options.length && (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {i18n.t("app:obligations.no_categories_match")}
            </p>
          )}
          {unavailable && (
            <p className="px-2 py-2 text-sm text-destructive">
              {i18n.t("app:obligations.category_names_unavailable")}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function PeriodFilter({
  value,
  onChange,
}: {
  value: string[]
  onChange: (periods: string[]) => void
}) {
  useTranslation()
  const id = useId()
  const selectRef = useRef<HTMLSelectElement>(null)
  const now = new Date()
  const [selection, setSelection] = useState("")
  const [draft, setDraft] = useState(() =>
    monthInputValue(String(now.getFullYear()), String(now.getMonth() + 1)),
  )
  const periods = new Set([
    ...value,
    ...Array.from({ length: 25 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() + index - 12, 1)
      return monthInputValue(
        String(date.getFullYear()),
        String(date.getMonth() + 1),
      )
    }),
  ])
  const atLimit = value.length >= maxSelectedPeriods
  const showCustomMonth = selection === "custom" && !atLimit
  const pendingMonth = showCustomMonth ? draft : selection
  const canApply =
    selection === "all"
      ? value.length > 0
      : !atLimit &&
        parseMonthInput(pendingMonth) !== null &&
        !value.includes(pendingMonth)
  const allPeriods = i18n.t("app:obligations.all_periods")
  let prompt = allPeriods
  if (atLimit) {
    prompt = i18n.t("app:obligations.period_limit_reached", {
      count: maxSelectedPeriods,
    })
  } else if (value.length > 0) {
    prompt = i18n.t("app:obligations.add_period")
  }

  return (
    <form
      className="min-w-0 space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canApply) return
        onChange(selection === "all" ? [] : [...value, pendingMonth].sort())
        setSelection("")
        selectRef.current?.focus()
      }}
    >
      <Label htmlFor={id}>{i18n.t("app:obligations.billing_period")}</Label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select
          id={id}
          ref={selectRef}
          className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ${showCustomMonth ? "col-span-2" : ""}`}
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="" disabled>
            {prompt}
          </option>
          {value.length > 0 && <option value="all">{allPeriods}</option>}
          {[...periods]
            .sort()
            .reverse()
            .map((period) => {
              const parsed = parseMonthInput(period)
              if (!parsed) return null
              const selected = value.includes(period)
              return (
                <option
                  key={period}
                  value={period}
                  disabled={atLimit || selected}
                >
                  {selected ? "✓ " : ""}
                  {formatBillingPeriod({
                    year: Number(parsed.year),
                    month: Number(parsed.month),
                  })}
                </option>
              )
            })}
          <option value="custom" disabled={atLimit}>
            {i18n.t("app:obligations.other_period")}
          </option>
        </select>
        {showCustomMonth && (
          <Input
            type="month"
            aria-label={i18n.t("app:obligations.choose_month")}
            className="min-w-0"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
        <Button type="submit" variant="outline" disabled={!canApply}>
          {i18n.t("app:obligations.apply_period")}
        </Button>
      </div>
    </form>
  )
}

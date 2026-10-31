import { Check, X } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { i18n } from "@/i18n"
import { getLocale } from "@/i18n/format"
import {
  type FilterCategory,
  matchingCategories,
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
  value: string
  onChange: (period: string) => void
}) {
  useTranslation()
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState(
    value ||
      monthInputValue(
        String(new Date().getFullYear()),
        String(new Date().getMonth() + 1),
      ),
  )
  const now = new Date()
  const periods = new Set(
    [
      value,
      ...Array.from({ length: 25 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() + index - 12, 1)
        return monthInputValue(
          String(date.getFullYear()),
          String(date.getMonth() + 1),
        )
      }),
    ].filter(Boolean),
  )
  const valid = parseMonthInput(draft)
  return (
    <div className="min-w-0 space-y-2">
      <select
        aria-label={i18n.t("app:obligations.billing_period")}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        value={custom ? "custom" : value || "all"}
        onChange={(event) => {
          if (event.target.value === "custom") setCustom(true)
          else {
            setCustom(false)
            onChange(event.target.value === "all" ? "" : event.target.value)
          }
        }}
      >
        <option value="all">{i18n.t("app:obligations.all_periods")}</option>
        {[...periods]
          .sort()
          .reverse()
          .map((period) => {
            const parsed = parseMonthInput(period)!
            return (
              <option key={period} value={period}>
                {new Intl.DateTimeFormat(getLocale(), {
                  month: "long",
                  year: "numeric",
                }).format(
                  new Date(Number(parsed.year), Number(parsed.month) - 1, 1),
                )}
              </option>
            )
          })}
        <option value="custom">{i18n.t("app:obligations.other_period")}</option>
      </select>
      {custom && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) {
              onChange(draft)
              setCustom(false)
            }
          }}
        >
          <Input
            type="month"
            aria-label={i18n.t("app:obligations.choose_month")}
            className="min-w-0 flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!valid}>
            {i18n.t("app:obligations.apply_period")}
          </Button>
        </form>
      )}
    </div>
  )
}

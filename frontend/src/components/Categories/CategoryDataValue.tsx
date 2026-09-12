import type { ReactNode } from "react"

import {
  type JsonSchemaProperty,
  unwrapNullablePropertySchema,
} from "@/components/Categories/categoryDataSchema"
import { Badge } from "@/components/ui/badge"

export type CategoryDataPropertySchema = JsonSchemaProperty & {
  type?: string
  format?: string
  title?: string
  enum?: unknown[]
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
})

const calendarDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
})

const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/

function parseCalendarDate(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null
}

/**
 * Category date-times are displayed in the browser's locale and timezone.
 * Their exact RFC 3339 value remains available in the rendered detail.
 */
export function formatCategoryDateTime(value: string): string | null {
  const match = isoDateTimePattern.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match
  if (
    !parseCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour ?? 0) > 23 ||
    Number(offsetMinute ?? 0) > 59
  ) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return dateTimeFormatter.format(date)
}

/** Format a date-only value without applying the browser's timezone. */
export function formatCategoryCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [, year, month, day] = match
  const date = parseCalendarDate(Number(year), Number(month), Number(day))
  if (!date) return null
  return calendarDateFormatter.format(date)
}

function DateTimeValue({ value }: { value: string }) {
  const formatted = formatCategoryDateTime(value)
  if (!formatted) return value

  const exactValueLabel = `Exact value: ${value}`
  return (
    <time dateTime={value} title={exactValueLabel}>
      {formatted}
      <span className="sr-only">. {exactValueLabel}</span>
    </time>
  )
}

function CalendarDateValue({ value }: { value: string }) {
  const formatted = formatCategoryCalendarDate(value)
  if (!formatted) return value
  return <time dateTime={value}>{formatted}</time>
}

export function formatCategoryDataValue(
  value: unknown,
  schema: CategoryDataPropertySchema,
): ReactNode {
  if (value === null || value === undefined) return "—"

  const { value: effectiveSchema } = unwrapNullablePropertySchema(schema)
  const enumValues = Array.isArray(effectiveSchema.enum)
    ? effectiveSchema.enum
    : schema.enum

  if (enumValues?.includes(value)) {
    return <Badge variant="outline">{String(value)}</Badge>
  }

  if (effectiveSchema.type === "boolean" && typeof value === "boolean") {
    return (
      <Badge variant={value ? "secondary" : "outline"}>
        {value ? "Yes" : "No"}
      </Badge>
    )
  }

  if (
    (effectiveSchema.type === "number" || effectiveSchema.type === "integer") &&
    typeof value === "number"
  ) {
    return new Intl.NumberFormat().format(value)
  }

  if (effectiveSchema.type === "string" && effectiveSchema.format === "date") {
    return <CalendarDateValue value={String(value)} />
  }

  if (
    effectiveSchema.type === "string" &&
    effectiveSchema.format === "date-time"
  ) {
    return <DateTimeValue value={String(value)} />
  }

  if (typeof value === "object") {
    const json = JSON.stringify(value)
    return (
      <details className="max-w-72 whitespace-normal">
        <summary className="cursor-pointer text-sm font-medium">
          View details
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
          {json}
        </pre>
      </details>
    )
  }

  return String(value)
}

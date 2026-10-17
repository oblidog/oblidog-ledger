import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  type Control,
  type FieldValues,
  type Path,
  useWatch,
} from "react-hook-form"
import { useTranslation } from "react-i18next"
import { CategoriesService } from "@/client"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { i18n } from "@/i18n"
import { getLocale } from "@/i18n/format"
import { recurrencePreset } from "./categoryPresentation"

export function CurrencyField<T extends FieldValues>({
  control,
}: {
  control: Control<T>
}) {
  useTranslation()

  return (
    <FormField
      control={control}
      name={"currency" as Path<T>}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{i18n.t("app:categories.currency")}</FormLabel>
          <Select onValueChange={field.onChange} value={field.value as string}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="PLN">PLN</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="GBP">GBP</SelectItem>
              <SelectItem value="CHF">CHF</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function obligationModeDescription(
  mode: "manual" | "automatic" | "hybrid",
) {
  if (mode === "manual") {
    return i18n.t(
      "app:categories.obligations_for_this_category_are_created_manually",
    )
  }
  if (mode === "automatic") {
    return i18n.t(
      "app:categories.obligations_are_created_automatically_from_the_payment_schedule",
    )
  }
  return i18n.t(
    "app:categories.obligations_follow_the_schedule_and_can_also_be_created_manually",
  )
}

export function PaymentScheduleFields<T extends FieldValues>({
  ledgerId,
  control,
  onPresetChange,
}: {
  ledgerId: string
  control: Control<T>
  onPresetChange: (preset: string) => void
}) {
  useTranslation()

  const interval = useWatch({
    control,
    name: "recurrence_interval" as Path<T>,
  }) as number | undefined
  const unit = useWatch({
    control,
    name: "recurrence_unit" as Path<T>,
  }) as "month" | "year" | undefined
  const firstDueDate = useWatch({
    control,
    name: "first_due_date" as Path<T>,
  }) as string | undefined
  const preset = recurrencePreset(interval, unit)
  const schedule = useMemo(
    () => ({
      first_due_date: firstDueDate ?? "",
      recurrence_interval: interval ?? 0,
      recurrence_unit: unit ?? "month",
    }),
    [firstDueDate, interval, unit],
  )
  const [debouncedSchedule, setDebouncedSchedule] = useState(schedule)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSchedule(schedule), 300)
    return () => window.clearTimeout(timer)
  }, [schedule])
  const valid = Boolean(
    firstDueDate &&
      interval &&
      Number.isInteger(interval) &&
      interval > 0 &&
      unit,
  )
  const settled = schedule === debouncedSchedule
  const preview = useQuery({
    queryKey: ["schedule-preview", ledgerId, debouncedSchedule],
    queryFn: () =>
      CategoriesService.previewPaymentSchedule({
        ledgerId,
        requestBody: debouncedSchedule,
      }),
    enabled: valid && settled,
    staleTime: 0,
    retry: false,
  })
  const nextDueDate = valid && settled ? preview.data?.due_date : undefined
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`))

  return (
    <section className="space-y-4 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">
          {i18n.t("app:categories.payment_schedule")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:categories.set_when_the_first_payment_is_due_and_how_often_it_repeats",
          )}
        </p>
      </div>
      <FormField
        control={control}
        name={"first_due_date" as Path<T>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{i18n.t("app:categories.first_payment_due")}</FormLabel>
            <FormControl>
              <Input
                type="date"
                {...field}
                value={(field.value as string) ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormItem>
        <FormLabel>{i18n.t("app:categories.repeat")}</FormLabel>
        <Select onValueChange={onPresetChange} value={preset}>
          <FormControl>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value="monthly">
              {i18n.t("app:categories.every_month")}
            </SelectItem>
            <SelectItem value="every-two-months">
              {i18n.t("app:categories.every_2_months")}
            </SelectItem>
            <SelectItem value="yearly">
              {i18n.t("app:categories.every_year")}
            </SelectItem>
            <SelectItem value="custom">
              {i18n.t("app:categories.custom")}
            </SelectItem>
          </SelectContent>
        </Select>
      </FormItem>
      {preset === "custom" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={control}
            name={"recurrence_interval" as Path<T>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{i18n.t("app:categories.every")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    value={(field.value as number | undefined) ?? ""}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={"recurrence_unit" as Path<T>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{i18n.t("app:categories.period")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value as string}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={i18n.t("app:categories.choose_a_period")}
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="month">
                      {i18n.t("app:categories.months")}
                    </SelectItem>
                    <SelectItem value="year">
                      {i18n.t("app:categories.years")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <div className="rounded-md bg-muted p-3">
        <p className="text-sm font-medium">
          {i18n.t("app:categories.next_payment")}
        </p>
        {!valid ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {i18n.t(
              "app:categories.choose_a_valid_first_payment_date_and_recurrence_to_see_the_next_payment",
            )}
          </p>
        ) : !settled || preview.isFetching ? (
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {i18n.t("app:categories.calculating_schedule")}
          </p>
        ) : preview.isError ? (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {i18n.t("app:categories.could_not_load_the_payment_schedule")}
          </p>
        ) : nextDueDate ? (
          <div className="mt-1 text-sm text-muted-foreground">
            <p>{formatDate(nextDueDate)}</p>
            {preview.data?.scheduled_date &&
              preview.data.scheduled_date !== nextDueDate && (
                <p>
                  {i18n.t("app:messages.moved_payment", {
                    date: formatDate(preview.data.scheduled_date),
                    country: preview.data.calendar_country,
                  })}
                </p>
              )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {i18n.t(
              "app:categories.no_upcoming_payment_in_the_supported_date_range",
            )}
          </p>
        )}
      </div>
    </section>
  )
}

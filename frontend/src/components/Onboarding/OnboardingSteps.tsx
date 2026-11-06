import { useQuery } from "@tanstack/react-query"
import { type FormEvent, type ReactNode, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import {
  CategoriesService,
  type Currency,
  LedgersService,
  OnboardingService,
  type OnboardingState,
  type ScheduleDraft,
} from "@/client"
import {
  CurrencyField,
  PaymentScheduleFields,
} from "@/components/Categories/CategoryFormFields"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useAuth from "@/hooks/useAuth"
import { i18n } from "@/i18n"
import { formatRegion, getLocale } from "@/i18n/format"
import { type OnboardingCommand, suggestCategoryCode } from "./onboardingLogic"

interface StepProps {
  state: OnboardingState
  pending: boolean
  submit: (command: OnboardingCommand) => void
}

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"

export function LedgerStep({
  state,
  pending,
  submit,
  defaultLedgerId,
  demo,
}: StepProps & { defaultLedgerId?: string; demo: boolean }) {
  useTranslation()
  const { user } = useAuth()
  const ledgers = useQuery({
    queryKey: ["ledgers"],
    queryFn: () => LedgersService.readLedgers(),
  })
  const owned =
    ledgers.data?.data.filter((ledger) => ledger.owner_user_id === user?.id) ??
    []
  const [selected, setSelected] = useState(
    state.ledger_id ?? defaultLedgerId ?? "",
  )
  const selectedId = owned.some((ledger) => ledger.id === selected)
    ? selected
    : ""
  const [name, setName] = useState(
    demo ? i18n.t("app:onboarding.example_ledger") : "",
  )
  const preferences = useQuery({
    queryKey: ["ledger-preference-options"],
    queryFn: () => LedgersService.readLedgerPreferenceOptions(),
  })
  const [country, setCountry] = useState("")
  const form = useForm<{ currency: Currency }>({
    defaultValues: { currency: "PLN" },
  })
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit({
      action: "ledger",
      revision: state.revision ?? 0,
      ...(selectedId
        ? { ledger_id: selectedId }
        : {
            ledger: {
              name: name.trim(),
              default_currency: form.getValues("currency"),
              business_calendar_country:
                country || preferences.data?.default_business_calendar_country,
            },
          }),
    })
  }
  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {i18n.t("app:onboarding.workspace_help")}
        </p>
        {owned.length > 0 && (
          <Field
            id="onboarding-ledger"
            label={i18n.t("app:onboarding.workspace")}
          >
            <select
              id="onboarding-ledger"
              className={selectClass}
              value={selectedId}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{i18n.t("app:onboarding.new_workspace")}</option>
              {owned.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!selectedId && (
          <>
            <Field
              id="onboarding-ledger-name"
              label={i18n.t("app:onboarding.workspace_name")}
            >
              <Input
                id="onboarding-ledger-name"
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={i18n.t("app:onboarding.example_ledger")}
              />
            </Field>
            <CurrencyField control={form.control} />
            <Field
              id="onboarding-country"
              label={i18n.t("app:onboarding.country")}
            >
              <select
                id="onboarding-country"
                className={selectClass}
                value={
                  country ||
                  preferences.data?.default_business_calendar_country ||
                  "PL"
                }
                onChange={(event) => setCountry(event.target.value)}
              >
                {(preferences.data?.countries ?? ["PL"]).map((item) => (
                  <option key={item} value={item}>
                    {formatRegion(item)} ({item})
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Button
          className="w-full"
          type="submit"
          disabled={
            pending || ledgers.isPending || (!selectedId && !name.trim())
          }
        >
          {i18n.t("app:onboarding.next")}
        </Button>
      </form>
    </Form>
  )
}

export function CategoryStep({
  state,
  pending,
  submit,
  demo,
}: StepProps & { demo: boolean }) {
  useTranslation()
  const ledgerId = state.ledger_id ?? ""
  const ledger = useQuery({
    queryKey: ["ledger", ledgerId],
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    enabled: !demo,
  })
  const groups = useQuery({
    queryKey: ["category-groups", ledgerId],
    queryFn: () => CategoriesService.readCategoryGroups({ ledgerId }),
    enabled: !demo,
  })
  const [name, setName] = useState(
    state.category?.name ??
      (demo ? i18n.t("app:onboarding.example_category") : ""),
  )
  const [groupId, setGroupId] = useState(state.category?.group_id ?? "")
  const [groupName, setGroupName] = useState(state.category?.group_name ?? "")
  const [code, setCode] = useState(state.category?.code ?? "")
  const form = useForm<{ currency: Currency }>({
    values: {
      currency:
        state.category?.currency ??
        state.default_currency ??
        ledger.data?.default_currency ??
        "PLN",
    },
  })
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit({
      action: "category",
      revision: state.revision ?? 0,
      category: {
        name: name.trim(),
        currency: form.getValues("currency"),
        code: code || null,
        ...(groupId ? { group_id: groupId } : { group_name: groupName.trim() }),
      },
    })
  }
  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {i18n.t("app:onboarding.category_help")}
        </p>
        <Field
          id="onboarding-category-name"
          label={i18n.t("app:onboarding.payment_name")}
        >
          <Input
            id="onboarding-category-name"
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={i18n.t("app:onboarding.example_category")}
          />
        </Field>
        {!demo && (
          <Field id="onboarding-group" label={i18n.t("app:onboarding.group")}>
            <select
              id="onboarding-group"
              className={selectClass}
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              disabled={groups.isPending || groups.isError}
            >
              <option value="">{i18n.t("app:onboarding.new_group")}</option>
              {groups.data?.data
                .filter((group) => group.is_active)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {!groupId && (
          <Field
            id="onboarding-group-name"
            label={i18n.t("app:onboarding.group_name")}
          >
            <Input
              id="onboarding-group-name"
              required
              maxLength={255}
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder={i18n.t("app:onboarding.example_group")}
            />
          </Field>
        )}
        <CurrencyField control={form.control} />
        <details className="text-sm">
          <summary className="cursor-pointer">
            {i18n.t("app:onboarding.code_optional")}
          </summary>
          <div className="mt-3">
            <Field id="onboarding-code" label={i18n.t("app:onboarding.code")}>
              <Input
                id="onboarding-code"
                pattern="[A-Z]{4}"
                minLength={4}
                maxLength={4}
                placeholder={suggestCategoryCode(name)}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <p className="mt-2 text-muted-foreground">
            {i18n.t("app:onboarding.code_help")}
          </p>
        </details>
        <Button
          type="submit"
          className="w-full"
          disabled={
            pending ||
            !name.trim() ||
            (!groupId && !groupName.trim()) ||
            (!demo && (groups.isPending || groups.isError))
          }
        >
          {i18n.t("app:onboarding.next")}
        </Button>
      </form>
    </Form>
  )
}

export function ScheduleStep({ state, pending, submit }: StepProps) {
  useTranslation()
  const form = useForm<Required<ScheduleDraft>>({
    defaultValues: {
      recurrence_interval: 1,
      recurrence_unit: "month",
      first_due_date: "",
      ...state.schedule,
    },
  })
  const date = form.watch("first_due_date")
  const interval = form.watch("recurrence_interval")
  return (
    <Form {...form}>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((schedule) =>
          submit({
            action: "schedule",
            revision: state.revision ?? 0,
            schedule,
          }),
        )}
      >
        <p className="text-sm text-muted-foreground">
          {i18n.t("app:onboarding.schedule_help")}
        </p>
        <PaymentScheduleFields
          ledgerId={state.ledger_id ?? ""}
          previewKey={state.business_calendar_country}
          previewSchedule={(schedule) =>
            OnboardingService.previewFirstPayment({
              requestBody: {
                ...schedule,
                business_calendar_country: state.business_calendar_country,
              },
            })
          }
          control={form.control}
          onPresetChange={(preset) => {
            form.setValue(
              "recurrence_interval",
              preset === "every-two-months" ? 2 : preset === "custom" ? 3 : 1,
            )
            form.setValue(
              "recurrence_unit",
              preset === "yearly" ? "year" : "month",
            )
          }}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={
            pending ||
            !date ||
            date < "1900-01-01" ||
            date > "9998-12-31" ||
            !Number.isInteger(interval) ||
            interval < 1 ||
            interval > 1200
          }
        >
          {i18n.t("app:onboarding.next")}
        </Button>
      </form>
    </Form>
  )
}

export function PaymentStep({ state, pending, submit }: StepProps) {
  useTranslation()
  const [amount, setAmount] = useState("")
  const [ready, setReady] = useState(false)
  const preview = useQuery({
    queryKey: [
      "onboarding-first-date",
      state.business_calendar_country,
      state.schedule,
    ],
    queryFn: () =>
      OnboardingService.previewFirstPayment({
        requestBody: {
          ...state.schedule!,
          recurrence_interval: state.schedule?.recurrence_interval ?? 1,
          recurrence_unit: state.schedule?.recurrence_unit ?? "month",
          business_calendar_country: state.business_calendar_country,
        },
      }),
    enabled: !!state.schedule,
  })
  const dueDate = preview.data?.due_date

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit({
          action: "payment",
          revision: state.revision ?? 0,
          amount: amount || null,
          ready,
        })
      }}
    >
      <p className="font-medium">
        {state.category?.name} · {state.category?.currency}
      </p>
      <p className="text-sm text-muted-foreground">
        {i18n.t("app:onboarding.first_date", {
          date: state.schedule?.first_due_date,
        })}
      </p>
      {dueDate && (
        <p className="text-sm font-medium">
          {i18n.t("app:onboarding.effective_date", {
            date: new Intl.DateTimeFormat(getLocale(), {
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date(`${dueDate}T12:00:00`)),
          })}
        </p>
      )}
      {preview.isError && (
        <p role="alert" className="text-sm text-destructive">
          {i18n.t("app:categories.could_not_load_the_payment_schedule")}
        </p>
      )}
      <Field id="onboarding-amount" label={i18n.t("app:onboarding.amount")}>
        <Input
          id="onboarding-amount"
          type="number"
          min="0"
          max="9999999999.99"
          step="0.01"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            if (!event.target.value) setReady(false)
          }}
          required={ready}
        />
      </Field>
      <p className="text-sm text-muted-foreground">
        {i18n.t("app:onboarding.unknown_amount")}
      </p>
      <div className="flex items-start gap-3">
        <input
          id="onboarding-ready"
          type="checkbox"
          className="mt-1 size-4"
          checked={ready}
          disabled={!amount || !dueDate}
          onChange={(event) => setReady(event.target.checked)}
        />
        <Label htmlFor="onboarding-ready" className="leading-5">
          {i18n.t("app:onboarding.ready")}
        </Label>
      </div>
      <p className="text-sm text-muted-foreground">
        {ready
          ? i18n.t("app:onboarding.ready_help")
          : i18n.t("app:onboarding.incomplete_help")}
      </p>
      <p className="text-sm text-muted-foreground">
        {i18n.t("app:onboarding.commit_notice")}
      </p>
      <Button type="submit" className="w-full" disabled={pending}>
        {i18n.t("app:onboarding.create")}
      </Button>
    </form>
  )
}

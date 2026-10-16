import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { type Currency, type LedgerPublic, LedgersService } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { formatRegion } from "@/i18n/format"
import { handleError } from "@/utils"

export function useLedgerPreferenceOptions() {
  return useSuspenseQuery({
    queryKey: ["ledger-preference-options"],
    queryFn: () => LedgersService.readLedgerPreferenceOptions(),
    staleTime: 60 * 60 * 1000,
  }).data
}

export function LedgerPreferenceFields({
  country,
  currency,
  onCountryChange,
  onCurrencyChange,
  disabled = false,
}: {
  country: string
  currency: Currency
  onCountryChange: (value: string) => void
  onCurrencyChange: (value: Currency) => void
  disabled?: boolean
}) {
  useTranslation()
  const options = useLedgerPreferenceOptions()
  const id = useId()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-country`}>
          {i18n.t("app:ledgersettings.holiday_calendar")}
        </Label>
        <Select
          value={country}
          onValueChange={onCountryChange}
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-country`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.countries.map((code) => (
              <SelectItem key={code} value={code}>
                {formatRegion(code)} ({code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-currency`}>
          {i18n.t("app:ledgersettings.default_currency")}
        </Label>
        <Select
          value={currency}
          onValueChange={(value) => {
            const selected = options.currencies.find((item) => item === value)
            if (selected) onCurrencyChange(selected)
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-currency`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.currencies.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function LedgerPreferences({ ledger }: { ledger: LedgerPublic }) {
  useTranslation()

  const { user } = useAuth()
  const owner = user?.id === ledger.owner_user_id
  const [country, setCountry] = useState(ledger.business_calendar_country)
  const [currency, setCurrency] = useState<Currency>(ledger.default_currency)
  useEffect(() => {
    setCountry(ledger.business_calendar_country)
    setCurrency(ledger.default_currency)
  }, [ledger.business_calendar_country, ledger.default_currency])
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const update = useMutation({
    mutationFn: () =>
      LedgersService.updateLedger({
        ledgerId: ledger.id,
        requestBody: {
          name: ledger.name,
          description: ledger.description,
          business_calendar_country: country,
          default_currency: currency,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["ledger", ledger.id], updated)
      void queryClient.invalidateQueries({ queryKey: ["ledgers"] })
      void queryClient.invalidateQueries({
        queryKey: ["schedule-preview", ledger.id],
      })
      showSuccessToast(i18n.t("app:ledgersettings.ledger_preferences_updated"))
    },
    onError: handleError.bind(showErrorToast),
  })
  const changed =
    country !== ledger.business_calendar_country ||
    currency !== ledger.default_currency
  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18n.t("app:ledgersettings.preferences")}</CardTitle>
        <CardDescription>
          {i18n.t(
            "app:ledgersettings.choose_the_holiday_calendar_and_the_currency_for_new_categories",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LedgerPreferenceFields
          country={country}
          currency={currency}
          onCountryChange={setCountry}
          onCurrencyChange={setCurrency}
          disabled={!owner || update.isPending}
        />
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:ledgersettings.the_calendar_applies_to_future_schedule_calculations_and_reports_existing_due_dates_s",
          )}
        </p>
        {owner ? (
          <LoadingButton
            loading={update.isPending}
            disabled={!changed}
            onClick={() => update.mutate()}
          >
            {i18n.t("app:ledgersettings.save_preferences")}
          </LoadingButton>
        ) : (
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:ledgersettings.only_the_ledger_owner_can_change_these_preferences",
            )}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

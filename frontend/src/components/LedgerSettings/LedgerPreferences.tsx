import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useEffect, useId, useState } from "react"
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
import { handleError } from "@/utils"

const regionNames = new Intl.DisplayNames(["en"], { type: "region" })

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
  const options = useLedgerPreferenceOptions()
  const id = useId()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-country`}>Holiday calendar</Label>
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
                {regionNames.of(code) ?? code} ({code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-currency`}>Default currency</Label>
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
      showSuccessToast("Ledger preferences updated")
    },
    onError: handleError.bind(showErrorToast),
  })
  const changed =
    country !== ledger.business_calendar_country ||
    currency !== ledger.default_currency
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>
          Choose the holiday calendar and the currency for new categories.
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
          The calendar applies to future schedule calculations and reports.
          Existing due dates stay unchanged. The default currency applies only
          to new categories.
        </p>
        {owner ? (
          <LoadingButton
            loading={update.isPending}
            disabled={!changed}
            onClick={() => update.mutate()}
          >
            Save preferences
          </LoadingButton>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the ledger owner can change these preferences.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

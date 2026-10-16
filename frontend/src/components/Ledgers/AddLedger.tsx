import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { type LedgerCreate, LedgersService } from "@/client"
import {
  LedgerPreferenceFields,
  useLedgerPreferenceOptions,
} from "@/components/LedgerSettings/LedgerPreferences"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => i18n.t("app:messages.name_required") })
    .max(255),
  description: z.string().optional(),
})

type FormData = z.infer<typeof formSchema>

export function AddLedger() {
  useTranslation()

  const options = useLedgerPreferenceOptions()
  const [country, setCountry] = useState(
    options.default_business_calendar_country,
  )
  const [currency, setCurrency] = useState(options.default_currency)
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  })

  const mutation = useMutation({
    mutationFn: (data: LedgerCreate) =>
      LedgersService.createLedger({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:ledgers.ledger_created_successfully"))
      form.reset()
      setCountry(options.default_business_calendar_country)
      setCurrency(options.default_currency)
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ledgers"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({
      name: data.name,
      description: data.description || null,
      business_calendar_country: country,
      default_currency: currency,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {i18n.t("app:ledgers.new_ledger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n.t("app:ledgers.create_a_ledger")}</DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:ledgers.create_a_private_workspace_for_your_payment_obligations",
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:ledgers.name")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t("app:ledgers.household_finances")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:ledgers.description")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t("app:ledgers.optional_description")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <LedgerPreferenceFields
              country={country}
              currency={currency}
              onCountryChange={setCountry}
              onCurrencyChange={setCurrency}
              disabled={mutation.isPending}
            />
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                {i18n.t("app:ledgers.create_ledger")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default AddLedger

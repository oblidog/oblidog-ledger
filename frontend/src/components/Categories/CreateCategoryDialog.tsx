import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CategoriesService,
  type CategoryCreate,
  LedgersService,
} from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  assignCategoryCounterparty,
  type CounterpartySummary,
} from "@/features/counterparties/api"
import { CategoryCounterpartyField } from "@/features/counterparties/CategoryCounterpartyField"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"
import {
  CurrencyField,
  obligationModeDescription,
  PaymentScheduleFields,
} from "./CategoryFormFields"
import { type CategoryFormData, categorySchema } from "./categoryForms"
import { categoryQueryKeys } from "./categoryQueryKeys"

export function CreateCategoryDialog({
  ledgerId,
  groups,
}: {
  ledgerId: string
  groups: { id: string; name: string; is_active: boolean }[]
}) {
  useTranslation()

  const { data: ledger } = useSuspenseQuery({
    queryKey: ["ledger", ledgerId],
    queryFn: () => LedgersService.readLedger({ ledgerId }),
  })
  const [open, setOpen] = useState(false)
  const [counterparty, setCounterparty] = useState<CounterpartySummary | null>(
    null,
  )
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const activeGroups = groups.filter((group) => group.is_active)
  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      category_group_id: "",
      name: "",
      description: "",
      code: "",
      data_source_policy: "hybrid",
      recurrence_interval: 1,
      recurrence_unit: "month",
      first_due_date: "",
      currency: ledger.default_currency,
    },
  })
  useEffect(() => {
    if (!open)
      form.resetField("currency", { defaultValue: ledger.default_currency })
  }, [open, ledger.default_currency, form])
  const mutation = useMutation({
    mutationFn: async (data: CategoryCreate) => {
      const created = await CategoriesService.createCategory({
        ledgerId,
        requestBody: data,
      })
      if (counterparty) {
        await assignCategoryCounterparty(ledgerId, created.id, counterparty.id)
      }
      return created
    },
    onSuccess: () => {
      showSuccessToast(i18n.t("app:categories.category_created"))
      form.reset()
      setCounterparty(null)
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.categories(ledgerId),
      }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={activeGroups.length === 0}>
          <Plus />
          {i18n.t("app:categories.new_category")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{i18n.t("app:categories.create_category")}</DialogTitle>
          <DialogDescription>
            {i18n.t("app:categories.add_a_category_to_an_active_group")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                ...data,
                description: data.description || null,
                first_due_date: data.first_due_date || null,
              }),
            )}
            className="space-y-4"
          >
            <h3 className="text-sm font-semibold">
              {i18n.t("app:categories.basic_information")}
            </h3>
            <FormField
              control={form.control}
              name="category_group_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.group")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={i18n.t("app:categories.choose_a_group")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeGroups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.name")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t("app:categories.electricity")}
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
                  <FormLabel>{i18n.t("app:categories.description")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t(
                        "app:categories.optional_description",
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.code")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="ELEC"
                      maxLength={4}
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <CategoryCounterpartyField
              value={counterparty}
              disabled={mutation.isPending}
              onChange={setCounterparty}
            />
            <section className="space-y-4 border-t pt-4">
              <div>
                <h3 className="text-sm font-semibold">
                  {i18n.t("app:categories.behavior")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {i18n.t(
                    "app:categories.choose_how_obligations_are_created_and_managed",
                  )}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="data_source_policy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {i18n.t("app:categories.category_mode")}
                      </FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value)
                          if (
                            value !== "manual" &&
                            (!form.getValues("recurrence_interval") ||
                              !form.getValues("recurrence_unit"))
                          ) {
                            form.setValue("recurrence_interval", 1)
                            form.setValue("recurrence_unit", "month")
                          }
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="manual">
                            {i18n.t("app:categories.manual")}
                          </SelectItem>
                          <SelectItem value="automatic">
                            {i18n.t("app:categories.automatic")}
                          </SelectItem>
                          <SelectItem value="hybrid">
                            {i18n.t("app:categories.hybrid")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <CurrencyField control={form.control} />
              </div>
              <p className="text-sm text-muted-foreground">
                {obligationModeDescription(form.watch("data_source_policy"))}
              </p>
            </section>
            {form.watch("data_source_policy") !== "manual" && (
              <PaymentScheduleFields
                ledgerId={ledgerId}
                control={form.control}
                onPresetChange={(preset) => {
                  if (preset === "monthly") {
                    form.setValue("recurrence_interval", 1)
                    form.setValue("recurrence_unit", "month")
                  } else if (preset === "every-two-months") {
                    form.setValue("recurrence_interval", 2)
                    form.setValue("recurrence_unit", "month")
                  } else if (preset === "yearly") {
                    form.setValue("recurrence_interval", 1)
                    form.setValue("recurrence_unit", "year")
                  } else {
                    form.setValue("recurrence_interval", 3)
                    form.setValue("recurrence_unit", "month")
                  }
                }}
              />
            )}
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                {i18n.t("app:categories.create_category")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

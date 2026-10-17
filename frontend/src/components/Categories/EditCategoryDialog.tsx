import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  CategoriesService,
  type CategoryPublic,
  type CategoryUpdate,
} from "@/client"
import { Badge } from "@/components/ui/badge"
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
import {
  type CategoryUpdateFormData,
  categoryConfigurationSchema,
} from "./categoryForms"
import { categoryCounterparty } from "./categoryPresentation"
import { categoryQueryKeys } from "./categoryQueryKeys"

export function EditCategoryDialog({
  ledgerId,
  category,
  groups,
  trigger,
}: {
  ledgerId: string
  category: CategoryPublic
  groups: { id: string; name: string; is_active: boolean }[]
  trigger?: ReactNode
}) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const currentCounterparty = categoryCounterparty(category)
  const [counterparty, setCounterparty] = useState<CounterpartySummary | null>(
    currentCounterparty,
  )
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<CategoryUpdateFormData & { category_group_id: string }>({
    resolver: zodResolver(
      categoryConfigurationSchema.extend({
        category_group_id: z
          .string()
          .min(1, { error: () => i18n.t("app:categories.choose_a_group") }),
      }),
    ),
    defaultValues: {
      category_group_id: category.category_group_id,
      name: category.name,
      description: category.description ?? "",
      data_source_policy: category.data_source_policy,
      recurrence_interval: category.recurrence_interval ?? undefined,
      recurrence_unit: category.recurrence_unit ?? undefined,
      first_due_date: category.first_due_date ?? "",
      currency: category.currency,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        category_group_id: category.category_group_id,
        name: category.name,
        description: category.description ?? "",
        data_source_policy: category.data_source_policy,
        recurrence_interval: category.recurrence_interval ?? undefined,
        recurrence_unit: category.recurrence_unit ?? undefined,
        first_due_date: category.first_due_date ?? "",
        currency: category.currency,
      })
      setCounterparty(currentCounterparty)
    }
  }, [category, currentCounterparty, form, open])

  const mutation = useMutation({
    mutationFn: async (data: CategoryUpdate) => {
      const updated = await CategoriesService.updateCategory({
        ledgerId,
        categoryId: category.id,
        requestBody: data,
      })
      if ((counterparty?.id ?? null) !== (currentCounterparty?.id ?? null)) {
        await assignCategoryCounterparty(
          ledgerId,
          category.id,
          counterparty?.id ?? null,
        )
      }
      return updated
    },
    onSuccess: () => {
      showSuccessToast(i18n.t("app:categories.category_updated"))
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
        {trigger || (
          <Button
            variant="ghost"
            size="sm"
            aria-label={i18n.t("app:categories.more_actions_for", {
              value1: category.name,
            })}
          >
            <Pencil />
            <span className="sr-only">
              {i18n.t("app:categories.edit")} {category.name}
            </span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{i18n.t("app:categories.edit_category")}</DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:categories.update_the_category_and_its_obligation_configuration",
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                category_group_id: data.category_group_id,
                name: data.name,
                description: data.description || null,
                data_source_policy: data.data_source_policy,
                recurrence_interval: data.recurrence_interval,
                recurrence_unit: data.recurrence_unit ?? null,
                first_due_date: data.first_due_date || null,
                currency: data.currency,
              }),
            )}
            className="space-y-4"
          >
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
                      {groups
                        .filter(
                          (group) =>
                            group.is_active ||
                            group.id === category.category_group_id,
                        )
                        .map((group) => (
                          <SelectItem
                            key={group.id}
                            value={group.id}
                            disabled={!group.is_active}
                          >
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
                    <Input {...field} />
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
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {i18n.t("app:categories.code")}
              </p>
              <Badge variant="secondary">{category.code}</Badge>
            </div>
            <CategoryCounterpartyField
              value={counterparty}
              disabled={mutation.isPending}
              onChange={setCounterparty}
            />
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
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
                {i18n.t("app:categories.save_changes")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

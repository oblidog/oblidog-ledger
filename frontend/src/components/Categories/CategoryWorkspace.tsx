import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Archive,
  ArrowDownUp,
  Ellipsis,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings2,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
  type Control,
  type FieldValues,
  type Path,
  useForm,
  useWatch,
} from "react-hook-form"
import { z } from "zod"
import {
  AnalyticsService,
  CategoriesService,
  type CategoryCreate,
  type CategoryGroupCreate,
  type CategoryGroupUpdate,
  type CategoryPublic,
  type CategoryUpdate,
} from "@/client"
import { CategoryCustomDataDialog } from "@/components/Categories/CategoryCustomDataDialog"
import {
  DataTable,
  type DataTableFeatures,
} from "@/components/Common/DataTable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  assignCategoryCounterparty,
  type CategoryWithCounterparty,
  type CounterpartySummary,
} from "@/features/counterparties/api"
import { CategoryCounterpartyField } from "@/features/counterparties/CategoryCounterpartyField"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const groupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().optional(),
})

const categoryConfigurationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().optional(),
  data_source_policy: z.enum(["manual", "automatic", "hybrid"]),
  recurrence_interval: z.number().int().positive().optional(),
  recurrence_unit: z.enum(["month", "year"]).optional(),
  first_due_date: z.string().optional(),
  currency: z.enum(["PLN", "EUR", "USD", "GBP", "CHF"]),
})

const categorySchema = categoryConfigurationSchema.extend({
  category_group_id: z.string().min(1, "Choose a group"),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}$/, "Code must contain exactly 4 uppercase letters"),
})

type GroupFormData = z.infer<typeof groupSchema>
type CategoryFormData = z.infer<typeof categorySchema>
type CategoryUpdateFormData = z.infer<typeof categoryConfigurationSchema>

type CategoryRow = CategoryPublic & { groupName: string }

const FILTER_ALL = "all"

function categoryCounterparty(category: CategoryPublic) {
  return (
    (category as CategoryPublic & CategoryWithCounterparty).counterparty ?? null
  )
}

function CurrencyField<T extends FieldValues>({
  control,
}: {
  control: Control<T>
}) {
  return (
    <FormField
      control={control}
      name={"currency" as Path<T>}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Currency</FormLabel>
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

function obligationModeDescription(mode: "manual" | "automatic" | "hybrid") {
  if (mode === "manual") {
    return "Obligations for this category are created manually."
  }
  if (mode === "automatic") {
    return "Obligations are created automatically from the payment schedule."
  }
  return "Obligations follow the schedule and can also be created manually."
}

function nextPaymentDate(
  firstDueDate: string | undefined,
  interval: number | undefined,
  unit: "month" | "year" | undefined,
): Date | undefined {
  if (!firstDueDate || !interval || !unit) return undefined

  const [year, month, day] = firstDueDate.split("-").map(Number)
  if (!year || !month || !day) return undefined

  const addMonths = (value: Date, months: number) => {
    const targetMonth = value.getMonth() + months
    const targetYear = value.getFullYear() + Math.floor(targetMonth / 12)
    const normalizedMonth = ((targetMonth % 12) + 12) % 12
    const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate()
    return new Date(targetYear, normalizedMonth, Math.min(day, lastDay))
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let occurrence = new Date(year, month - 1, day)
  const monthsToAdd = unit === "year" ? interval * 12 : interval

  while (occurrence <= today) {
    occurrence = addMonths(occurrence, monthsToAdd)
  }

  return occurrence
}

function recurrencePreset(
  interval: number | undefined,
  unit: "month" | "year" | undefined,
) {
  if (interval === 1 && unit === "month") return "monthly"
  if (interval === 2 && unit === "month") return "every-two-months"
  if (interval === 1 && unit === "year") return "yearly"
  return "custom"
}

function PaymentScheduleFields<T extends FieldValues>({
  control,
  onPresetChange,
}: {
  control: Control<T>
  onPresetChange: (preset: string) => void
}) {
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
  const nextDueDate = nextPaymentDate(
    firstDueDate,
    interval ?? 1,
    unit ?? "month",
  )

  return (
    <section className="space-y-4 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">Payment schedule</h3>
        <p className="text-sm text-muted-foreground">
          Set when the first payment is due and how often it repeats.
        </p>
      </div>
      <FormField
        control={control}
        name={"first_due_date" as Path<T>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>First payment due</FormLabel>
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
        <FormLabel>Repeat</FormLabel>
        <Select onValueChange={onPresetChange} value={preset}>
          <FormControl>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value="monthly">Every month</SelectItem>
            <SelectItem value="every-two-months">Every 2 months</SelectItem>
            <SelectItem value="yearly">Every year</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
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
                <FormLabel>Every</FormLabel>
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
                <FormLabel>Period</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value as string}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a period" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="month">Months</SelectItem>
                    <SelectItem value="year">Years</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <div className="rounded-md bg-muted p-3">
        <p className="text-sm font-medium">Next payment</p>
        {nextDueDate ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(nextDueDate)}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the first payment due date to see the next occurrence.
          </p>
        )}
      </div>
    </section>
  )
}

function useCategoryQueries(ledgerId: string, includeArchived: boolean) {
  const groups = useSuspenseQuery({
    queryFn: () =>
      CategoriesService.readCategoryGroups({ ledgerId, includeArchived }),
    queryKey: ["category-groups", ledgerId, includeArchived],
  })
  const categories = useSuspenseQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived }),
    queryKey: ["categories", ledgerId, includeArchived],
  })

  return { categories: categories.data.data, groups: groups.data.data }
}

function CreateGroupDialog({ ledgerId }: { ledgerId: string }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: "", description: "" },
  })
  const mutation = useMutation({
    mutationFn: (data: CategoryGroupCreate) =>
      CategoriesService.createCategoryGroup({ ledgerId, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Category group created")
      form.reset()
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["category-groups", ledgerId],
      }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create category group</DialogTitle>
          <DialogDescription>
            Groups keep related categories together.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                ...data,
                description: data.description || null,
              }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Utilities" {...field} />
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Create group
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditGroupDialog({
  ledgerId,
  group,
}: {
  ledgerId: string
  group: { id: string; name: string; description: string | null }
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: group.name, description: group.description ?? "" },
  })

  useEffect(() => {
    if (open)
      form.reset({ name: group.name, description: group.description ?? "" })
  }, [form, group.description, group.name, open])

  const mutation = useMutation({
    mutationFn: (data: CategoryGroupUpdate) =>
      CategoriesService.updateCategoryGroup({
        ledgerId,
        categoryGroupId: group.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Category group updated")
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["category-groups", ledgerId],
      }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil />
          <span className="sr-only">Edit {group.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit category group</DialogTitle>
          <DialogDescription>
            Update the name or description of this group.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                ...data,
                description: data.description || null,
              }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Save group changes
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function CreateCategoryDialog({
  ledgerId,
  groups,
}: {
  ledgerId: string
  groups: { id: string; name: string; is_active: boolean }[]
}) {
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
      currency: "PLN",
    },
  })
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
      showSuccessToast("Category created")
      form.reset()
      setCounterparty(null)
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={activeGroups.length === 0}>
          <Plus />
          New category
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create category</DialogTitle>
          <DialogDescription>
            Add a category to an active group.
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
            <h3 className="text-sm font-semibold">Basic information</h3>
            <FormField
              control={form.control}
              name="category_group_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a group" />
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
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Electricity" {...field} />
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional description" {...field} />
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
                  <FormLabel>Code</FormLabel>
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
                <h3 className="text-sm font-semibold">Behavior</h3>
                <p className="text-sm text-muted-foreground">
                  Choose how obligations are created and managed.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="data_source_policy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category mode</FormLabel>
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
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="automatic">Automatic</SelectItem>
                          <SelectItem value="hybrid">Hybrid</SelectItem>
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
                Create category
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditCategoryDialog({
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
        category_group_id: z.string().min(1, "Choose a group"),
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
      showSuccessToast("Category updated")
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`More actions for ${category.name}`}
          >
            <Pencil />
            <span className="sr-only">Edit {category.name}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
          <DialogDescription>
            Update the category and its obligation configuration.
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
                  <FormLabel>Group</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a group" />
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
                  <FormLabel>Name</FormLabel>
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium">Code</p>
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
                    <FormLabel>Category mode</FormLabel>
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
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="automatic">Automatic</SelectItem>
                        <SelectItem value="hybrid">Hybrid</SelectItem>
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
                Save changes
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveButton({
  label,
  onArchive,
}: {
  label: string
  onArchive: () => void
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onArchive}>
      <Archive />
      <span className="sr-only">Archive {label}</span>
    </Button>
  )
}

function ManageGroupsDialog({
  ledgerId,
  groups,
  categories,
  onArchive,
}: {
  ledgerId: string
  groups: {
    id: string
    name: string
    description: string | null
    is_active: boolean
  }[]
  categories: CategoryPublic[]
  onArchive: (groupId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const activeCategoryCount = (groupId: string) =>
    categories.filter(
      (category) =>
        category.category_group_id === groupId && category.is_active,
    ).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 />
          Manage groups
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage category groups</DialogTitle>
          <DialogDescription>
            Categories always belong to a group. Archive active categories or
            move them before archiving their group.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <CreateGroupDialog ledgerId={ledgerId} />
        </div>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No groups yet.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {groups.map((group) => {
              const count = activeCategoryCount(group.id)
              return (
                <div
                  key={group.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p
                      className={
                        group.is_active
                          ? "font-medium"
                          : "font-medium text-muted-foreground line-through"
                      }
                    >
                      {group.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {count} active {count === 1 ? "category" : "categories"}
                      {group.description ? ` · ${group.description}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <EditGroupDialog ledgerId={ledgerId} group={group} />
                    {!group.is_active ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : (
                      <ArchiveButton
                        label={group.name}
                        onArchive={() => onArchive(group.id)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CategoryActions({
  ledgerId,
  category,
  groups,
  onArchive,
  onRestore,
}: {
  ledgerId: string
  category: CategoryPublic
  groups: { id: string; name: string; is_active: boolean }[]
  onArchive: (categoryId: string) => void
  onRestore: (categoryId: string) => void
}) {
  return (
    <div className="flex justify-end gap-1">
      {category.has_data_schema && (
        <CategoryCustomDataDialog ledgerId={ledgerId} category={category} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`More actions for ${category.name}`}
          >
            <Ellipsis />
            <span className="sr-only">More actions for {category.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <CategoryHistoryDialog
            ledgerId={ledgerId}
            category={category}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                View amount history
              </DropdownMenuItem>
            }
          />
          <DropdownMenuItem asChild>
            <Link
              to="/ledgers/$ledgerId/categories/$categoryId/custom-fields"
              params={{ ledgerId, categoryId: category.id }}
            >
              Manage custom fields
            </Link>
          </DropdownMenuItem>
          <EditCategoryDialog
            ledgerId={ledgerId}
            category={category}
            groups={groups}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                Edit category
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          {category.is_active ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onArchive(category.id)}
            >
              Archive category
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onRestore(category.id)}>
              Restore category
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function historyRange() {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
  const toPeriod = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  return { from: toPeriod(start), to: toPeriod(end) }
}

function CategoryHistoryDialog({
  ledgerId,
  category,
  trigger,
}: {
  ledgerId: string
  category: CategoryPublic
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const range = historyRange()
  const history = useQuery({
    queryFn: () =>
      AnalyticsService.readCategoryAmountHistory({
        ledgerId,
        categoryId: category.id,
        from: range.from,
        to: range.to,
      }),
    queryKey: ["analytics", "category-history", ledgerId, category.id, range],
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{category.name} amount history</DialogTitle>
          <DialogDescription>
            Last six periods. Missing and unknown amounts are kept distinct.
          </DialogDescription>
        </DialogHeader>
        {history.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : history.isError || !history.data ? (
          <Alert variant="destructive">
            <AlertTitle>History is unavailable</AlertTitle>
            <AlertDescription>
              The category history could not be loaded right now.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {history.data.points.map((point) => (
              <div
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2"
                key={`${point.period.year}-${point.period.month}`}
              >
                <span className="text-sm font-medium">
                  {new Intl.DateTimeFormat(undefined, {
                    month: "long",
                    year: "numeric",
                  }).format(
                    new Date(point.period.year, point.period.month - 1, 1),
                  )}
                </span>
                {point.state === "known" ? (
                  <span>
                    {Number(point.current_amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {point.currency}
                  </span>
                ) : (
                  <Badge
                    variant={
                      point.state === "unknown" ? "outline" : "secondary"
                    }
                  >
                    {point.state === "unknown"
                      ? "Amount unknown"
                      : "No obligation"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CategoryWorkspace({ ledgerId }: { ledgerId: string }) {
  const initialFilters = () => {
    if (typeof window === "undefined") {
      return { group: FILTER_ALL, query: "", status: "active", sort: "name" }
    }
    const params = new URLSearchParams(window.location.search)
    return {
      group: params.get("group") || FILTER_ALL,
      query: params.get("q") || "",
      status: params.get("status") || "active",
      sort: params.get("sort") || "name",
    }
  }
  const [filters] = useState(initialFilters)
  const [groupFilter, setGroupFilter] = useState(filters.group)
  const [query, setQuery] = useState(filters.query)
  const [statusFilter, setStatusFilter] = useState(filters.status)
  const [sortBy, setSortBy] = useState(filters.sort)
  const includeArchived = statusFilter !== "active"
  const { categories, groups } = useCategoryQueries(ledgerId, includeArchived)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const values = {
      group: groupFilter,
      q: query,
      status: statusFilter,
      sort: sortBy,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (
        !value ||
        (key === "group" && value === FILTER_ALL) ||
        (key === "status" && value === "active") ||
        (key === "sort" && value === "name")
      ) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    const search = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    )
  }, [groupFilter, query, sortBy, statusFilter])

  const archiveGroup = useMutation({
    mutationFn: (groupId: string) =>
      CategoriesService.archiveCategoryGroup({
        ledgerId,
        categoryGroupId: groupId,
      }),
    onSuccess: () => showSuccessToast("Category group archived"),
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["category-groups", ledgerId] })
      queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] })
    },
  })
  const archiveCategory = useMutation({
    mutationFn: (categoryId: string) =>
      CategoriesService.archiveCategory({ ledgerId, categoryId }),
    onSuccess: () => showSuccessToast("Category archived"),
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] }),
  })
  const restoreCategory = useMutation({
    mutationFn: (categoryId: string) =>
      CategoriesService.restoreCategory({ ledgerId, categoryId }),
    onSuccess: () => showSuccessToast("Category restored"),
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] }),
  })

  const rows = useMemo(() => {
    const groupNames = new Map(groups.map((group) => [group.id, group.name]))
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return categories
      .filter(
        (category) =>
          groupFilter === FILTER_ALL ||
          category.category_group_id === groupFilter,
      )
      .filter(
        (category) =>
          statusFilter === FILTER_ALL ||
          (statusFilter === "active"
            ? category.is_active
            : !category.is_active),
      )
      .filter(
        (category) =>
          !normalizedQuery ||
          `${category.name} ${category.code}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      )
      .map((category) => ({
        ...category,
        groupName:
          groupNames.get(category.category_group_id) || "Unknown group",
      }))
      .sort((left, right) => {
        const result = (
          sortBy === "group" ? left.groupName : left.name
        ).localeCompare(sortBy === "group" ? right.groupName : right.name)
        return result || left.name.localeCompare(right.name)
      })
  }, [categories, groupFilter, groups, query, sortBy, statusFilter])

  const columns = useMemo<ColumnDef<DataTableFeatures, CategoryRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: () => (
          <Button variant="ghost" size="sm" onClick={() => setSortBy("name")}>
            Name <ArrowDownUp />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <p
              className={
                !row.original.is_active
                  ? "font-medium text-muted-foreground line-through"
                  : "font-medium"
              }
            >
              {row.original.name}
            </p>
            {row.original.description && (
              <p className="max-w-56 truncate text-sm text-muted-foreground">
                {row.original.description}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "groupName",
        header: () => (
          <Button variant="ghost" size="sm" onClick={() => setSortBy("group")}>
            Group <ArrowDownUp />
          </Button>
        ),
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.groupName}</Badge>
        ),
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.code}</Badge>
        ),
      },
      { accessorKey: "data_source_policy", header: "Mode" },
      {
        id: "recurrence",
        header: "Recurrence",
        cell: ({ row }) =>
          row.original.recurrence_interval && row.original.recurrence_unit
            ? `Every ${row.original.recurrence_interval} ${row.original.recurrence_unit}${row.original.recurrence_interval === 1 ? "" : "s"}`
            : "None",
      },
      { accessorKey: "currency", header: "Currency" },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "outline" : "secondary"}>
            {row.original.is_active ? "Active" : "Archived"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <CategoryActions
            ledgerId={ledgerId}
            category={row.original}
            groups={groups}
            onArchive={(categoryId) => archiveCategory.mutate(categoryId)}
            onRestore={(categoryId) => restoreCategory.mutate(categoryId)}
          />
        ),
      },
    ],
    [archiveCategory, groups, ledgerId, restoreCategory],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Search, filter, and manage categories without leaving this page.
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <CreateGroupDialog ledgerId={ledgerId} />
            <ManageGroupsDialog
              ledgerId={ledgerId}
              groups={groups}
              categories={categories}
              onArchive={(groupId) => archiveGroup.mutate(groupId)}
            />
            <CreateCategoryDialog ledgerId={ledgerId} groups={groups} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="Search name or code"
              />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value={FILTER_ALL}>All statuses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DataTable columns={columns} data={rows} />
        </CardContent>
      </Card>
    </div>
  )
}

export default CategoryWorkspace

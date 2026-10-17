import { z } from "zod"
import { i18n } from "@/i18n"

export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => i18n.t("app:messages.name_required") })
    .max(255),
  description: z.string().optional(),
})

export const categoryConfigurationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => i18n.t("app:messages.name_required") })
    .max(255),
  description: z.string().optional(),
  data_source_policy: z.enum(["manual", "automatic", "hybrid"]),
  recurrence_interval: z.number().int().positive().optional(),
  recurrence_unit: z.enum(["month", "year"]).optional(),
  first_due_date: z.string().optional(),
  currency: z.enum(["PLN", "EUR", "USD", "GBP", "CHF"]),
})

export const categorySchema = categoryConfigurationSchema.extend({
  category_group_id: z
    .string()
    .min(1, { error: () => i18n.t("app:categories.choose_a_group") }),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}$/, {
      error: () =>
        i18n.t("app:categories.code_must_contain_exactly_4_uppercase_letters"),
    }),
})

export type GroupFormData = z.infer<typeof groupSchema>
export type CategoryFormData = z.infer<typeof categorySchema>
export type CategoryUpdateFormData = z.infer<typeof categoryConfigurationSchema>

import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, ListPlus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { CategoriesService } from "@/client"
import { CategoryCustomFieldsBuilder } from "@/components/Categories/CategoryCustomFieldsBuilder"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { i18n } from "@/i18n"

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/categories/$categoryId/custom-fields",
)({
  component: CategoryCustomFields,
  head: () => ({
    meta: [{ title: i18n.t("app:categories.custom_fields_oblidog") }],
  }),
})

function CategoryCustomFields() {
  useTranslation()

  const { ledgerId, categoryId } = Route.useParams()
  const { data: categories } = useSuspenseQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
    queryKey: ["categories", ledgerId, true],
  })
  const category = categories.data.find((item) => item.id === categoryId)

  if (!category) throw notFound()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
          <ArrowLeft />
          {i18n.t("app:categories.back_to_categories")}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <ListPlus className="size-5 text-primary" />
          </div>
          <CardTitle>
            {i18n.t("app:categories.custom_fields_for")} {category.name}
          </CardTitle>
          <CardDescription>
            {i18n.t(
              "app:categories.define_the_data_collected_for_this_category_saving_creates_a_new_schema_version",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryCustomFieldsBuilder
            ledgerId={ledgerId}
            category={category}
          />
        </CardContent>
      </Card>
    </div>
  )
}

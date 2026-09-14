import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Database } from "lucide-react"

import { CategoriesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function IntegrationDataCategoriesTable({
  ledgerId,
}: {
  ledgerId: string
}) {
  const categories = useQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
    queryKey: ["categories", ledgerId, true],
  })

  const dataCategories =
    categories.data?.data.filter((category) => category.has_data_schema) ?? []

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex items-center gap-2">
          <Database className="size-5 text-primary" />
        </div>
        <h2 className="leading-none font-semibold">Category data</h2>
        <CardDescription>
          Categories with a defined data schema and their structured integration
          history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : categories.isError ? (
          <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            Could not load categories with structured data.
          </p>
        ) : dataCategories.length === 0 ? (
          <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
            No categories have category data configured yet.
          </p>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-lg border">
            <Table data-testid="integration-data-categories-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Schema</TableHead>
                  <TableHead className="text-right">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">
                      {category.name}
                      {category.archived_at ? (
                        <Badge variant="secondary" className="ml-2">
                          Archived
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{category.code}</TableCell>
                    <TableCell>
                      {category.active_data_schema_version ? (
                        <Badge variant="outline">
                          v{category.active_data_schema_version}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/ledgers/$ledgerId/categories/$categoryId/data"
                          params={{ ledgerId, categoryId: category.id }}
                          search={{ sort: "desc" }}
                        >
                          View history
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

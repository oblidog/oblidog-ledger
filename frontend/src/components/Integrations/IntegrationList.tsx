import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { EllipsisVertical, Plus, RefreshCw } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CategoriesService,
  IntegrationsService,
  LedgersService,
} from "@/client"
import { DemoPreviewNotice } from "@/components/Common/DemoRestrictedSection"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useAuth from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { IntegrationForm } from "./IntegrationForm"
import {
  changesLabel,
  dateTime,
  HealthBadge,
  LoadError,
  resultLabel,
} from "./shared"

const PAGE_SIZE = 24

export function IntegrationList({ ledgerId }: { ledgerId: string }) {
  useTranslation()

  const { data: config } = usePublicAppConfig()
  const demo = config?.is_demo === true
  const navigate = useNavigate()
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [connectionKey, setConnectionKey] = useState<string | null>(null)
  const ledger = useQuery({
    queryKey: ["ledger", ledgerId],
    queryFn: () => LedgersService.readLedger({ ledgerId }),
  })
  const integrations = useQuery({
    queryKey: ["integrations", ledgerId, page],
    queryFn: () =>
      IntegrationsService.listIntegrations({
        ledgerId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 15_000,
  })
  const categories = useQuery({
    queryKey: ["integration-categories", ledgerId],
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
  })
  const isOwner = !!user && ledger.data?.owner_user_id === user.id
  const categoryNames = new Map(
    categories.data?.data.map((category) => [category.id, category.name]),
  )

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {i18n.t("app:integrations.integrations")}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {i18n.t("app:integrations.monitor_external_integrations_for")}{" "}
            {ledger.data?.name ?? i18n.t("app:integrations.this_ledger")}.
          </p>
          {!isOwner && (
            <p className="mt-1 text-sm text-muted-foreground">
              {i18n.t(
                "app:integrations.only_the_ledger_owner_can_change_configuration",
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void integrations.refetch()}
            disabled={integrations.isFetching}
          >
            <RefreshCw /> {i18n.t("app:integrations.refresh")}
          </Button>
          {isOwner && (
            <Button
              disabled={!config || demo}
              onClick={() => setCreating(true)}
            >
              <Plus /> {i18n.t("app:integrations.add_integration")}
            </Button>
          )}
        </div>
      </div>
      {demo && <DemoPreviewNotice />}
      {integrations.isError && (
        <LoadError
          hasData={!!integrations.data}
          retry={() => void integrations.refetch()}
        />
      )}
      {integrations.isPending && (
        <p role="status">{i18n.t("app:integrations.loading_integrations")}</p>
      )}
      {integrations.data?.count === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="font-semibold">
            {i18n.t("app:integrations.no_integrations_yet")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? i18n.t(
                  "app:integrations.add_an_integration_here_then_copy_its_connection_key_into_the_runner_configuration",
                )
              : i18n.t(
                  "app:integrations.the_ledger_owner_can_register_integrations_here_their_status_will_appear_after_the_ru",
                )}
          </p>
        </div>
      )}
      {connectionKey && (
        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("app:integrations.connection_key")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">
              {i18n.t(
                "app:integrations.copy_this_key_now_it_will_not_be_displayed_again",
              )}
            </p>
            <code className="block break-all rounded-md border p-3 text-sm">
              {connectionKey}
            </code>
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `OBLIDOG_URL=${window.location.origin}\nOBLIDOG_API_KEY=${connectionKey}\n`,
                )
              }
            >
              {i18n.t("app:integrations.copy_configuration")}
            </Button>
            <Button variant="ghost" onClick={() => setConnectionKey(null)}>
              {i18n.t("app:integrations.i_copied_the_key")}
            </Button>
          </CardContent>
        </Card>
      )}
      {integrations.data && integrations.data.count > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>
                    {i18n.t("app:integrations.integration")}
                  </TableHead>
                  <TableHead>{i18n.t("app:integrations.category")}</TableHead>
                  <TableHead>{i18n.t("app:integrations.status")}</TableHead>
                  <TableHead>{i18n.t("app:integrations.last_run")}</TableHead>
                  <TableHead>{i18n.t("app:integrations.result")}</TableHead>
                  <TableHead>{i18n.t("app:integrations.changes")}</TableHead>
                  <TableHead className="w-16 text-right">
                    {i18n.t("app:integrations.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integrations.data.data.map((item) => (
                  <TableRow key={item.id} className="group">
                    <TableCell className="min-w-52">
                      <Link
                        className="font-medium hover:underline"
                        to="/ledgers/$ledgerId/integrations/$integrationId"
                        params={{ ledgerId, integrationId: item.id }}
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.enabled
                          ? i18n.t("app:integrations.enabled")
                          : i18n.t("app:integrations.disabled")}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {categoryNames.get(item.category_id) ?? item.category_id}
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={item.health} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {dateTime(item.last_finished_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {resultLabel(item)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {changesLabel(item)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={i18n.t(
                              "app:integrations.actions_for_9e1489",
                              { value1: item.name },
                            )}
                          >
                            <EllipsisVertical />
                            <span className="sr-only">
                              {i18n.t("app:integrations.actions_for")}{" "}
                              {item.name}
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              to="/ledgers/$ledgerId/integrations/$integrationId"
                              params={{ ledgerId, integrationId: item.id }}
                            >
                              {i18n.t("app:integrations.view_integration")}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              to="/ledgers/$ledgerId/categories/$categoryId/data"
                              params={{
                                ledgerId,
                                categoryId: item.category_id,
                              }}
                              search={{
                                schema: undefined,
                                from: undefined,
                                to: undefined,
                                sort: "desc",
                              }}
                            >
                              {i18n.t("app:integrations.view_category_data")}
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {((integrations.data?.count ?? 0) > PAGE_SIZE || page > 0) && (
        <nav
          aria-label={i18n.t("app:integrations.integration_pages")}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <Button
            variant="outline"
            disabled={page === 0 || integrations.isFetching}
            onClick={() => setPage((value) => value - 1)}
          >
            {i18n.t("app:integrations.previous")}
          </Button>
          <span className="text-sm">
            {i18n.t("app:integrations.page")} {page + 1}
          </span>
          <Button
            variant="outline"
            disabled={
              !integrations.data ||
              (page + 1) * PAGE_SIZE >= integrations.data.count ||
              integrations.isFetching
            }
            onClick={() => setPage((value) => value + 1)}
          >
            {i18n.t("app:integrations.next")}
          </Button>
        </nav>
      )}
      {creating && isOwner && !demo && (
        <IntegrationForm
          ledgerId={ledgerId}
          onClose={() => setCreating(false)}
          onSaved={(item, key) => {
            setCreating(false)
            setConnectionKey(key ?? null)
            if (!key) {
              void navigate({
                to: "/ledgers/$ledgerId/integrations/$integrationId",
                params: { ledgerId, integrationId: item.id },
              })
            }
          }}
        />
      )}
    </div>
  )
}

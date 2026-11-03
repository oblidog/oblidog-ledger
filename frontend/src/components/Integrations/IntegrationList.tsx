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
import { PageHeader } from "@/components/Common/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { IntegrationForm } from "./IntegrationForm"
import {
  changesLabel,
  dateTime,
  HealthBadge,
  LoadError,
  needsAttention,
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
      <PageHeader
        title={i18n.t("app:integrations.integrations")}
        description={
          !isOwner && (
            <p className="mt-1 text-sm text-muted-foreground">
              {i18n.t(
                "app:integrations.only_the_ledger_owner_can_change_configuration",
              )}
            </p>
          )
        }
        actions={
          <>
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
                aria-describedby={demo ? "integration-demo-actions" : undefined}
                onClick={() => setCreating(true)}
              >
                <Plus /> {i18n.t("app:integrations.add_integration")}
              </Button>
            )}
          </>
        }
      />
      {demo && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p data-testid="demo-preview-notice">
            {i18n.t("app:integrations.demo_preview")}
          </p>
          {isOwner && (
            <p id="integration-demo-actions">
              {i18n.t("app:integrations.demo_actions")}
            </p>
          )}
        </div>
      )}
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
        <ul
          aria-label={i18n.t("app:integrations.integrations")}
          className="divide-y rounded-lg border"
        >
          {integrations.data.data.map((item) => (
            <li
              key={item.id}
              className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-4 ${needsAttention(item.health) ? "bg-destructive/5" : ""}`}
            >
              <div className="min-w-0">
                <Link
                  className="break-words font-medium hover:underline"
                  to="/ledgers/$ledgerId/integrations/$integrationId"
                  params={{ ledgerId, integrationId: item.id }}
                >
                  {item.name}
                </Link>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {categoryNames.get(item.category_id) ?? item.category_id}
                </p>
              </div>
              <div className="col-start-1 min-w-0 space-y-2 md:col-auto">
                <HealthBadge health={item.health} />
                {needsAttention(item.health) && (
                  <Link
                    className="block text-sm font-medium text-destructive underline underline-offset-4"
                    to="/ledgers/$ledgerId/integrations/$integrationId"
                    params={{ ledgerId, integrationId: item.id }}
                  >
                    {i18n.t("app:integrations.review_run_history")}
                  </Link>
                )}
              </div>
              <div className="col-start-1 min-w-0 text-sm md:col-auto">
                <p className="text-xs text-muted-foreground">
                  {i18n.t("app:integrations.last_run")}
                </p>
                <p className="mt-1">
                  {dateTime(item.current_started_at ?? item.last_finished_at)}
                </p>
                <details className="mt-2 text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    {i18n.t("app:integrations.run_details")}
                  </summary>
                  <dl className="mt-2 space-y-2">
                    <div>
                      <dt>{i18n.t("app:integrations.reporting")}</dt>
                      <dd>
                        {item.enabled
                          ? i18n.t("app:integrations.enabled")
                          : i18n.t("app:integrations.disabled")}
                      </dd>
                    </div>
                    <div>
                      <dt>{i18n.t("app:integrations.last_completed_run")}</dt>
                      <dd>{dateTime(item.last_finished_at)}</dd>
                    </div>
                    <div>
                      <dt>{i18n.t("app:integrations.result")}</dt>
                      <dd>{resultLabel(item)}</dd>
                    </div>
                    <div>
                      <dt>{i18n.t("app:integrations.changes")}</dt>
                      <dd>{changesLabel(item)}</dd>
                    </div>
                  </dl>
                </details>
              </div>
              <div className="col-start-2 row-start-1 md:col-auto md:row-auto">
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
                        {i18n.t("app:integrations.actions_for")} {item.name}
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
              </div>
            </li>
          ))}
        </ul>
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

import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { AnalyticsService } from "@/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount, formatDate } from "@/i18n/format"
import { attentionObligationHref } from "./attentionNavigation"

export function NeedsAttention({ ledgerId }: { ledgerId: string }) {
  useTranslation()
  const { data: config } = usePublicAppConfig()
  const attention = useInfiniteQuery({
    queryKey: ["analytics", "attention", ledgerId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      AnalyticsService.readAttentionOverview({
        ledgerId,
        offset: pageParam,
        limit: 8,
      }),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
  })
  const pages = attention.data?.pages
  const items = pages?.flatMap((page) => page.items) ?? []
  return (
    <Card className="gap-3 py-4" aria-labelledby="attention-title">
      <CardHeader className="gap-1">
        <CardTitle>
          <h2 id="attention-title">
            {i18n.t("app:analytics.attention_title")}
          </h2>
        </CardTitle>
        <CardDescription>
          {i18n.t("app:analytics.attention_scope")}
        </CardDescription>
        {config?.is_demo && (
          <p className="text-xs text-muted-foreground">
            {i18n.t("app:analytics.attention_demo")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {attention.isPending ? (
          <Skeleton
            aria-label={i18n.t("app:analytics.attention_loading")}
            className="h-24 w-full"
          />
        ) : attention.isError && items.length === 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              {i18n.t("app:analytics.attention_unavailable")}
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:analytics.attention_empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium">{item.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {(item.reasons ?? []).map((reason) => (
                      <Badge
                        key={reason}
                        variant={
                          reason === "overdue" || reason === "error"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {i18n.t(`app:analytics.attention_${reason}`)}
                      </Badge>
                    ))}
                  </div>
                  {item.category_code && (
                    <p className="text-sm text-muted-foreground">
                      {item.year}-{String(item.month).padStart(2, "0")} ·{" "}
                      {item.due_date
                        ? i18n.t("app:analytics.attention_due", {
                            date: formatDate(item.due_date),
                          })
                        : i18n.t("app:analytics.attention_unknown_date")}
                      {item.due_date && (
                        <>
                          {" "}
                          ·{" "}
                          {domainLabel(
                            "valueState",
                            item.due_date_state ?? "unknown",
                          )}
                        </>
                      )}
                    </p>
                  )}
                  {(item.integrations ?? []).map((integration) => (
                    <p key={integration.id} className="text-sm">
                      <a
                        className="underline underline-offset-4"
                        href={`/ledgers/${ledgerId}/integrations/${integration.id}`}
                      >
                        {integration.name}:{" "}
                        {i18n.t(
                          `app:analytics.attention_integration_${integration.health}`,
                        )}
                      </a>
                    </p>
                  ))}
                </div>
                {item.category_code && (
                  <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
                    <div className="text-sm sm:text-right">
                      <p className="font-medium">
                        {item.amount == null || item.amount_state === "unknown"
                          ? i18n.t("app:analytics.attention_unknown_amount")
                          : formatAmount(item.amount, item.currency)}
                      </p>
                      {item.amount != null &&
                        item.amount_state !== "unknown" && (
                          <p className="text-xs text-muted-foreground">
                            {domainLabel(
                              "valueState",
                              item.amount_state ?? "unknown",
                            )}
                          </p>
                        )}
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a href={attentionObligationHref(ledgerId, item)}>
                        {i18n.t(
                          item.reasons?.includes("error") ||
                            item.reasons?.includes("incomplete")
                            ? "app:analytics.attention_review_data"
                            : "app:analytics.attention_view_obligation",
                        )}
                        <span className="sr-only">: {item.name}</span>
                      </a>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {attention.hasNextPage && (
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void attention.fetchNextPage()}
            disabled={attention.isFetchingNextPage}
          >
            {i18n.t("app:analytics.attention_more", {
              count: Math.max(0, (pages?.[0]?.total ?? 0) - items.length),
            })}
          </Button>
        )}
        {attention.isError && items.length > 0 && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {i18n.t("app:analytics.attention_unavailable")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

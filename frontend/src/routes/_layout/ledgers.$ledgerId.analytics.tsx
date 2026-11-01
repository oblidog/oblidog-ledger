import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ComponentHistoryExplorer } from "@/components/Analytics/ComponentHistoryTable"
import { PageHeader } from "@/components/Common/PageHeader"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/analytics")({
  component: LedgerAnalytics,
  head: () => ({ meta: [{ title: i18n.t("app:ledgers.analytics_oblidog") }] }),
})

function LedgerAnalytics() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6">
      <PageHeader title={i18n.t("common:navigation.analytics")} />
      <ComponentHistoryExplorer key={ledgerId} ledgerId={ledgerId} />
    </div>
  )
}

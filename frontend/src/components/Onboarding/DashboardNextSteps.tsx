import { skipToken, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense, useState } from "react"
import { useTranslation } from "react-i18next"
import { type LedgerPublic, OnboardingService } from "@/client"
import { firstScheduledPaymentSearch } from "@/components/Categories/categoryPresentation"
import AddLedger from "@/components/Ledgers/AddLedger"
import { Button } from "@/components/ui/button"
import { fetchPublicAppConfig } from "@/config"
import useAuth from "@/hooks/useAuth"
import { useLedgerEditorAccess } from "@/hooks/useLedgerCanEdit"

export function DashboardNextSteps({
  ledger,
}: {
  ledger: LedgerPublic | null
}) {
  const { user } = useAuth()
  const config = useQuery({
    queryKey: ["public-app-config"],
    queryFn: fetchPublicAppConfig,
    staleTime: Infinity,
  })
  if (!user || !config.data || (config.data.is_demo && !ledger)) return null

  const storageKey = `oblidog:onboarding:hidden:${user.id}:${ledger?.id ?? "new"}`
  return (
    <WorkspaceNextStep
      key={storageKey}
      storageKey={storageKey}
      ledger={ledger}
      demo={config.data.is_demo}
    />
  )
}

function WorkspaceNextStep({
  storageKey,
  ledger,
  demo,
}: {
  storageKey: string
  ledger: LedgerPublic | null
  demo: boolean
}) {
  const { t } = useTranslation(["app"])
  const canEdit = useLedgerEditorAccess(ledger, !demo)
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(storageKey) === "1",
  )
  const ledgerId = ledger?.id
  const setup = useQuery({
    queryKey: ["dashboard-setup", storageKey],
    queryFn:
      ledgerId && !demo && canEdit && !hidden
        ? () => OnboardingService.readDashboardSetup({ ledgerId })
        : skipToken,
    retry: false,
  })
  if (ledger && !demo && !canEdit) return null

  function toggleGuide() {
    if (hidden) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, "1")
    setHidden(!hidden)
  }

  const toggle = (
    <Button
      variant="ghost"
      size="sm"
      className="min-h-11"
      onClick={toggleGuide}
    >
      {t(hidden ? "app:onboarding.show" : "app:onboarding.hide")}
    </Button>
  )
  if (hidden) return <div className="flex justify-end">{toggle}</div>
  if (ledgerId && !demo && setup.isFetching) return null

  let title = t("app:onboarding.title")
  let description: string
  let action: ReactNode
  if (!ledgerId) {
    description = t("app:onboarding.ledger_help")
    action = (
      <Suspense fallback={null}>
        <AddLedger />
      </Suspense>
    )
  } else if (demo) {
    title = t("app:onboarding.demo_title")
    description = t("app:onboarding.demo_help")
    action = (
      <Button asChild variant="outline">
        <Link
          to="/ledgers/$ledgerId/categories"
          params={{ ledgerId }}
          search={{ setupPreview: true }}
        >
          {t("app:onboarding.open_categories")}
        </Link>
      </Button>
    )
  } else if (setup.isError) {
    description = t("app:onboarding.load_error")
    action = (
      <Button variant="outline" onClick={() => void setup.refetch()}>
        {t("app:obligations.try_again")}
      </Button>
    )
  } else if (!setup.data) {
    return null
  } else if (setup.data.completed) {
    title = t("app:onboarding.completed")
    description = t("app:onboarding.integration_optional")
    action = (
      <Button asChild variant="outline">
        <Link to="/ledgers/$ledgerId/integrations" params={{ ledgerId }}>
          {t("app:onboarding.integrations")}
        </Link>
      </Button>
    )
  } else if (setup.data.payment) {
    const { category_code, period, automatic } = setup.data.payment
    description = t(
      automatic
        ? "app:onboarding.automatic_help"
        : "app:onboarding.payment_help",
    )
    action = (
      <Button asChild>
        <Link
          to="/ledgers/$ledgerId"
          params={{ ledgerId }}
          search={firstScheduledPaymentSearch(category_code, period, automatic)}
        >
          {t("app:onboarding.open_first_payment")}
        </Link>
      </Button>
    )
  } else {
    description = t("app:onboarding.category_help")
    action = (
      <Button asChild>
        <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
          {t("app:onboarding.open_categories")}
        </Link>
      </Button>
    )
  }

  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {toggle}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </section>
  )
}

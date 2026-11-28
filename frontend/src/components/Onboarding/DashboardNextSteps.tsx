import { skipToken, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Ellipsis, Wallet } from "lucide-react"
import { type ReactNode, Suspense, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { type LedgerPublic, OnboardingService } from "@/client"
import { firstScheduledPaymentSearch } from "@/components/Categories/categoryPresentation"
import AddLedger from "@/components/Ledgers/AddLedger"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLedgerEditorAccess } from "@/hooks/useLedgerCanEdit"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { useUpdateOnboardingGuide } from "@/hooks/useUpdateOnboardingGuide"
import { onboardingGuideVersionKey } from "@/lib/onboardingGuide"

function GuideMenu() {
  const { t } = useTranslation("app")
  const updateGuide = useUpdateOnboardingGuide()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("onboarding.options")}
          disabled={updateGuide.isPending}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => updateGuide.mutate(false)}>
          {t("onboarding.disable")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DashboardEmptyLedger() {
  const { t } = useTranslation("app")
  const { user } = useAuth()
  const { data: config, isPending } = usePublicAppConfig()
  const showGuide =
    user && config && !config.is_demo && user.onboarding_guide_enabled !== false

  return (
    <section
      aria-labelledby="dashboard-empty-ledger"
      className="relative flex min-h-64 flex-col items-center justify-center gap-5 rounded-lg border border-dashed px-8 py-12 text-center"
    >
      {showGuide && (
        <div className="absolute right-2 top-2">
          <GuideMenu />
        </div>
      )}
      <div className="space-y-2">
        <span className="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-muted">
          <Wallet className="size-5" aria-hidden="true" />
        </span>
        <h2 id="dashboard-empty-ledger" className="text-lg font-semibold">
          {t(showGuide ? "onboarding.first_ledger" : "ledgers.no_ledgers_yet")}
        </h2>
        {showGuide && (
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("onboarding.ledger_help")}
          </p>
        )}
      </div>
      {isPending ? (
        <Skeleton className="h-9 w-36" />
      ) : config && (!config.is_demo || config.demo_writes_enabled) ? (
        <Suspense fallback={<Skeleton className="h-9 w-36" />}>
          <AddLedger triggerLabel={t("ledgers.create_ledger")} />
        </Suspense>
      ) : (
        <Button asChild variant="outline">
          <Link to="/ledgers">{t("analytics.manage_ledgers")}</Link>
        </Button>
      )}
    </section>
  )
}

export function DashboardNextSteps({ ledger }: { ledger: LedgerPublic }) {
  const { user } = useAuth()
  const { data: config } = usePublicAppConfig()
  if (!user || !config) return null

  if (config.is_demo) {
    const storageKey = `oblidog:onboarding:hidden:${user.id}:${ledger.id}`
    return (
      <DemoNextStep
        key={storageKey}
        storageKey={storageKey}
        ledgerId={ledger.id}
      />
    )
  }

  if (user.onboarding_guide_enabled === false) return null

  const storageKey = `oblidog:onboarding:started:${user.id}:${ledger.id}`
  return (
    <WorkspaceNextStep
      key={storageKey}
      storageKey={storageKey}
      versionKey={onboardingGuideVersionKey(user.id)}
      ledger={ledger}
    />
  )
}

function GuideCard({
  title,
  description,
  action,
  controls,
}: {
  title: string
  description: string
  action: ReactNode
  controls: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {controls}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </section>
  )
}

function DemoNextStep({
  storageKey,
  ledgerId,
}: {
  storageKey: string
  ledgerId: string
}) {
  const { t } = useTranslation("app")
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(storageKey) === "1",
  )
  const toggle = (
    <Button
      variant="ghost"
      size="sm"
      className="min-h-11"
      onClick={() => {
        if (hidden) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, "1")
        setHidden(!hidden)
      }}
    >
      {t(hidden ? "onboarding.show" : "onboarding.hide")}
    </Button>
  )
  if (hidden) return <div className="flex justify-end">{toggle}</div>

  return (
    <GuideCard
      title={t("onboarding.demo_title")}
      description={t("onboarding.demo_help")}
      controls={toggle}
      action={
        <Button asChild variant="outline">
          <Link
            to="/ledgers/$ledgerId/categories"
            params={{ ledgerId }}
            search={{ setupPreview: true }}
          >
            {t("onboarding.open_categories")}
          </Link>
        </Button>
      }
    />
  )
}

function WorkspaceNextStep({
  storageKey,
  versionKey,
  ledger,
}: {
  storageKey: string
  versionKey: string
  ledger: LedgerPublic
}) {
  const { t } = useTranslation("app")
  const ledgerId = ledger.id
  const canEdit = useLedgerEditorAccess(ledger)
  const [showCompletion, setShowCompletion] = useState(false)
  const setup = useQuery({
    queryKey: ["dashboard-setup", storageKey],
    queryFn: canEdit
      ? () => OnboardingService.readDashboardSetup({ ledgerId })
      : skipToken,
    retry: false,
  })
  const completed =
    canEdit &&
    setup.isFetchedAfterMount &&
    !setup.isError &&
    setup.data?.completed === true

  useEffect(() => {
    if (!completed) return

    const startedVersion = sessionStorage.getItem(storageKey)
    sessionStorage.removeItem(storageKey)
    if (startedVersion === (localStorage.getItem(versionKey) ?? "")) {
      setShowCompletion(true)
    }
  }, [completed, storageKey, versionKey])

  if (!canEdit || setup.isFetching) return null

  function startGuide() {
    sessionStorage.setItem(storageKey, localStorage.getItem(versionKey) ?? "")
  }

  if (setup.isError) {
    return (
      <GuideCard
        title={t("onboarding.title")}
        description={t("onboarding.load_error")}
        controls={<GuideMenu />}
        action={
          <Button variant="outline" onClick={() => void setup.refetch()}>
            {t("obligations.try_again")}
          </Button>
        }
      />
    )
  }
  if (!setup.data) return null

  if (setup.data.completed) {
    if (!showCompletion) return null

    return (
      <GuideCard
        title={t("onboarding.completed")}
        description={t("onboarding.integration_optional")}
        controls={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompletion(false)}
          >
            {t("onboarding.close")}
          </Button>
        }
        action={
          <Button asChild variant="outline">
            <Link to="/ledgers/$ledgerId/integrations" params={{ ledgerId }}>
              {t("onboarding.integrations")}
            </Link>
          </Button>
        }
      />
    )
  }

  const payment = setup.data.payment
  return (
    <GuideCard
      title={t("onboarding.title")}
      description={t(
        payment
          ? payment.automatic
            ? "onboarding.automatic_help"
            : "onboarding.payment_help"
          : "onboarding.category_help",
      )}
      controls={<GuideMenu />}
      action={
        payment ? (
          <Button asChild>
            <Link
              to="/ledgers/$ledgerId"
              params={{ ledgerId }}
              search={firstScheduledPaymentSearch(
                payment.category_code,
                payment.period,
                payment.automatic,
              )}
              onClick={startGuide}
            >
              {t("onboarding.open_first_payment")}
            </Link>
          </Button>
        ) : (
          <Button asChild>
            <Link
              to="/ledgers/$ledgerId/categories"
              params={{ ledgerId }}
              onClick={startGuide}
            >
              {t("onboarding.open_categories")}
            </Link>
          </Button>
        )
      }
    />
  )
}

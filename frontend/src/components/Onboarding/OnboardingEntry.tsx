import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { LedgersService, OnboardingService } from "@/client"
import { Button } from "@/components/ui/button"
import { fetchPublicAppConfig } from "@/config"
import { i18n } from "@/i18n"
import { OnboardingWizard } from "./OnboardingWizard"
import { onboardingQueryKey } from "./onboardingLogic"

export function OnboardingEntry({ ledgerId }: { ledgerId?: string }) {
  useTranslation()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const config = useQuery({
    queryKey: ["public-app-config"],
    queryFn: fetchPublicAppConfig,
    staleTime: Infinity,
  })
  const demo = config.data?.is_demo === true
  const progress = useQuery({
    queryKey: onboardingQueryKey,
    queryFn: () => OnboardingService.readOnboarding(),
    enabled: !!config.data && !demo,
  })
  const ledgers = useQuery({
    queryKey: ["ledgers"],
    queryFn: () => LedgersService.readLedgers(),
  })
  const payments = useQuery({
    queryKey: ["onboarding-eligibility", ledgerId],
    queryFn: () =>
      OnboardingService.readOnboardingEligibility({ ledgerId: ledgerId! }),
    enabled:
      !!ledgerId && !!config.data && !demo && (progress.data?.step ?? 0) === 0,
  })
  const state = progress.data
  const inProgress = (state?.step ?? 0) > 0 && state?.step !== 4
  const empty = ledgerId ? payments.data === true : ledgers.data?.count === 0
  if (
    !config.data ||
    (!demo && !state) ||
    (!demo && state?.step === 4 && !open)
  )
    return null
  if (!demo && !inProgress && !empty && !open) return null
  const compact = demo || state?.dismissed

  return (
    <section
      className={
        compact ? "flex justify-end" : "space-y-3 rounded-lg border bg-card p-5"
      }
    >
      {!compact && (
        <div>
          <h2 className="font-semibold">{i18n.t("app:onboarding.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {i18n.t("app:onboarding.description")}
          </p>
        </div>
      )}
      <Button
        variant={compact ? "outline" : "default"}
        size={compact ? "sm" : "default"}
        onClick={() => setOpen(true)}
      >
        {demo
          ? i18n.t("app:onboarding.try_preview")
          : inProgress || state?.dismissed
            ? i18n.t("app:onboarding.resume")
            : i18n.t("app:onboarding.start")}
      </Button>
      {open && (
        <OnboardingWizard
          initialState={demo ? {} : state!}
          demo={demo}
          defaultLedgerId={ledgerId}
          onClose={() => setOpen(false)}
          onProgress={(next) =>
            queryClient.setQueryData(onboardingQueryKey, next)
          }
        />
      )}
    </section>
  )
}

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { LedgersService, OnboardingService, type UserPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { fetchPublicAppConfig } from "@/config"
import useAuth from "@/hooks/useAuth"
import { i18n } from "@/i18n"
import { OnboardingWizard } from "./OnboardingWizard"

export function OnboardingEntry({ ledgerId }: { ledgerId?: string }) {
  useTranslation()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id
  const progressKey = ["onboarding", userId] as const
  const config = useQuery({
    queryKey: ["public-app-config"],
    queryFn: fetchPublicAppConfig,
    staleTime: Infinity,
  })
  const demo = config.data?.is_demo === true
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: () => OnboardingService.readOnboarding(),
    enabled: !!userId && !!config.data && !demo,
  })
  const ledgers = useQuery({
    queryKey: ["ledgers"],
    queryFn: () => LedgersService.readLedgers(),
  })
  const payments = useQuery({
    queryKey: ["onboarding-eligibility", userId, ledgerId],
    queryFn: () =>
      OnboardingService.readOnboardingEligibility({ ledgerId: ledgerId! }),
    enabled:
      !!userId &&
      !!ledgerId &&
      !!config.data &&
      !demo &&
      (progress.data?.step ?? 0) === 0,
  })
  const state = progress.data
  const inProgress = (state?.step ?? 0) > 0 && state?.step !== 4
  const empty = ledgerId ? payments.data === true : ledgers.data?.count === 0
  if (
    !userId ||
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
          key={userId}
          initialState={demo ? {} : state!}
          demo={demo}
          defaultLedgerId={ledgerId}
          onClose={() => setOpen(false)}
          onProgress={(next) => {
            // A background dismissal can finish after the user signs out.
            const currentUser = queryClient.getQueryData<UserPublic | null>([
              "currentUser",
            ])
            if (currentUser?.id !== userId) return
            queryClient.setQueryData<typeof next>(progressKey, (previous) =>
              (previous?.revision ?? 0) > (next.revision ?? 0)
                ? previous
                : next,
            )
          }}
        />
      )}
    </section>
  )
}

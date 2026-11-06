import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  LedgersService,
  OnboardingService,
  type OnboardingState,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { i18n } from "@/i18n"
import { apiErrorPayload, getApiErrorMessage } from "@/i18n/apiErrors"
import {
  CategoryStep,
  LedgerStep,
  PaymentStep,
  ScheduleStep,
} from "./OnboardingSteps"
import { type OnboardingCommand, previewStep } from "./onboardingLogic"

export function OnboardingWizard({
  initialState,
  demo,
  defaultLedgerId,
  onClose,
  onProgress,
}: {
  initialState: OnboardingState
  demo: boolean
  defaultLedgerId?: string
  onClose: () => void
  onProgress: (state: OnboardingState) => void
}) {
  useTranslation()
  const [state, setState] = useState(initialState)
  const [error, setError] = useState("")
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const ledgers = useQuery({
    queryKey: ["ledgers"],
    queryFn: () => LedgersService.readLedgers(),
  })
  const step = state.step ?? 0
  const mutation = useMutation({
    mutationFn: (command: OnboardingCommand) =>
      demo
        ? Promise.resolve(previewStep(state, command, ledgers.data?.data))
        : OnboardingService.advanceOnboarding({ requestBody: command }),
    onSuccess: (next) => {
      setError("")
      setState(next)
      if (!demo) {
        onProgress(next)
        // Refresh lists and analytics after either the ledger or final payment
        // has been committed. An unfiltered first-payment link avoids hiding it.
        if (next.step === 1 || next.step === 4)
          void queryClient.invalidateQueries({
            predicate: (query) =>
              [
                "ledgers",
                "ledger",
                "category-groups",
                "categories",
                "obligations",
                "onboarding-eligibility",
                "analytics",
              ].includes(String(query.queryKey[0])),
          })
      }
    },
    onError: async (caught) => {
      setError(getApiErrorMessage(caught))
      if (apiErrorPayload(caught)?.code === "onboarding_changed") {
        const next = await OnboardingService.readOnboarding()
        setState(next)
        onProgress(next)
      }
    },
  })
  const send = (command: OnboardingCommand) => {
    if (lock.current) return
    lock.current = true
    void mutation
      .mutateAsync(command)
      .catch(() => {})
      .finally(() => {
        lock.current = false
      })
  }
  const pause = () => {
    if (mutation.isPending || lock.current) return
    if (demo || step === 4) {
      onClose()
      return
    }
    lock.current = true
    void mutation
      .mutateAsync({ action: "dismiss", revision: state.revision ?? 0 })
      .then(onClose)
      .catch(() => {})
      .finally(() => {
        lock.current = false
      })
  }
  const props = { state, pending: mutation.isPending, submit: send }
  const titles = [
    i18n.t("app:onboarding.workspace"),
    i18n.t("app:onboarding.category"),
    i18n.t("app:onboarding.schedule"),
    i18n.t("app:onboarding.payment"),
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) pause()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 4
              ? i18n.t("app:onboarding.done")
              : i18n.t("app:onboarding.title")}
          </DialogTitle>
          <DialogDescription>
            {demo
              ? i18n.t("app:onboarding.preview_notice")
              : i18n.t("app:onboarding.saved_notice")}
          </DialogDescription>
        </DialogHeader>
        {step < 4 && (
          <p className="text-sm font-medium" aria-live="polite">
            {i18n.t("app:onboarding.step", { number: step + 1 })} ·{" "}
            {titles[step]}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {step === 0 && (
          <LedgerStep
            {...props}
            defaultLedgerId={defaultLedgerId}
            demo={demo}
          />
        )}
        {step === 1 && <CategoryStep {...props} demo={demo} />}
        {step === 2 && <ScheduleStep {...props} />}
        {step === 3 && <PaymentStep {...props} />}
        {step === 4 && (
          <div className="space-y-4">
            <p>
              {demo
                ? i18n.t("app:onboarding.preview_done")
                : i18n.t("app:onboarding.created")}
            </p>
            <p className="text-sm text-muted-foreground">
              {i18n.t("app:onboarding.integration_optional")}
            </p>
            {!demo && state.ledger_id && (
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a
                    href={`/ledgers/${state.ledger_id}?period=all&lifecycle=&category=${state.category?.code}`}
                  >
                    {i18n.t("app:onboarding.view_payment")}
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/ledgers/${state.ledger_id}/integrations`}>
                    {i18n.t("app:onboarding.integrations")}
                  </a>
                </Button>
              </div>
            )}
            <Button variant="ghost" onClick={onClose}>
              {i18n.t("app:onboarding.close")}
            </Button>
          </div>
        )}
        {step < 4 && (
          <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={pause}
            >
              {demo
                ? i18n.t("app:onboarding.close")
                : i18n.t("app:onboarding.later")}
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    send({ action: "back", revision: state.revision ?? 0 })
                  }
                >
                  {i18n.t("app:onboarding.back")}
                </Button>
              )}
              {!demo && step > 0 && (
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    send({ action: "restart", revision: state.revision ?? 0 })
                  }
                >
                  {i18n.t("app:onboarding.restart")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

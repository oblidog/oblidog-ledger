import type {
  LedgerPublic,
  OnboardingAdvanceOnboardingData,
  OnboardingState,
} from "@/client"

export type OnboardingCommand = OnboardingAdvanceOnboardingData["body"]
export const onboardingQueryKey = ["onboarding"] as const

export function suggestCategoryCode(name: string) {
  return `${name
    .normalize("NFKD")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()}XXXX`.slice(0, 4)
}

// The demo never sends commands to the shared account. Its progress lives only
// in this mounted dialog, so another visitor cannot inherit the walkthrough.
export function previewStep(
  state: OnboardingState,
  command: OnboardingCommand,
  ledgers: LedgerPublic[] = [],
): OnboardingState {
  const next = { ...state, revision: (state.revision ?? 0) + 1 }
  switch (command.action) {
    case "ledger": {
      const ledger = ledgers.find((item) => item.id === command.ledger_id)
      return {
        ...next,
        ledger_id: command.ledger_id ?? "preview",
        default_currency:
          command.ledger?.default_currency ?? ledger?.default_currency ?? "PLN",
        business_calendar_country:
          command.ledger?.business_calendar_country ??
          ledger?.business_calendar_country ??
          "PL",
        step: 1,
      }
    }
    case "category":
      return { ...next, category: command.category, step: 2 }
    case "schedule":
      return { ...next, schedule: command.schedule, step: 3 }
    case "payment":
      return { ...next, step: 4 }
    case "back":
      return { ...next, step: Math.max(0, (state.step ?? 0) - 1) }
    case "restart":
      return { revision: next.revision, step: 0 }
    case "dismiss":
      return { ...next, dismissed: true }
    case "resume":
      return { ...next, dismissed: false }
  }
}

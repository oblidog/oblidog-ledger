import { type QueryClient, useQuery } from "@tanstack/react-query"
import { ObligationsService } from "@/client"
import { apiErrorPayload } from "@/i18n/apiErrors"
import {
  type LifecycleFilter,
  type ObligationFilters,
  parseMonthInput,
} from "./obligationLogic"

export const obligationQueryKeys = {
  list: (ledgerId: string) => ["obligations", ledgerId] as const,
  filteredList: (
    ledgerId: string,
    periods: string[],
    categoryCode: string,
    lifecycle: LifecycleFilter,
  ) => ["obligations", ledgerId, periods, categoryCode, lifecycle] as const,
  firstScheduled: (ledgerId: string, key: string | null) =>
    ["first-scheduled-obligation", ledgerId, key] as const,
  detail: (ledgerId: string, key: string | null) =>
    ["obligation", ledgerId, key] as const,
  actions: (ledgerId: string, key: string) =>
    ["obligation-actions", ledgerId, key] as const,
}

// Lifecycle actions refresh history immediately, then await detail and list refreshes.
export async function invalidateObligationAction(
  queryClient: QueryClient,
  ledgerId: string,
  key: string,
) {
  void queryClient.invalidateQueries({
    queryKey: obligationQueryKeys.actions(ledgerId, key),
  })
  await queryClient.invalidateQueries({
    queryKey: obligationQueryKeys.detail(ledgerId, key),
  })
  await queryClient.invalidateQueries({
    queryKey: obligationQueryKeys.list(ledgerId),
  })
}

export function useObligationList(
  ledgerId: string,
  { periods, categoryCode, lifecycle }: ObligationFilters,
) {
  const singlePeriod = periods.length === 1 ? parseMonthInput(periods[0]) : null
  return useQuery({
    queryKey: obligationQueryKeys.filteredList(
      ledgerId,
      periods,
      categoryCode,
      lifecycle,
    ),
    queryFn: () =>
      ObligationsService.readObligations({
        ledgerId,
        periods: periods.length > 1 ? periods : undefined,
        year: singlePeriod ? Number(singlePeriod.year) : undefined,
        month: singlePeriod ? Number(singlePeriod.month) : undefined,
        categoryCode: categoryCode || undefined,
        lifecycle: lifecycle === "unpaid" ? undefined : lifecycle || undefined,
      }),
  })
}

export function useObligationDetail(
  ledgerId: string,
  selectedKey: string | null,
) {
  return useQuery({
    enabled: selectedKey !== null,
    queryKey: obligationQueryKeys.detail(ledgerId, selectedKey),
    queryFn: () =>
      ObligationsService.readObligation({
        ledgerId,
        obligationKey: selectedKey!,
      }),
  })
}

export function useFirstScheduledObligation(
  ledgerId: string,
  key: string | null,
  existingCategoryCode?: string,
) {
  return useQuery({
    queryKey: [
      ...obligationQueryKeys.firstScheduled(ledgerId, key),
      existingCategoryCode,
    ],
    enabled: key !== null,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!key) return null
      if (existingCategoryCode) {
        const { data } = await ObligationsService.readObligations({
          ledgerId,
          categoryCode: existingCategoryCode,
        })
        // The API orders billing periods newest first. Business keys for
        // one category sort in billing-period order (CODE-YYYY-MM).
        return data.filter((obligation) => obligation.key >= key).pop() ?? null
      }
      try {
        return await ObligationsService.readObligation({
          ledgerId,
          obligationKey: key,
        })
      } catch (error) {
        if (apiErrorPayload(error)?.code === "obligation_not_found") return null
        throw error
      }
    },
  })
}

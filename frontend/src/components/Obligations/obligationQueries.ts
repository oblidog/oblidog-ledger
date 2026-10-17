import { type QueryClient, useQuery } from "@tanstack/react-query"
import { ObligationsService } from "@/client"
import { isValidPeriod, type LifecycleFilter } from "./obligationLogic"

export const obligationQueryKeys = {
  list: (ledgerId: string) => ["obligations", ledgerId] as const,
  filteredList: (
    ledgerId: string,
    filterByPeriod: boolean,
    year: string,
    month: string,
    categoryCode: string,
    lifecycle: LifecycleFilter,
  ) =>
    [
      "obligations",
      ledgerId,
      filterByPeriod,
      year,
      month,
      categoryCode,
      lifecycle,
    ] as const,
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
  filterByPeriod: boolean,
  year: string,
  month: string,
  categoryCode: string,
  lifecycle: LifecycleFilter,
) {
  return useQuery({
    queryKey: obligationQueryKeys.filteredList(
      ledgerId,
      filterByPeriod,
      year,
      month,
      categoryCode,
      lifecycle,
    ),
    enabled: !filterByPeriod || isValidPeriod(Number(year), Number(month)),
    queryFn: () =>
      ObligationsService.readObligations({
        ledgerId,
        year: filterByPeriod ? Number(year) : undefined,
        month: filterByPeriod ? Number(month) : undefined,
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

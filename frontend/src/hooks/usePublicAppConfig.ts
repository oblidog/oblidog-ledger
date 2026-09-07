import { useQuery } from "@tanstack/react-query"

import { fetchPublicAppConfig } from "@/config"

export function usePublicAppConfig() {
  return useQuery({
    queryKey: ["public-app-config"],
    queryFn: fetchPublicAppConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

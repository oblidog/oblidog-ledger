import { ChartNoAxesCombined, Home, ListChecks, Tags } from "lucide-react"

import type { Item } from "./Main"

export function primaryNavigation(ledgerId: string | null): Item[] {
  return [
    { icon: Home, title: "navigation.dashboard", path: "/" },
    ...(ledgerId
      ? [
          {
            icon: ListChecks,
            title: "navigation.obligations" as const,
            path: `/ledgers/${ledgerId}`,
            exact: true,
          },
          {
            icon: Tags,
            title: "navigation.categories" as const,
            path: `/ledgers/${ledgerId}/categories`,
          },
          {
            icon: ChartNoAxesCombined,
            title: "navigation.analytics" as const,
            path: `/ledgers/${ledgerId}/analytics`,
          },
        ]
      : []),
  ]
}

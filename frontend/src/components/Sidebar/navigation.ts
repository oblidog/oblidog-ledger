import { ChartNoAxesCombined, Home, ListChecks, Tags } from "lucide-react"

import type { Item } from "./Main"

export function primaryNavigation(ledgerId: string | null): Item[] {
  return [
    { icon: Home, title: "Dashboard", path: "/" },
    ...(ledgerId
      ? [
          {
            icon: ListChecks,
            title: "Obligations",
            path: `/ledgers/${ledgerId}`,
            exact: true,
          },
          {
            icon: Tags,
            title: "Categories",
            path: `/ledgers/${ledgerId}/categories`,
          },
          {
            icon: ChartNoAxesCombined,
            title: "Analytics",
            path: `/ledgers/${ledgerId}/analytics`,
          },
        ]
      : []),
  ]
}

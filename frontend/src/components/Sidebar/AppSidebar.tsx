import { Plug, Users } from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { LanguageSelector } from "@/components/Common/LanguageSelector"
import { Logo } from "@/components/Common/Logo"
import LedgerSwitcher from "@/components/Sidebar/LedgerSwitcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { useActiveLedger } from "@/hooks/useActiveLedger"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { primaryNavigation } from "./navigation"
import { User } from "./User"

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const { activeLedgerId } = useActiveLedger()

  const items: Item[] = [
    ...primaryNavigation(activeLedgerId),
    ...(activeLedgerId
      ? [
          {
            icon: Plug,
            title: "navigation.integrations" as const,
            path: `/ledgers/${activeLedgerId}/integrations`,
          },
        ]
      : []),
    ...(currentUser?.is_superuser
      ? [{ icon: Users, title: "navigation.admin" as const, path: "/admin" }]
      : []),
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <LedgerSwitcher />
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <LanguageSelector />
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar

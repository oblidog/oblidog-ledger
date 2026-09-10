import { Building2, Plug, Users } from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
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
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { Main } from "./Main"
import { primaryNavigation } from "./navigation"
import { User } from "./User"

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const { activeLedgerId } = useActiveLedger()

  const { data: appConfig } = usePublicAppConfig()

  const items = [
    ...primaryNavigation(activeLedgerId),
    ...(activeLedgerId && appConfig && !appConfig.is_demo
      ? [
          {
            icon: Plug,
            title: "Integrations",
            path: `/ledgers/${activeLedgerId}/integrations`,
          },
        ]
      : []),
    ...(currentUser?.is_superuser
      ? [
          { icon: Building2, title: "Counterparties", path: "/counterparties" },
          { icon: Users, title: "Admin", path: "/admin" },
        ]
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
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar

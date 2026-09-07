import { Link, useNavigate } from "@tanstack/react-router"
import {
  BookOpen,
  Check,
  ChevronsUpDown,
  List,
  Play,
  Settings,
  Tags,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useActiveLedger } from "@/hooks/useActiveLedger"
import useAuth from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"

export function LedgerSwitcher() {
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const { user: currentUser } = useAuth()
  const { data: appConfig } = usePublicAppConfig()
  const isDemo = appConfig?.is_demo === true
  const { activeLedger, activeLedgerId, isLoading, ledgers, setLastLedgerId } =
    useActiveLedger()

  const selectLedger = (ledgerId: string) => {
    window.localStorage.setItem("last-ledger-id", ledgerId)
    setLastLedgerId(ledgerId)
    if (isMobile) setOpenMobile(false)
    void navigate({ to: "/ledgers/$ledgerId", params: { ledgerId } })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={activeLedger?.name ?? "Select ledger"}
              size="lg"
              disabled={isLoading || ledgers.length === 0}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="ledger-switcher"
            >
              <BookOpen className="text-primary" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeLedger?.name ??
                    (isLoading ? "Loading ledger…" : "Select ledger")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Current workspace
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel>Switch ledger</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ledgers.map((ledger) => (
              <DropdownMenuItem
                key={ledger.id}
                onClick={() => selectLedger(ledger.id)}
              >
                <BookOpen />
                <span className="truncate">{ledger.name}</span>
                {ledger.id === activeLedgerId && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {activeLedgerId && (
              <>
                {!isDemo && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/ledgers/$ledgerId/settings"
                      params={{ ledgerId: activeLedgerId }}
                    >
                      <Settings />
                      Ledger settings
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link
                    to="/ledgers/$ledgerId/categories"
                    params={{ ledgerId: activeLedgerId }}
                  >
                    <Tags />
                    Categories
                  </Link>
                </DropdownMenuItem>
                {!isDemo && activeLedger?.owner_user_id === currentUser?.id ? (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/ledgers/$ledgerId/system-run"
                      params={{ ledgerId: activeLedgerId }}
                    >
                      <Play />
                      System Run
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </>
            )}
            <DropdownMenuItem asChild>
              <Link to="/ledgers">
                <List />
                Manage ledgers
                <Badge variant="outline" className="ml-auto">
                  {ledgers.length}
                </Badge>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export default LedgerSwitcher

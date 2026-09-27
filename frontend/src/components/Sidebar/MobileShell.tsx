import { Link, useRouterState } from "@tanstack/react-router"
import { Menu } from "lucide-react"

import { Logo } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { useActiveLedger } from "@/hooks/useActiveLedger"
import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

export function MobileShell() {
  const { activeLedger, activeLedgerId, isLoading } = useActiveLedger()
  const { toggleSidebar } = useSidebar()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const items = primaryNavigation(activeLedgerId).filter(
    (item) => item.title !== "Analytics",
  )

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4 md:hidden">
        <Logo variant="full" className="h-5" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {activeLedger?.name ??
            (isLoading ? "Loading ledger…" : "No ledger selected")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="More"
        >
          <Menu />
        </Button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid h-16 grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((item) => {
          const active = pathname === item.path
          return (
            <Link
              key={item.title}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
                active && "text-primary",
              )}
            >
              <item.icon className="size-5" />
              {item.title}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>
    </>
  )
}

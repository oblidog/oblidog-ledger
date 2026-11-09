import { useQuery } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { LedgersService } from "@/client"

export const LAST_LEDGER_KEY = "last-ledger-id"

function getLedgerIdFromPath(pathname: string) {
  return pathname.match(/^\/ledgers\/([^/]+)/)?.[1] ?? null
}

export function useActiveLedger() {
  const location = useLocation()
  const [lastLedgerId, setLastLedgerId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(LAST_LEDGER_KEY),
  )
  const { data, isLoading, isError } = useQuery({
    queryFn: () => LedgersService.readLedgers(),
    queryKey: ["ledgers"],
  })
  const pathLedgerId = getLedgerIdFromPath(location.pathname)
  const requestedLedgerId = pathLedgerId ?? lastLedgerId
  const ledgers = data?.data ?? []
  const activeLedger =
    ledgers.find((ledger) => ledger.id === requestedLedgerId) ??
    ledgers[0] ??
    null
  const activeLedgerId = activeLedger?.id ?? null

  useEffect(() => {
    if (!pathLedgerId) return
    window.localStorage.setItem(LAST_LEDGER_KEY, pathLedgerId)
    setLastLedgerId(pathLedgerId)
  }, [pathLedgerId])

  useEffect(() => {
    if (!activeLedgerId || pathLedgerId) return
    window.localStorage.setItem(LAST_LEDGER_KEY, activeLedgerId)
    setLastLedgerId(activeLedgerId)
  }, [activeLedgerId, pathLedgerId])

  return {
    activeLedger,
    activeLedgerId,
    isLoading,
    isError,
    ledgers,
    setLastLedgerId,
  }
}

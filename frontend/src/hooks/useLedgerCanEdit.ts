import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { LedgersService } from "@/client"
import useAuth from "@/hooks/useAuth"

export function useLedgerCanEdit(ledgerId: string, enabled = true) {
  const { user } = useAuth()
  const { data: ledger } = useSuspenseQuery({
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    queryKey: ["ledger", ledgerId],
  })
  const isOwner = ledger.owner_user_id === user?.id && !!user
  const members = useQuery({
    queryFn: () => LedgersService.readLedgerMembers({ ledgerId }),
    queryKey: ["ledger-members", ledgerId],
    enabled: enabled && !!user && !isOwner,
  })
  return (
    isOwner ||
    members.data?.data.some(
      (member) =>
        member.user_id === user?.id &&
        (member.role === "owner" || member.role === "editor"),
    ) === true
  )
}

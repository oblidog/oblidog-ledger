import { skipToken, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { type LedgerPublic, LedgersService } from "@/client"
import useAuth from "@/hooks/useAuth"

export function useLedgerCanEdit(ledgerId: string, enabled = true) {
  const { data: ledger } = useSuspenseQuery({
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    queryKey: ["ledger", ledgerId],
  })
  return useLedgerEditorAccess(ledger, enabled)
}

export function useLedgerEditorAccess(
  ledger: Pick<LedgerPublic, "id" | "owner_user_id"> | null,
  enabled = true,
) {
  const { user } = useAuth()
  const ledgerId = ledger?.id
  const isOwner = !!user && ledger?.owner_user_id === user.id
  const members = useQuery({
    queryFn: ledgerId
      ? () => LedgersService.readLedgerMembers({ ledgerId })
      : skipToken,
    queryKey: ["ledger-members", ledgerId],
    enabled: enabled && !!ledgerId && !!user && !isOwner,
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

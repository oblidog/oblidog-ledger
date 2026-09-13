import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Mail, RotateCw, UserRoundX } from "lucide-react"
import { useState } from "react"

import { type UserInvitationPublic, UserInvitationsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))

const statusVariant = (status: UserInvitationPublic["status"]) => {
  if (status === "pending") return "default" as const
  if (status === "revoked") return "destructive" as const
  if (status === "accepted") return "secondary" as const
  return "outline" as const
}

const statusLabel = (status: UserInvitationPublic["status"]) =>
  status.charAt(0).toUpperCase() + status.slice(1)

function InvitationActions({
  invitation,
}: {
  invitation: UserInvitationPublic
}) {
  const [revokeOpen, setRevokeOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const actionable =
    invitation.status === "pending" || invitation.status === "expired"

  const refreshInvitations = () =>
    queryClient.invalidateQueries({ queryKey: ["user-invitations"] })

  const resendMutation = useMutation({
    mutationFn: () =>
      UserInvitationsService.resendInvitation({
        invitationId: invitation.id,
      }),
    onSuccess: () => showSuccessToast("Invitation resent"),
    onError: handleError.bind(showErrorToast),
    onSettled: refreshInvitations,
  })

  const revokeMutation = useMutation({
    mutationFn: () =>
      UserInvitationsService.revokeInvitation({
        invitationId: invitation.id,
      }),
    onSuccess: () => {
      showSuccessToast("Invitation revoked")
      setRevokeOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: refreshInvitations,
  })

  if (!actionable) return null

  return (
    <div className="flex justify-end gap-1">
      <LoadingButton
        variant="ghost"
        size="sm"
        loading={resendMutation.isPending}
        onClick={() => resendMutation.mutate()}
        aria-label={`Resend invitation to ${invitation.email}`}
      >
        <RotateCw />
        Resend
      </LoadingButton>
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevokeOpen(true)}
          aria-label={`Revoke invitation for ${invitation.email}`}
        >
          <UserRoundX />
          Revoke
        </Button>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke invitation?</DialogTitle>
            <DialogDescription>
              The invitation link sent to {invitation.email} will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={revokeMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate()}
            >
              Revoke invitation
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function InvitationsTable({
  invitations,
}: {
  invitations: UserInvitationPublic[]
}) {
  return (
    <section className="space-y-3" aria-labelledby="invitations-heading">
      <div>
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Invitations
        </h2>
        <p className="text-sm text-muted-foreground">
          Invitations are separate from active user accounts.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Recipient</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.length ? (
              invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <Mail className="mt-0.5 size-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{invitation.email}</div>
                        {invitation.full_name && (
                          <div className="text-sm text-muted-foreground">
                            {invitation.full_name}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        invitation.is_superuser ? "default" : "secondary"
                      }
                    >
                      {invitation.is_superuser ? "Superuser" : "User"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(invitation.status)}>
                      {statusLabel(invitation.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={invitation.created_at}>
                      {formatDate(invitation.created_at)}
                    </time>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={invitation.expires_at}>
                      {formatDate(invitation.expires_at)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <InvitationActions invitation={invitation} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No invitations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

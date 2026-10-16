import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Mail, RotateCw, UserRoundX } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
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
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { getLocale } from "@/i18n/format"
import { handleError } from "@/utils"

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), {
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
  domainLabel("invitation", status)

function InvitationActions({
  invitation,
}: {
  invitation: UserInvitationPublic
}) {
  useTranslation()

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
    onSuccess: () => showSuccessToast(i18n.t("app:admin.invitation_resent")),
    onError: handleError.bind(showErrorToast),
    onSettled: refreshInvitations,
  })

  const revokeMutation = useMutation({
    mutationFn: () =>
      UserInvitationsService.revokeInvitation({
        invitationId: invitation.id,
      }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:admin.invitation_revoked"))
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
        aria-label={i18n.t("app:admin.resend_invitation_to", {
          value1: invitation.email,
        })}
      >
        <RotateCw />
        {i18n.t("app:admin.resend")}
      </LoadingButton>
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevokeOpen(true)}
          aria-label={i18n.t("app:admin.revoke_invitation_for", {
            value1: invitation.email,
          })}
        >
          <UserRoundX />
          {i18n.t("app:admin.revoke")}
        </Button>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{i18n.t("app:admin.revoke_invitation")}</DialogTitle>
            <DialogDescription>
              {i18n.t("app:admin.the_invitation_link_sent_to")}{" "}
              {invitation.email} {i18n.t("app:admin.will_stop_working")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={revokeMutation.isPending}>
                {i18n.t("app:admin.cancel")}
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate()}
            >
              {i18n.t("app:admin.revoke_invitation_aa0129")}
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
  useTranslation()

  return (
    <section className="space-y-3" aria-labelledby="invitations-heading">
      <div>
        <h2 id="invitations-heading" className="text-lg font-semibold">
          {i18n.t("app:admin.invitations")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:admin.invitations_are_separate_from_active_user_accounts",
          )}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{i18n.t("app:admin.recipient")}</TableHead>
              <TableHead>{i18n.t("app:admin.role")}</TableHead>
              <TableHead>{i18n.t("app:admin.status")}</TableHead>
              <TableHead>{i18n.t("app:admin.sent")}</TableHead>
              <TableHead>{i18n.t("app:admin.expires")}</TableHead>
              <TableHead className="text-right">
                {i18n.t("app:admin.actions")}
              </TableHead>
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
                      {invitation.is_superuser
                        ? i18n.t("app:admin.superuser")
                        : i18n.t("app:admin.user")}
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
                  {i18n.t("app:admin.no_invitations_yet")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

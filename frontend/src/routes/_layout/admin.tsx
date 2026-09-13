import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"

import { UserInvitationsService, type UserPublic, UsersService } from "@/client"
import { columns, type UserTableData } from "@/components/Admin/columns"
import { InvitationsTable } from "@/components/Admin/InvitationsTable"
import InviteUser from "@/components/Admin/InviteUser"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import useAuth from "@/hooks/useAuth"
import { CounterpartiesAdmin } from "@/routes/_layout/counterparties"

function getUsersQueryOptions() {
  return {
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
  }
}

function getInvitationsQueryOptions() {
  return {
    queryFn: () =>
      UserInvitationsService.listInvitations({ skip: 0, limit: 100 }),
    queryKey: ["user-invitations"],
  }
}

export const Route = createFileRoute("/_layout/admin")({
  component: Admin,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Admin - Oblidog",
      },
    ],
  }),
})

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function InvitationsTableContent() {
  const { data: invitations } = useSuspenseQuery(getInvitationsQueryOptions())
  return <InvitationsTable invitations={invitations.data} />
}

function AdminInvitations() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <InvitationsTableContent />
    </Suspense>
  )
}

function Admin() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            Manage user accounts, permissions, and invitations
          </p>
        </div>
        <InviteUser />
      </div>
      <AdminInvitations />
      <section className="space-y-3" aria-labelledby="accounts-heading">
        <div>
          <h2 id="accounts-heading" className="text-lg font-semibold">
            User accounts
          </h2>
          <p className="text-sm text-muted-foreground">
            People who have accepted an invitation and can sign in.
          </p>
        </div>
        <UsersTable />
      </section>
      <CounterpartiesAdmin />
    </div>
  )
}

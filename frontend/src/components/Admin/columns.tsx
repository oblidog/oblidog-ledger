import type { ColumnDef } from "@tanstack/react-table"
import type { UserPublic } from "@/client"
import type { DataTableFeatures } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import { i18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { UserActionsMenu } from "./UserActionsMenu"

export type UserTableData = UserPublic & {
  isCurrentUser: boolean
}

export const columns: ColumnDef<DataTableFeatures, UserTableData>[] = [
  {
    accessorKey: "full_name",
    header: () => i18n.t("app:admin.full_name"),
    cell: ({ row }) => {
      const fullName = row.original.full_name
      return (
        <div className="flex items-center gap-2">
          <span
            className={cn("font-medium", !fullName && "text-muted-foreground")}
          >
            {fullName || i18n.t("app:admin.n_a")}
          </span>
          {row.original.isCurrentUser && (
            <Badge variant="outline" className="text-xs">
              {i18n.t("app:admin.you")}
            </Badge>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "email",
    header: () => i18n.t("app:admin.email"),
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "is_superuser",
    header: () => i18n.t("app:admin.role"),
    cell: ({ row }) => (
      <Badge variant={row.original.is_superuser ? "default" : "secondary"}>
        {row.original.is_superuser
          ? i18n.t("app:admin.superuser")
          : i18n.t("app:admin.user")}
      </Badge>
    ),
  },
  {
    accessorKey: "is_active",
    header: () => i18n.t("app:admin.status"),
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            row.original.is_active ? "bg-green-500" : "bg-gray-400",
          )}
        />
        <span className={row.original.is_active ? "" : "text-muted-foreground"}>
          {row.original.is_active
            ? i18n.t("app:admin.active")
            : i18n.t("app:admin.inactive")}
        </span>
      </div>
    ),
  },
  {
    id: "actions",
    header: () => (
      <span className="sr-only">{i18n.t("app:admin.actions")}</span>
    ),
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UserActionsMenu user={row.original} />
      </div>
    ),
  },
]

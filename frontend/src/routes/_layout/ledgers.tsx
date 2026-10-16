import { createFileRoute, Outlet } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers")({
  component: Ledgers,
  head: () => ({ meta: [{ title: i18n.t("app:ledgers.ledgers_oblidog") }] }),
})

function Ledgers() {
  useTranslation()

  return <Outlet />
}

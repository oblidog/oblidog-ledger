import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"
import { useTranslation } from "react-i18next"
import AddLedger from "@/components/Ledgers/AddLedger"
import LedgerList from "@/components/Ledgers/LedgerList"
import PendingLedgers from "@/components/Ledgers/PendingLedgers"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/")({
  component: LedgersIndex,
})

function LedgersIndex() {
  useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {i18n.t("app:ledgers.ledgers")}
          </h1>
          <p className="text-muted-foreground">
            {i18n.t(
              "app:ledgers.keep_separate_workspaces_for_different_areas_of_your_finances",
            )}
          </p>
        </div>
        <AddLedger />
      </div>
      <Suspense fallback={<PendingLedgers />}>
        <LedgerList />
      </Suspense>
    </div>
  )
}

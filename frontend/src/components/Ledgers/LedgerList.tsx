import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowRight, BookOpen, Clock3 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { LedgersService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { i18n } from "@/i18n"
import { getLocale } from "@/i18n/format"

export function getLedgersQueryOptions() {
  return {
    queryFn: () => LedgersService.readLedgers(),
    queryKey: ["ledgers"],
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
  }).format(new Date(value))
}

export function LedgerList() {
  useTranslation()

  const { data } = useSuspenseQuery(getLedgersQueryOptions())

  if (data.data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <BookOpen className="mx-auto size-10 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">
          {i18n.t("app:ledgers.no_ledgers_yet")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {i18n.t(
            "app:ledgers.create_your_first_ledger_to_start_organizing_obligations",
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.data.map((ledger) => (
        <Link
          key={ledger.id}
          to="/ledgers/$ledgerId"
          params={{ ledgerId: ledger.id }}
          className="group"
        >
          <Card className="h-full transition-colors group-hover:border-primary/60">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle>{ledger.name}</CardTitle>
                <Badge variant="outline">{i18n.t("app:ledgers.ledger")}</Badge>
              </div>
              <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="min-h-10 text-sm text-muted-foreground">
                {ledger.description || i18n.t("app:ledgers.no_description")}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" />
                {i18n.t("app:ledgers.created")} {formatDate(ledger.created_at)}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}

export default LedgerList

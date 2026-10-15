export type DigestRow = {
  category_name: string
  amount_label: string
  amount_detail: string
  due_label: string
  link: string
}
export type DigestLedger = { name: string; obligations: DigestRow[] }
export type DigestSection = {
  title: string
  count: number
  ledgers: DigestLedger[]
}
export type DigestCurrency = {
  currency: string
  confirmed_label: string | null
  unconfirmed_label: string | null
  detail: string
}
export type Activity = {
  category_name: string
  actor_name: string
  messages: string[]
  omitted_changes: number
  link: string
}
export type Integration = {
  integration_name: string
  health: string
  detail: string
  last_success_at: string | null
  link: string
}
export type DailyContext = {
  project_name: string
  report_date: string
  digest: {
    summary_title: string
    summary_detail: string
    sections: DigestSection[]
    currencies: DigestCurrency[]
  }
  activity: Record<string, Activity[]>
  activity_truncated: boolean
  integration_health: Record<string, Integration[]>
  integration_health_truncated: boolean
}

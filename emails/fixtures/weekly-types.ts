/** Monetary values are decimal strings; preview code must not coerce to Number. */
export type WeeklyPayment = {
  category_name: string
  due_date: string
  amount: string | null
}
export type WeeklyCurrency = {
  currency: string | null
  total_known_amount: string
  paid_known_amount: string
  remaining_known_amount: string
  ready_count: number
  paid_count: number
  not_ready_count: number
  overdue_count: number
  overdue_known_amount: string
  paid_percentage: string | null
  incomplete_count: number
  total_is_complete: boolean
  previous_total_known_amount: string
  previous_total_is_complete: boolean
  total_change: string | null
  upcoming: WeeklyPayment[]
}
export type WeeklyContext = {
  project_name: string
  report_date: string
  period: string
  app_url?: string
  ledgers: { ledger_name: string; currencies: WeeklyCurrency[] }[]
}

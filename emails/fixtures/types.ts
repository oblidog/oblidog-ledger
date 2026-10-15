export type Obligation = {
  name: string
  due_label: string
  amount_label: string
  url: string
}
export type CurrencyGroup = {
  currency: string
  total_label: string
  obligations: Obligation[]
}
export type Ledger = { name: string; groups: CurrencyGroup[] }
export type Report = {
  project_name: string
  preheader: string
  title: string
  intro: string
  report_date: string
  summary: { label: string; value: string }
  notice: string | null
  ledgers: Ledger[]
  app_url: string
  footer_note: string
}

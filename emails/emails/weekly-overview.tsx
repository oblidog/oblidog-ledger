import {
  Column,
  Heading,
  Link,
  Row,
  Section,
  Text,
} from "@react-email/components"
import type { ReactNode } from "react"
import {
  EmailButton,
  EmailFooter,
  EmailHeading,
  EmailLayout,
  EmailSection,
  EmailSummary,
} from "../components/design-system"
import { type EmailLanguage, emailCopy } from "../components/i18n"
import type { JinjaTokens } from "../components/jinja"
import { TemplateIf, TemplateLoop } from "../components/template-control"
import normal from "../fixtures/weekly/normal.json"
import type {
  WeeklyContext,
  WeeklyCurrency,
  WeeklyPayment,
} from "../fixtures/weekly-types"

const detailStyle = {
  color: "#52645f",
  fontSize: "13px",
  lineHeight: "21px",
  margin: "6px 0",
  overflowWrap: "anywhere" as const,
  wordBreak: "break-word" as const,
}
const blankCurrency: WeeklyCurrency = {
  ...normal.ledgers[0].currencies[0],
  currency: null,
  upcoming: [],
}
const blankPayment: WeeklyPayment = {
  category_name: "",
  due_date: "",
  amount: null,
}

/** Preview formatting only; production amounts/dates use Python EmailLocale. */
function previewAmount(value: string | null, language: EmailLanguage): string {
  if (value === null) return emailCopy("unknown_amount_lower", language)
  const [whole, fraction = ""] = value.split(".")
  return `${whole}${language !== "en" ? "," : "."}${fraction.padEnd(2, "0")}`
}
function previewDate(value: string, language: EmailLanguage): string {
  return language !== "en" ? value.split("-").reverse().join(".") : value
}
function AmountMetric({
  label,
  value,
  end = false,
}: {
  label: string
  value: string
  end?: boolean
}) {
  return (
    <Column
      style={{
        width: "50%",
        verticalAlign: "top",
        padding: end ? "0 0 0 8px" : "0 8px 0 0",
      }}
    >
      <Text style={detailStyle}>{label}</Text>
      <Text
        style={{
          ...detailStyle,
          marginTop: "4px",
          fontSize: "18px",
          lineHeight: "26px",
          fontWeight: 700,
          color: "#182c2a",
        }}
      >
        {value}
      </Text>
    </Column>
  )
}
function MinorHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h4"
      style={{
        ...detailStyle,
        fontSize: "14px",
        fontWeight: 700,
        color: "#182c2a",
        marginTop: "18px",
      }}
    >
      {children}
    </Heading>
  )
}

export default function WeeklyOverviewEmail({
  context = normal,
  tokens,
  language = "en",
}: {
  context?: WeeklyContext
  tokens?: JinjaTokens
  language?: EmailLanguage
}) {
  const v = (expression: string, fallback: string | number | null) =>
    tokens ? tokens.expression(expression) : String(fallback ?? "")
  const t = (key: string) => v(`tr('${key}')`, emailCopy(key, language))
  const money = (expression: string, fallback: string | null) =>
    v(`fmt_amount(${expression})`, previewAmount(fallback, language))
  const projectName = v("project_name", context.project_name)
  const currencyName = (item: WeeklyCurrency) =>
    v(
      "item.currency or tr('currency_unspecified')",
      item.currency ?? emailCopy("currency_unspecified", language),
    )
  const amount = (
    field:
      | "total_known_amount"
      | "paid_known_amount"
      | "remaining_known_amount"
      | "overdue_known_amount"
      | "previous_total_known_amount",
    item: WeeklyCurrency,
  ) => money(`item.${field}`, item[field])
  return (
    <EmailLayout
      projectName={projectName}
      language={v("language", language)}
      preview={t("weekly_intro")}
      footer={
        <EmailFooter
          projectName={projectName}
          tagline={t("tagline")}
          note={t("weekly_footer")}
        />
      }
    >
      <EmailHeading
        eyebrow={`${t("period")}: ${v("period", language !== "en" ? context.period.split("-").reverse().join(".") : context.period)}`}
        intro={`${t("snapshot")}: ${v("report_date", previewDate(context.report_date, language))}`}
      >
        {t("weekly_subject")}
      </EmailHeading>
      <Text style={{ ...detailStyle, fontSize: "15px", lineHeight: "24px" }}>
        {t("weekly_intro")}
      </Text>
      <TemplateIf
        tokens={tokens}
        expression="weekly_size_notice"
        show={Boolean(context.weekly_size_notice)}
      >
        <Text style={detailStyle}>
          {v("weekly_size_notice", context.weekly_size_notice ?? "")}
        </Text>
        <Text style={detailStyle}>
          <Link
            href={v("app_url", context.app_url ?? "")}
            style={{ color: "#1c614d", textDecoration: "underline" }}
          >
            {t("open_data")} →
          </Link>
        </Text>
      </TemplateIf>
      <TemplateIf
        tokens={tokens}
        expression="not ledgers and not weekly_size_notice"
        show={!context.ledgers.length && !context.weekly_size_notice}
      >
        <Text style={detailStyle}>{t("weekly_empty")}</Text>
      </TemplateIf>
      <TemplateLoop
        tokens={tokens}
        expression="ledger in ledgers"
        items={context.ledgers}
        placeholder={{ ledger_name: "", currencies: [] }}
      >
        {(ledger) => (
          <EmailSection title={v("ledger.ledger_name", ledger.ledger_name)}>
            <TemplateIf
              tokens={tokens}
              expression="not ledger.currencies"
              show={!ledger.currencies.length}
            >
              <Text style={detailStyle}>{t("no_obligations")}</Text>
            </TemplateIf>
            <TemplateLoop
              tokens={tokens}
              expression="item in ledger.currencies"
              items={ledger.currencies}
              placeholder={blankCurrency}
            >
              {(item) => (
                <Section
                  style={{
                    border: "1px solid #e1e8e3",
                    borderRadius: "8px",
                    padding: "16px",
                    marginTop: "16px",
                  }}
                >
                  <Heading
                    as="h3"
                    style={{
                      ...detailStyle,
                      margin: "0 0 12px",
                      fontSize: "16px",
                      fontWeight: 700,
                      color: "#182c2a",
                    }}
                  >
                    {currencyName(item)}
                  </Heading>
                  <EmailSummary
                    label={t("total_known")}
                    value={`${amount("total_known_amount", item)} ${v("item.currency or ''", item.currency)}`}
                  />
                  <TemplateIf
                    tokens={tokens}
                    expression="not item.total_is_complete"
                    show={!item.total_is_complete}
                  >
                    <Text style={{ ...detailStyle, color: "#87531a" }}>
                      <strong>{t("incomplete")}</strong>{" "}
                      {t("weekly_incomplete_notice")}
                    </Text>
                  </TemplateIf>
                  <Row
                    style={{
                      marginTop: "12px",
                      tableLayout: "fixed",
                      width: "100%",
                    }}
                  >
                    <AmountMetric
                      label={t("paid_known")}
                      value={amount("paid_known_amount", item)}
                    />
                    <AmountMetric
                      label={t("remaining_known")}
                      value={amount("remaining_known_amount", item)}
                      end
                    />
                  </Row>
                  <Text style={detailStyle}>
                    {t("ready")}: {v("item.ready_count", item.ready_count)} ·{" "}
                    {t("paid")}: {v("item.paid_count", item.paid_count)} ·{" "}
                    {t("not_ready")}:{" "}
                    {v("item.not_ready_count", item.not_ready_count)}
                  </Text>
                  <Text style={detailStyle}>
                    {t("weekly_count_progress")}:{" "}
                    <strong>
                      {v(
                        "fmt_amount(item.paid_percentage) ~ '%' if item.paid_percentage is not none else tr('na')",
                        item.paid_percentage === null
                          ? emailCopy("na", language)
                          : `${previewAmount(item.paid_percentage, language)}%`,
                      )}
                    </strong>
                  </Text>
                  <Text
                    style={{
                      ...detailStyle,
                      color: "#8a3b26",
                      borderTop: "1px solid #e1e8e3",
                      paddingTop: "12px",
                      marginTop: "12px",
                    }}
                  >
                    <strong>
                      {t("section_overdue")}:{" "}
                      {v("item.overdue_count", item.overdue_count)}
                    </strong>{" "}
                    · {amount("overdue_known_amount", item)}{" "}
                    {v("item.currency or ''", item.currency)}
                  </Text>
                  <Text style={detailStyle}>
                    {t("unknown_values")}:{" "}
                    {v("item.incomplete_count", item.incomplete_count)}
                  </Text>
                  <MinorHeading>{t("weekly_comparison")}</MinorHeading>
                  <Text style={detailStyle}>
                    {t("previous_total")}:{" "}
                    {amount("previous_total_known_amount", item)}
                    <TemplateIf
                      tokens={tokens}
                      expression="not item.previous_total_is_complete"
                      show={!item.previous_total_is_complete}
                    >
                      {" "}
                      {t("incomplete")}
                    </TemplateIf>
                  </Text>
                  <Text style={detailStyle}>
                    {t("change_previous")}:{" "}
                    {v(
                      "fmt_amount(item.total_change) if item.total_change is not none else tr('na_incomplete')",
                      item.total_change === null
                        ? emailCopy("na_incomplete", language)
                        : previewAmount(item.total_change, language),
                    )}
                  </Text>
                  <MinorHeading>{t("upcoming")}</MinorHeading>
                  <TemplateIf
                    tokens={tokens}
                    expression="not item.upcoming and not item.upcoming_omitted"
                    show={!item.upcoming.length && !item.upcoming_omitted}
                  >
                    <Text style={detailStyle}>{t("none")}</Text>
                  </TemplateIf>
                  <TemplateLoop
                    tokens={tokens}
                    expression="obligation in item.upcoming"
                    items={item.upcoming}
                    placeholder={blankPayment}
                  >
                    {(obligation) => (
                      <Text
                        style={{
                          ...detailStyle,
                          borderTop: "1px solid #e1e8e3",
                          paddingTop: "10px",
                          marginTop: "10px",
                        }}
                      >
                        <strong>
                          {v(
                            "obligation.category_name",
                            obligation.category_name,
                          )}
                        </strong>
                        <br />
                        {v(
                          "fmt_date(obligation.due_date)",
                          previewDate(obligation.due_date, language),
                        )}{" "}
                        · {money("obligation.amount", obligation.amount)}{" "}
                        {v("item.currency or ''", item.currency)}
                      </Text>
                    )}
                  </TemplateLoop>
                  <TemplateIf
                    tokens={tokens}
                    expression="item.upcoming_omitted"
                    show={Boolean(item.upcoming_omitted)}
                  >
                    <Text style={detailStyle}>
                      {v(
                        "tr('weekly_upcoming_omitted', shown=item.upcoming|length, total=(item.upcoming|length)+item.upcoming_omitted)",
                        emailCopy("weekly_upcoming_omitted", language, {
                          shown: item.upcoming.length,
                          total:
                            item.upcoming.length + (item.upcoming_omitted ?? 0),
                        }),
                      )}
                    </Text>
                  </TemplateIf>
                </Section>
              )}
            </TemplateLoop>
          </EmailSection>
        )}
      </TemplateLoop>
      <TemplateIf
        tokens={tokens}
        expression="app_url"
        show={Boolean(context.app_url)}
      >
        <EmailButton href={v("app_url", context.app_url ?? "")}>
          {t("open_oblidog")}
        </EmailButton>
      </TemplateIf>
    </EmailLayout>
  )
}
WeeklyOverviewEmail.PreviewProps = { context: normal }

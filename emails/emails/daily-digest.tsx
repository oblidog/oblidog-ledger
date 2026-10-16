import { Heading, Link, Text } from "@react-email/components"
import {
  EmailFooter,
  EmailHeading,
  EmailLayout,
  EmailSection,
  EmailSummary,
  ObligationRow,
} from "../components/design-system"
import { type EmailLanguage, emailCopy } from "../components/i18n"
import type { JinjaTokens } from "../components/jinja"
import { TemplateIf, TemplateLoop } from "../components/template-control"
import normal from "../fixtures/daily/normal.json"
import type {
  Activity,
  DailyContext,
  DigestCurrency,
  DigestLedger,
  DigestRow,
  DigestSection,
  Integration,
} from "../fixtures/daily-types"

const blankRow: DigestRow = {
  category_name: "",
  amount_label: "",
  amount_detail: "",
  due_label: "",
  link: "",
}
const blankLedger: DigestLedger = { name: "", obligations: [] }
const blankSection: DigestSection = { title: "", count: 0, ledgers: [] }
const blankCurrency: DigestCurrency = {
  currency: "",
  confirmed_label: null,
  unconfirmed_label: null,
  detail: "",
}
const blankActivity: Activity = {
  category_name: "",
  actor_name: "",
  messages: [],
  omitted_changes: 0,
  link: "",
}
const blankIntegration: Integration = {
  integration_name: "",
  health: "",
  detail: "",
  last_success_at: null,
  link: "",
}
const ledgerStyle = {
  fontSize: "14px",
  lineHeight: "22px",
  margin: "20px 0 4px",
  color: "#52645f",
  overflowWrap: "anywhere" as const,
}
const textStyle = {
  fontSize: "13px",
  lineHeight: "21px",
  color: "#52645f",
  margin: "4px 0",
  overflowWrap: "anywhere" as const,
}
const linkStyle = { color: "#1c614d", textDecoration: "underline" }

export default function DailyDigestEmail({
  context = normal,
  tokens,
  language = "en",
}: {
  context?: DailyContext
  tokens?: JinjaTokens
  language?: EmailLanguage
}) {
  const v = (expression: string, fallback: string | number | null) =>
    tokens ? tokens.expression(expression) : String(fallback ?? "")
  const t = (key: string, params: Record<string, string | number> = {}) =>
    v(`tr('${key}')`, emailCopy(key, language, params))
  const { digest } = context
  const projectName = v("project_name", context.project_name)
  return (
    <EmailLayout
      projectName={projectName}
      language={v("language", language)}
      preview={v("digest.summary_title", digest.summary_title)}
      footer={
        <EmailFooter
          projectName={projectName}
          tagline={t("tagline")}
          note={t("daily_footer")}
        />
      }
    >
      <EmailHeading
        eyebrow={v("report_date", context.report_date)}
        intro={t("daily_intro")}
      >
        {t("daily_title")}
      </EmailHeading>
      <TemplateIf
        tokens={tokens}
        expression="size_notice"
        show={Boolean(context.size_notice)}
      >
        <Text style={textStyle}>
          {v("size_notice", context.size_notice ?? "")}
        </Text>
        <Text style={textStyle}>
          <Link href={v("app_url", context.app_url ?? "")} style={linkStyle}>
            {t("open_data")} →
          </Link>
        </Text>
      </TemplateIf>
      <EmailSummary
        label={t("attention_label")}
        value={v("digest.summary_title", digest.summary_title)}
      />
      <Text style={{ ...textStyle, margin: "12px 0 0" }}>
        {v("digest.summary_detail", digest.summary_detail)}
      </Text>

      <TemplateLoop
        tokens={tokens}
        expression="section in digest.sections"
        items={digest.sections}
        placeholder={blankSection}
      >
        {(section) => (
          <EmailSection
            title={`${v("section.title", section.title)} · ${v("section.count", section.count)}`}
          >
            <TemplateIf
              tokens={tokens}
              expression="section.omitted_count"
              show={Boolean(section.omitted_count)}
            >
              <Text style={textStyle}>
                {v(
                  "tr('section_omitted', shown=section.count-section.omitted_count, total=section.count)",
                  emailCopy("section_omitted", language, {
                    shown: section.count - (section.omitted_count ?? 0),
                    total: section.count,
                  }),
                )}
              </Text>
            </TemplateIf>
            <TemplateLoop
              tokens={tokens}
              expression="ledger in section.ledgers"
              items={section.ledgers}
              placeholder={blankLedger}
            >
              {(ledger) => (
                <>
                  <Heading as="h3" style={ledgerStyle}>
                    {v("ledger.name", ledger.name)}
                  </Heading>
                  <TemplateLoop
                    tokens={tokens}
                    expression="row in ledger.obligations"
                    items={ledger.obligations}
                    placeholder={blankRow}
                  >
                    {(row) => (
                      <ObligationRow
                        name={v("row.category_name", row.category_name)}
                        due={v("row.due_label", row.due_label)}
                        amount={v("row.amount_label", row.amount_label)}
                        amountDetail={v("row.amount_detail", row.amount_detail)}
                        href={v("row.link", row.link)}
                        actionLabel={`${t("view_obligation")} →`}
                      />
                    )}
                  </TemplateLoop>
                </>
              )}
            </TemplateLoop>
          </EmailSection>
        )}
      </TemplateLoop>

      <TemplateIf
        tokens={tokens}
        expression="integration_health or integration_health_truncated"
        show={Boolean(
          Object.keys(context.integration_health).length ||
            context.integration_health_truncated,
        )}
      >
        <EmailSection title={t("health_title")}>
          <TemplateLoop<[string, Integration[]]>
            tokens={tokens}
            expression="ledger_name, entries in integration_health.items()"
            items={Object.entries(context.integration_health)}
            placeholder={["", []]}
          >
            {([ledgerName, entries]) => (
              <>
                <Heading as="h3" style={ledgerStyle}>
                  {v("ledger_name", ledgerName)}
                </Heading>
                <TemplateLoop
                  tokens={tokens}
                  expression="entry in entries"
                  items={entries}
                  placeholder={blankIntegration}
                >
                  {(entry) => (
                    <>
                      <Text
                        style={{
                          ...textStyle,
                          fontWeight: 700,
                          marginTop: "14px",
                        }}
                      >
                        <Link
                          href={v("entry.link", entry.link)}
                          style={linkStyle}
                        >
                          {v("entry.integration_name", entry.integration_name)}
                        </Link>
                        {" · "}
                        {v(
                          "tr('health_' + entry.health)",
                          emailCopy(
                            `health_${entry.health || "error"}`,
                            language,
                          ),
                        )}
                      </Text>
                      <Text style={textStyle}>
                        {v("entry.detail", entry.detail)}
                      </Text>
                      <TemplateIf
                        tokens={tokens}
                        expression="entry.last_success_at"
                        show={Boolean(entry.last_success_at)}
                      >
                        <Text style={textStyle}>
                          {t("last_success")}:{" "}
                          {v("entry.last_success_at", entry.last_success_at)}
                        </Text>
                      </TemplateIf>
                    </>
                  )}
                </TemplateLoop>
              </>
            )}
          </TemplateLoop>
          <TemplateIf
            tokens={tokens}
            expression="integration_health_truncated"
            show={context.integration_health_truncated}
          >
            <Text style={textStyle}>{t("health_omitted")}</Text>
          </TemplateIf>
        </EmailSection>
      </TemplateIf>

      <TemplateIf
        tokens={tokens}
        expression="digest.currencies"
        show={Boolean(digest.currencies.length)}
      >
        <EmailSection title={t("amounts_title")}>
          <Text style={textStyle}>{t("amounts_intro")}</Text>
          <TemplateLoop
            tokens={tokens}
            expression="currency in digest.currencies"
            items={digest.currencies}
            placeholder={blankCurrency}
          >
            {(currency) => (
              <>
                <Heading as="h3" style={ledgerStyle}>
                  {v("currency.currency", currency.currency)}
                </Heading>
                <TemplateIf
                  tokens={tokens}
                  expression="currency.confirmed_label"
                  show={Boolean(currency.confirmed_label)}
                >
                  <Text style={textStyle}>
                    {v("currency.confirmed_label", currency.confirmed_label)}
                  </Text>
                </TemplateIf>
                <TemplateIf
                  tokens={tokens}
                  expression="currency.unconfirmed_label"
                  show={Boolean(currency.unconfirmed_label)}
                >
                  <Text style={textStyle}>
                    {v(
                      "currency.unconfirmed_label",
                      currency.unconfirmed_label,
                    )}
                  </Text>
                </TemplateIf>
                <Text style={textStyle}>
                  {v("currency.detail", currency.detail)}
                </Text>
              </>
            )}
          </TemplateLoop>
        </EmailSection>
      </TemplateIf>

      <TemplateIf
        tokens={tokens}
        expression="activity or activity_truncated"
        show={Boolean(
          Object.keys(context.activity).length || context.activity_truncated,
        )}
      >
        <EmailSection title={t("activity_title")}>
          <TemplateLoop<[string, Activity[]]>
            tokens={tokens}
            expression="ledger_name, entries in activity.items()"
            items={Object.entries(context.activity)}
            placeholder={["", []]}
          >
            {([ledgerName, entries]) => (
              <>
                <Heading as="h3" style={ledgerStyle}>
                  {v("ledger_name", ledgerName)}
                </Heading>
                <TemplateLoop
                  tokens={tokens}
                  expression="entry in entries"
                  items={entries}
                  placeholder={blankActivity}
                >
                  {(entry) => (
                    <>
                      <Text
                        style={{
                          ...textStyle,
                          fontWeight: 700,
                          marginTop: "14px",
                        }}
                      >
                        <Link
                          href={v("entry.link", entry.link)}
                          style={linkStyle}
                        >
                          {v("entry.category_name", entry.category_name)}
                        </Link>
                      </Text>
                      <Text style={textStyle}>
                        {v(
                          "tr('updated_by', actor=entry.actor_name)",
                          emailCopy("updated_by", language, {
                            actor: entry.actor_name,
                          }),
                        )}
                      </Text>
                      <ul style={{ ...textStyle, paddingLeft: "20px" }}>
                        <TemplateLoop
                          tokens={tokens}
                          expression="message in entry.messages"
                          items={entry.messages}
                          placeholder=""
                        >
                          {(message) => (
                            <li style={{ paddingBottom: "4px" }}>
                              {v("message", message)}
                            </li>
                          )}
                        </TemplateLoop>
                      </ul>
                      <TemplateIf
                        tokens={tokens}
                        expression="entry.omitted_changes"
                        show={Boolean(entry.omitted_changes)}
                      >
                        <Text style={textStyle}>
                          {v(
                            "tr('more_changes', count=entry.omitted_changes)",
                            emailCopy("more_changes", language, {
                              count: entry.omitted_changes,
                            }),
                          )}
                        </Text>
                      </TemplateIf>
                    </>
                  )}
                </TemplateLoop>
              </>
            )}
          </TemplateLoop>
          <TemplateIf
            tokens={tokens}
            expression="activity_truncated"
            show={context.activity_truncated}
          >
            <Text style={textStyle}>{t("activity_omitted")}</Text>
          </TemplateIf>
        </EmailSection>
      </TemplateIf>
    </EmailLayout>
  )
}

DailyDigestEmail.PreviewProps = { context: normal }

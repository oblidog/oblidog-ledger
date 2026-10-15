import { Heading, Text } from "@react-email/components"
import type { ReactNode } from "react"
import {
  EmailButton,
  EmailFooter,
  EmailHeading,
  EmailLayout,
  EmailSection,
  EmailSummary,
  ObligationRow,
} from "../components/design-system"
import type { JinjaTokens } from "../components/jinja"
import normal from "../fixtures/normal.json"
import type { Report } from "../fixtures/types"

function CurrencySection({
  currency,
  total,
  children,
}: {
  currency: string
  total: string
  children: ReactNode
}) {
  return (
    <>
      <Heading
        as="h3"
        style={{
          fontSize: "13px",
          lineHeight: "20px",
          color: "#52645f",
          margin: "20px 0 0",
        }}
      >
        {currency}
      </Heading>
      <Text
        style={{
          fontSize: "13px",
          lineHeight: "20px",
          margin: "4px 0 0",
          color: "#52645f",
        }}
      >
        {total}
      </Text>
      {children}
    </>
  )
}

const emptyMessage = (
  <Text
    style={{
      fontSize: "15px",
      lineHeight: "24px",
      color: "#52645f",
      margin: "24px 0 0",
    }}
  >
    No obligations in this snapshot.
  </Text>
)

/** An integration example, not the daily/weekly report selection or calculation. */
export default function FoundationEmail({
  report = normal,
  tokens,
}: {
  report?: Report
  tokens?: JinjaTokens
}) {
  const value = (expression: string, fallback: string) =>
    tokens ? tokens.expression(expression) : fallback
  const notice = (
    <Text
      style={{
        fontSize: "14px",
        lineHeight: "22px",
        color: "#52645f",
        margin: "20px 0 0",
      }}
    >
      {value("report.notice", report.notice ?? "")}
    </Text>
  )
  const ledgers = tokens ? (
    <>
      {tokens.code("{% for ledger in report.ledgers %}")}
      <EmailSection title={tokens.expression("ledger.name")}>
        {tokens.code("{% for group in ledger.groups %}")}
        <CurrencySection
          currency={tokens.expression("group.currency")}
          total={tokens.expression("group.total_label")}
        >
          {tokens.code("{% for obligation in group.obligations %}")}
          <ObligationRow
            name={tokens.expression("obligation.name")}
            due={tokens.expression("obligation.due_label")}
            amount={tokens.expression("obligation.amount_label")}
            href={tokens.expression("obligation.url")}
          />
          {tokens.code("{% endfor %}")}
        </CurrencySection>
        {tokens.code("{% endfor %}")}
      </EmailSection>
      {tokens.code("{% else %}")}
      {emptyMessage}
      {tokens.code("{% endfor %}")}
    </>
  ) : report.ledgers.length ? (
    report.ledgers.map((ledger, ledgerIndex) => (
      <EmailSection key={`${ledgerIndex}-${ledger.name}`} title={ledger.name}>
        {ledger.groups.map((group) => (
          <CurrencySection
            key={group.currency}
            currency={group.currency}
            total={group.total_label}
          >
            {group.obligations.map((obligation) => (
              <ObligationRow
                key={obligation.url}
                name={obligation.name}
                due={obligation.due_label}
                amount={obligation.amount_label}
                href={obligation.url}
              />
            ))}
          </CurrencySection>
        ))}
      </EmailSection>
    ))
  ) : (
    emptyMessage
  )
  const projectName = value("report.project_name", report.project_name)
  return (
    <EmailLayout
      preview={value("report.preheader", report.preheader)}
      projectName={projectName}
      footer={
        <EmailFooter
          projectName={projectName}
          note={value("report.footer_note", report.footer_note)}
        />
      }
    >
      <EmailHeading
        eyebrow={value("report.report_date", report.report_date)}
        intro={value("report.intro", report.intro)}
      >
        {value("report.title", report.title)}
      </EmailHeading>
      <EmailSummary
        label={value("report.summary.label", report.summary.label)}
        value={value("report.summary.value", report.summary.value)}
      />
      {tokens ? (
        <>
          {tokens.code("{% if report.notice %}")}
          {notice}
          {tokens.code("{% endif %}")}
        </>
      ) : report.notice ? (
        notice
      ) : null}
      {ledgers}
      <EmailButton href={value("report.app_url", report.app_url)}>
        Open Oblidog
      </EmailButton>
    </EmailLayout>
  )
}

FoundationEmail.PreviewProps = { report: normal }

import { Link, Section, Text } from "@react-email/components"
import normal from "../fixtures/transactional/normal.json"
import type {
  TransactionalContext,
  TransactionalKind,
} from "../fixtures/transactional-types"
import {
  EmailButton,
  EmailFooter,
  EmailHeading,
  EmailLayout,
} from "./design-system"
import { type EmailLanguage, emailCopy } from "./i18n"
import type { JinjaTokens } from "./jinja"
import { TemplateIf } from "./template-control"

export type TransactionalProps = {
  context?: TransactionalContext
  tokens?: JinjaTokens
  language?: EmailLanguage
}
const textStyle = {
  color: "#52645f",
  fontSize: "14px",
  lineHeight: "23px",
  margin: "16px 0 0",
  overflowWrap: "anywhere" as const,
  wordBreak: "break-word" as const,
}
const titles: Record<TransactionalKind, string> = {
  reset_password: "reset_title",
  user_invitation: "invitation_subject",
  new_account: "new_title",
  test_email: "test_subject",
}
const actions: Record<Exclude<TransactionalKind, "test_email">, string> = {
  reset_password: "reset_action",
  user_invitation: "invitation_action",
  new_account: "dashboard_action",
}

/** Kind is fixed at build time; recipient values remain escaped Jinja context. */
export function TransactionalEmail({
  kind,
  context = normal[kind],
  tokens,
  language = "en",
}: TransactionalProps & { kind: TransactionalKind }) {
  const v = (
    expression: string,
    fallback: string | number | null | undefined,
  ) => (tokens ? tokens.expression(expression) : String(fallback ?? ""))
  const t = (key: string) => v(`tr('${key}')`, emailCopy(key, language))
  const projectName = v("project_name", context.project_name)
  const intro =
    kind === "reset_password"
      ? v(
          "tr('hello', username=username or email)",
          emailCopy("hello", language, {
            username: context.username || context.email,
          }),
        )
      : kind === "user_invitation"
        ? v(
            "tr('invitation_intro', email=email)",
            emailCopy("invitation_intro", language, { email: context.email }),
          )
        : kind === "test_email"
          ? v(
              "tr('test_for', email=email)",
              emailCopy("test_for", language, { email: context.email }),
            )
          : t("new_welcome")
  const footer =
    kind === "reset_password"
      ? t("reset_ignore")
      : kind === "user_invitation"
        ? t("invitation_ignore")
        : v(
            "tr('transactional_footer', project_name=project_name)",
            emailCopy("transactional_footer", language, {
              project_name: context.project_name,
            }),
          )
  return (
    <EmailLayout
      projectName={projectName}
      language={v("language", language)}
      preview={t(titles[kind])}
      footer={
        <EmailFooter
          projectName={projectName}
          tagline={t("tagline")}
          note={footer}
        />
      }
    >
      <EmailHeading eyebrow={t("transactional_eyebrow")} intro={intro}>
        {t(titles[kind])}
      </EmailHeading>
      {kind === "reset_password" ? (
        <Text style={textStyle}>{t("reset_intro")}</Text>
      ) : null}
      {kind === "test_email" ? (
        <Text style={textStyle}>{t("test_delivery_ok")}</Text>
      ) : (
        <>
          {kind === "new_account" ? (
            <>
              <Text style={textStyle}>{t("new_details")}</Text>
              <Section
                style={{
                  backgroundColor: "#eaf3ed",
                  padding: "16px 20px",
                  marginTop: "16px",
                  borderLeft: "3px solid #26705d",
                }}
              >
                <TemplateIf
                  tokens={tokens}
                  expression="username"
                  show={Boolean(context.username)}
                >
                  <Text style={{ ...textStyle, margin: 0 }}>
                    <strong>{t("username")}:</strong>{" "}
                    {v("username", context.username)}
                  </Text>
                </TemplateIf>
                <Text style={{ ...textStyle, margin: 0 }}>
                  <strong>{t("password")}:</strong>{" "}
                  {v("password", context.password)}
                </Text>
              </Section>
            </>
          ) : null}
          <EmailButton href={v("link", context.link)}>
            {t(actions[kind])}
          </EmailButton>
          <Text style={textStyle}>
            {t("copy_link")}
            <br />
            <Link
              href={v("link", context.link)}
              style={{
                color: "#1c614d",
                textDecoration: "underline",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {v("link", context.link)}
            </Link>
          </Text>
          {kind === "reset_password" || kind === "user_invitation" ? (
            <Text
              style={{
                ...textStyle,
                backgroundColor: "#f0f4f1",
                padding: "12px 16px",
              }}
            >
              {v(
                `tr('${kind === "reset_password" ? "reset_expiry" : "invitation_expiry"}', count=valid_hours)`,
                emailCopy(
                  kind === "reset_password"
                    ? "reset_expiry"
                    : "invitation_expiry",
                  language,
                  { count: context.valid_hours ?? 48 },
                ),
              )}
            </Text>
          ) : null}
        </>
      )}
    </EmailLayout>
  )
}

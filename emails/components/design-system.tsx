import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import type { ReactNode } from "react"

const ink = "#182c2a"
const muted = "#52645f"
const font = "Arial, Helvetica, sans-serif"

export function EmailLayout({
  preview,
  projectName,
  children,
  footer,
  language = "en",
}: {
  preview: string
  projectName: string
  children: ReactNode
  footer: ReactNode
  language?: string
}) {
  return (
    <Html lang={language}>
      <Head>
        <meta name="color-scheme" content="light" />
        <style>{`@media only screen and (max-width: 480px) { .email-content { padding: 24px 20px !important; } .email-shell { padding: 16px 8px !important; } }`}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#f0f4f1",
          color: ink,
          fontFamily: font,
        }}
      >
        <Section className="email-shell" style={{ padding: "32px 12px" }}>
          <Container
            style={{
              maxWidth: "600px",
              width: "100%",
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              borderTop: "4px solid #26705d",
            }}
          >
            <Section
              className="email-content"
              style={{ padding: "36px 36px 28px" }}
            >
              <Text
                style={{
                  margin: "0 0 28px",
                  fontSize: "22px",
                  lineHeight: "28px",
                  fontWeight: 700,
                  letterSpacing: "-0.5px",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {projectName}
              </Text>
              {children}
              <Hr style={{ borderColor: "#e1e8e3", margin: "32px 0 20px" }} />
              {footer}
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  )
}

export function EmailHeading({
  eyebrow,
  children,
  intro,
}: {
  eyebrow: string
  children: ReactNode
  intro: string
}) {
  return (
    <>
      <Text
        style={{
          color: muted,
          fontSize: "12px",
          lineHeight: "18px",
          letterSpacing: "1px",
          textTransform: "uppercase",
          margin: "0 0 8px",
        }}
      >
        {eyebrow}
      </Text>
      <Heading
        as="h1"
        style={{
          color: ink,
          fontSize: "28px",
          lineHeight: "36px",
          letterSpacing: "-0.5px",
          margin: "0 0 12px",
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </Heading>
      <Text
        style={{
          color: muted,
          fontSize: "15px",
          lineHeight: "24px",
          margin: "0 0 24px",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {intro}
      </Text>
    </>
  )
}

export function EmailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Section style={{ marginTop: "28px" }}>
      <Heading
        as="h2"
        style={{
          margin: "0 0 12px",
          fontSize: "19px",
          lineHeight: "27px",
          color: ink,
          overflowWrap: "anywhere",
        }}
      >
        {title}
      </Heading>
      {children}
    </Section>
  )
}

export function EmailSummary({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <Section
      style={{
        backgroundColor: "#eaf3ed",
        borderLeft: "3px solid #26705d",
        padding: "16px 20px",
      }}
    >
      <Text
        style={{
          color: muted,
          fontSize: "13px",
          lineHeight: "20px",
          margin: 0,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: ink,
          fontSize: "24px",
          lineHeight: "32px",
          fontWeight: 700,
          margin: "4px 0 0",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </Text>
    </Section>
  )
}

export function ObligationRow({
  name,
  due,
  amount,
  href,
  amountDetail,
  actionLabel,
}: {
  name: string
  due: string
  amount: string
  href: string
  amountDetail?: string
  actionLabel?: string
}) {
  return (
    <Section style={{ borderBottom: "1px solid #e1e8e3", padding: "14px 0" }}>
      <Text
        style={{
          margin: "0 0 4px",
          fontSize: "15px",
          lineHeight: "23px",
          fontWeight: 700,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        <Link
          href={href}
          style={{ color: "#1c614d", textDecoration: "underline" }}
        >
          {name}
        </Link>
      </Text>
      <Text
        style={{
          margin: 0,
          color: muted,
          fontSize: "13px",
          lineHeight: "21px",
          overflowWrap: "anywhere",
        }}
      >
        {due}
      </Text>
      <Text
        style={{
          margin: "6px 0 0",
          color: ink,
          fontSize: "16px",
          lineHeight: "24px",
          fontWeight: 700,
          overflowWrap: "anywhere",
        }}
      >
        {amount}
      </Text>
      {amountDetail ? (
        <Text
          style={{
            margin: "2px 0 0",
            color: muted,
            fontSize: "12px",
            lineHeight: "19px",
          }}
        >
          {amountDetail}
        </Text>
      ) : null}
      {actionLabel ? (
        <Text
          style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: "20px" }}
        >
          <Link
            href={href}
            style={{ color: "#1c614d", textDecoration: "underline" }}
          >
            {actionLabel}
          </Link>
        </Text>
      ) : null}
    </Section>
  )
}

export function EmailButton({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Section style={{ marginTop: "28px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: "#1c614d",
          color: "#ffffff",
          borderRadius: "6px",
          padding: "13px 20px",
          fontSize: "14px",
          lineHeight: "20px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  )
}

export function EmailFooter({
  projectName,
  note,
  tagline = "Keep your payments on a leash.",
}: {
  projectName: string
  note: string
  tagline?: string
}) {
  return (
    <Text
      style={{
        color: muted,
        fontSize: "12px",
        lineHeight: "19px",
        margin: 0,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {projectName} · {tagline}
      <br />
      {note}
    </Text>
  )
}

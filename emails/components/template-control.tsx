import { Fragment, type ReactNode } from "react"
import type { JinjaTokens } from "./jinja"

/** Shared structure for previews and export; expressions are developer-owned. */
export function TemplateLoop<T>({
  tokens,
  expression,
  items,
  placeholder,
  children,
}: {
  tokens?: JinjaTokens
  expression: string
  items: readonly T[]
  placeholder: T
  children: (item: T) => ReactNode
}) {
  return tokens ? (
    <>
      {tokens.code(`{% for ${expression} %}`)}
      {children(placeholder)}
      {tokens.code("{% endfor %}")}
    </>
  ) : (
    items.map((item, index) => (
      <Fragment key={index}>{children(item)}</Fragment>
    ))
  )
}

export function TemplateIf({
  tokens,
  expression,
  show,
  children,
}: {
  tokens?: JinjaTokens
  expression: string
  show: boolean
  children: ReactNode
}) {
  return tokens ? (
    <>
      {tokens.code(`{% if ${expression} %}`)}
      {children}
      {tokens.code("{% endif %}")}
    </>
  ) : show ? (
    children
  ) : null
}

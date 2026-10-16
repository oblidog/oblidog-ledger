import { useRouterState } from "@tanstack/react-router"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { resources } from "./index"

const titles = Object.entries(resources.en.app).flatMap(([feature, entries]) =>
  Object.entries(entries)
    .filter(([, text]) => text.endsWith("- Oblidog"))
    .map(([key, en]) => ({
      en,
      pl: (resources.pl.app as Record<string, Record<string, string>>)[feature][
        key
      ],
    })),
)

export function LocalizedPageTitle() {
  const { i18n } = useTranslation()
  const title = useRouterState({
    select: (state) =>
      state.matches
        .flatMap((match) => match.meta ?? [])
        .map((meta) => meta?.title)
        .filter(Boolean)
        .slice(-1)[0],
  })
  useEffect(() => {
    const entry = titles.find((item) => item.en === title || item.pl === title)
    document.title = entry
      ? i18n.resolvedLanguage === "pl"
        ? entry.pl
        : entry.en
      : (title ?? "Oblidog")
  }, [title, i18n.resolvedLanguage])
  return null
}

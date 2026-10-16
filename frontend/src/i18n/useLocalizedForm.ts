import { useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

/** Revalidate only visible errors; keep values, focus and dirty/touched state. */
export const useLocalizedForm: typeof useForm = (props) => {
  const form = useForm(props)
  const { i18n } = useTranslation()
  const previous = useRef(i18n.resolvedLanguage)
  const errors = form.formState.errors
  useEffect(() => {
    if (previous.current === i18n.resolvedLanguage) return
    previous.current = i18n.resolvedLanguage
    const names: string[] = []
    const collect = (value: unknown, prefix: string) => {
      if (!value || typeof value !== "object") return
      if ("type" in value && "message" in value) {
        names.push(prefix)
        return
      }
      for (const [key, child] of Object.entries(value)) {
        if (key !== "ref") collect(child, prefix ? `${prefix}.${key}` : key)
      }
    }
    collect(errors, "")
    if (names.length)
      void form.trigger(names as Parameters<typeof form.trigger>[0], {
        shouldFocus: false,
      })
  }, [i18n.resolvedLanguage, errors, form.trigger])
  return form
}

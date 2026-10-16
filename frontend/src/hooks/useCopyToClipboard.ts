// source: https://usehooks-ts.com/react-hook/use-copy-to-clipboard
import { useCallback, useState } from "react"
import { i18n } from "@/i18n"

type CopiedValue = string | null

type CopyFn = (text: string) => Promise<boolean>

export function useCopyToClipboard(): [CopiedValue, CopyFn] {
  const [copiedText, setCopiedText] = useState<CopiedValue>(null)

  const copy: CopyFn = useCallback(async (text) => {
    if (!navigator?.clipboard) {
      console.warn(i18n.t("app:common.clipboard_not_supported"))
      return false
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)

      setTimeout(() => setCopiedText(null), 2000)

      return true
    } catch (error) {
      console.warn(i18n.t("app:common.copy_failed"), error)
      setCopiedText(null)
      return false
    }
  }, [])

  return [copiedText, copy]
}

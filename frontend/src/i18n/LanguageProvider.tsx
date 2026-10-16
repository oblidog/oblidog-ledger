import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { toast } from "sonner"
import { type UserPublic, UsersService } from "@/client"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "./index"
import {
  type Language,
  readLocalLanguage,
  resolveLanguage,
  writeLocalLanguage,
} from "./language"

type LanguageContextValue = {
  changeLanguage: (language: Language) => void
  isSaving: boolean
  disabled: boolean
}
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  // Observe the session query without issuing authentication requests on public pages.
  const { data: user } = useQuery<UserPublic | null>({
    queryKey: ["currentUser"],
    queryFn: () => UsersService.readUserMe(),
    enabled: false,
  })
  const { data: config } = usePublicAppConfig()
  const [localLanguage, setLocalLanguage] = useState(readLocalLanguage)
  const demo = config?.is_demo === true
  const language = resolveLanguage({
    accountLanguage: user?.language,
    authenticated: Boolean(user),
    demo,
    localLanguage,
    browserLanguages: navigator.languages,
  })

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language])

  const save = useMutation({
    mutationFn: (selected: Language) =>
      UsersService.updateUserMe({ requestBody: { language: selected } }),
    onSuccess: (updated) => {
      queryClient.setQueryData<UserPublic | null>(["currentUser"], (current) =>
        current?.id === updated.id ? updated : current,
      )
    },
    onError: () => toast.error(i18n.t("language.saveError")),
  })
  const disabled = save.isPending || (Boolean(user) && !config)
  const changeLanguage = (selected: Language) => {
    if (disabled) return
    if (user && !demo) {
      save.mutate(selected)
    } else {
      writeLocalLanguage(selected)
      setLocalLanguage(selected)
    }
  }

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider
        value={{ changeLanguage, isSaving: save.isPending, disabled }}
      >
        {children}
      </LanguageContext.Provider>
    </I18nextProvider>
  )
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error("useLanguage requires LanguageProvider")
  return value
}

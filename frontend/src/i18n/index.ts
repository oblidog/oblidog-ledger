import { createInstance } from "i18next"
import { initReactI18next } from "react-i18next"
import { z } from "zod"
import { appResources } from "./appResources"
import { browserLanguage, readLocalLanguage } from "./language"
import enCommon from "./locales/en/common.json"
import enDomain from "./locales/en/domain.json"
import enErrors from "./locales/en/errors.json"
import enValidation from "./locales/en/validation.json"
import plCommon from "./locales/pl/common.json"
import plDomain from "./locales/pl/domain.json"
import plErrors from "./locales/pl/errors.json"
import plValidation from "./locales/pl/validation.json"

export const resources = {
  en: {
    common: enCommon,
    app: appResources.en,
    domain: enDomain,
    errors: enErrors,
    validation: enValidation,
  },
  pl: {
    common: plCommon,
    app: appResources.pl,
    domain: plDomain,
    errors: plErrors,
    validation: plValidation,
  },
} as const

export const i18n = createInstance()
void i18n.use(initReactI18next).init({
  resources,
  lng:
    readLocalLanguage() ??
    browserLanguage(
      typeof navigator === "undefined"
        ? []
        : (navigator.languages ?? [navigator.language ?? "en"]),
    ),
  supportedLngs: ["en", "pl"],
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
})

function updateDocumentLanguage(language: string) {
  z.config(language === "pl" ? z.locales.pl() : z.locales.en())
  if (typeof document !== "undefined")
    document.documentElement.lang = language === "pl" ? "pl" : "en"
}
i18n.on("languageChanged", updateDocumentLanguage)
updateDocumentLanguage(i18n.resolvedLanguage ?? "en")

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common"
    resources: (typeof resources)["en"]
    strictKeyChecks: true
  }
}

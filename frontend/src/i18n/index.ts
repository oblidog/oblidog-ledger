import { createInstance } from "i18next"
import { initReactI18next } from "react-i18next"
import { z } from "zod"
import { appResources } from "./appResources"
import {
  browserLanguage,
  readLocalLanguage,
  supportedLanguage,
  supportedLanguages,
} from "./language"
import deCommon from "./locales/de/common.json"
import deDomain from "./locales/de/domain.json"
import deErrors from "./locales/de/errors.json"
import deValidation from "./locales/de/validation.json"
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
  de: {
    common: deCommon,
    app: appResources.de,
    domain: deDomain,
    errors: deErrors,
    validation: deValidation,
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
  supportedLngs: [...supportedLanguages],
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
})

function updateDocumentLanguage(language: string) {
  const resolved = supportedLanguage(language) ?? "en"
  z.config({ en: z.locales.en, pl: z.locales.pl, de: z.locales.de }[resolved]())
  if (typeof document !== "undefined") document.documentElement.lang = resolved
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

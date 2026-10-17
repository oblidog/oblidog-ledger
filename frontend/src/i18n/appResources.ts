import deAdmin from "./locales/de/app/admin.json"
import deAnalytics from "./locales/de/app/analytics.json"
import deAuth from "./locales/de/app/auth.json"
import deCategories from "./locales/de/app/categories.json"
import deCommon from "./locales/de/app/common.json"
import deCounterparties from "./locales/de/app/counterparties.json"
import deFilters from "./locales/de/app/filters.json"
import deIntegrations from "./locales/de/app/integrations.json"
import deLedgers from "./locales/de/app/ledgers.json"
import deLedgersettings from "./locales/de/app/ledgersettings.json"
import deMessages from "./locales/de/app/messages.json"
import deObligations from "./locales/de/app/obligations.json"
import dePending from "./locales/de/app/pending.json"
import deSettings from "./locales/de/app/settings.json"
import deSidebar from "./locales/de/app/sidebar.json"
import deSystem from "./locales/de/app/system.json"
import deUi from "./locales/de/app/ui.json"
import deUsersettings from "./locales/de/app/usersettings.json"
import enAdmin from "./locales/en/app/admin.json"
import enAnalytics from "./locales/en/app/analytics.json"
import enAuth from "./locales/en/app/auth.json"
import enCategories from "./locales/en/app/categories.json"
import enCommon from "./locales/en/app/common.json"
import enCounterparties from "./locales/en/app/counterparties.json"
import enFilters from "./locales/en/app/filters.json"
import enIntegrations from "./locales/en/app/integrations.json"
import enLedgers from "./locales/en/app/ledgers.json"
import enLedgersettings from "./locales/en/app/ledgersettings.json"
import enMessages from "./locales/en/app/messages.json"
import enObligations from "./locales/en/app/obligations.json"
import enPending from "./locales/en/app/pending.json"
import enSettings from "./locales/en/app/settings.json"
import enSidebar from "./locales/en/app/sidebar.json"
import enSystem from "./locales/en/app/system.json"
import enUi from "./locales/en/app/ui.json"
import enUsersettings from "./locales/en/app/usersettings.json"
import plAdmin from "./locales/pl/app/admin.json"
import plAnalytics from "./locales/pl/app/analytics.json"
import plAuth from "./locales/pl/app/auth.json"
import plCategories from "./locales/pl/app/categories.json"
import plCommon from "./locales/pl/app/common.json"
import plCounterparties from "./locales/pl/app/counterparties.json"
import plFilters from "./locales/pl/app/filters.json"
import plIntegrations from "./locales/pl/app/integrations.json"
import plLedgers from "./locales/pl/app/ledgers.json"
import plLedgersettings from "./locales/pl/app/ledgersettings.json"
import plMessages from "./locales/pl/app/messages.json"
import plObligations from "./locales/pl/app/obligations.json"
import plPending from "./locales/pl/app/pending.json"
import plSettings from "./locales/pl/app/settings.json"
import plSidebar from "./locales/pl/app/sidebar.json"
import plSystem from "./locales/pl/app/system.json"
import plUi from "./locales/pl/app/ui.json"
import plUsersettings from "./locales/pl/app/usersettings.json"

export const appResources = {
  en: {
    admin: enAdmin,
    analytics: enAnalytics,
    categories: enCategories,
    common: enCommon,
    integrations: enIntegrations,
    ledgersettings: enLedgersettings,
    ledgers: enLedgers,
    obligations: enObligations,
    pending: enPending,
    sidebar: enSidebar,
    usersettings: enUsersettings,
    ui: enUi,
    counterparties: enCounterparties,
    system: enSystem,
    settings: enSettings,
    auth: enAuth,
    messages: enMessages,
    filters: enFilters,
  },
  de: {
    admin: deAdmin,
    analytics: deAnalytics,
    categories: deCategories,
    common: deCommon,
    integrations: deIntegrations,
    ledgersettings: deLedgersettings,
    ledgers: deLedgers,
    obligations: deObligations,
    pending: dePending,
    sidebar: deSidebar,
    usersettings: deUsersettings,
    ui: deUi,
    counterparties: deCounterparties,
    system: deSystem,
    settings: deSettings,
    auth: deAuth,
    messages: deMessages,
    filters: deFilters,
  },
  pl: {
    admin: plAdmin,
    analytics: plAnalytics,
    categories: plCategories,
    common: plCommon,
    integrations: plIntegrations,
    ledgersettings: plLedgersettings,
    ledgers: plLedgers,
    obligations: plObligations,
    pending: plPending,
    sidebar: plSidebar,
    usersettings: plUsersettings,
    ui: plUi,
    counterparties: plCounterparties,
    system: plSystem,
    settings: plSettings,
    auth: plAuth,
    messages: plMessages,
    filters: plFilters,
  },
} as const

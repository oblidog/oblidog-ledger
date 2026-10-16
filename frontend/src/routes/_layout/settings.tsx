import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import ReportSettings from "@/components/UserSettings/ReportSettings"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import { i18n } from "@/i18n"

const tabsConfig = [
  {
    value: "my-profile",
    get title() {
      return i18n.t("app:settings.my_profile")
    },
    component: UserInformation,
  },
  {
    value: "password",
    get title() {
      return i18n.t("app:settings.password")
    },
    component: ChangePassword,
  },
  {
    value: "reports",
    get title() {
      return i18n.t("app:settings.reports")
    },
    component: ReportSettings,
  },
  {
    value: "danger-zone",
    get title() {
      return i18n.t("app:settings.danger_zone")
    },
    component: DeleteAccount,
  },
]

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: i18n.t("app:settings.settings_oblidog"),
      },
    ],
  }),
})

function UserSettings() {
  useTranslation()

  const { user: currentUser } = useAuth()

  if (!currentUser) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {i18n.t("app:settings.user_settings")}
        </h1>
        <p className="text-muted-foreground">
          {i18n.t("app:settings.manage_your_account_settings_and_preferences")}
        </p>
      </div>

      <Tabs defaultValue="my-profile">
        <TabsList>
          {tabsConfig.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabsConfig.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

import type { AxiosResponse } from "axios"
import type { Options } from "./client/sdk.gen"
import * as generated from "./client/sdk.gen"

export { AxiosError as ApiError } from "axios"
export { client } from "./client/client.gen"
export type { BodyLoginLoginAccessToken as Body_login_login_access_token } from "./client/types.gen"
export * from "./client/types.gen"

type CamelCase<Value extends string> =
  Value extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<CamelCase<Tail>>}`
    : Value
type CamelKeys<Value> = Value extends object
  ? {
      [Key in keyof Value as Key extends string
        ? CamelCase<Key>
        : Key]: Value[Key]
    }
  : Value
type OptionData<Value> =
  Value extends Options<infer Data, infer _ThrowOnError, infer _Response>
    ? Data
    : never
type RequestData<Function> = Function extends (
  ...arguments_: infer Arguments
) => unknown
  ? OptionData<Arguments[0]>
  : never
type ResponseBody<Function> =
  Awaited<
    Function extends (...arguments_: never[]) => infer Result ? Result : never
  > extends { data: infer Body }
    ? NonNullable<Body>
    : never
type LegacyBody<Data> = Data extends { body?: infer Body }
  ? [NonNullable<Body>] extends [never]
    ? object
    : Data extends { body: infer RequiredBody }
      ?
          | { requestBody: RequiredBody; formData?: never }
          | { requestBody?: never; formData: RequiredBody }
      : { requestBody?: Body; formData?: Body }
  : object
type LegacyOptions<Data> = (Data extends { path?: infer Path }
  ? [NonNullable<Path>] extends [never]
    ? object
    : CamelKeys<NonNullable<Path>>
  : object) &
  (Data extends { query?: infer Query }
    ? [NonNullable<Query>] extends [never]
      ? object
      : CamelKeys<NonNullable<Query>>
    : object) &
  LegacyBody<Data>
type HasRequiredProperties<Value> = [NonNullable<Value>] extends [never]
  ? false
  : NonNullable<Value> extends object
    ? object extends NonNullable<Value>
      ? false
      : true
    : false
type HasRequiredPath<Data> = Data extends { path?: infer Path }
  ? HasRequiredProperties<Path>
  : false
type HasRequiredQuery<Data> = Data extends { query?: infer Query }
  ? HasRequiredProperties<Query>
  : false
type RequiresOptions<Data> = Data extends { body: unknown }
  ? true
  : HasRequiredPath<Data> extends true
    ? true
    : HasRequiredQuery<Data> extends true
      ? true
      : false
type RequestArguments<Data> =
  RequiresOptions<Data> extends true
    ? [options: LegacyOptions<Data>]
    : [options?: LegacyOptions<Data>]

const snakeCase = (key: string) =>
  key
    .replace(/^_/, "")
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

const request =
  <Function>(function_: Function) =>
  async (
    ...[options]: RequestArguments<RequestData<Function>>
  ): Promise<ResponseBody<Function>> => {
    const legacyOptions = options as
      | (LegacyOptions<RequestData<Function>> & {
          formData?: unknown
          requestBody?: unknown
        })
      | undefined
    const { formData, requestBody, ...params } = legacyOptions ?? {}
    const fields = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [snakeCase(key), value]),
    )
    const response = await (
      function_ as (options: unknown) => Promise<AxiosResponse>
    )({
      body: requestBody ?? formData,
      path: fields,
      query: fields,
      throwOnError: true,
    })
    return response.data as ResponseBody<Function>
  }

export const AnalyticsService = {
  readCategoryAmountHistory: request(
    generated.AnalyticsService.readCategoryAmountHistory<true>,
  ),
  readObligationPeriodTotals: request(
    generated.AnalyticsService.readObligationPeriodTotals<true>,
  ),
  readPeriodPaymentSummary: request(
    generated.AnalyticsService.readPeriodPaymentSummary<true>,
  ),
  readRemainingPeriodCashflow: request(
    generated.AnalyticsService.readRemainingPeriodCashflow<true>,
  ),
}
export const CategoriesService = {
  archiveCategory: request(generated.CategoriesService.archiveCategory<true>),
  archiveCategoryGroup: request(
    generated.CategoriesService.archiveCategoryGroup<true>,
  ),
  createCategory: request(generated.CategoriesService.createCategory<true>),
  createCategoryDataSchema: request(
    generated.CategoriesService.createCategoryDataSchema<true>,
  ),
  createCategoryGroup: request(
    generated.CategoriesService.createCategoryGroup<true>,
  ),
  readCategories: request(generated.CategoriesService.readCategories<true>),
  readCategoryDataRecords: request(
    generated.CategoriesService.readCategoryDataRecords<true>,
  ),
  readCategoryDataSchema: request(
    generated.CategoriesService.readCategoryDataSchema<true>,
  ),
  readCategoryGroups: request(
    generated.CategoriesService.readCategoryGroups<true>,
  ),
  restoreCategory: request(generated.CategoriesService.restoreCategory<true>),
  updateCategory: request(generated.CategoriesService.updateCategory<true>),
  updateCategoryGroup: request(
    generated.CategoriesService.updateCategoryGroup<true>,
  ),
}
export const LedgersService = {
  createApiKey: request(generated.LedgersService.createApiKey<true>),
  createLedger: request(generated.LedgersService.createLedger<true>),
  deleteAllCategories: request(
    generated.LedgersService.deleteAllCategories<true>,
  ),
  deleteAllObligations: request(
    generated.LedgersService.deleteAllObligations<true>,
  ),
  readApiKeys: request(generated.LedgersService.readApiKeys<true>),
  readLedger: request(generated.LedgersService.readLedger<true>),
  readLedgerMembers: request(generated.LedgersService.readLedgerMembers<true>),
  readLedgers: request(generated.LedgersService.readLedgers<true>),
  removeLedgerMember: request(
    generated.LedgersService.removeLedgerMember<true>,
  ),
  revokeApiKey: request(generated.LedgersService.revokeApiKey<true>),
  shareLedger: request(generated.LedgersService.shareLedger<true>),
  updateLedger: request(generated.LedgersService.updateLedger<true>),
  updateLedgerMember: request(
    generated.LedgersService.updateLedgerMember<true>,
  ),
}
export const IntegrationsService = {
  listIntegrations: request(
    generated.IntegrationsService.listIntegrations<true>,
  ),
  getIntegration: request(generated.IntegrationsService.getIntegration<true>),
  createIntegration: request(
    generated.IntegrationsService.createIntegration<true>,
  ),
  updateIntegration: request(
    generated.IntegrationsService.updateIntegration<true>,
  ),
}
export const LoginService = {
  loginAccessToken: request(generated.LoginService.loginAccessToken<true>),
  recoverPassword: request(generated.LoginService.recoverPassword<true>),
  resetPassword: request(generated.LoginService.resetPassword<true>),
}
export const ObligationsService = {
  addObligationComponent: request(
    generated.ObligationsService.addObligationComponent<true>,
  ),
  cancelObligation: request(
    generated.ObligationsService.cancelObligation<true>,
  ),
  createObligation: request(
    generated.ObligationsService.createObligation<true>,
  ),
  markObligationPaid: request(
    generated.ObligationsService.markObligationPaid<true>,
  ),
  markObligationReady: request(
    generated.ObligationsService.markObligationReady<true>,
  ),
  readObligation: request(generated.ObligationsService.readObligation<true>),
  readObligationComponents: request(
    generated.ObligationsService.readObligationComponents<true>,
  ),
  readObligations: request(generated.ObligationsService.readObligations<true>),
  removeObligationComponent: request(
    generated.ObligationsService.removeObligationComponent<true>,
  ),
  reopenObligation: request(
    generated.ObligationsService.reopenObligation<true>,
  ),
  updateObligation: request(
    generated.ObligationsService.updateObligation<true>,
  ),
  updateObligationComponent: request(
    generated.ObligationsService.updateObligationComponent<true>,
  ),
}
export const SystemRunsService = {
  readSystemRunTasks: request(
    generated.SystemRunsService.runsReadSystemRunTasks<true>,
  ),
  readSystemRuns: request(generated.SystemRunsService.runsReadSystemRuns<true>),
  startSystemRun: request(generated.SystemRunsService.runsStartSystemRun<true>),
}
export const UsersService = {
  createUser: request(generated.UsersService.createUser<true>),
  deleteUser: request(generated.UsersService.deleteUser<true>),
  deleteUserMe: request(generated.UsersService.deleteUserMe<true>),
  readUserMe: request(generated.UsersService.readUserMe<true>),
  readUsers: request(generated.UsersService.readUsers<true>),
  updatePasswordMe: request(generated.UsersService.updatePasswordMe<true>),
  updateUser: request(generated.UsersService.updateUser<true>),
  updateUserMe: request(generated.UsersService.updateUserMe<true>),
}

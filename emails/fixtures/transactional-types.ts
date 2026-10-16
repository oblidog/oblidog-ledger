export type TransactionalKind =
  | "reset_password"
  | "user_invitation"
  | "new_account"
  | "test_email"
export type TransactionalContext = {
  project_name: string
  email: string
  username?: string | null
  password?: string
  valid_hours?: number
  link?: string
}

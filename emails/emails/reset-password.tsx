import {
  TransactionalEmail,
  type TransactionalProps,
} from "../components/transactional"

export default function ResetPasswordEmail(props: TransactionalProps) {
  return <TransactionalEmail kind="reset_password" {...props} />
}

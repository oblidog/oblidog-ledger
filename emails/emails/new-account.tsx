import {
  TransactionalEmail,
  type TransactionalProps,
} from "../components/transactional"

export default function NewAccountEmail(props: TransactionalProps) {
  return <TransactionalEmail kind="new_account" {...props} />
}

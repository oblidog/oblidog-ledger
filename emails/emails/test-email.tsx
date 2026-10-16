import {
  TransactionalEmail,
  type TransactionalProps,
} from "../components/transactional"

export default function TestEmail(props: TransactionalProps) {
  return <TransactionalEmail kind="test_email" {...props} />
}

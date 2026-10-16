import {
  TransactionalEmail,
  type TransactionalProps,
} from "../components/transactional"

export default function InvitationEmail(props: TransactionalProps) {
  return <TransactionalEmail kind="user_invitation" {...props} />
}

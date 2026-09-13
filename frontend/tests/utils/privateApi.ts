import axios from "axios"

import { client, LoginService, type UserPublic } from "../../src/client"
import { firstSuperuser, firstSuperuserPassword } from "../config"

client.setConfig({ baseURL: `${process.env.VITE_API_URL}` })

type MailcatcherEmail = {
  id: number
  recipients: string[]
}

const waitForInvitationToken = async (email: string): Promise<string> => {
  const mailcatcherHost = process.env.MAILCATCHER_HOST
  if (!mailcatcherHost) {
    throw new Error("MAILCATCHER_HOST is required to accept test invitations")
  }

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const response = await axios.get<MailcatcherEmail[]>(
      `${mailcatcherHost}/messages`,
    )
    const message = response.data.findLast((item) =>
      item.recipients.includes(`<${email}>`),
    )

    if (message) {
      const html = await axios.get<string>(
        `${mailcatcherHost}/messages/${message.id}.html`,
      )
      const match = html.data.match(
        /accept-invitation\?token=([^&"'<\s]+)/,
      )
      if (match?.[1]) {
        return decodeURIComponent(match[1])
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Invitation email for ${email} was not received`)
}

export const createUser = async ({
  email,
  password,
}: {
  email: string
  password: string
}): Promise<UserPublic> => {
  const apiBaseUrl = process.env.VITE_API_URL
  if (!apiBaseUrl) {
    throw new Error("VITE_API_URL is required to create test users")
  }

  const token = await LoginService.loginAccessToken({
    formData: {
      username: firstSuperuser,
      password: firstSuperuserPassword,
    },
  })

  client.setConfig({ auth: token.access_token })

  await axios.post(
    `${apiBaseUrl}/api/v1/users/invitations`,
    {
      email,
      is_superuser: false,
      full_name: "Test User",
    },
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  )

  const invitationToken = await waitForInvitationToken(email)
  const accepted = await axios.post<UserPublic>(
    `${apiBaseUrl}/api/v1/invitations/${encodeURIComponent(invitationToken)}/accept`,
    { new_password: password },
  )
  return accepted.data
}

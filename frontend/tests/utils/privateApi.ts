import axios from "axios"
import { client, LoginService, type UserPublic } from "../../src/client"
import { firstSuperuser, firstSuperuserPassword } from "../config"
import { applicationLink, waitForEmail } from "./mailpit"

client.setConfig({ baseURL: `${process.env.VITE_API_URL}` })

const waitForInvitationToken = async (email: string): Promise<string> => {
  const message = await waitForEmail({
    recipient: email,
    subject: "You're invited",
  })
  const link = applicationLink(
    message.HTML,
    "/accept-invitation",
    process.env.VITE_API_URL!,
  )
  return new URL(link).searchParams.get("token")!
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

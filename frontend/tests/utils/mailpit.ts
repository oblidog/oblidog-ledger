type MessageSummary = {
  ID: string
  To: { Address: string }[]
  Subject: string
  Created: string
}

type Message = MessageSummary & { HTML: string }

/** One deadline covers polling, HTTP requests and response bodies. */
export async function waitForEmail({
  recipient,
  subject,
  timeout = 5000,
  host = process.env.MAILPIT_HOST,
}: {
  recipient: string
  subject: string
  timeout?: number
  host?: string
}): Promise<Message> {
  if (!host) throw new Error("MAILPIT_HOST is required to read test emails")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const { signal } = controller
  const get = async (path: string) => {
    const response = await fetch(new URL(path, host), { signal })
    if (!response.ok) {
      throw new Error(`Mailpit ${path} returned HTTP ${response.status}`)
    }
    return response.json()
  }
  try {
    // Mailpit search narrows the result before pagination; verify exact recipient
    // and subject again locally, as search terms may also match substrings.
    const query = `to:${JSON.stringify(recipient)} subject:${JSON.stringify(subject)}`
    while (!signal.aborted) {
      const result: { messages: MessageSummary[] } = await get(
        `/api/v1/search?query=${encodeURIComponent(query)}`,
      )
      const message = result.messages
        .filter(
          (item) =>
            item.To.some(
              (to) => to.Address.toLowerCase() === recipient.toLowerCase(),
            ) && item.Subject.includes(subject),
        )
        .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0]
      if (message) {
        return (await get(
          `/api/v1/message/${encodeURIComponent(message.ID)}`,
        )) as Message
      }
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(pause)
          resolve()
        }
        const pause = setTimeout(() => {
          signal.removeEventListener("abort", onAbort)
          resolve()
        }, 100)
        signal.addEventListener("abort", onAbort, { once: true })
        if (signal.aborted) {
          signal.removeEventListener("abort", onAbort)
          onAbort()
        }
      })
    }
    throw new Error("Mailpit polling aborted")
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `Timed out after ${timeout}ms waiting for Mailpit email to ${recipient} with subject containing ${JSON.stringify(subject)}`,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Keep the email path/query, but use the configured browser application URL. */
export function applicationLink(
  html: string,
  pathname: "/reset-password" | "/accept-invitation",
  applicationUrl: string,
): string {
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].replace(/&amp;/g, "&")
    const url = new URL(href, applicationUrl)
    if (url.pathname === pathname && url.searchParams.get("token")) {
      const target = new URL(applicationUrl)
      target.pathname = url.pathname
      target.search = url.search
      target.hash = url.hash
      return target.href
    }
  }
  throw new Error(`Email does not contain a ${pathname} link with a token`)
}

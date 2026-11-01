/** Only these public values are serialized into the client artifact. */
export function resolveBuildVersion(projectVersion, env = {}) {
  const baseVersion = projectVersion?.trim().replace(/^v/, "")
  const isVercel = env.VERCEL === "1" || Boolean(env.VERCEL_ENV)
  const candidate = isVercel
    ? env.VERCEL_GIT_COMMIT_SHA
    : env.VITE_APP_COMMIT_SHA
  const commit = /^[a-f0-9]{40}$/i.test(candidate ?? "")
    ? candidate.toLowerCase()
    : null
  const release = env.VITE_APP_VERSION?.trim()

  // Release Docker images already receive their tag from publish-images.yml.
  // Vercel builds always carry a development marker, even on Production.
  const label =
    !isVercel && release && release !== "dev"
      ? release
      : `${baseVersion ? `v${baseVersion}-dev` : "dev"}.${commit?.slice(0, 7) ?? "unknown"}`

  return { label, commit }
}

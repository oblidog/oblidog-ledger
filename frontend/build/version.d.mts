export function resolveBuildVersion(
  projectVersion: string | undefined,
  env?: Record<string, string | undefined>,
): { label: string; commit: string | null }

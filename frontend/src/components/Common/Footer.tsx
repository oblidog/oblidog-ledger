const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "dev"

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t px-6 py-4">
      <div className="flex items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Oblidog · {currentYear} ·{" "}
          <span data-testid="app-version" title="Application version">
            {appVersion}
          </span>
        </p>
      </div>
    </footer>
  )
}

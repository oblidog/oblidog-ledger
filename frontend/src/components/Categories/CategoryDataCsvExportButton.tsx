import { Download } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { apiUrl } from "@/config"
import useCustomToast from "@/hooks/useCustomToast"

type CategoryDataCsvExportButtonProps = {
  ledgerId: string
  categoryId: string
  schemaVersion: number
  observedFrom?: string
  observedTo?: string
}

function exportUrl({
  ledgerId,
  categoryId,
  schemaVersion,
  observedFrom,
  observedTo,
}: CategoryDataCsvExportButtonProps) {
  const params = new URLSearchParams({
    schema_version: String(schemaVersion),
  })
  if (observedFrom) params.set("observed_from", observedFrom)
  if (observedTo) params.set("observed_to", observedTo)

  return `/api/v1/ledgers/${encodeURIComponent(ledgerId)}/categories/${encodeURIComponent(categoryId)}/data-records.csv?${params}`
}

function responseFilename(response: Response) {
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] ?? "oblidog-category-data.csv"
}

export function CategoryDataCsvExportButton(
  props: CategoryDataCsvExportButtonProps,
) {
  const [isExporting, setIsExporting] = useState(false)
  const { showErrorToast } = useCustomToast()

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await fetch(`${apiUrl}${exportUrl(props)}`, {
        credentials: "include",
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail ?? "Could not export category data.")
      }
      if (!response.headers.get("content-type")?.startsWith("text/csv")) {
        throw new Error("The export response was not a CSV file.")
      }

      const blobUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = blobUrl
      link.download = responseFilename(response)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (error) {
      showErrorToast(
        error instanceof Error
          ? error.message
          : "Could not export category data.",
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExporting}
    >
      <Download />
      {isExporting ? "Exporting…" : "Export CSV"}
    </Button>
  )
}

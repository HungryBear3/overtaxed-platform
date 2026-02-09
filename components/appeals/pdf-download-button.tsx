"use client"

import { useState } from "react"

export function PdfDownloadButton({ appealId }: { appealId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")

  // Open PDF in new tab via direct URL (inline disposition) — bypasses AV that blocks blob/download
  const viewInNewTabUrl = `/api/appeals/${appealId}/download-summary?view=1`

  async function fetchPdf(mode: "view" | "download") {
    setLoading(true)
    setError("")
    setWarning("")
    try {
      const res = await fetch(mode === "view" ? `${viewInNewTabUrl}` : `/api/appeals/${appealId}/download-summary`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed (${res.status})`)
      }
      const warnHeader = res.headers.get("X-Appeal-Warning")
      if (warnHeader) setWarning(warnHeader)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (mode === "view") {
        window.open(url, "_blank", "noopener")
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      } else {
        const a = document.createElement("a")
        a.href = url
        const cd = res.headers.get("Content-Disposition")
        const match = cd?.match(/filename="?([^";\n]+)"?/)
        a.download = match?.[1] || `overtaxed-appeal-summary.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed. Try "Open in new tab" or "View in browser" if antivirus blocks download.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        If your browser or antivirus blocks the download, use &quot;Open in new tab&quot; to view the PDF, then print or save from there.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={viewInNewTabUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V8a2 2 0 00-2-2h-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open in new tab
        </a>
        <button
          type="button"
          onClick={() => fetchPdf("view")}
          disabled={loading}
          className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
          {loading ? "Loading…" : "View in browser"}
        </button>
        <button
          type="button"
          onClick={() => fetchPdf("download")}
          disabled={loading}
          className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download PDF
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      {warning && !error && (
        <p className="text-xs text-amber-700">{warning}</p>
      )}
    </div>
  )
}

"use client"

/**
 * The one-time-code redemption form.
 *
 * The code is the whole authorization, so this component is written around
 * keeping it in as few places as possible:
 *
 *   - it lives in React state and nowhere else. No `localStorage`, no
 *     `sessionStorage`, no cookie, no URL, no query parameter, no hash;
 *   - the form never navigates, so the value can never reach an address bar,
 *     browser history, a `Referer` header, or a server access log;
 *   - it is submitted as a JSON POST body and cleared from state the moment the
 *     request resolves, in every branch;
 *   - the object URL created for the download is revoked immediately after the
 *     click, so the blob is not retained by the page;
 *   - there is no analytics call, no third-party widget, and no error reporter
 *     on this path. Nothing observes what is typed here.
 *
 * The outcomes shown are deliberately coarse, mirroring the route: a holder of a
 * live code learns nothing useful from a precise reason, and someone guessing
 * must not be able to tell "no such code" from "that order was refunded".
 */
import { useId, useRef, useState } from "react"

const CODE_LENGTH = 43
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/

type Outcome =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "error"; message: string }

const MESSAGES: Readonly<Record<string, string>> = {
  EXPIRED: "That code has expired. Contact support and we can look into it.",
  REVOKED: "That code is no longer active. Contact support and we can look into it.",
  EXHAUSTED:
    "That code has already been used the maximum number of times. Contact support and we can look into it.",
  TEMPORARILY_UNAVAILABLE:
    "The packet could not be read just now. Please try again in a few minutes.",
  REISSUE_REQUIRED:
    "This code was spent but the download could not be completed. Contact support for a replacement code.",
  NOT_AVAILABLE: "That code is not valid. Check it was pasted in full.",
  INVALID_REQUEST: "That code is not valid. Check it was pasted in full.",
}

function messageFor(code: unknown): string {
  return typeof code === "string" && code in MESSAGES
    ? MESSAGES[code]
    : "Something went wrong. Please try again in a few minutes."
}

export function PacketForm() {
  const inputId = useId()
  const [code, setCode] = useState("")
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" })
  // Guards against a double submit spending two uses of a bounded budget.
  const inFlight = useRef(false)

  const trimmed = code.trim()
  const submittable = CODE_SHAPE.test(trimmed) && outcome.kind !== "working"

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!submittable || inFlight.current) return
    inFlight.current = true
    setOutcome({ kind: "working" })

    // Read once into a local, so the value is not re-read from state later and
    // state can be cleared as early as possible.
    const value = trimmed
    try {
      const response = await fetch("/api/ot/packet/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same-origin only, and no credentials: the code is the authorization,
        // and this request must never carry an ambient session anywhere.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        body: JSON.stringify({ capability: value }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: unknown
        }
        setOutcome({ kind: "error", message: messageFor(body.code) })
        return
      }

      const blob = await response.blob()
      const contentDisposition = response.headers?.get?.("content-disposition") ?? ""
      const advertisedFilename = contentDisposition.match(/filename="([^"\\\r\\\n]+)"/i)?.[1]
      const filename = advertisedFilename === "overtaxed-records-report.zip"
        ? advertisedFilename
        : "overtaxed-appeal-evidence.pdf"
      const href = URL.createObjectURL(blob)
      try {
        const link = document.createElement("a")
        link.href = href
        link.download = filename
        link.rel = "noreferrer"
        document.body.appendChild(link)
        link.click()
        link.remove()
      } finally {
        // Revoked immediately: the page keeps no handle on the packet bytes.
        URL.revokeObjectURL(href)
      }
      setOutcome({ kind: "done" })
    } catch {
      setOutcome({
        kind: "error",
        message: "The download could not be completed. Please try again.",
      })
    } finally {
      // Cleared in EVERY branch — success, refusal, and network failure alike.
      setCode("")
      inFlight.current = false
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-900"
        >
          One-time code
        </label>
        <p className="mt-1 text-sm text-gray-600">
          Paste the {CODE_LENGTH}-character code from your email.
        </p>
        <input
          id={inputId}
          name="packet-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // `data-*` off the browser's password/one-time-code heuristics, so no
          // manager offers to store this value.
          data-1p-ignore="true"
          data-lpignore="true"
          maxLength={200}
          required
          aria-describedby={`${inputId}-status`}
          placeholder="Paste your code"
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-3 font-mono text-base tracking-tight text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      <button
        type="submit"
        disabled={!submittable}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {outcome.kind === "working" ? "Checking…" : "Download packet"}
      </button>

      <p
        id={`${inputId}-status`}
        role="status"
        aria-live="polite"
        className="min-h-[1.5rem] text-sm"
      >
        {outcome.kind === "done" ? (
          <span className="text-green-700">
            Your packet has downloaded. Save the PDF somewhere you can find it.
          </span>
        ) : outcome.kind === "error" ? (
          <span className="text-red-700">{outcome.message}</span>
        ) : null}
      </p>
    </form>
  )
}

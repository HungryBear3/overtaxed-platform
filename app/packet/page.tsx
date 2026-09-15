import type { Metadata } from "next"
import { PrivateDocumentGate } from "@/components/analytics/private-document-boundary"
import { PacketForm } from "./packet-form"

/**
 * `/packet` — where a customer redeems the one-time code from their email.
 *
 * Deliberately generic and deliberately boring. The URL carries no token, no
 * order id, no query and no fragment, so the link in the email discloses
 * nothing if the message is forwarded, quoted, or scanned. Everything that
 * authorizes anything arrives in a POST body from the form.
 *
 * Not indexed and not crawled: `robots` below sets it per-page, and
 * `app/robots.ts` disallows the prefix. It is a private transactional surface,
 * not a marketing page, and it makes no claim about deadlines, savings or
 * outcomes.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Download your packet",
  description: "Enter the one-time code from your email to download your evidence packet.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "no-referrer",
}

export default function PacketPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-bold text-gray-900">Download your packet</h1>
      <p className="mt-3 text-base text-gray-600">
        Your evidence packet is ready. Paste the one-time code we emailed you to
        download the PDF.
      </p>

      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <PrivateDocumentGate><PacketForm /></PrivateDocumentGate>
      </div>

      <div className="mt-8 space-y-3 text-sm text-gray-600">
        <p>
          The code works for a limited time and a limited number of downloads, so
          save the PDF once you have it.
        </p>
        <p>
          We never put the code in a link and we never ask for it by reply. If
          the code has stopped working, email{" "}
          <a
            className="font-medium text-blue-700 underline"
            href="mailto:support@overtaxed-il.com"
            rel="noreferrer"
          >
            support@overtaxed-il.com
          </a>{" "}
          and we can look into it.
        </p>
      </div>
    </main>
  )
}

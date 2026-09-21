import Link from "next/link"

import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import {
  NEUTRAL_REPORT_LIMITS,
  NEUTRAL_REPORT_NAME,
  NEUTRAL_REPORT_PRICE,
  NEUTRAL_REPORT_REFUND,
  NEUTRAL_REPORT_REFUND_COMPLETE_REPORT,
  NEUTRAL_REPORT_REFUND_CURE,
  NEUTRAL_REPORT_REFUND_EXCLUSIONS,
  NEUTRAL_REPORT_REFUND_INTERRUPTION,
  NEUTRAL_REPORT_REFUND_REQUEST,
  NEUTRAL_REPORT_REFUND_NONWAIVER,
  NEUTRAL_REPORT_REFUND_VOLUNTARY,
  NEUTRAL_REPORT_SUMMARY,
  neutralReportCopyEnabled,
} from "@/lib/copy/neutral-report"
import "../ot-design.css"

/**
 * `/refunds` — the page a "refund policy" link is expected to reach.
 *
 * It existed as a link target and not as a route: the URL 404'd while the
 * refund term itself was live in Terms of Service §7 and on every purchase
 * surface. This page closes that gap and nothing else. It states no term the
 * Terms do not already state, and it grants no refund the owner-approved
 * contract does not.
 *
 * Why it imports rather than re-types the rule: `NEUTRAL_REPORT_REFUND` is the
 * core promise approved 2026-09-15; its clarification and flexibility terms
 * were owner-approved in direct chat on 2026-09-21. The same copy is rendered
 * by `/terms`, `/pricing`, `/checkout` and the home page. A fourth surface that
 * paraphrased it would be a second copy of one policy — which is exactly how
 * `RiskReversalBadge` drifted into promising a refund on a county decision.
 * The constant is rendered verbatim or not at all.
 *
 * Why the page switches on the commerce gate: `app/terms/page.tsx` does, for
 * the same reason. With the gate off the site sells the DIY Appeal Packet, and
 * a refund page describing the neutral records report would describe a product
 * no other surface offers. In that posture this page does not restate the
 * legacy §7 rule either — it points at the Terms, which govern.
 */
const REFUNDS_DESCRIPTION =
  "OverTaxed IL refund policy, governing terms, and instructions for requesting review of an order."

export const metadata = {
  title: "Refund Policy",
  description: REFUNDS_DESCRIPTION,
  alternates: { canonical: "https://www.overtaxed-il.com/refunds" },
  openGraph: {
    type: "website",
    url: "https://www.overtaxed-il.com/refunds",
    title: "OverTaxed IL Refund Policy",
    description: REFUNDS_DESCRIPTION,
    siteName: "OverTaxed IL",
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL Refund Policy",
    description: REFUNDS_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

export default function RefundsPage() {
  const neutralReport = neutralReportCopyEnabled()
  return (
    <div className="ot-root">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <h1 className="text-3xl font-bold text-foreground mb-2">Refund Policy</h1>
        <p className="text-muted-foreground text-sm mb-8">Last updated: September 2026</p>

        <div className="prose max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">What you paid for</h2>
            <p className="text-muted-foreground mb-3">
              {neutralReport
                ? `${NEUTRAL_REPORT_NAME} — ${NEUTRAL_REPORT_PRICE} one-time. ${NEUTRAL_REPORT_SUMMARY}`
                : "DIY Appeal Packet — $69 one-time. We prepare the materials; you review, sign, and file them with Cook County yourself."}
            </p>
            <p className="text-muted-foreground">
              {neutralReport ? <>
                This page is a plain-language copy of the refund term in our{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>{" "}
                (§7). Where the two differ, the Terms govern.
              </> : <>
                This page directs you to the governing refund terms in our{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>{" "}
                (§7). The Terms govern.
              </>}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">When we refund</h2>
            {neutralReport ? <>
              <p className="text-muted-foreground mb-3">{NEUTRAL_REPORT_REFUND_COMPLETE_REPORT}</p>
              <p className="text-muted-foreground mb-3">{NEUTRAL_REPORT_REFUND_INTERRUPTION}</p>
              <p className="text-muted-foreground mb-3">{NEUTRAL_REPORT_REFUND}</p>
              <p className="text-muted-foreground mb-3">{NEUTRAL_REPORT_REFUND_REQUEST}</p>
              <p className="text-muted-foreground">{NEUTRAL_REPORT_REFUND_CURE}</p>
            </> : (
              <p className="text-muted-foreground">
                The refund term for the DIY Appeal Packet is stated in §7 of the{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>
                . It is reproduced there in full and is not restated here, so that one rule has one
                wording.
              </p>
            )}
          </section>

          {neutralReport && <>
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">What does not create a refund right</h2>
              <p className="text-muted-foreground">{NEUTRAL_REPORT_REFUND_EXCLUSIONS}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Other accommodations and consumer rights</h2>
              <p className="text-muted-foreground mb-3">{NEUTRAL_REPORT_REFUND_VOLUNTARY}</p>
              <p className="text-muted-foreground">{NEUTRAL_REPORT_REFUND_NONWAIVER}</p>
            </section>
          </>}

          {neutralReport && (
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">What the report is not</h2>
              <p className="text-muted-foreground">{NEUTRAL_REPORT_LIMITS}</p>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">How to ask us to review an order</h2>
            {neutralReport ? (
              <p className="text-muted-foreground mb-3">
                Email{" "}
                <a href="mailto:support@overtaxed-il.com" className="text-primary hover:underline">
                  support@overtaxed-il.com
                </a>{" "}
                with your order reference and tell us what you did not receive.
              </p>
            ) : (
              <p className="text-muted-foreground mb-3">
                To request review of a claimed OverTaxed IL procedural error, email{" "}
                <a href="mailto:support@overtaxed-il.com" className="text-primary hover:underline">
                  support@overtaxed-il.com
                </a>{" "}
                within 30 days of the county notice and include the notice or filing status.
              </p>
            )}
            <p className="text-muted-foreground">
              You can also use the Refund Request category on our{" "}
              <Link href="/contact" className="text-primary hover:underline">
                contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <SiteFooter neutralReport={neutralReport} />
    </div>
  )
}

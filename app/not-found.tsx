import type { Metadata } from "next"
import Link from "next/link"
import { SiteFooter, SiteHeader } from "@/components/ot-design/SiteChrome"
import "./ot-design.css"

export const metadata: Metadata = {
  title: "Page not found",
  description: "The requested OverTaxed IL page could not be found.",
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <div className="ot-root">
      <SiteHeader />
      <main className="ot-checkout">
        <section className="ot-checkout-inner" style={{ maxWidth: 760, paddingBlock: 80, textAlign: "center" }}>
          <div className="ot-eyebrow">404</div>
          <h1 className="ot-h1">Page not found</h1>
          <p className="ot-hero-subhead">
            That link may be outdated. You can still check your Cook County assessment against public-record matching properties.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 28 }}>
            <Link href="/#hero-check" className="ot-cta">
              Start a free property check <span className="ot-cta-arrow">→</span>
            </Link>
            <Link href="/" className="ot-btn-secondary">
              Return home
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

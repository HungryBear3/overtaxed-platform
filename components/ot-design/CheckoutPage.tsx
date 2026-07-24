"use client"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { RiskReversalBadge } from "@/components/ot-design/SiteChrome"
import { isClientPreviewStubMode } from "@/lib/marketing/preview-gate-client"

const PLAN_TO_TIER: Record<string, "T2" | "T3"> = { diy: "T2", dfy: "T3" }
type PlanId = "diy" | "dfy" | "contingency"
type WindowState = "open" | "closed" | "future_cycle" | "unknown"
type Candidate = { pin: string; address: string; city: string; township: string | null }
type GateState = {
  code: string
  error?: string
  acknowledgmentToken?: string
  window?: { township: string; status: WindowState; openDate?: string | null; closeDate?: string | null }
  candidates?: Candidate[]
}

const PLANS: Array<{ id: PlanId; name: string; price: string; priceNote: string; bullets: string[]; tag?: string }> = [
  {
    id: "diy",
    name: "DIY Appeal Packet",
    price: "$69",
    priceNote: "one-time · your analysis is yours to keep",
    bullets: [
      "Assessment and comparable-property analysis",
      "Appeal argument tailored to assessment level and comp uniformity",
      "Filing instructions when an official window is available",
      "Deadline reminders for a future eligible window",
    ],
    tag: "Recommended",
  },
  {
    id: "dfy",
    name: "Done-For-You",
    price: "$97",
    priceNote: "one-time · available only after eligibility confirmation",
    bullets: [
      "Everything in DIY plus filing preparation and submission when eligible",
      "You sign the authorization — we handle the forms",
      "Tracked through the applicable decision",
      "Payment stays unavailable until we confirm a filing path",
    ],
  },
  {
    id: "contingency",
    name: "Contingency",
    price: "$0 upfront",
    priceNote: "22% of first-year savings (only if we win)",
    bullets: [
      "No upfront cost — we're paid from your savings",
      "Best fit if estimated savings exceed $2,500/year",
      "Same filing quality as Done-For-You",
      "If we don't reduce your bill, you pay $0",
    ],
  },
]

const gateCardStyle: React.CSSProperties = {
  border: "1px solid #d4a72c",
  background: "#fff8e6",
  borderRadius: 10,
  padding: 16,
  color: "#17243b",
}

function checkoutKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`
}

export default function CheckoutPage({ initialPlan = "diy" }: { initialPlan?: PlanId }) {
  const router = useRouter()
  const previewMode = isClientPreviewStubMode()
  const [planId, setPlanId] = useState<PlanId>(initialPlan)
  const [email, setEmail] = useState("")
  const [address, setAddress] = useState("")
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key] = useState(checkoutKey)
  const [gate, setGate] = useState<GateState | null>(null)
  const [analysisAcknowledged, setAnalysisAcknowledged] = useState(false)
  const [selectedPin, setSelectedPin] = useState("")
  const [showNoticeForm, setShowNoticeForm] = useState(false)
  const [noticeDate, setNoticeDate] = useState("")
  const [noticeAddress, setNoticeAddress] = useState("")

  const plan = PLANS.find((item) => item.id === planId)!

  function resetGate() {
    setGate(null)
    setAnalysisAcknowledged(false)
    setSelectedPin("")
    setShowNoticeForm(false)
    setNoticeDate("")
    setNoticeAddress("")
    setError(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (planId === "contingency") {
      router.push("/appeal-contingency")
      return
    }
    if (previewMode) {
      setError("Preview checkout disabled — Stripe is not called in this environment.")
      return
    }
    const tier = PLAN_TO_TIER[planId]
    if (!tier) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          email,
          name: `${first} ${last}`.trim(),
          address,
          checkoutKey: key,
          ...(selectedPin ? { propertyPin: selectedPin } : {}),
          ...(analysisAcknowledged && gate?.acknowledgmentToken
            ? { analysisAcknowledged: true, acknowledgmentToken: gate.acknowledgmentToken }
            : {}),
          ...(showNoticeForm && noticeDate && noticeAddress
            ? { reassessmentNoticeDate: noticeDate, reassessmentNoticeAddress: noticeAddress }
            : {}),
        }),
      })
      const data = (await res.json()) as GateState & { url?: string }
      if (!res.ok) {
        if (["T2_ACKNOWLEDGMENT_REQUIRED", "T3_WINDOW_BLOCKED", "NOTICE_REVIEW_REQUIRED", "ADDRESS_AMBIGUOUS"].includes(data.code)) {
          setGate(data)
          setLoading(false)
          return
        }
        throw new Error(data.error || "Checkout failed")
      }
      if (!data.url) throw new Error("Checkout failed")
      router.push(data.url)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Something went wrong")
      setLoading(false)
    }
  }

  const isAcknowledgmentGate = gate?.code === "T2_ACKNOWLEDGMENT_REQUIRED"
  const isT3Blocked = gate?.code === "T3_WINDOW_BLOCKED" || gate?.code === "NOTICE_REVIEW_REQUIRED"
  const isAmbiguous = gate?.code === "ADDRESS_AMBIGUOUS"

  return (
    <section className="ot-checkout">
      <div className="ot-checkout-inner">
        <nav className="ot-tp-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 16 }}>
          <Link href="/">Home</Link><span>›</span><span>Checkout</span>
        </nav>

        <div className="ot-checkout-grid">
          <div className="ot-checkout-l">
            <div className="ot-eyebrow">Order summary</div>
            <h1 className="ot-h1" style={{ fontSize: 32, lineHeight: 1.2 }}>Choose the help that fits your situation.</h1>
            <p className="ot-checkout-sub">
              Eligibility depends on your confirmed Cook County property and current official filing window. We check both before accepting payment.
            </p>

            <div className="ot-checkout-plans">
              {PLANS.map((item) => (
                <label key={item.id} className={`ot-checkout-plan${planId === item.id ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="plan"
                    value={item.id}
                    checked={planId === item.id}
                    onChange={() => { setPlanId(item.id); resetGate() }}
                  />
                  <div className="ot-checkout-plan-body">
                    <div className="ot-checkout-plan-head">
                      <div className="ot-checkout-plan-name">{item.name}</div>
                      {item.tag && <span className="ot-checkout-plan-tag">{item.tag}</span>}
                    </div>
                    <div className="ot-checkout-plan-price">
                      <span className="ot-checkout-plan-price-amount">{item.price}</span>
                      <span className="ot-checkout-plan-price-note">{item.priceNote}</span>
                    </div>
                    <ul className="ot-checkout-plan-bullets">{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="ot-checkout-r">
            <div className="ot-checkout-r-card">
              <div className="ot-eyebrow">Your details</div>
              <h2 className="ot-h2" style={{ fontSize: 22, lineHeight: 1.25 }}>Let’s confirm your property first.</h2>

              <form className="ot-checkout-form" onSubmit={onSubmit}>
                <div className="ot-checkout-form-row">
                  <label className="ot-field ot-field-half">
                    <span className="ot-field-label">First name</span>
                    <input type="text" required maxLength={120} value={first} onChange={(e) => setFirst(e.target.value)} className="ot-input" autoComplete="given-name" />
                  </label>
                  <label className="ot-field ot-field-half">
                    <span className="ot-field-label">Last name</span>
                    <input type="text" required maxLength={120} value={last} onChange={(e) => setLast(e.target.value)} className="ot-input" autoComplete="family-name" />
                  </label>
                </div>
                <label className="ot-field">
                  <span className="ot-field-label">Email</span>
                  <input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="ot-input" autoComplete="email" placeholder="you@example.com" />
                </label>
                <label className="ot-field">
                  <span className="ot-field-label">Property address</span>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); if (gate) resetGate() }}
                    className="ot-input"
                    autoComplete="street-address"
                    placeholder="123 Main St, Chicago IL 60601"
                  />
                </label>

                {isAcknowledgmentGate && (
                  <div style={gateCardStyle} role="status">
                    <strong>{gate.window?.status === "closed" ? "Your township's appeal window is closed right now." : "Your township's official window isn't confirmed yet."}</strong>
                    <p style={{ margin: "8px 0" }}>
                      {gate.window?.status === "closed"
                        ? "We'll review your current assessment and the case for an appeal. No appeal will be filed now."
                        : "Cook County hasn't published a confirmed open/close date for your township. We can start your assessment analysis now, but we can't promise your appeal window will be open when it's published."}
                    </p>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" checked={analysisAcknowledged} onChange={(e) => setAnalysisAcknowledged(e.target.checked)} />
                      <span>
                        {gate.window?.status === "closed"
                          ? "I understand the appeal window is currently closed and I'm ordering analysis only — no appeal will be filed now."
                          : "I understand I'm ordering an assessment analysis now, and a fileable appeal is not guaranteed until Cook County confirms my township's window."}
                      </span>
                    </label>
                  </div>
                )}

                {isAmbiguous && (
                  <div style={gateCardStyle} role="status">
                    <strong>We found more than one possible match for your address.</strong>
                    <p>To make sure we check the right property and township, pick one below. We won't charge anything until we've confirmed your property.</p>
                    {gate.candidates?.map((candidate) => (
                      <label key={candidate.pin} style={{ display: "block", margin: "8px 0" }}>
                        <input type="radio" name="property-match" value={candidate.pin} checked={selectedPin === candidate.pin} onChange={() => setSelectedPin(candidate.pin)} />{" "}
                        {candidate.address}, {candidate.city}{candidate.township ? ` — ${candidate.township} Township` : ""}
                      </label>
                    ))}
                  </div>
                )}

                {isT3Blocked && (
                  <div style={gateCardStyle} role="status">
                    <strong>{gate.code === "NOTICE_REVIEW_REQUIRED" ? "We need to verify your reassessment notice first." : "We can't offer a full filing for this property right now."}</strong>
                    <p>
                      {gate.code === "NOTICE_REVIEW_REQUIRED"
                        ? "Payment remains unavailable while we confirm eligibility. We won't charge you unless a filing path is verified."
                        : "Based on what we can confirm for your township and property, we're not able to take on a filing at this time. We don't want you to pay for something we can't complete."}
                    </p>
                    <p><strong>What you can do instead:</strong> Check your township's official window and assessment for free, and come back if your situation changes.</p>
                    <Link href="/#free-check">Check my township for free</Link>
                    {gate.code === "T3_WINDOW_BLOCKED" && !showNoticeForm && (
                      <button type="button" className="ot-btn-link" onClick={() => { setShowNoticeForm(true); setNoticeAddress(address) }} style={{ display: "block", marginTop: 12 }}>
                        I received an individual reassessment notice
                      </button>
                    )}
                    {showNoticeForm && (
                      <div style={{ marginTop: 14 }}>
                        <p><strong>Got a reassessment notice? That can open an appeal window.</strong></p>
                        <label className="ot-field">
                          <span className="ot-field-label">Notice date (from the letter)</span>
                          <input className="ot-input" type="date" required value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
                        </label>
                        <label className="ot-field">
                          <span className="ot-field-label">Property address on the notice</span>
                          <input className="ot-input" type="text" required maxLength={200} value={noticeAddress} onChange={(e) => setNoticeAddress(e.target.value)} />
                        </label>
                        <p style={{ fontSize: 13 }}>Please don't share your PIN, assessed value, or the notice itself here.</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="ot-checkout-total"><div className="ot-checkout-total-key">{plan.name}</div><div className="ot-checkout-total-val">{plan.price}</div></div>

                {isT3Blocked && !showNoticeForm ? (
                  <button type="button" className="ot-cta ot-cta-block ot-cta-tall" disabled>Payment unavailable</button>
                ) : isT3Blocked && gate?.code === "NOTICE_REVIEW_REQUIRED" ? (
                  <button type="button" className="ot-cta ot-cta-block ot-cta-tall" disabled>Payment unavailable</button>
                ) : (
                  <button
                    type="submit"
                    className="ot-cta ot-cta-block ot-cta-tall"
                    disabled={loading || previewMode || (isAcknowledgmentGate && !analysisAcknowledged) || (isAmbiguous && !selectedPin) || (showNoticeForm && (!noticeDate || !noticeAddress))}
                  >
                    {loading ? "Checking eligibility…" : isAmbiguous ? "Use this property" : isAcknowledgmentGate || showNoticeForm ? "Confirm and continue" : planId === "contingency" ? "Request contingency review →" : "Continue to payment →"}
                  </button>
                )}

                {error && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{error}</p>}
              </form>
              <div className="ot-checkout-rrb"><RiskReversalBadge variant="full" /></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiskReversalBadge } from "@/components/ot-design/SiteChrome";
import { isClientPreviewStubMode } from "@/lib/marketing/preview-gate-client";

const PLAN_TO_TIER: Record<string, string> = {
  diy: "T2",
  dfy: "T3",
};

type PlanId = "diy" | "dfy" | "contingency";

const PLANS: Array<{
  id: PlanId;
  name: string;
  price: string;
  priceNote: string;
  bullets: string[];
  tag?: string;
}> = [
  {
    id: "diy",
    name: "DIY Appeal Packet",
    price: "$69",
    priceNote: "one-time · keep 100% of your savings",
    bullets: [
      "Pre-written appeal argument tailored to assessment level and comp uniformity",
      "3 nearby comps formatted for the Board of Review",
      "Step-by-step filing instructions for your township",
      "Deadline reminders for your 2026 window + 2027 second pass",
    ],
    tag: "Recommended",
  },
  {
    id: "dfy",
    name: "Done-For-You",
    price: "$97",
    priceNote: "one-time · we file and follow up",
    bullets: [
      "Everything in DIY plus we prepare + submit the appeal",
      "You sign the authorization — we handle the Board of Review forms",
      "Tracked through BoR decision",
      "Procedural refund on township procedural denial",
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
];

export default function CheckoutPage() {
  const router = useRouter();
  const previewMode = isClientPreviewStubMode();
  const [planId, setPlanId] = useState<PlanId>("diy");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = PLANS.find((p) => p.id === planId)!;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (planId === "contingency") {
      router.push("/appeal-contingency");
      return;
    }
    if (previewMode) {
      setError("Preview checkout disabled — Stripe is not called in this environment.");
      return;
    }
    const tier = PLAN_TO_TIER[planId];
    if (!tier) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          email,
          name: `${first} ${last}`.trim(),
          address,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Checkout failed");
      }
      const { url } = await res.json();
      router.push(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <section className="ot-checkout">
      <div className="ot-checkout-inner">
        <nav className="ot-tp-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 16 }}>
          <Link href="/">Home</Link>
          <span>›</span>
          <span>Checkout</span>
        </nav>

        <div className="ot-checkout-grid">
          <div className="ot-checkout-l">
            <div className="ot-eyebrow">Order summary</div>
            <h1 className="ot-h1" style={{ fontSize: 32, lineHeight: 1.2 }}>
              You&apos;re a few details away from filing.
            </h1>
            <p className="ot-checkout-sub">
              Pick how hands-on you want to be. All three options come with
              the same procedural refund policy if the township denies the filing on procedural grounds.
            </p>

            <div className="ot-checkout-plans">
              {PLANS.map((p) => (
                <label
                  key={p.id}
                  className={`ot-checkout-plan${planId === p.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={planId === p.id}
                    onChange={() => setPlanId(p.id)}
                  />
                  <div className="ot-checkout-plan-body">
                    <div className="ot-checkout-plan-head">
                      <div className="ot-checkout-plan-name">{p.name}</div>
                      {p.tag && <span className="ot-checkout-plan-tag">{p.tag}</span>}
                    </div>
                    <div className="ot-checkout-plan-price">
                      <span className="ot-checkout-plan-price-amount">{p.price}</span>
                      <span className="ot-checkout-plan-price-note">{p.priceNote}</span>
                    </div>
                    <ul className="ot-checkout-plan-bullets">
                      {p.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="ot-checkout-r">
            <div className="ot-checkout-r-card">
              <div className="ot-eyebrow">Your details</div>
              <h2 className="ot-h2" style={{ fontSize: 22, lineHeight: 1.25 }}>
                Where should we send your packet?
              </h2>

              <form className="ot-checkout-form" onSubmit={onSubmit}>
                <div className="ot-checkout-form-row">
                  <label className="ot-field ot-field-half">
                    <span className="ot-field-label">First name</span>
                    <input
                      type="text"
                      required
                      value={first}
                      onChange={(e) => setFirst(e.target.value)}
                      className="ot-input"
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="ot-field ot-field-half">
                    <span className="ot-field-label">Last name</span>
                    <input
                      type="text"
                      required
                      value={last}
                      onChange={(e) => setLast(e.target.value)}
                      className="ot-input"
                      autoComplete="family-name"
                    />
                  </label>
                </div>

                <label className="ot-field">
                  <span className="ot-field-label">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ot-input"
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="ot-field">
                  <span className="ot-field-label">Property address</span>
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="ot-input"
                    autoComplete="street-address"
                    placeholder="123 Main St, Chicago IL 60601"
                  />
                </label>

                <div className="ot-checkout-total">
                  <div className="ot-checkout-total-key">{plan.name}</div>
                  <div className="ot-checkout-total-val">{plan.price}</div>
                </div>

                <button
                  type="submit"
                  className="ot-cta ot-cta-block ot-cta-tall"
                  disabled={loading || previewMode}
                >
                  {loading
                    ? "Redirecting to payment…"
                    : planId === "contingency"
                    ? "Request contingency review →"
                    : "Continue to payment →"}
                </button>

                {error && (
                  <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{error}</p>
                )}
              </form>

              <div className="ot-checkout-rrb">
                <RiskReversalBadge variant="full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

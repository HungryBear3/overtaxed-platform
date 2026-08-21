"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Check } from "lucide-react";
import { isClientPreviewStubMode } from "@/lib/marketing/preview-gate-client";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import { CC_10, CC_11, CC_12 } from "@/lib/copy/canonical";
import "../ot-design.css";

/**
 * One tier, because only one is offered.
 *
 * The $97 "Done-For-You" and 22% "Contingency" tiers are removed rather than
 * marked unavailable. Both were held products, and both described a service
 * posture that is not merely paused but barred: "We submit the Board of Review
 * forms" is BL-A2 — Board Rule 1 permits only a licensed attorney or the
 * taxpayer personally to practise there, so that line could not be honoured at
 * any price. "Full appeal management" and "Dedicated case manager" are BL-A6.
 *
 * Leaving them on the page greyed out would keep making the claim while
 * removing only the ability to pay for it.
 */
const tiers = [
  {
    id: "T2",
    name: "DIY Appeal Packet",
    price: "$69",
    priceSub: "one-time",
    description: "We build your comparable-property packet. You file it yourself.",
    features: [
      "Comparable property analysis",
      "Ready-to-use comp report",
      "Appeal argument draft",
      "Step-by-step filing guide",
      "Priority email support",
    ],
    cta: "Buy Now",
    href: null,
    popular: true,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewMode = isClientPreviewStubMode();

  async function handleBuyNow(tierId: string) {
    if (previewMode) {
      setError("Preview checkout disabled — Stripe is not called in this environment.");
      return;
    }
    setError(null);
    // The T3 branch previously routed to /checkout?plan=done-for-you. There is
    // no held-tier branch here any more: the only reachable plan is the packet.
    void tierId;
    router.push("/checkout?plan=diy");
  }

  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="bg-gray-50">
      {/* Hero */}
      <section className="bg-white border-b border-gray-100 py-16 px-4 text-center">
        <h1 className="text-4xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
          One way to file your Cook County appeal
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          {CC_10} {CC_12}
        </p>
      </section>

      {/* Pricing Grid */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        {/* One card, centred. "Most Popular" is also gone: with a single tier
            it would be a comparative claim with nothing to compare against. */}
        <div className="mx-auto max-w-sm">
          {tiers.map((tier) => (
            <Card key={tier.id} className="relative flex flex-col border-blue-500 border-2 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-gray-900">
                  {tier.name}
                </CardTitle>
                <div className="mt-2">
                  <span className="text-3xl font-extrabold text-gray-900">
                    {tier.price}
                  </span>
                  <span className="text-sm text-gray-400 ml-1 block leading-snug">
                    {tier.priceSub}
                  </span>
                </div>
                <CardDescription className="mt-2 text-sm text-gray-500">
                  {tier.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col flex-1">
                <ul className="space-y-2 flex-1">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-sm text-gray-600">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {tier.href ? (
                    <Link
                      href={tier.href}
                      className={buttonVariants({ variant: "outline", size: "md", className: "w-full justify-center" })}
                    >
                      {tier.cta}
                    </Link>
                  ) : (
                    <button
                      className={buttonVariants({ variant: "primary", size: "md", className: "w-full justify-center" })}
                      onClick={() => handleBuyNow(tier.id)}
                      disabled={loadingTier === tier.id || previewMode}
                      aria-disabled={previewMode}
                      title={previewMode ? "Preview checkout disabled — Stripe is not called in this environment." : undefined}
                    >
                      {previewMode
                        ? "Preview checkout disabled"
                        : loadingTier === tier.id
                        ? "Loading..."
                        : tier.cta}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {error && (
          <p className="text-center text-red-500 mt-6 text-sm">{error}</p>
        )}
      </section>

      {/* The "How a flat packet compares to an attorney contingency" table is
          removed, not relabelled. Every cell in its third column was a dollar
          savings figure — "$2,000 if granted", "$1,903–$1,931 if granted" —
          which BL-B3 bans outright, and calling it illustrative does not stop a
          reader treating it as what they would get. It also equated a $2,000
          assessment reduction with $2,000 kept, the exact one-to-one
          assessment-to-bill equivalence BL-B6 bans and that CC-12, rendered on
          this same page, explicitly denies. There is no version of this table
          that keeps its point without making the claim. */}

      <section className="bg-white border-t border-gray-100 py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            What the packet is, and what it is not
          </h2>
          <p className="text-gray-600 text-sm mb-3">{CC_10}</p>
          <p className="text-gray-600 text-sm mb-3">{CC_12}</p>
          <p className="text-gray-600 text-sm">{CC_11}</p>
        </div>
      </section>

      <section className="py-12 px-4 text-center">
        <p className="text-gray-500 text-sm">
          Questions?{" "}
          <Link
            href="mailto:support@overtaxed-il.com"
            className="text-blue-600 underline"
          >
            Email us
          </Link>{" "}
          or{" "}
          <Link href="/check" className="text-blue-600 underline">
            run a free check first
          </Link>
          .
        </p>
      </section>
      </main>
      <SiteFooter />
    </div>
  );
}

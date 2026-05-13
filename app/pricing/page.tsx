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
import "../ot-design.css";

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
  {
    id: "T3",
    name: "Done-For-You",
    price: "$97",
    priceSub: "one-time",
    description: "We prepare the packet and submit the appeal after you sign authorization.",
    features: [
      "Everything in DIY Appeal Packet",
      "Explicit filing authorization at checkout",
      "We submit the Board of Review forms",
      "Status tracking through decision",
      "Phone + email support",
    ],
    cta: "Buy Now",
    href: null,
    popular: false,
  },
  {
    id: "T4",
    name: "Contingency",
    price: "22%",
    priceSub: "of first-year savings · $0 upfront · $50 minimum",
    description:
      "We handle everything. You pay only if the county reduces your assessment.",
    features: [
      "Everything in Done-For-You",
      "No upfront cost",
      "Fee applies only to granted savings",
      "Full appeal management",
      "Dedicated case manager",
    ],
    cta: "Request contingency review",
    href: "/appeal-contingency",
    popular: false,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewMode = isClientPreviewStubMode();

  async function handleBuyNow(tierId: string) {
    if (previewMode) {
      // Belt and suspenders — the button is also disabled in preview, but
      // refuse to call /api/checkout/session in any case.
      setError("Preview checkout disabled — Stripe is not called in this environment.");
      return;
    }
    setLoadingTier(tierId);
    setError(null);
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Checkout failed");
      }
      const { url } = await res.json();
      router.push(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoadingTier(null);
    }
  }

  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="bg-gray-50">
      {/* Hero */}
      <section className="bg-white border-b border-gray-100 py-16 px-4 text-center">
        <h1 className="text-4xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
          Three clear ways to file your Cook County appeal
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          DIY Appeal Packet ($69), Done-For-You filing ($97), or Contingency (22% of first-year savings only if the county grants a reduction). Every option is built around Cook County Assessor + Board of Review public records. We don&apos;t guarantee a reduction — county decisions are final.
        </p>
      </section>

      {/* Pricing Grid */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {tiers.map((tier) => (
            <Card
              key={tier.id}
              className={`relative flex flex-col ${
                tier.popular
                  ? "border-blue-500 border-2 shadow-lg"
                  : "border-gray-200"
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}
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

      {/* Illustrative cost comparison */}
      <section className="bg-white border-t border-gray-100 py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            How a flat packet compares to an attorney contingency
          </h2>
          <p className="text-gray-500 mb-2 text-sm">
            Illustrative example only — your actual savings depend on the
            reduction granted by the county and your township tax rate.
          </p>
          <div className="overflow-x-auto mt-6">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-3 font-semibold text-gray-700 border border-gray-200">
                    Option
                  </th>
                  <th className="text-right p-3 font-semibold text-gray-700 border border-gray-200">
                    Cost
                  </th>
                  <th className="text-right p-3 font-semibold text-gray-700 border border-gray-200">
                    You keep on a $2,000 illustrative reduction
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-3 border border-gray-200 text-gray-600">
                    DIY filing (no help)
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    $0
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    $2,000 if granted
                  </td>
                </tr>
                <tr className="bg-blue-50">
                  <td className="p-3 border border-gray-200 font-semibold text-blue-800">
                    OverTaxed IL DIY packet ($69) or DFY ($97)
                  </td>
                  <td className="p-3 border border-gray-200 text-right font-semibold text-blue-800">
                    Flat $69 or $97
                  </td>
                  <td className="p-3 border border-gray-200 text-right font-semibold text-blue-800">
                    $1,903–$1,931 if granted
                  </td>
                </tr>
                <tr>
                  <td className="p-3 border border-gray-200 text-gray-600">
                    Attorney contingency
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    Percentage of savings (varies by firm)
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    Whatever the contingency leaves you with
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            OverTaxed IL is not a law firm. Attorney fees vary widely — check
            your attorney&apos;s engagement letter for their actual rate.
          </p>
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

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

const tiers = [
  {
    id: "T1",
    name: "DIY Starter",
    price: "$37",
    priceSub: "one-time",
    description:
      "PDF packet + instructions. You find comps and file yourself.",
    features: [
      "Appeal instructions guide",
      "Appeal letter template",
      "Filing checklist",
      "Deadline calendar",
      "Email support",
    ],
    cta: "Buy Now",
    href: null,
    popular: false,
  },
  {
    id: "T2",
    name: "DIY Pro",
    price: "$69",
    priceSub: "one-time",
    description: "We build your comp package. You file yourself.",
    features: [
      "Everything in DIY Starter",
      "Comparable property analysis",
      "Ready-to-use comp report",
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
    priceSub: "flat, one-time",
    description: "We prepare everything + submit your appeal on your behalf.",
    features: [
      "Everything in DIY Pro",
      "We file the appeal for you",
      "Professional appeal letter",
      "Hearing representation guidance",
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
    priceSub: "of first-year savings · $0 upfront · $50 min",
    description:
      "We handle everything. You pay only if we win your appeal.",
    features: [
      "Everything in Done-For-You",
      "No upfront cost",
      "We win or you pay nothing",
      "Full appeal management",
      "Dedicated case manager",
    ],
    cta: "Get Started Free",
    href: "/appeal-contingency",
    popular: false,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuyNow(tierId: string) {
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
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-white border-b border-gray-100 py-16 px-4 text-center">
        <h1 className="text-4xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
          Pay only if we win — or choose a flat rate that beats any attorney
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          Illinois homeowners overpay $1B+ in property taxes every year. We fix
          that — starting at $37.
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
                      disabled={loadingTier === tier.id}
                    >
                      {loadingTier === tier.id ? "Loading..." : tier.cta}
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

      {/* ROI Comparison */}
      <section className="bg-white border-t border-gray-100 py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            How we compare to a tax attorney
          </h2>
          <p className="text-gray-500 mb-8 text-sm">
            Most Illinois property tax attorneys charge 33–40% of savings.
            We&apos;re 22% — and you can start for as little as $37.
          </p>
          <div className="overflow-x-auto">
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
                    You keep (on $2k savings)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-3 border border-gray-200 text-gray-600">
                    DIY (no help)
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    $0
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    $2,000 (if you win)
                  </td>
                </tr>
                <tr className="bg-blue-50">
                  <td className="p-3 border border-gray-200 font-semibold text-blue-800">
                    Overtaxed IL — Contingency
                  </td>
                  <td className="p-3 border border-gray-200 text-right font-semibold text-blue-800">
                    22%
                  </td>
                  <td className="p-3 border border-gray-200 text-right font-semibold text-blue-800">
                    $1,560
                  </td>
                </tr>
                <tr>
                  <td className="p-3 border border-gray-200 text-gray-600">
                    Tax attorney (typical)
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    33–40%
                  </td>
                  <td className="p-3 border border-gray-200 text-right text-gray-600">
                    $1,200–$1,340
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ / CTA */}
      <section className="py-12 px-4 text-center">
        <p className="text-gray-500 text-sm">
          Questions?{" "}
          <Link
            href="mailto:hello@overtaxed-il.com"
            className="text-blue-600 underline"
          >
            Email us
          </Link>{" "}
          or{" "}
          <Link href="/check" className="text-blue-600 underline">
            check your property for free first
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

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
import { CC_11, CC_12 } from "@/lib/copy/canonical";
import { NEUTRAL_REPORT_LIMITS, NEUTRAL_REPORT_NAME, NEUTRAL_REPORT_PRICE, NEUTRAL_REPORT_QA, NEUTRAL_REPORT_REFUND, NEUTRAL_REPORT_SUMMARY, NEUTRAL_REPORT_TURNAROUND } from "@/lib/copy/neutral-report";

/**
 * Default posture: DIY versus paid preparation, owner-approved copy.
 *
 * The default page no longer sells from a feature list. The previous card
 * listed packet contents and support ("argument draft", "filing guide",
 * "priority email support") that the approved claim map does not support, and
 * its "Buy Now" button implied a packet was available for any visitor. The
 * default card now points to the free check, with the limits of that check
 * stated next to the link. The refund answer restates the published Terms §7
 * conditions and links to the Terms as the authoritative statement.
 *
 * The neutral-report posture below is unchanged, including its checkout path.
 */
const neutralTiers = [{
  id: "T2", name: NEUTRAL_REPORT_NAME, price: NEUTRAL_REPORT_PRICE, priceSub: "one-time",
  description: NEUTRAL_REPORT_SUMMARY,
  features: ["Official assessment records with source details", "Properties matching the published filters", NEUTRAL_REPORT_QA, NEUTRAL_REPORT_TURNAROUND, NEUTRAL_REPORT_REFUND],
  cta: "Get My Records Report", href: null as string | null, popular: true,
}];

const ASSESSOR_APPEALS_URL = "https://www.cookcountyassessoril.gov/appeals";
const TERMS_URL = "https://www.overtaxed-il.com/terms";

function DiyPaidOffer() {
  return (
    <>
      <section className="bg-white border-b border-gray-100 py-16 px-4 text-center">
        <h1 className="text-4xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
          You can appeal for free. Paid preparation is optional.
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          {"The Cook County Assessor's Office says filing an appeal is free and can be done online. In its words: \"You do not need to hire anyone to file an appeal for you.\" Start with the Assessor's own page: "}
          <a
            href={ASSESSOR_APPEALS_URL}
            className="text-blue-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            How appeals work
          </a>
          .
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-16">
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold text-gray-900">
                Do it yourself, free.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                {"You file directly with the Assessor's Office, following its instructions. You do not need OverTaxed IL, or anyone else, to do that."}
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col border-blue-500 border-2 shadow-lg">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold text-gray-900">
                Paid preparation, if you want it.
              </CardTitle>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">DIY Appeal Packet</p>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <p className="text-sm text-gray-600">
                {"OverTaxed IL's published price is $69, one-time, for Assessor-stage comparable-property preparation built from public Cook County records. We prepare it. You review it, sign it and file it with the county yourself."}
              </p>
              <p className="mt-4 text-sm font-semibold text-gray-900">
                A few things to be clear about:
              </p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-gray-600">
                <li>We are not a law firm. We do not represent you and do not give legal or tax advice.</li>
                <li>We do not guarantee a reduction. A change in assessed value does not produce an equal change in a tax bill.</li>
                <li>A published price does not mean a packet is available for every property.</li>
              </ul>
              <div className="mt-6">
                <p className="text-sm font-semibold text-gray-900">Not sure where you stand?</p>
                <Link
                  href="/check"
                  className={buttonVariants({ variant: "primary", size: "md", className: "mt-2 w-full justify-center" })}
                >
                  Run the free check
                </Link>
                <p className="mt-2 text-xs text-gray-500">
                  Results are not available for every property, and a result does not mean a paid packet is available for yours.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="pricing-questions" className="bg-white border-t border-gray-100 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 id="pricing-questions" className="text-2xl font-bold text-gray-900 mb-6">
            Questions
          </h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900">Do I have to pay anyone to appeal?</h3>
              <p className="mt-1 text-sm text-gray-600">
                No. The Assessor&apos;s Office says filing is free and that you do not need to hire anyone. Paid preparation is a convenience, not a requirement.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Does OverTaxed IL file for me or represent me?</h3>
              <p className="mt-1 text-sm text-gray-600">
                No. We prepare materials for the Assessor stage. You review, sign and file them yourself, and you remain responsible for filing.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Can I get a refund?</h3>
              <p className="mt-1 text-sm text-gray-600">
                Refunds are not automatic. If your filing is rejected or denied solely because of an OverTaxed IL procedural error in the materials we prepared, contact us within 30 days of the county notice and we will review whether a refund of our fee is appropriate. That review does not apply when the county denies an appeal on the merits, and other exclusions apply. The full conditions are in our{" "}
                <a href={TERMS_URL} className="text-blue-600 underline">
                  Terms
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default function PricingPageClient({ neutralReport = false }: { neutralReport?: boolean }) {
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewMode = isClientPreviewStubMode();
  const visibleTiers = neutralTiers;

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
      {!neutralReport ? <DiyPaidOffer /> : (
      <>
      {/* Hero */}
      <section className="bg-white border-b border-gray-100 py-16 px-4 text-center">
        <h1 className="text-4xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
          See the official records behind your assessment
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          {NEUTRAL_REPORT_LIMITS}
        </p>
      </section>

      {/* Pricing Grid */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="mx-auto max-w-sm">
          {visibleTiers.map((tier) => (
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

      <section className="bg-white border-t border-gray-100 py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            What the report is, and what it is not
          </h2>
          <p className="text-gray-600 text-sm mb-3">{NEUTRAL_REPORT_LIMITS}</p>
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
      </>
      )}
      </main>
      <SiteFooter neutralReport={neutralReport} />
    </div>
  );
}

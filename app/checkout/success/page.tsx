import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/db";

interface Props {
  searchParams?: Promise<{ tier?: string; session_id?: string }>;
}

export const metadata = {
  title: "Payment Successful | Overtaxed IL",
  description: "Your payment was received. We'll be in touch soon.",
};

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { session_id: sessionId } = (await searchParams) ?? {};
  const order = sessionId
    ? await prisma.oTOrder.findUnique({
      where: { stripeSessionId: sessionId },
      select: { tier: true, status: true },
    })
    : null

  const state = !order
    ? "PENDING"
    : order.tier === "T1"
      ? "RECOVERY"
    : order.status === "PAID_RECOVERY_REQUIRED"
      ? "RECOVERY"
      : order.status === "PAID"
        ? "PAID"
        : "PENDING"
  const isAnalysisOnly = order?.tier === "T2";

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="w-16 h-16 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          {state === "PAID" ? "Payment Received" : state === "RECOVERY" ? "Payment Received, Review Pending" : "We're still verifying your payment"}
        </h1>

        {state === "PENDING" ? (
          <div className="space-y-3">
            <p className="text-gray-600">
              We&apos;re still verifying your Stripe session with our records before we claim payment success or start any work.
            </p>
            <p className="text-gray-500 text-sm">
              If payment already settled, we&apos;ll email you once the order is confirmed.
            </p>
          </div>
        ) : state === "RECOVERY" ? (
          <div className="space-y-3">
            <p className="text-gray-600">
              We received your payment, but this order needs manual review before any fulfillment decision.
            </p>
            <p className="text-gray-500 text-sm">
              Operations has durable recovery records for this session and will contact you if anything else is needed.
            </p>
          </div>
        ) : isAnalysisOnly ? (
          <div className="space-y-3">
            <p className="text-gray-600">
              We received your payment for the analysis service.
            </p>
            <p className="text-gray-500 text-sm">
              You&apos;ll receive a confirmation email with the next analysis step. This page does not claim that an appeal was filed or started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-gray-600">
              We received your payment and will be in touch within{" "}
              <strong>24 hours</strong> to get started on your appeal.
            </p>
            <p className="text-gray-500 text-sm">
              You&apos;ll receive a confirmation email with next steps. Keep an eye
              on your inbox (and spam folder, just in case).
            </p>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-100">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Return to home
          </Link>
        </div>
      </div>
    </main>
  );
}

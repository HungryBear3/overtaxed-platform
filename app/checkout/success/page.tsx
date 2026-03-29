import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface Props {
  searchParams: { tier?: string; session_id?: string };
}

export const metadata = {
  title: "Payment Successful | Overtaxed IL",
  description: "Your payment was received. We'll be in touch soon.",
};

export default function CheckoutSuccessPage({ searchParams }: Props) {
  const tier = searchParams.tier;
  const isT1 = tier === "T1";

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="w-16 h-16 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Payment Successful! 🎉
        </h1>

        {isT1 ? (
          <div className="space-y-3">
            <p className="text-gray-600">
              Your Illinois Property Tax Appeal Packet is ready. Check your
              email for the download link.
            </p>
            <p className="text-gray-500 text-sm">
              Didn&apos;t get the email? Download it directly:
            </p>
            <Link
              href="/appeal-packet/success"
              className={buttonVariants({ variant: "primary", size: "md", className: "w-full justify-center" })}
            >
              Download Your Appeal Packet
            </Link>
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

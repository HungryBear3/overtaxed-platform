import Link from "next/link";
import { CheckCircle } from "lucide-react";

export const metadata = {
  title: "Request Received | Overtaxed IL",
  description: "We received your appeal request and will be in touch soon.",
};

export default function ContingencySuccessPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="w-16 h-16 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          We&apos;ve Got It!
        </h1>
        <p className="text-gray-600 mb-4">
          We will review your property and be in touch within{" "}
          <strong>2 business days</strong>.
        </p>
        <p className="text-gray-500 text-sm mb-6">
          A confirmation email is on its way. If you have any questions in the
          meantime, reply to that email.
        </p>
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Return to home
        </Link>
      </div>
    </main>
  );
}

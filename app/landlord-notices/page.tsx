import Link from "next/link";

export const metadata = {
  title: "Illinois Landlord Notice Templates — Pay or Quit, Lease Violation, Entry & Eviction Prep",
  description: "4 ready-to-file Illinois landlord notices: 5-Day Pay or Quit, 10-Day Lease Violation, Entry Notice, and Eviction Prep Guide. Instant download.",
};

export default function LandlordNoticesPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="inline-block bg-red-100 text-red-800 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-3">
          Instant Download
        </span>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
          Illinois Landlord Notice Templates
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          4 legally-grounded notices ready to serve today.
        </p>
        <p className="text-gray-500 text-sm">
          Pay or Quit · Lease Violation · Entry Notice · Eviction Prep Guide
        </p>
      </div>

      {/* Price + CTA */}
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center mb-10">
        <div className="mb-2">
          <span className="text-gray-400 line-through text-xl mr-2">$34</span>
          <span className="text-4xl font-extrabold text-gray-900">$17</span>
        </div>
        <p className="text-gray-500 text-sm mb-6">One-time purchase · Instant ZIP download</p>
        <a
          href="https://www.etsy.com/listing/4479848685"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-red-700 hover:bg-red-800 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Templates — $17 →
        </a>
        <p className="text-xs text-gray-400 mt-3">Available on Etsy · Secure checkout</p>
      </div>

      {/* What's included */}
      <section className="mb-10">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">What&apos;s Included</h2>
        <div className="space-y-4">
          {[
            { emoji: "📋", title: "5-Day Pay or Quit Notice", desc: "Serve when rent is overdue. Includes service instructions and Illinois statute reference (735 ILCS 5/9-209)." },
            { emoji: "⚠️", title: "10-Day Lease Violation Notice", desc: "Covers unauthorized pets, noise, damage, unauthorized occupants, and more. Includes cure instructions." },
            { emoji: "🔑", title: "Landlord Entry Notice", desc: "Proper notice for inspections, repairs, showings, and maintenance. Includes Chicago RLTO notes." },
            { emoji: "⚖️", title: "Eviction Prep Guide", desc: "What to file, when, and how to collect after judgment — including wage garnishment and liens." },
          ].map(({ emoji, title, desc }) => (
            <div key={title} className="flex gap-4 bg-gray-50 rounded-xl p-5 border border-gray-100">
              <span className="text-3xl flex-shrink-0 mt-1">{emoji}</span>
              <div>
                <p className="font-semibold text-gray-900">{title}</p>
                <p className="text-gray-500 text-sm mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust signals */}
      <section className="grid grid-cols-3 gap-4 mb-10 text-center">
        {[
          { emoji: "⚡", label: "Instant download" },
          { emoji: "🗺️", label: "All IL counties" },
          { emoji: "📝", label: "Plain English" },
        ].map(({ emoji, label }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="text-2xl mb-1">{emoji}</div>
            <p className="text-sm font-medium text-gray-700">{label}</p>
          </div>
        ))}
      </section>

      {/* CTA repeat */}
      <div className="text-center">
        <a
          href="https://www.etsy.com/listing/4479848685"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-red-700 hover:bg-red-800 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Templates — $17 →
        </a>
        <p className="text-xs text-gray-400 mt-3">
          Need to appeal your property taxes too?{" "}
          <Link href="/appeal-packet" className="text-blue-600 hover:underline">
            Get the Appeal Packet →
          </Link>
        </p>
      </div>
    </main>
  );
}

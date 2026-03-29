import Link from "next/link";

export const metadata = {
  title: "Illinois Expungement & Sealing Guide — Clear Your Criminal Record",
  description: "Step-by-step Illinois expungement and sealing guide. Check eligibility, complete the petition, and clear your record. Covers arrests, convictions, cannabis, and juvenile records.",
};

export default function ExpungementGuidePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-3">
          Instant Download
        </span>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
          Illinois Expungement &amp; Sealing Guide
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Clear your record without hiring an attorney.
        </p>
        <p className="text-gray-500 text-sm">
          Eligibility guide · Petition checklist · FAQ — plain English
        </p>
      </div>

      {/* Price + CTA */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center mb-10">
        <div className="mb-2">
          <span className="text-gray-400 line-through text-xl mr-2">$47</span>
          <span className="text-4xl font-extrabold text-gray-900">$27</span>
        </div>
        <p className="text-gray-500 text-sm mb-6">One-time purchase · Instant ZIP download</p>
        <a
          href="https://www.etsy.com/listing/4479848697"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-blue-900 hover:bg-blue-950 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Guide — $27 →
        </a>
        <p className="text-xs text-gray-400 mt-3">Available on Etsy · Secure checkout</p>
      </div>

      {/* What's included */}
      <section className="mb-10">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">What&apos;s Included</h2>
        <div className="space-y-4">
          {[
            { emoji: "✅", title: "Eligibility Guide", desc: "Expunge vs. seal, waiting periods, ineligible offenses, Illinois Clean Slate Act, and automatic sealing rules." },
            { emoji: "📋", title: "7-Phase Petition Checklist", desc: "From requesting your ISP record through final confirmation — every step, in order, with links and fees." },
            { emoji: "❓", title: "FAQ — 15 Plain-English Answers", desc: "Can I say 'no' on a job app? What about a DUI? Federal background checks? Multiple counties? All answered." },
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

      {/* Covers */}
      <section className="mb-10 bg-blue-50 rounded-2xl p-6 border border-blue-100">
        <h2 className="text-lg font-bold text-gray-900 mb-3">This Guide Covers</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          {[
            "Arrests without conviction",
            "Court supervision (completed)",
            "Misdemeanor convictions",
            "Class 4 felonies (eligible ones)",
            "Cannabis convictions",
            "Juvenile records",
            "Multiple-county situations",
            "Cook County specifics",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="text-blue-700 font-bold">✓</span> {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Trust signals */}
      <section className="grid grid-cols-3 gap-4 mb-10 text-center">
        {[
          { emoji: "⚡", label: "Instant download" },
          { emoji: "🗺️", label: "All IL counties" },
          { emoji: "📝", label: "No lawyer needed" },
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
          href="https://www.etsy.com/listing/4479848697"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-blue-900 hover:bg-blue-950 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Guide — $27 →
        </a>
        <p className="text-xs text-gray-400 mt-3">
          Have a property tax issue too?{" "}
          <Link href="/appeal-packet" className="text-blue-600 hover:underline">
            See the Appeal Packet →
          </Link>
        </p>
      </div>
    </main>
  );
}

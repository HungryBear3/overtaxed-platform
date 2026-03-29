import Link from "next/link";

export const metadata = {
  title: "Illinois Divorce Prep Checklist — Documents, Basics & Attorney Questions",
  description: "Prepare for your Illinois divorce before spending thousands on an attorney. Complete document checklist, Illinois divorce basics, and 42 questions to ask your lawyer.",
};

export default function DivorcePrepPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="inline-block bg-teal-100 text-teal-800 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-3">
          Instant Download
        </span>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
          Illinois Divorce Prep Checklist
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Prepare before you spend $5,000+ on an attorney.
        </p>
        <p className="text-gray-500 text-sm">
          Document checklist · Illinois divorce basics · 42 attorney questions
        </p>
      </div>

      {/* Price + CTA */}
      <div className="bg-teal-50 border border-teal-200 rounded-2xl p-8 text-center mb-10">
        <div className="mb-2">
          <span className="text-gray-400 line-through text-xl mr-2">$67</span>
          <span className="text-4xl font-extrabold text-gray-900">$37</span>
        </div>
        <p className="text-gray-500 text-sm mb-6">One-time purchase · Instant ZIP download</p>
        <a
          href="https://www.etsy.com/listing/4479856396"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-teal-700 hover:bg-teal-800 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Kit — $37 →
        </a>
        <p className="text-xs text-gray-400 mt-3">Available on Etsy · Secure checkout</p>
      </div>

      {/* What's included */}
      <section className="mb-10">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">What&apos;s Included</h2>
        <div className="space-y-4">
          {[
            { emoji: "📂", title: "Complete Document Checklist", desc: "8 categories: personal ID, income, assets, retirement, real estate, debts, children, and insurance. Everything you need to walk into your first attorney meeting." },
            { emoji: "📖", title: "Illinois Divorce Basics", desc: "Property division, spousal maintenance formula, child custody allocation, child support calculation, and realistic timelines — in plain English." },
            { emoji: "❓", title: "42 Questions to Ask Your Attorney", desc: "Covers strategy, property, children, support, costs, and protecting yourself. Walk in prepared and save $500+ in billable time." },
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

      {/* Who it's for */}
      <section className="mb-10 bg-teal-50 rounded-2xl p-6 border border-teal-100">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Covers All Situations</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          {[
            "Uncontested divorce",
            "Contested divorce",
            "High-asset situations",
            "Marriages with children",
            "Business owner divorces",
            "Retirement account splits",
            "Spousal support questions",
            "Chicago & all IL counties",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="text-teal-700 font-bold">✓</span> {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Trust signals */}
      <section className="grid grid-cols-3 gap-4 mb-10 text-center">
        {[
          { emoji: "⚡", label: "Instant download" },
          { emoji: "💰", label: "Save on attorney time" },
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
          href="https://www.etsy.com/listing/4479856396"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-teal-700 hover:bg-teal-800 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors"
        >
          Get the Kit — $37 →
        </a>
        <p className="text-xs text-gray-400 mt-3">
          Illinois property tax issue?{" "}
          <Link href="/appeal-packet" className="text-blue-600 hover:underline">
            See the Appeal Packet →
          </Link>
        </p>
      </div>
    </main>
  );
}

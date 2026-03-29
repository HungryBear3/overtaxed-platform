"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


export default function ContingencyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      fullName: formData.get("fullName") as string,
      email: formData.get("email") as string,
      phone: formData.get("phone") as string,
      propertyPin: formData.get("propertyPin") as string,
      propertyAddress: formData.get("propertyAddress") as string,
      estimatedAssessedValue: formData.get("estimatedAssessedValue") as string,
      hearAboutUs: formData.get("hearAboutUs") as string,
    };

    try {
      const res = await fetch("/api/contingency-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submission failed");
      }
      router.push("/appeal-contingency/success");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Get Your Free Property Tax Assessment
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            We&apos;ll review your property and handle everything. You only pay if
            we win — 22% of your first-year savings, $50 minimum.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="fullName">Full Name *</Label>
            <Input
              id="fullName"
              name="fullName"
              required
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="jane@example.com"
            />
          </div>

          <div>
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              required
              placeholder="(312) 555-0100"
            />
          </div>

          <div>
            <Label htmlFor="propertyPin">Property PIN *</Label>
            <Input
              id="propertyPin"
              name="propertyPin"
              required
              placeholder="XX-XX-XXX-XXX-XXXX"
            />
            <p className="text-xs text-gray-400 mt-1">
              Find your PIN on your tax bill or at cookcountyassessor.com
            </p>
          </div>

          <div>
            <Label htmlFor="propertyAddress">Property Address *</Label>
            <Input
              id="propertyAddress"
              name="propertyAddress"
              required
              placeholder="123 Main St, Chicago, IL 60601"
            />
          </div>

          <div>
            <Label htmlFor="estimatedAssessedValue">
              Estimated Current Assessed Value{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </Label>
            <Input
              id="estimatedAssessedValue"
              name="estimatedAssessedValue"
              placeholder="$250,000"
            />
          </div>

          <div>
            <Label htmlFor="hearAboutUs">
              How did you hear about us?{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </Label>
            <select
              id="hearAboutUs"
              name="hearAboutUs"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 mt-1"
            >
              <option value="">Select one...</option>
              <option value="Google">Google</option>
              <option value="Referral">Referral</option>
              <option value="Realtor">Realtor</option>
              <option value="Property Manager">Property Manager</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            className={buttonVariants({ variant: "primary", size: "md", className: "w-full justify-center" })}
            disabled={loading}
          >
            {loading ? "Submitting..." : "Get My Free Assessment"}
          </button>
        </form>
      </div>
    </main>
  );
}

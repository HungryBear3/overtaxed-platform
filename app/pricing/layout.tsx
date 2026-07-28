import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "https://www.overtaxed-il.com/pricing" },
};

export default function PricingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
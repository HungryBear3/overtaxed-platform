import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cook County Property Tax Appeal Pricing",
  alternates: { canonical: "https://www.overtaxed-il.com/pricing" },
};

export default function PricingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
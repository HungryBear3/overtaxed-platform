import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cook County Property Tax Appeal Pricing",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
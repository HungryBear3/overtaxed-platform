import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Contingency Property Tax Appeal Review",
    template: "%s | OverTaxed IL",
  },
};

export default function AppealContingencyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

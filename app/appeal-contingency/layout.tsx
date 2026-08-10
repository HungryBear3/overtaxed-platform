import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contingency Property Tax Appeal Review",
};

export default function AppealContingencyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

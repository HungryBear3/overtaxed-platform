import type { Metadata } from "next";

// The old title advertised the held product in search results and in every
// browser tab. This route family is withdrawn, so it is also de-indexed: it
// exists to catch stale inbound links, not to be found.
export const metadata: Metadata = {
  title: {
    default: "Contingency Review Withdrawn",
    template: "%s | OverTaxed IL",
  },
  robots: { index: false, follow: true },
};

export default function AppealContingencyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

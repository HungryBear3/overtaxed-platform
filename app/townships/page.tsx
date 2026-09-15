import type { Metadata } from "next";
import LiveDeadlinesPage from "@/components/ot-design/LiveDeadlinesPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

export const metadata: Metadata = {
  title: "Cook County Township Appeal Deadlines",
  description:
    "The filing window for each of the 38 Cook County townships, as published by the Cook County Assessor. Unverified or expired source data shows no date.",
  alternates: { canonical: "https://www.overtaxed-il.com/townships" },
};

// The two informational calendar routes share the same live feed and lifecycle.
// Neither route may fall back to the bundled commerce snapshot or enable capture.
export default function TownshipsPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <LiveDeadlinesPage />
      <SiteFooter />
    </div>
  );
}

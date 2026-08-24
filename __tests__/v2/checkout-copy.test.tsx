/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import CheckoutPage from "@/components/ot-design/CheckoutPage";
import { metadata } from "@/app/checkout/page";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/marketing/preview-gate-client", () => ({ isClientPreviewStubMode: () => false }));

describe("OT checkout copy", () => {
  it("renders apostrophes as apostrophes, not HTML entities", () => {
    render(<CheckoutPage />);

    // This previously anchored on two contingency bullets — "we're paid from
    // your savings" and "If we don't reduce your bill, you pay $0". Both are
    // gone with the held tier, and the second was an outcome promise on a
    // decision the county makes. The entity check is what the test is for, so
    // it re-anchors on surviving copy that still carries an apostrophe.
    expect(screen.getByText(/Let’s confirm your property first/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("&apos;");
    expect(document.body.textContent).not.toContain("&#39;");
  });

  it("keeps checkout metadata aligned with current pricing and conditional window safeguards", () => {
    const serialized = JSON.stringify(metadata);
    expect(serialized).toContain("$69 DIY Appeal Packet");
    expect(serialized).toContain("Eligibility is confirmed before payment");
    expect(serialized).not.toContain("$149");
    expect(serialized).not.toMatch(/money-back|procedural denial/i);
    // Metadata outlives the page in search results and link previews, so the
    // held tiers must not survive here after being removed from the body.
    expect(serialized).not.toMatch(/done-for-you|\$97|contingency|22%/i);
  });

  it("offers no held plan in the rendered checkout body", () => {
    render(<CheckoutPage />);

    expect(document.body.textContent).not.toMatch(/done-for-you/i);
    expect(document.body.textContent).not.toContain("$97");
    expect(document.body.textContent).not.toContain("22%");
  });

  // The metadata assertion above already banned "procedural denial", and the
  // body assertion above it banned the held tiers. Neither covered the body
  // for a refund promise, and that is exactly where one survived: the shared
  // `RiskReversalBadge` in SiteChrome rendered "If your township denies the
  // filing on procedural grounds, we refund your packet" under the pay button.
  // It reached this page from chrome, not from checkout's own source, which is
  // why a per-file remediation of app/checkout and CheckoutPage missed it.
  //
  // CC-13 is the canonical refund statement and it says the opposite: "No
  // county outcome — granted, denied, or partial — creates a refund right."
  it("promises no refund on a county or township decision", () => {
    render(<CheckoutPage />);
    const body = document.body.textContent ?? "";

    expect(body).not.toMatch(/procedural refund/i);
    expect(body).not.toMatch(/\b(township|county|assessor)\b[^.]{0,80}\b(denies|denied|rejects|rejected)\b[^.]{0,80}\brefund\b/i);
    expect(body).not.toMatch(/\brefund\b[^.]{0,80}\bno questions\b/i);
  });
});

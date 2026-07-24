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

    expect(screen.getByText(/we're paid from your savings/i)).toBeTruthy();
    expect(screen.getByText(/If we don't reduce your bill, you pay \$0/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("&apos;");
  });

  it("keeps checkout metadata aligned with current pricing and conditional window safeguards", () => {
    const serialized = JSON.stringify(metadata);
    expect(serialized).toContain("Done-For-You at $97");
    expect(serialized).toContain("Eligibility is confirmed before payment");
    expect(serialized).not.toContain("$149");
    expect(serialized).not.toMatch(/money-back|procedural denial/i);
  });
});

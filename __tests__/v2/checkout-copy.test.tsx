/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import CheckoutPage from "@/components/ot-design/CheckoutPage";

describe("OT checkout copy", () => {
  it("renders apostrophes as apostrophes, not HTML entities", () => {
    render(<CheckoutPage />);

    expect(screen.getByText(/we're paid from your savings/i)).toBeTruthy();
    expect(screen.getByText(/If we don't reduce your bill, you pay \$0/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("&apos;");
  });
});

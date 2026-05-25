/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import OutreachApprovalPage, { metadata } from "../app/outreach-approval/page";

function bodyText() {
  return document.body.textContent || "";
}

describe("OT outreach approval prototype", () => {
  it("is noindexed and labeled as an internal prototype", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });

    render(<OutreachApprovalPage />);

    expect(screen.getByText(/Prototype · mock data · no sending/i)).toBeTruthy();
    expect(screen.getByText(/No outbound action available/i)).toBeTruthy();
    expect(screen.getByText(/Approve draft — no send/i)).toBeTruthy();
  });

  it("does not render live-send action labels from the downloaded mockup", () => {
    render(<OutreachApprovalPage />);
    const text = bodyText();

    expect(text).not.toMatch(/Approve email send/i);
    expect(text).not.toMatch(/Exact email that will go out/i);
    expect(text).not.toMatch(/Approval ≠ send/i);
  });

  it("pins outreach copy to safer resource framing", () => {
    render(<OutreachApprovalPage />);
    const text = bodyText();

    expect(text).toMatch(/not a vendor endorsement/i);
    expect(text).toMatch(/Owners decide for themselves/i);
    expect(text).toMatch(/not a law firm/i);
    expect(text).toMatch(/no savings claim included/i);
  });

  it("blocks risky outreach claims and fake production sends", () => {
    render(<OutreachApprovalPage />);
    const text = bodyText();

    const forbidden = [
      /likely over-assessed/i,
      /est\. saved/i,
      /est\. \$\d/i,
      /median household saves/i,
      /free if we don'?t reduce/i,
      /guaranteed/i,
      /send now/i,
      /resend now/i,
      /bypass\s+(safety|verification|blocked\s+contacts)\s+now/i,
      /dpark@/i,
      /\.hoa\.example/i,
    ];

    for (const pattern of forbidden) {
      expect(text).not.toMatch(pattern);
    }
  });
});

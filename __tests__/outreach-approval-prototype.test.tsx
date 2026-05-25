/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { OutreachApprovalConsole } from "../components/admin/OutreachApprovalConsole";
import type { OutreachApprovalData } from "@/lib/outreach/approval-queue";

const realDataFixture: OutreachApprovalData = {
  source: "database",
  generatedAt: "2026-05-25T20:30:00.000Z",
  counts: {
    needs_review: 1,
    approved_no_send: 0,
    sent_monitoring: 1,
    blocked: 1,
    bounced: 0,
    reply: 1,
    all: 4,
  },
  packets: [
    {
      id: "real-prospect-1",
      status: "needs_review",
      organization: "Real Condo Board",
      contact: "re…@example.org",
      role: "Board/contact email",
      township: "Lake",
      units: 0,
      channel: "Email",
      subject: "Cook County assessment resource for Real Condo Board",
      summary: "Prospect from live campaign awaiting human copy/safety review.",
      ownerCountNote: "Uses source prospect data only; no exact savings or over-assessment claim generated.",
      draftedBy: "Rex",
      updated: "1h ago",
      risk: "low",
      body: ["Draft for Real Condo Board.", "Sender remains disabled here."],
    },
    {
      id: "real-send-1",
      status: "sent_monitoring",
      organization: "Delivered Condo Board",
      contact: "de…@example.org",
      role: "Outreach recipient",
      township: "Unknown",
      units: 0,
      channel: "Email",
      subject: "delivered · HOA pilot",
      summary: "Real send row is delivered.",
      ownerCountNote: "Template v1; UTM campaign hoa.",
      draftedBy: "Rex",
      updated: "2h ago",
      risk: "medium",
      body: ["Campaign: HOA pilot.", "Current provider status: delivered."],
    },
    {
      id: "real-blocked-1",
      status: "blocked",
      organization: "blocked@example.org",
      contact: "bl…@example.org",
      role: "Suppressed recipient",
      township: "Unknown",
      units: 0,
      channel: "Email",
      subject: "Suppressed · MANUAL_OPT_OUT",
      summary: "Address is in outreach suppression.",
      ownerCountNote: "Suppression is terminal unless manually investigated outside this UI.",
      draftedBy: "Rex",
      updated: "3h ago",
      risk: "blocked",
      blockers: ["MANUAL_OPT_OUT", "manual"],
      body: ["Suppression reason: MANUAL_OPT_OUT."],
    },
    {
      id: "real-reply-1",
      status: "reply",
      organization: "Reply Condo Board",
      contact: "rp…@example.org",
      role: "Inbound reply",
      township: "Unknown",
      units: 0,
      channel: "Email",
      subject: "Reply · neutral",
      summary: "neutral reply is new.",
      ownerCountNote: "Reply content shown for review only.",
      draftedBy: "Abigail",
      updated: "4h ago",
      risk: "medium",
      replySnippet: "Thanks, send details.",
      body: ["Inbound reply captured from outreach workflow."],
    },
  ],
};

function bodyText() {
  return document.body.textContent || "";
}

describe("OT outreach approval queue", () => {
  it("renders read-only database-backed data without mock/demo packets", () => {
    render(<OutreachApprovalConsole data={realDataFixture} />);

    expect(screen.getByText(/Live database · review-only · no sending/i)).toBeTruthy();
    expect(screen.getAllByText(/Real Condo Board/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/All packets/i)).toBeTruthy();
    expect(screen.getByText(/No outbound action available/i)).toBeTruthy();

    const text = bodyText();
    expect(text).not.toMatch(/Prototype · mock data/i);
    expect(text).not.toMatch(/Lakeside Point|Rogers Park|Oak Square|OUT-284/i);
  });

  it("does not render live-send action labels from the downloaded mockup", () => {
    render(<OutreachApprovalConsole data={realDataFixture} />);
    const text = bodyText();

    expect(text).not.toMatch(/Approve email send/i);
    expect(text).not.toMatch(/Exact email that will go out/i);
    expect(text).not.toMatch(/Send now/i);
    expect(text).not.toMatch(/Resend now/i);
  });

  it("pins outreach copy to safer resource framing", () => {
    render(<OutreachApprovalConsole data={realDataFixture} />);
    const text = bodyText();

    expect(text).toMatch(/no exact savings/i);
    expect(text).toMatch(/not a law firm/i);
    expect(text).toMatch(/Approval creates no outbound email/i);
  });

  it("blocks risky outreach claims and fake production sends", () => {
    render(<OutreachApprovalConsole data={realDataFixture} />);
    const text = bodyText();

    const forbidden = [
      /likely over-assessed/i,
      /est\. saved/i,
      /median household saves/i,
      /free if we don'?t reduce/i,
      /guaranteed savings/i,
      /dpark@/i,
      /\.hoa\.example/i,
    ];

    for (const pattern of forbidden) {
      expect(text).not.toMatch(pattern);
    }
  });
});

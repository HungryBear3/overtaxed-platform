/**
 * @jest-environment jsdom
 *
 * Evidence console panels — flag-off shows no controls; the read-only console
 * renders inert (disabled) actions and leaks no secrets in the rendered HTML.
 */
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { EvidenceConsolePanel, EvidenceDisabledPanel } from "@/components/admin/EvidenceConsolePanel"
import { deriveAdminEvidenceView } from "@/lib/fulfillment/admin-read-model"

describe("EvidenceDisabledPanel (flag off)", () => {
  it("shows the disabled message and exposes NO interactive controls", () => {
    const { container } = render(<EvidenceDisabledPanel />)
    expect(screen.getByText(/Fulfillment evidence is disabled/i)).toBeInTheDocument()
    expect(screen.getByText(/OT_T2_FULFILLMENT_EVIDENCE_ENABLED/)).toBeInTheDocument()
    // No buttons or form controls at all when disabled.
    expect(container.querySelectorAll("button")).toHaveLength(0)
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0)
  })
})

describe("EvidenceConsolePanel (flag on, read-only)", () => {
  const hostileView = deriveAdminEvidenceView({
    order: { id: "ord_1", tier: "T2", status: "PAID", amountPaid: 149, createdAt: "2026-08-01T00:00:00.000Z" },
    fulfillment: {
      id: "ful_1",
      kind: "T2_APPEAL_EVIDENCE",
      status: "PROVIDER_ACCEPTED",
      statusRevision: 3,
      attemptCount: 1,
      leaseOwner: "worker-secret-9",
      leaseToken: "tok_SECRET",
      leaseExpiresAt: "2026-08-08T13:00:00.000Z",
      lastReasonCode: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      artifacts: [
        {
          version: 1,
          artifactSha256: "b".repeat(64),
          byteSize: 4096,
          storageLocator: "s3://private/secret/v1.pdf",
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          createdAt: "2026-08-02T00:00:00.000Z",
        },
      ],
      attempts: [
        {
          attemptNumber: 1,
          artifactVersion: 1,
          provider: "resend",
          providerMessageId: "re_RAWSECRETID",
          idempotencyKey: "otf:SECRETKEY",
          requestedAt: "2026-08-03T00:00:00.000Z",
          providerAcceptedAt: "2026-08-03T00:00:01.000Z",
          deliveredAt: null,
          delayedAt: null,
          failedAt: null,
          reasonCode: null,
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
      events: [
        { provider: "resend", providerEventId: "evt_1", eventType: "ACCEPTED", sequence: 1, occurredAt: "2026-08-03T00:00:01.000Z", reasonCode: null, attemptNumber: 1, receivedAt: "2026-08-03T00:00:02.000Z" },
      ],
    },
    now: "2026-08-08T12:00:00.000Z",
  })

  it("renders the derived state, the evidence trail, and only disabled action controls", () => {
    const { container } = render(<EvidenceConsolePanel view={hostileView} />)
    expect(screen.getByText("Provider accepted")).toBeInTheDocument()
    expect(screen.getByText(/Evidence trail/i)).toBeInTheDocument()
    expect(screen.getByText(/Artifact provenance/i)).toBeInTheDocument()

    const buttons = Array.from(container.querySelectorAll("button"))
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) {
      expect(b).toBeDisabled()
      expect(b).toHaveAttribute("aria-disabled", "true")
    }
    // No enabled form controls exist (strictly read-only).
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0)
  })

  it("leaks no PII, private locator, lease token, idempotency key, or raw message id in the DOM", () => {
    const { container } = render(<EvidenceConsolePanel view={hostileView} />)
    const html = container.innerHTML
    for (const secret of ["s3://private/secret/v1.pdf", "tok_SECRET", "otf:SECRETKEY", "re_RAWSECRETID", "worker-secret-9"]) {
      expect(html).not.toContain(secret)
    }
    // Masked provider message id is present instead.
    expect(html).toContain("re_•••ID")
  })
})

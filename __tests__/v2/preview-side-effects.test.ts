/**
 * @jest-environment node
 *
 * Asserts that, in the default jest environment (NODE_ENV !== "production"),
 * every gated marketing route returns the preview noop response without
 * touching Stripe, Resend, Prisma, the Cook County data layer, or the
 * in-memory rate limiter. Mocks are reachable through the mocked imports
 * so any leaked call fails the suite loudly.
 */

// ── jest.mock factories (hoisted) ──────────────────────────────────────────
// `jest.fn()` instances live inside the factory and are reached via the
// `jest.requireMock(...)` calls below.

jest.mock("stripe", () => {
  const sessionsCreate = jest.fn();
  const ctor = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: sessionsCreate } },
  }));
  // Stripe is a default export.
  return Object.assign(ctor, { __esModule: true, default: ctor, _sessionsCreate: sessionsCreate });
});

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

jest.mock("@/lib/email/send", () => ({
  sendContactEmail: jest.fn(),
  sendEmail: jest.fn(),
}));

jest.mock("@/lib/drip", () => ({
  enrollInDrip: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    referral: { upsert: jest.fn() },
    contingencyLead: { create: jest.fn() },
    oTLead: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    townshipAlert: { upsert: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/db/prisma", () => ({
  prisma: {
    referral: { upsert: jest.fn() },
    contingencyLead: { create: jest.fn() },
    oTLead: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    townshipAlert: { upsert: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/cook-county", () => ({
  getPropertyByPIN: jest.fn(),
  searchPropertiesByAddress: jest.fn(),
  getComparableSales: jest.fn(),
  getComparableEquity: jest.fn(),
  formatPIN: (s: string) => s,
  normalizePIN: (s: string) => s,
  isValidPIN: () => true,
}));

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "test-client"),
}));

// ioredis is imported eagerly by /api/leads/capture; REDIS_URL is unset in
// the jest env so the route file falls back to `redis = null`, but mock the
// constructor anyway to keep the import side-effect-free.
jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({})));

// ── Route handlers under test ──────────────────────────────────────────────

import { POST as contactPOST } from "@/app/api/contact/route";
import { POST as townshipAlertPOST } from "@/app/api/township-alert/route";
import { POST as referralsPOST } from "@/app/api/referrals/visit/route";
import { POST as contingencyPOST } from "@/app/api/contingency-intake/route";
import { POST as leadsPOST } from "@/app/api/leads/capture/route";
import { POST as checkoutPOST } from "@/app/api/checkout/session/route";
import { POST as freeCheckPOST } from "@/app/api/free-check/route";

// Reach into the mocked module references for assertions.
const sendModule = jest.requireMock("@/lib/email/send") as {
  sendContactEmail: jest.Mock;
  sendEmail: jest.Mock;
};
const dripModule = jest.requireMock("@/lib/drip") as {
  enrollInDrip: jest.Mock;
};
const dbModule = jest.requireMock("@/lib/db") as {
  prisma: {
    referral: { upsert: jest.Mock };
    contingencyLead: { create: jest.Mock };
    oTLead: { create: jest.Mock };
  };
};
const dbPrismaModule = jest.requireMock("@/lib/db/prisma") as {
  prisma: {
    oTLead: { findFirst: jest.Mock };
    townshipAlert: { upsert: jest.Mock };
  };
};
const cookCountyModule = jest.requireMock("@/lib/cook-county") as {
  getPropertyByPIN: jest.Mock;
  searchPropertiesByAddress: jest.Mock;
  getComparableSales: jest.Mock;
  getComparableEquity: jest.Mock;
};
const rateLimitModule = jest.requireMock("@/lib/rate-limit") as {
  rateLimit: jest.Mock;
};
const stripeModule = jest.requireMock("stripe") as { _sessionsCreate: jest.Mock };
const resendModule = jest.requireMock("resend") as { Resend: jest.Mock };

function mkReq(url: string, body: unknown): any {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  // The gate's "closed by default in test" guarantee relies on NODE_ENV.
  expect(process.env.NODE_ENV).not.toBe("production");
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("preview gate — route handlers do not call live services", () => {
  it("/api/contact returns preview_noop and never sends email", async () => {
    const res = await contactPOST(
      mkReq("/api/contact", {
        name: "Test User",
        email: "t@example.com",
        subject: "subject text",
        message: "this is a message that is at least ten characters long",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(sendModule.sendContactEmail).not.toHaveBeenCalled();
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
  });

  it("/api/township-alert returns preview_noop and never writes DB/email/drip", async () => {
    const res = await townshipAlertPOST(
      mkReq("/api/township-alert", { email: "t@example.com", township: "Worth" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(dbPrismaModule.prisma.townshipAlert.upsert).not.toHaveBeenCalled();
    expect(sendModule.sendEmail).not.toHaveBeenCalled();
    expect(dripModule.enrollInDrip).not.toHaveBeenCalled();
    expect(dbPrismaModule.prisma.oTLead.findFirst).not.toHaveBeenCalled();
  });

  it("/api/referrals/visit returns preview_noop and never records visits", async () => {
    const res = await referralsPOST(
      mkReq("/api/referrals/visit", { code: "test-ref" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(dbModule.prisma.referral.upsert).not.toHaveBeenCalled();
  });

  it("/api/contingency-intake returns preview_noop and never writes DB/Resend", async () => {
    const res = await contingencyPOST(
      mkReq("/api/contingency-intake", {
        fullName: "Test",
        email: "t@example.com",
        phone: "5550001234",
        propertyPin: "12-34-567-890-1234",
        propertyAddress: "123 Test St",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(dbModule.prisma.contingencyLead.create).not.toHaveBeenCalled();
    expect(resendModule.Resend).not.toHaveBeenCalled();
  });

  it("/api/leads/capture returns preview_noop and never writes DB/Redis/email", async () => {
    const res = await leadsPOST(
      mkReq("/api/leads/capture", {
        email: "t@example.com",
        address: "123 Test St",
        potentialSavings: 100,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(dbModule.prisma.oTLead.create).not.toHaveBeenCalled();
  });

  it("/api/checkout/session returns preview_noop and never calls Stripe", async () => {
    const res = await checkoutPOST(mkReq("/api/checkout/session", { tier: "T2" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(stripeModule._sessionsCreate).not.toHaveBeenCalled();
  });

  it("/api/free-check returns a preview sample without calling Cook County or rate-limit", async () => {
    const res = await freeCheckPOST(
      mkReq("/api/free-check", { pin: "12345678901234" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("preview_noop");
    expect(json.subject?.pin).toBeTruthy();
    expect(json.compCount).toBeGreaterThan(0);
    expect(cookCountyModule.getPropertyByPIN).not.toHaveBeenCalled();
    expect(cookCountyModule.searchPropertiesByAddress).not.toHaveBeenCalled();
    expect(cookCountyModule.getComparableSales).not.toHaveBeenCalled();
    expect(cookCountyModule.getComparableEquity).not.toHaveBeenCalled();
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
  });
});

// ── Source-level guards ────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

function readSrc(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
}

describe("source-level guards", () => {
  it("ReferralCapture refuses to fetch or set cookies in preview", () => {
    const src = readSrc("components/ReferralCapture.tsx");
    expect(src).toMatch(/preview-gate-client/);
    const earlyReturnIdx = src.indexOf("isClientPreviewStubMode()");
    const cookieIdx = src.indexOf("document.cookie");
    const fetchIdx = src.indexOf('fetch("/api/referrals/visit"');
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(earlyReturnIdx).toBeLessThan(cookieIdx);
    expect(earlyReturnIdx).toBeLessThan(fetchIdx);
  });

  it("/pricing client disables Buy Now in preview and refuses to POST /api/checkout/session", () => {
    const src = readSrc("app/pricing/page.tsx");
    expect(src).toMatch(/preview-gate-client/);
    expect(src).toMatch(/Preview checkout disabled/);
    const guardIdx = src.indexOf("if (previewMode)");
    const fetchIdx = src.indexOf('fetch("/api/checkout/session"');
    expect(guardIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });
});

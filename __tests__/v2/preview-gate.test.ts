/**
 * @jest-environment node
 *
 * Unit tests for the marketing preview gate.
 */
import fs from "fs";
import path from "path";
import {
  isProductionMarketingRuntime,
  isPreviewStubEnabled,
  marketingGateReason,
  previewNoopResponseBody,
  hostFromRequest,
} from "@/lib/marketing/preview-gate";

const KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "OT_FORCE_PREVIEW_STUB",
  "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB",
] as const;

function withEnv(
  patch: Partial<Record<(typeof KEYS)[number], string | undefined>>,
  fn: () => void,
) {
  // Cast through `Record` so we can write NODE_ENV in newer Node typings.
  const env = process.env as Record<string, string | undefined>;
  const original: Record<string, string | undefined> = {};
  for (const k of KEYS) original[k] = env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (original[k] === undefined) delete env[k];
      else env[k] = original[k];
    }
  }
}

describe("marketing preview gate", () => {
  it("is closed by default in the jest test environment", () => {
    // Jest sets NODE_ENV to "test", which the gate treats as non-production.
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(isPreviewStubEnabled()).toBe(true);
    expect(isProductionMarketingRuntime()).toBe(false);
    expect(marketingGateReason()).toBe("non-production-node-env");
  });

  it("opens only with production node + production vercel + production host", () => {
    withEnv(
      {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        OT_FORCE_PREVIEW_STUB: undefined,
        NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB: undefined,
      },
      () => {
        expect(isProductionMarketingRuntime()).toBe(true);
        expect(
          isProductionMarketingRuntime({ host: "overtaxed-il.com" }),
        ).toBe(true);
        expect(
          isProductionMarketingRuntime({ host: "www.overtaxed-il.com" }),
        ).toBe(true);
        expect(
          isProductionMarketingRuntime({ host: "WWW.OVERTAXED-IL.COM:443" }),
        ).toBe(true);
        expect(
          isProductionMarketingRuntime({ host: "preview.vercel.app" }),
        ).toBe(false);
        expect(
          marketingGateReason({ host: "preview.vercel.app" }),
        ).toBe("non-production-host");
      },
    );
  });

  it("stays closed when VERCEL_ENV=preview even on a production node build", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" }, () => {
      expect(isProductionMarketingRuntime()).toBe(false);
      expect(marketingGateReason()).toBe("non-production-vercel-env");
    });
  });

  it("forces preview when OT_FORCE_PREVIEW_STUB=true", () => {
    withEnv(
      {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        OT_FORCE_PREVIEW_STUB: "true",
      },
      () => {
        expect(isProductionMarketingRuntime()).toBe(false);
        expect(marketingGateReason()).toBe("forced-override");
      },
    );
  });

  it("forces preview when NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB=true", () => {
    withEnv(
      {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB: "true",
      },
      () => {
        expect(isProductionMarketingRuntime()).toBe(false);
        expect(marketingGateReason()).toBe("forced-override");
      },
    );
  });

  it("returns the canonical preview-noop body shape", () => {
    expect(previewNoopResponseBody("forced-override")).toEqual({
      ok: true,
      mode: "preview_noop",
      reason: "forced-override",
    });
  });

  it("hostFromRequest pulls host from x-forwarded-host or host header", () => {
    const reqA = new Request("http://localhost/x", {
      headers: { host: "www.overtaxed-il.com" },
    });
    expect(hostFromRequest(reqA)).toBe("www.overtaxed-il.com");

    const reqB = new Request("http://localhost/x", {
      headers: { "x-forwarded-host": "overtaxed-il.com" },
    });
    expect(hostFromRequest(reqB)).toBe("overtaxed-il.com");

    const reqC = new Request("http://localhost/x");
    expect(hostFromRequest(reqC)).toBeUndefined();
  });
});

describe("layout.tsx source no longer always mounts Analytics + ReferralCapture", () => {
  it("imports the gate and mounts both behind a conditional", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/layout.tsx"),
      "utf8",
    );
    expect(src).toMatch(/preview-gate/);
    // Analytics must be wrapped in a `{ ... && <Analytics ... /> }` conditional.
    expect(src).toMatch(/&&\s*<Analytics\s*\/>/);
    // ReferralCapture mount must also be gated.
    expect(src).toMatch(/&&\s*\(\s*<Suspense[^>]*>\s*<ReferralCapture/);
  });
});

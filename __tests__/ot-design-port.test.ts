/**
 * @jest-environment node
 *
 * Pass 2 launch-blocker guards for the OT design port.
 *
 * These are content/regression checks, not full integration tests:
 *  - No fake testimonials slip back in (Maria R., David T., Anita K.).
 *  - No $99 leftover in the design-port body (price is $97 everywhere).
 *  - No unverified savings claims ($1,103/year, $300–$800 attorney rates).
 *  - /api/check never pretends the preview sample is real submitted-address data.
 */
import fs from "fs";
import path from "path";
import { POST as checkPOST } from "@/app/api/check/route";
import { CC_02 } from "@/lib/copy/canonical";

const ROOT = path.resolve(__dirname, "..");
const DESIGN_FILES = [
  "components/ot-design/HomePage.tsx",
  "components/ot-design/DeadlinesPage.tsx",
  "components/ot-design/TownshipPage.tsx",
  "components/ot-design/CheckoutPage.tsx",
  "components/ot-design/SiteChrome.tsx",
  "app/page.tsx",
  "app/deadlines/page.tsx",
  "app/checkout/page.tsx",
  "app/township/[slug]/page.tsx",
];

function readDesign(): string {
  return DESIGN_FILES.map((f) =>
    fs.readFileSync(path.join(ROOT, f), "utf8"),
  )
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("OT design port — Pass 2 launch blockers", () => {
  const body = readDesign();

  it("does not ship fake testimonial names", () => {
    expect(body).not.toMatch(/Maria R\./);
    expect(body).not.toMatch(/David T\./);
    expect(body).not.toMatch(/Anita K\./);
  });

  it("does not ship the old $99 price", () => {
    expect(body).not.toMatch(/\$99\b/);
  });

  it("does not ship unverified savings claims", () => {
    expect(body).not.toMatch(/\$1,?103/);
    expect(body).not.toMatch(/\$300.{1,4}\$800/);
  });
});

describe("/api/check", () => {
  // The sample this route used to serve was `windowStatus: "open"`,
  // `windowCloses: "Cicero Township appeal window open through Jul 31, 2026"`,
  // `windowDaysRemaining: 17`, `assessmentLevel: 12.1`, `overpayPerYear: 1420`.
  // These tests pinned it as correct behaviour. It is a hard-coded open window,
  // a filing date, a countdown and an overpayment figure, served
  // unauthenticated with no canonical state behind any of it, so what is pinned
  // now is its absence.
  const BANNED_RESULT_KEYS = [
    "windowStatus",
    "windowCloses",
    "windowDaysRemaining",
    "assessmentLevel",
    "overpayPerYear",
    "overpay3Year",
    "yourAssessed",
    "compsAvg",
  ];

  async function post(body: unknown) {
    const req = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await checkPOST(req);
    return { res, json: await res.json() };
  }

  it("returns no result and marks itself non-actionable", async () => {
    const { json } = await post({ address: "1212 W Belmont Ave, Chicago IL 60657", mode: "address" });
    expect(json.preview).toBe(true);
    expect(json.actionable).toBe(false);
    expect(json.result).toBeNull();
    expect(json.reason).toBe("preview_sample_withdrawn");
  });

  it("does not echo the submitted address or PIN", async () => {
    const submitted = "1212 W Belmont Ave, Chicago IL 60657";
    const { json } = await post({ address: submitted, pin: "16-01-216-001-0000", mode: "address" });
    const body = JSON.stringify(json);
    expect(body).not.toContain(submitted);
    expect(body).not.toContain("16-01-216-001-0000");
  });

  it("carries CC-02 and no window, date, countdown, or dollar figure", async () => {
    const { json } = await post({});
    expect(json.disclosure).toBe(CC_02);

    const body = JSON.stringify(json);
    for (const key of BANNED_RESULT_KEYS) {
      expect({ key, present: body.includes(key) }).toEqual({ key, present: false });
    }
    // No date, no countdown, no money, anywhere in the envelope.
    expect(body).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
    expect(body).not.toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/);
    expect(body).not.toMatch(/Jul 31, 2026/);
    expect(body).not.toMatch(/\$\s?\d/);
    expect(body).not.toMatch(/Cicero/);
  });
});

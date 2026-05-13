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
  it("labels the submitted-address flow as preview sample data", async () => {
    const submitted = "1212 W Belmont Ave, Chicago IL 60657";
    const req = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: submitted, mode: "address" }),
    });
    const res = await checkPOST(req);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.preview).toBe(true);
    expect(json.result.address).toMatch(/Sample result/);
    expect(json.result.address).not.toBe(submitted);
  });

  it("uses an internally consistent open 2026 sample township", async () => {
    const req = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await checkPOST(req);
    const json = await res.json();
    expect(json.result.township).toBe("Lyons");
    expect(json.result.windowStatus).toBe("open");
    expect(json.result.windowCloses).toMatch(/Jun 9, 2026/);
    expect(json.result.assessmentLevel).toBe(12.1);
    expect(json.result.equityRatio).toBeUndefined();
  });
});

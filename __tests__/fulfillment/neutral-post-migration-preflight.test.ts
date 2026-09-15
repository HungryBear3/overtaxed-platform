import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "scripts/preflight-neutral-report-migration.ts"),
  "utf8",
);

describe("neutral post-migration least-privilege preflight", () => {
  it("uses only constrained authority views for positive proof", () => {
    expect(source).toContain("ot_neutral_runtime_order");
    expect(source).toContain("ot_neutral_runtime_payment_binding");
    expect(source).toContain("ot_neutral_runtime_settlement_reversal");
    expect(source).toContain(
      "Runtime constrained authority views are unavailable",
    );
  });

  it("requires direct shared-commerce reads to remain denied", () => {
    expect(source).toContain(
      "has_any_column_privilege(current_user,'ot_order','SELECT')",
    );
    expect(source).toMatch(
      /\[\s*"ot_order",\s*"ot_payment_binding",\s*"ot_settlement_reversal",?\s*\]/,
    );
    expect(source).toContain("Runtime direct SELECT unexpectedly succeeded");
    expect(source).not.toContain(
      "from ot_order o left join ot_payment_binding",
    );
  });
});

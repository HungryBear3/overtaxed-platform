import fs from "node:fs";
import path from "node:path";

describe("neutral Preview identity bootstrap contract", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts/bootstrap-neutral-report-preview-identities.ts",
    ),
    "utf8",
  );

  test("requires canonical host and username evidence together", () => {
    expect(source).toContain("iyaxdrehtxsfkaexgxls");
    expect(source).toContain("directTarget");
    expect(source).toContain("poolerTarget");
    expect(source).toContain("host and username do not jointly identify");
  });

  test("is disabled before connecting or reading role passwords", () => {
    expect(source).toContain("Direct Preview identity bootstrap is disabled");
    expect(source).toContain("protected Supabase Management API flow");
    expect(source).not.toContain('from "pg"');
    expect(source).not.toMatch(/create role|client\.query/i);
  });
});

/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

test("deployment cron invokes the authenticated neutral production recovery route every ten minutes", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
  ) as { crons?: Array<{ path: string; schedule: string }> };
  expect(
    manifest.crons?.filter(
      (entry) => entry.path === "/api/cron/neutral-report-production",
    ),
  ).toEqual([
    {
      path: "/api/cron/neutral-report-production",
      schedule: "*/10 * * * *",
    },
  ]);
});

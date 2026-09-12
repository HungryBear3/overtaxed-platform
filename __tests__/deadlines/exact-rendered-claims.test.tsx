import { act, render, screen } from "@testing-library/react";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
jest.mock("@/lib/analytics/events", () => ({ analytics: { deadlineMapView: jest.fn() } }));
const URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
function source(): OfficialDeadlineSnapshot {
  // Hypothetical fixture only. No real calendar or retrieval claim.
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
    retrievedAt: "2026-06-02T16:55:00Z", sourceUpdatedAt: "2026-05-20T00:00:00Z",
    contentSha256: "c".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
  } }, townships: { "oak-park": { townshipName: "Oak Park", stages: { assessor: {
    noticeDate: "2026-05-20", openDate: "2026-05-25", lastFileDate: "2026-06-08",
  } } } } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-06-02T17:00:00Z")); });
afterEach(() => { jest.useRealTimers(); });
function assertNoPersonalizedClaims(container: HTMLElement) {
  expect(container.textContent).not.toMatch(/closes today|\d+ days? left|county hasn.t posted|have not been posted yet/i);
  expect(screen.queryByLabelText("Email address")).toBeNull();
  expect(screen.queryByRole("button", { name: /send me reminders/i })).toBeNull();
}
test("all38 table rows match the exact supported dates, not just a provenance-shaped string", () => {
  const { container } = render(<DeadlinesPage snapshot={source()} />);
  const rows = [...container.querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(38);
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    expect(cells[2].textContent).toBe(cells[0].textContent === "Oak Park" ? "Last file: June 8, 2026" : "Pending official date");
    expect(cells[3].textContent).toBe("—");
  }
  expect(container.textContent).toContain("Cook County Assessor");
  expect(container.textContent).toContain("2026-06-02T16:55:00Z");
  assertNoPersonalizedClaims(container);
});
test("a hostile extra township and an invalid known row cannot add a date", () => {
  const snapshot = source();
  snapshot.townships["fake-township"] = { townshipName: "Invented", stages: { assessor: { noticeDate: null, openDate: "2026-06-01", lastFileDate: "2026-12-31" } } };
  snapshot.townships["cicero"] = { townshipName: "Cicero", stages: { assessor: { noticeDate: null, openDate: "2026-06-01", lastFileDate: "2026-02-30" } } };
  const { container } = render(<DeadlinesPage snapshot={snapshot} />);
  expect(container.querySelectorAll("tbody tr")).toHaveLength(38);
  expect(container.textContent).not.toMatch(/Invented|Dec 31|Feb 30/);
  expect([...container.querySelectorAll(".ot-tbl-window")].filter(c => c.textContent?.startsWith("Last file:"))).toHaveLength(1);
  assertNoPersonalizedClaims(container);
});
test.each(["bad-hash", "stale", "synthetic"])("%s suppresses every date despite valid-looking source names", kind => {
  const snapshot = source();
  if (kind === "bad-hash") snapshot.sources.assessor!.contentSha256 = "forged";
  if (kind === "stale") snapshot.sources.assessor!.retrievedAt = "2026-05-01T00:00:00Z";
  if (kind === "synthetic") snapshot.synthetic = true;
  const { container } = render(<DeadlinesPage snapshot={snapshot} />);
  expect([...container.querySelectorAll(".ot-tbl-window")].every(c => c.textContent === "Pending official date")).toBe(true);
  expect(container.textContent).not.toMatch(/Last file:|Last file Jun/);
  assertNoPersonalizedClaims(container);
});
test("mounted expiry removes the previously verified exact date from every surface", () => {
  const { container } = render(<DeadlinesPage snapshot={source()} />);
  act(() => { jest.setSystemTime(new Date("2026-06-03T05:00:00Z")); window.dispatchEvent(new Event("focus")); });
  expect(container.textContent).not.toMatch(/Jun(e)? 8|2026-06-02T16:55:00Z/);
  expect([...container.querySelectorAll(".ot-tbl-window")].every(c => c.textContent === "Pending official date")).toBe(true);
  assertNoPersonalizedClaims(container);
});
test.each([
  ["2025-05-25", "2025-06-08"],
  ["2027-05-25", "2027-06-08"],
  ["2026-05-25", "2027-06-08"],
])("the 2026 calendar refuses window %s through %s", (openDate, lastFileDate) => {
  const snapshot = source();
  snapshot.townships["oak-park"].stages.assessor = { noticeDate: openDate, openDate, lastFileDate };
  const { container } = render(<DeadlinesPage snapshot={snapshot} />);
  expect([...container.querySelectorAll(".ot-tbl-window")].every(c => c.textContent === "Pending official date")).toBe(true);
  expect(container.textContent).not.toMatch(/Last file:|Last file Jun/);
  assertNoPersonalizedClaims(container);
});

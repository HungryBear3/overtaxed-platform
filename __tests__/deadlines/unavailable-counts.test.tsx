import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { UNAVAILABLE_INFORMATIONAL_SNAPSHOT } from "@/lib/deadlines/use-live-informational-snapshot";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { TOWNSHIPS } from "@/lib/townships";

/**
 * While the calendar is loading, or its source is unavailable, the page must
 * not state "0 open now", "0 closed" or "38 pending official date" as if the
 * county had published that. Those tallies render as a dash; only "All" (the
 * township inventory) still counts. Once a fresh source verifies, real
 * counts — zeros included — return.
 */
jest.mock("@/lib/analytics/events", () => ({ analytics: { deadlineMapView: jest.fn(), deadlineTownshipSelected: jest.fn() } }));

const URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
const TOTAL = String(TOWNSHIPS.length);

// Hypothetical source-shaped test data, never published as actual retrieval.
function fresh(): OfficialDeadlineSnapshot {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
    retrievedAt: "2026-10-30T13:00:00Z", sourceUpdatedAt: null,
    contentSha256: "c".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
  } }, townships: { orland: { townshipName: "Orland", stages: { assessor: {
    noticeDate: "2026-10-20", openDate: "2026-10-20", lastFileDate: "2026-11-19",
  } } } } };
}

const texts = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);

function counts(root: ParentNode) {
  return {
    summary: texts(root, ".ot-status-summary-num"),
    filters: texts(root, ".ot-tbl-filter-count"),
    groups: texts(root, ".ot-fullmap-group-count"),
  };
}

// Summary: open, pending, closed. Filters: all, open, upcoming, pending, closed.
// Groups: open, upcoming, closed, pending.
const UNKNOWN = {
  summary: ["—", "—", "—"],
  filters: [TOTAL, "—", "—", "—", "—"],
  groups: ["—", "—", "—", "—"],
};

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-30T15:00:00Z")); });
afterEach(() => { jest.useRealTimers(); });

test("loading (server render, before any evaluation) states no zero tallies", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(<DeadlinesPage snapshot={fresh()} />);
  expect(counts(host)).toEqual(UNKNOWN);
});

test("an unavailable source states no zero tallies and still fails closed", () => {
  const { container } = render(<DeadlinesPage snapshot={UNAVAILABLE_INFORMATIONAL_SNAPSHOT} />);
  expect(counts(container)).toEqual(UNKNOWN);
  expect(container.textContent).toContain("loading or unavailable");
  expect(container.textContent).not.toMatch(/Nov(ember)? 19/);
});

test("a stale source states no zero tallies", () => {
  jest.setSystemTime(new Date("2026-11-01T15:00:00Z"));
  const { container } = render(<DeadlinesPage snapshot={fresh()} />);
  expect(counts(container)).toEqual(UNKNOWN);
});

test("a fresh source restores real counts, zeros included", () => {
  const { container } = render(<DeadlinesPage snapshot={fresh()} />);
  const pending = String(TOWNSHIPS.length - 1);
  expect(counts(container)).toEqual({
    summary: ["1", pending, "0"],
    filters: [TOTAL, "1", "0", pending, "0"],
    groups: ["1", "0", "0", pending],
  });
});

import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { DEADLINE_PENDING_NOTICE } from "@/lib/deadline-sources";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { TOWNSHIPS } from "@/lib/townships";

/**
 * Index-page copy must agree with the data beside it:
 * - DL-01: the "we have not verified" notice only while some township lacks a
 *   verified date, never beside a fully verified table.
 * - DL-02: no "the rest are marked pending" when nothing is pending.
 * - DL-03: the map's default card carries a neutral chip, not "Pending date".
 * - The verify block is informational: it offers no review/filing service.
 */
jest.mock("@/lib/analytics/events", () => ({ analytics: { deadlineMapView: jest.fn(), deadlineTownshipSelected: jest.fn() } }));

const URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

// Hypothetical source-shaped test data, never published as actual retrieval.
function snapshot(slugs: string[]): OfficialDeadlineSnapshot {
  const townships = Object.fromEntries(
    TOWNSHIPS.filter((t) => slugs.includes(t.slug)).map((t) => [t.slug, {
      townshipName: t.name,
      stages: { assessor: { noticeDate: "2026-10-20", openDate: "2026-10-20", lastFileDate: "2026-11-19" } },
    }]),
  );
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
    retrievedAt: "2026-10-30T13:00:00Z", sourceUpdatedAt: null,
    contentSha256: "d".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
  } }, townships } as OfficialDeadlineSnapshot;
}

const ALL = TOWNSHIPS.map((t) => t.slug);

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-30T15:00:00Z")); });
afterEach(() => { jest.useRealTimers(); });

test("all townships verified: no unverified fallback and no pending sentence", () => {
  const { container } = render(<DeadlinesPage snapshot={snapshot(ALL)} />);
  const text = container.textContent ?? "";
  const nums = Array.from(container.querySelectorAll(".ot-status-summary-num")).map((n) => n.textContent);
  expect(nums).toEqual([String(TOWNSHIPS.length), "0", "0"]);
  expect(text).toContain(`All ${TOWNSHIPS.length} townships, with 2026 Assessor last file dates`);
  expect(text).toContain("Confirm your filing deadline with the county before you file.");
  expect(text).not.toContain(DEADLINE_PENDING_NOTICE);
  expect(text).not.toMatch(/we have not verified|the rest are marked pending|we don.t guess/i);
});

test("some townships unverified: the pending notice and pending sentence return", () => {
  const { container } = render(<DeadlinesPage snapshot={snapshot(ALL.slice(1))} />);
  const text = container.textContent ?? "";
  expect(text).toContain("We have not verified dates for every township on this page.");
  expect(text).not.toContain("we are not showing one");
  expect(text).toContain(`${TOWNSHIPS.length - 1} of ${TOWNSHIPS.length} townships`);
  expect(text).toMatch(/marked pending; we do not estimate them/);
});

test("map default card shows a neutral chip, not a pending status", () => {
  const { container } = render(<DeadlinesPage snapshot={snapshot(ALL)} />);
  const card = container.querySelector(".ot-deadline-map-card-status");
  expect(card?.textContent).toBe("Select a township");
  expect(card?.textContent).not.toMatch(/pending/i);
});

test("verify block is informational and implies no filing or review service", () => {
  for (const html of [
    renderToString(<DeadlinesPage snapshot={snapshot(ALL)} />),
    render(<DeadlinesPage snapshot={snapshot(ALL)} />).container.innerHTML,
  ]) {
    expect(html).not.toMatch(/go-ahead|Request a review|help you\s+confirm/i);
    expect(html).toMatch(/informational and does not start or\s+file an appeal/);
  }
});

test("loading state keeps dashes and makes no present-tense open claim", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(<DeadlinesPage snapshot={snapshot(ALL)} />);
  const labels = Array.from(host.querySelectorAll(".ot-status-summary-label")).map((n) => n.textContent);
  expect(labels).toEqual(["open", "pending official date", "closed"]);
  expect(host.textContent).not.toMatch(/—\s*open now/);
});

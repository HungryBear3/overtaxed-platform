import { act, renderHook } from "@testing-library/react";
import { useInformationalCalendar } from "@/lib/deadlines/use-informational-calendar";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
const URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
// Hypothetical source-shaped test data, never published as actual retrieval.
export function fixture(): OfficialDeadlineSnapshot {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
    retrievedAt: "2026-06-02T16:55:00Z", sourceUpdatedAt: "2026-05-20T00:00:00Z",
    contentSha256: "c".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
  } }, townships: { "oak-park": { townshipName: "Oak Park", stages: { assessor: {
    noticeDate: "2026-05-20", openDate: "2026-05-25", lastFileDate: "2026-06-08",
  } } } } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-06-03T04:59:59Z")); });
afterEach(() => { jest.useRealTimers(); });
test("default source renders fail-closed without an injected snapshot", () => {
  const { result } = renderHook(() => useInformationalCalendar());
  expect(result.current.COUNTS.official).toBe(0);
});
test("mounted calendar invalidates at Chicago midnight without changing real retrieval", () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const { result, unmount } = renderHook(() => useInformationalCalendar(source));
  expect(result.current.COUNTS.official).toBe(1);
  expect(result.current.PROVENANCE?.retrievedAt).toBe("2026-06-02T16:55:00Z");
  expect(result.current.VIEWS.every(v => !v.allowReminderSignup && v.daysUntilLastFile === undefined)).toBe(true);
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current.COUNTS.official).toBe(0);
  expect(result.current.PROVENANCE).toBeNull();
  expect(JSON.stringify(source)).toBe(before);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});
test("focus rechecks a suspended tab without waiting for interval", () => {
  const source = fixture();
  const { result } = renderHook(() => useInformationalCalendar(source));
  expect(result.current.COUNTS.official).toBe(1);
  act(() => { jest.setSystemTime(new Date("2026-06-03T08:00:00Z")); window.dispatchEvent(new Event("focus")); });
  expect(result.current.COUNTS.official).toBe(0);
});
test("hidden pages suppress dates and resume rechecks the current clock", () => {
  const source = fixture();
  const { result } = renderHook(() => useInformationalCalendar(source));
  const visibility = jest.spyOn(document, "visibilityState", "get");
  act(() => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.COUNTS.official).toBe(0);
  act(() => { jest.setSystemTime(new Date("2026-06-03T08:00:00Z")); visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.COUNTS.official).toBe(0);
  visibility.mockRestore();
});
test("far-off window still expires at source TTL and replacement does not reuse it", () => {
  const source = fixture();
  source.townships["oak-park"].stages.assessor = { openDate: "2026-08-01", lastFileDate: "2026-08-31" };
  jest.setSystemTime(new Date("2026-06-03T16:54:59Z"));
  const { result, rerender } = renderHook(({ snapshot }) => useInformationalCalendar(snapshot), { initialProps: { snapshot: source } });
  expect(result.current.COUNTS.official).toBe(1);
  act(() => jest.advanceTimersByTime(2000));
  expect(result.current.COUNTS.official).toBe(0);
  rerender({ snapshot: { ...source, synthetic: true } });
  expect(result.current.COUNTS.official).toBe(0);
});

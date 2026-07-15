/**
 * @jest-environment node
 */
import { getFreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window";

describe("free-check appeal-window township cycle alignment", () => {
  it("uses official 2026 Assessor dates for Lake View instead of design-seed 2028 dates", () => {
    expect(getFreeCheckAppealWindowStatus("Lake View", new Date("2026-07-12T12:00:00Z"))).toEqual(
      expect.objectContaining({
        township: "Lake View",
        status: "open",
        openDate: "2026-05-28",
        closeDate: "2026-07-13",
      }),
    );
  });

  it("marks official 2026 windows closed after their last-file date", () => {
    expect(getFreeCheckAppealWindowStatus("Berwyn", new Date("2026-07-14T12:00:00Z"))).toEqual(
      expect.objectContaining({
        township: "Berwyn",
        status: "closed",
        openDate: "2026-05-20",
        closeDate: "2026-07-06",
      }),
    );
  });

  it("keeps townships without a published official date undated instead of using design-seed windows", () => {
    expect(getFreeCheckAppealWindowStatus("North Chicago", new Date("2026-07-14T12:00:00Z"))).toEqual(
      expect.objectContaining({
        township: "North Chicago",
        status: "future_cycle",
        openDate: null,
        closeDate: null,
      }),
    );
  });

  it("uses newly verified official additions", () => {
    expect(getFreeCheckAppealWindowStatus("Maine", new Date("2026-07-14T12:00:00Z"))).toEqual(
      expect.objectContaining({
        township: "Maine",
        status: "open",
        openDate: "2026-06-05",
        closeDate: "2026-07-21",
      }),
    );
  });
});

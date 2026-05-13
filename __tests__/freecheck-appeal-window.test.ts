/**
 * @jest-environment node
 */
import { getFreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window";

describe("free-check appeal-window township cycle alignment", () => {
  it("uses the canonical 2028 Chicago cycle for Lake View instead of unknown/sample dates", () => {
    expect(getFreeCheckAppealWindowStatus("Lake View")).toEqual(
      expect.objectContaining({
        township: "Lake View",
        status: "future_cycle",
        openDate: "2028-05-08",
        closeDate: "2028-06-12",
      }),
    );
  });

  it("does not mark North Chicago open in 2026", () => {
    expect(getFreeCheckAppealWindowStatus("North Chicago")).toEqual(
      expect.objectContaining({
        township: "North Chicago",
        status: "future_cycle",
        openDate: "2028-05-08",
        closeDate: "2028-06-12",
      }),
    );
  });

  it("keeps currently-open 2026 south/west townships open", () => {
    expect(getFreeCheckAppealWindowStatus("Lyons")).toEqual(
      expect.objectContaining({
        township: "Lyons",
        status: "open",
        openDate: "2026-05-06",
        closeDate: "2026-06-09",
      }),
    );
  });
});

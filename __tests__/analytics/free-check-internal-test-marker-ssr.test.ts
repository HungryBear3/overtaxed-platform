/** @jest-environment node */
// Server render has no URL: the internal-test marker is never requested.
import { freeCheckMeasurementRequestFields } from "@/lib/analytics/free-check-measurement-client";

it("SSR (no window) requests nothing and does not throw", () => {
  expect(typeof window).toBe("undefined");
  expect(freeCheckMeasurementRequestFields()).toEqual({
    freeCheckAttributionObservation: "unknown",
  });
});

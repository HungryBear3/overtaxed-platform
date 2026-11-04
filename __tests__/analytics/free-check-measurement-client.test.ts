import { freeCheckMeasurementRequestFields } from "@/lib/analytics/free-check-measurement-client";
import { clearStoredAttributionCodes } from "@/lib/attribution/client-codes";
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  clearStoredAttributionCodes();
});
it("untagged request is not labeled organic", () =>
  expect(freeCheckMeasurementRequestFields()).toEqual({
    freeCheckAttributionObservation: "untagged",
  }));
it.each([
  "?ot_campaign=PRIVATE%40email.com",
  "?ot_creative=unknown",
  "?ot_campaign=18062140010000",
  "?ot_campaign=unknown",
  "?ot_campaign=",
])("never forwards unapproved raw code %s", (query) => {
  window.history.replaceState({}, "", query);
  expect(freeCheckMeasurementRequestFields()).toEqual({
    freeCheckAttributionObservation: "unknown",
  });
});
it("does not forward raw UTM data", () => {
  window.history.replaceState(
    {},
    "",
    "?utm_campaign=PRIVATE&email=PRIVATE&pin=18062140010000",
  );
  expect(freeCheckMeasurementRequestFields()).toEqual({
    freeCheckAttributionObservation: "untagged",
  });
});

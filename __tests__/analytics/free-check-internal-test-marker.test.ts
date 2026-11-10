// The `?ot_internal_test=1` URL opt-in is a request only (the server verifies
// ADMIN). It must be exact, never displace attribution, and never forward the
// raw query. Synthetic values only.
import {
  FREE_CHECK_INTERNAL_TEST_PARAM,
  freeCheckMeasurementRequestFields,
} from "@/lib/analytics/free-check-measurement-client";
import { clearStoredAttributionCodes } from "@/lib/attribution/client-codes";
let mockCampaigns: { campaignCode: string; creativeCodes: string[] }[] = [];
jest.mock("@/lib/attribution/registry", () => ({
  ...jest.requireActual("@/lib/attribution/registry"),
  shippedAttributionRegistry: () => ({
    version: "synthetic_v1",
    campaigns: mockCampaigns,
  }),
}));
const at = (query: string) => window.history.replaceState({}, "", query);
beforeEach(() => {
  mockCampaigns = [];
  at("/");
  clearStoredAttributionCodes();
});

it("uses the documented param name", () =>
  expect(FREE_CHECK_INTERNAL_TEST_PARAM).toBe("ot_internal_test"));

it("absent param requests nothing", () => {
  at("/check?utm_source=synthetic");
  expect(freeCheckMeasurementRequestFields()).toEqual({
    freeCheckAttributionObservation: "untagged",
  });
});

it("exact =1 requests internal-test classification", () =>
  [`/?ot_internal_test=1`, `/check?a=b&ot_internal_test=1`].forEach((q) => {
    at(q);
    expect(freeCheckMeasurementRequestFields()).toEqual({
      freeCheckAttributionObservation: "untagged",
      freeCheckInternalTest: "requested",
    });
  }));

it.each(["0", "", "true", "01", " 1", "yes", "TRUE"])(
  "=%p requests nothing",
  (value) => {
    at(`/?ot_internal_test=${encodeURIComponent(value)}`);
    expect(freeCheckMeasurementRequestFields()).not.toHaveProperty(
      "freeCheckInternalTest",
    );
  },
);

it.each([
  "?ot_internal_test=1&ot_internal_test=0",
  "?ot_internal_test=0&ot_internal_test=1",
  "?ot_internal_test=1&ot_internal_test=1",
  "?ot_internal_test&ot_internal_test=1",
])("ambiguous duplicate params %s request nothing", (query) => {
  at(query);
  expect(freeCheckMeasurementRequestFields()).not.toHaveProperty(
    "freeCheckInternalTest",
  );
});

it("approved URL attribution is retained alongside the marker", () => {
  mockCampaigns = [{ campaignCode: "synth_campaign", creativeCodes: ["synth_a"] }];
  at("/?ot_campaign=synth_campaign&ot_creative=synth_a&ot_internal_test=1");
  expect(freeCheckMeasurementRequestFields()).toEqual({
    attributionCampaignCode: "synth_campaign",
    attributionCreativeCode: "synth_a",
    freeCheckInternalTest: "requested",
  });
});

it("unknown attribution stays unknown and no raw value leaks", () => {
  at("/?ot_campaign=PRIVATE%40a.com&ot_internal_test=1");
  const fields = freeCheckMeasurementRequestFields();
  expect(fields).toEqual({
    freeCheckAttributionObservation: "unknown",
    freeCheckInternalTest: "requested",
  });
  expect(JSON.stringify(fields)).not.toContain("PRIVATE");
});

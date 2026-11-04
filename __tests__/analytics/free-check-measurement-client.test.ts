import { freeCheckMeasurementRequestFields } from "@/lib/analytics/free-check-measurement-client";
import {
  captureFirstTouchAttributionCodes,
  clearStoredAttributionCodes,
  getApprovedAttributionCodesForRequest,
} from "@/lib/attribution/client-codes";
let mockCampaigns: { campaignCode: string; creativeCodes: string[] }[] = [];
jest.mock("@/lib/attribution/registry", () => ({
  ...jest.requireActual("@/lib/attribution/registry"),
  shippedAttributionRegistry: () => ({
    version: "synthetic_v1",
    campaigns: mockCampaigns,
  }),
}));
const KEY = "ot_attribution_first_touch_v1";
const APPROVED = { campaignCode: "synth_campaign", creativeCodes: ["synth_a"] };
const UNKNOWN = { freeCheckAttributionObservation: "unknown" };
const UNTAGGED = { freeCheckAttributionObservation: "untagged" };
const land = (query: string) => {
  window.history.replaceState({}, "", query);
  captureFirstTouchAttributionCodes();
  window.history.replaceState({}, "", "/check");
};
beforeEach(() => {
  mockCampaigns = [];
  window.history.replaceState({}, "", "/");
  clearStoredAttributionCodes();
});
afterEach(() => jest.restoreAllMocks());
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

describe("stored reference that does not resolve", () => {
  it("still forwards an approved stored pair after navigation", () => {
    mockCampaigns = [APPROVED];
    land("?ot_campaign=synth_campaign&ot_creative=synth_a");
    expect(freeCheckMeasurementRequestFields()).toEqual({
      attributionCampaignCode: "synth_campaign",
      attributionCreativeCode: "synth_a",
    });
  });
  it("labels a stored code withdrawn from the registry unknown", () => {
    mockCampaigns = [APPROVED];
    land("?ot_campaign=synth_campaign");
    mockCampaigns = [];
    expect(freeCheckMeasurementRequestFields()).toEqual(UNKNOWN);
  });
  it.each([
    ["unparseable JSON", "{not json"],
    ["empty value", ""],
    ["JSON null", "null"],
    ["missing timestamp", '{"campaignCode":"synth_campaign"}'],
    ["non-string campaign", `{"campaignCode":5,"at":${Date.now()}}`],
    ["creative for another pair", `{"campaignCode":"synth_campaign","creativeCode":"other","at":${Date.now()}}`],
  ])("labels a corrupt or rejected record unknown: %s", (_name, raw) => {
    mockCampaigns = [APPROVED];
    window.localStorage.setItem(KEY, raw);
    expect(freeCheckMeasurementRequestFields()).toEqual(UNKNOWN);
  });
  it("forwards no stored raw value when labeling unknown", () => {
    window.localStorage.setItem(KEY, '{"campaignCode":"PRIVATE@a.com","at":1}');
    expect(JSON.stringify(freeCheckMeasurementRequestFields())).not.toContain(
      "PRIVATE",
    );
  });
  it("labels unreadable storage unknown", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(freeCheckMeasurementRequestFields()).toEqual(UNKNOWN);
  });
});

describe("states with no local trace stay untagged, as documented", () => {
  it("expired touch is removed by design", () => {
    mockCampaigns = [APPROVED];
    const at = Date.now() - 31 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ campaignCode: "synth_campaign", creativeCode: null, at }),
    );
    expect(freeCheckMeasurementRequestFields()).toEqual(UNTAGGED);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
  it("tag rejected at landing leaves nothing after navigation", () => {
    land("?ot_campaign=PRIVATE");
    expect(freeCheckMeasurementRequestFields()).toEqual(UNTAGGED);
  });
  it("failed capture write leaves nothing after navigation", () => {
    mockCampaigns = [APPROVED];
    const write = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    land("?ot_campaign=synth_campaign");
    write.mockRestore();
    expect(freeCheckMeasurementRequestFields()).toEqual(UNTAGGED);
  });
  it("mount-only capture misses a tag reached by client navigation", () => {
    mockCampaigns = [APPROVED];
    window.history.replaceState({}, "", "?ot_campaign=synth_campaign");
    expect(freeCheckMeasurementRequestFields().attributionCampaignCode).toBe(
      "synth_campaign",
    );
    window.history.replaceState({}, "", "/check");
    expect(freeCheckMeasurementRequestFields()).toEqual(UNTAGGED);
  });
});

describe("checkout attribution is unchanged", () => {
  it("still forwards nothing and leaves corrupt or rejected records in place", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(getApprovedAttributionCodesForRequest()).toEqual({});
    expect(window.localStorage.getItem(KEY)).toBe("{not json");
    const rejected = `{"campaignCode":"withdrawn","at":${Date.now()}}`;
    window.localStorage.setItem(KEY, rejected);
    expect(getApprovedAttributionCodesForRequest()).toEqual({});
    freeCheckMeasurementRequestFields();
    expect(window.localStorage.getItem(KEY)).toBe(rejected);
  });
  it("still swallows unreadable storage", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getApprovedAttributionCodesForRequest()).toEqual({});
  });
  it("still lets an approved stored pair through and first touch win", () => {
    mockCampaigns = [
      APPROVED,
      { campaignCode: "later_campaign", creativeCodes: [] },
    ];
    land("?ot_campaign=synth_campaign&ot_creative=synth_a");
    land("?ot_campaign=later_campaign");
    expect(getApprovedAttributionCodesForRequest()).toEqual({
      attributionCampaignCode: "synth_campaign",
      attributionCreativeCode: "synth_a",
    });
  });
});

/** Only approved code references or a fixed observation marker leave the browser. */
import {
  getApprovedAttributionCodesForRequest,
  hasStoredAttributionRecord,
  ATTRIBUTION_CAMPAIGN_PARAM,
  ATTRIBUTION_CREATIVE_PARAM,
} from "@/lib/attribution/client-codes";
import {
  resolveAttributionCodes,
  shippedAttributionRegistry,
} from "@/lib/attribution/registry";

/** URL opt-in for staff tests. A request only; the server verifies ADMIN. */
export const FREE_CHECK_INTERNAL_TEST_PARAM = "ot_internal_test";

export function freeCheckMeasurementRequestFields(): Record<string, string> {
  const fields = freeCheckAttributionFields();
  try {
    if (typeof window === "undefined") return fields;
    // Exactly one `=1`. Duplicates are ambiguous and request nothing.
    const values = new URLSearchParams(window.location.search).getAll(
      FREE_CHECK_INTERNAL_TEST_PARAM,
    );
    if (values.length === 1 && values[0] === "1")
      return { ...fields, freeCheckInternalTest: "requested" };
  } catch {
    // An unreadable URL requests nothing.
  }
  return fields;
}

function freeCheckAttributionFields(): Record<string, string> {
  if (typeof window === "undefined")
    return { freeCheckAttributionObservation: "unknown" };
  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.has(ATTRIBUTION_CAMPAIGN_PARAM) ||
      params.has(ATTRIBUTION_CREATIVE_PARAM)
    ) {
      // Inspect these two dedicated params only. No raw value is forwarded.
      const result = resolveAttributionCodes(
        {
          campaignCode: params.get(ATTRIBUTION_CAMPAIGN_PARAM),
          creativeCode: params.get(ATTRIBUTION_CREATIVE_PARAM),
        },
        shippedAttributionRegistry(),
      );
      if (!result.ok || !result.attribution)
        return { freeCheckAttributionObservation: "unknown" };
      return {
        attributionCampaignCode: result.attribution.campaignCode,
        ...(result.attribution.creativeCode
          ? { attributionCreativeCode: result.attribution.creativeCode }
          : {}),
      };
    }
    const stored = getApprovedAttributionCodesForRequest();
    if (stored.attributionCampaignCode) return { ...stored };
    // A record that did not resolve is a touch we can no longer read, not an
    // untagged request. Expired records were removed above, so they read absent.
    if (hasStoredAttributionRecord())
      return { freeCheckAttributionObservation: "unknown" };
    // This is NOT organic/first-touch attribution: nothing readable says this
    // request was tagged. Traceless capture losses also land here.
    return { freeCheckAttributionObservation: "untagged" };
  } catch {
    return { freeCheckAttributionObservation: "unknown" };
  }
}

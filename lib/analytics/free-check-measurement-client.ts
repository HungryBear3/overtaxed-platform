/** Only approved code references or a fixed observation marker leave the browser. */
import {
  getApprovedAttributionCodesForRequest,
  ATTRIBUTION_CAMPAIGN_PARAM,
  ATTRIBUTION_CREATIVE_PARAM,
} from "@/lib/attribution/client-codes";
import {
  resolveAttributionCodes,
  shippedAttributionRegistry,
} from "@/lib/attribution/registry";

export function freeCheckMeasurementRequestFields(): Record<string, string> {
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
    // This is NOT organic/first-touch attribution: only this request was untagged.
    return { freeCheckAttributionObservation: "untagged" };
  } catch {
    return { freeCheckAttributionObservation: "unknown" };
  }
}

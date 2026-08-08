import { evaluateT2Eligibility } from "@/lib/fulfillment/eligibility";
import { t2FulfillmentEvidenceWritesEnabled } from "@/lib/fulfillment/flag";
export { t2FulfillmentEvidenceWritesEnabled } from "@/lib/fulfillment/flag";
import type {
  OTFulfillmentKind,
  OTFulfillmentStatus,
} from "@/lib/fulfillment/types";
import { prismaT2FulfillmentKickoffStore } from "@/lib/fulfillment-runtime/prisma-store";

export type T2FulfillmentKickoffOrder = {
  id: string;
  tier: string;
  status: string;
  propertyAddress?: string | null;
  propertyPin?: string | null;
  refunded?: boolean;
  disputed?: boolean;
};

export type T2FulfillmentKickoffInput = {
  orderId: string;
  kind: OTFulfillmentKind;
  status: OTFulfillmentStatus;
  reasonCode: string | null;
};

export interface T2FulfillmentKickoffStore {
  ensureInitial(input: T2FulfillmentKickoffInput): Promise<{
    id: string;
    status: OTFulfillmentStatus;
  } | null>;
}

export type T2FulfillmentKickoffResult =
  | { outcome: "DISABLED" }
  | { outcome: "SKIPPED"; reason: string }
  | {
      outcome: "PERSISTED";
      fulfillmentId: string;
      status: OTFulfillmentStatus;
    };

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRequiredT2Inputs(order: T2FulfillmentKickoffOrder): boolean {
  const pin = order.propertyPin?.trim() ?? "";
  return present(order.propertyAddress) && /^\d{14}$/.test(pin);
}

/**
 * Create the initial evidence summary for an exact paid T2 order. The operation
 * is inert unless the strict feature flag is true. It never generates an
 * artifact or performs delivery; retries use create-only upsert semantics so an
 * existing fulfillment state is never reset.
 */
export async function kickOffT2FulfillmentEvidence(
  order: T2FulfillmentKickoffOrder,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    store?: T2FulfillmentKickoffStore;
  } = {},
): Promise<T2FulfillmentKickoffResult> {
  if (!t2FulfillmentEvidenceWritesEnabled(options.env ?? process.env)) {
    return { outcome: "DISABLED" };
  }

  const eligibility = evaluateT2Eligibility({
    tier: order.tier,
    status: order.status,
    hasRequiredInputs: hasRequiredT2Inputs(order),
    refunded: order.refunded,
    disputed: order.disputed,
  });

  if (!eligibility.eligible && eligibility.outcome !== "INCOMPLETE_INPUT") {
    return { outcome: "SKIPPED", reason: eligibility.outcome };
  }

  const persisted = await (
    options.store ?? prismaT2FulfillmentKickoffStore
  ).ensureInitial({
    orderId: order.id,
    kind: "T2_APPEAL_EVIDENCE",
    status: eligibility.initialStatus,
    reasonCode:
      eligibility.outcome === "INCOMPLETE_INPUT" ? eligibility.outcome : null,
  });

  if (!persisted) {
    return { outcome: "SKIPPED", reason: "AUTHORITATIVE_ORDER_INELIGIBLE" };
  }

  return {
    outcome: "PERSISTED",
    fulfillmentId: persisted.id,
    status: persisted.status,
  };
}

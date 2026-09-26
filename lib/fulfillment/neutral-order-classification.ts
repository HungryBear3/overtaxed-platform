/**
 * Pure order-classification decisions.
 *
 * Why this exists: nothing in the base distinguishes an owner test from a paid
 * customer, so a rehearsal or a refusal-path test would be indistinguishable
 * from a served customer in any later count. The class is a durable,
 * insert-only fact per order; this module holds the decision, and the store
 * holds the transaction.
 *
 * The class NEVER changes an authority predicate. Payment, artifact, and QA
 * authority apply identically to every class. It exists for reporting and for
 * the Slice 2 PREPARE gate, and for nothing else.
 */

export const NEUTRAL_ORDER_CLASSES = [
  "CUSTOMER",
  "OWNER_TEST",
  "NEGATIVE_TEST",
  "SAMPLE",
] as const;

export type NeutralOrderClass = (typeof NEUTRAL_ORDER_CLASSES)[number];

/**
 * Closed note codes. There is deliberately no free-text note column: an
 * operator note is exactly the field that would eventually carry a name, an
 * address, or a support-thread quote.
 */
export const NEUTRAL_CLASSIFICATION_NOTE_CODES = [
  "OWNER_FULL_PRICE_TEST",
  "OWNER_REFUSAL_PATH_TEST",
  "REHEARSAL",
  "PILOT_CUSTOMER",
] as const;

export type NeutralClassificationNoteCode =
  (typeof NEUTRAL_CLASSIFICATION_NOTE_CODES)[number];

const ACTOR_KEY = /^admin:[A-Za-z0-9_-]{1,128}$/;

export type NeutralClassificationBlocker =
  | "INVALID_CLASS"
  | "INVALID_ACTOR"
  | "INVALID_NOTE_CODE"
  | "CLASS_CONFLICT"
  | "SAMPLE_PROHIBITED_IN_PRODUCTION";

export type NeutralClassificationDecision =
  | {
      ok: true;
      class: NeutralOrderClass;
      noteCode: NeutralClassificationNoteCode | null;
      created: boolean;
    }
  | { ok: false; blocker: NeutralClassificationBlocker };

function isClass(value: string): value is NeutralOrderClass {
  return (NEUTRAL_ORDER_CLASSES as readonly string[]).includes(value);
}

function isNoteCode(value: string): value is NeutralClassificationNoteCode {
  return (NEUTRAL_CLASSIFICATION_NOTE_CODES as readonly string[]).includes(value);
}

/**
 * Decide one classification attempt.
 *
 * `existingClass` is the durable row already present for this order, read in the
 * same transaction as the insert. Re-asserting the same class is idempotent and
 * succeeds with `created: false`; asserting a different one fails closed rather
 * than overwriting, because the row is the evidence that an owner test was
 * declared BEFORE it completed.
 *
 * `productionDatabase` must be true only when the durable Production database
 * marker POSITIVELY identified this database (I-12). An absent or unreadable
 * marker is not a Production identification, and is not treated as one.
 */
export function decideNeutralOrderClassification(input: {
  class: string;
  actorKey: string;
  noteCode: string | null;
  existingClass: string | null;
  productionDatabase: boolean;
}): NeutralClassificationDecision {
  if (!isClass(input.class)) return { ok: false, blocker: "INVALID_CLASS" };
  if (!ACTOR_KEY.test(input.actorKey))
    return { ok: false, blocker: "INVALID_ACTOR" };
  if (input.noteCode !== null && !isNoteCode(input.noteCode))
    return { ok: false, blocker: "INVALID_NOTE_CODE" };
  if (input.class === "SAMPLE" && input.productionDatabase)
    return { ok: false, blocker: "SAMPLE_PROHIBITED_IN_PRODUCTION" };

  if (input.existingClass !== null) {
    if (input.existingClass !== input.class)
      return { ok: false, blocker: "CLASS_CONFLICT" };
    return {
      ok: true,
      class: input.class,
      noteCode: input.noteCode as NeutralClassificationNoteCode | null,
      created: false,
    };
  }

  return {
    ok: true,
    class: input.class,
    noteCode: input.noteCode as NeutralClassificationNoteCode | null,
    created: true,
  };
}

export type NeutralOutcome = {
  /** The only definition of a served customer there is. */
  servedCustomer: boolean;
  ownerTestCompleted: boolean;
  /** A NEGATIVE_TEST that reached CONFIRMED: reported, never celebrated. */
  anomaly: boolean;
  unclassified: boolean;
  /** Whether this row belongs in any pilot total at all. */
  counted: boolean;
};

/**
 * The single place any later reporting may derive outcomes from.
 *
 * An unknown class string is treated as unclassified rather than trusted: a
 * class the code does not recognise must not be able to become a customer by
 * default.
 */
export function classifyNeutralOutcome(input: {
  deliveryStatus: string | null;
  class: string | null;
}): NeutralOutcome {
  const confirmed = input.deliveryStatus === "CONFIRMED";
  const known =
    typeof input.class === "string" && isClass(input.class) ? input.class : null;
  return {
    servedCustomer: confirmed && known === "CUSTOMER",
    ownerTestCompleted: confirmed && known === "OWNER_TEST",
    anomaly: confirmed && known === "NEGATIVE_TEST",
    unclassified: known === null,
    counted: known === "CUSTOMER" || known === "OWNER_TEST" || known === "NEGATIVE_TEST",
  };
}

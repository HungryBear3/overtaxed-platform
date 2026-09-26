/**
 * T-05 / T-06: the pure classification decision and the metric rules that keep
 * an owner test from ever being counted as a served customer.
 */
import {
  NEUTRAL_CLASSIFICATION_NOTE_CODES,
  NEUTRAL_ORDER_CLASSES,
  classifyNeutralOutcome,
  decideNeutralOrderClassification,
} from "@/lib/fulfillment/neutral-order-classification";

const base = {
  actorKey: "admin:u1",
  noteCode: null,
  existingClass: null,
  productionDatabase: false,
} as const;

describe("decideNeutralOrderClassification", () => {
  test("accepts every closed class and refuses anything else", () => {
    for (const value of NEUTRAL_ORDER_CLASSES)
      expect(decideNeutralOrderClassification({ ...base, class: value })).toEqual({
        ok: true,
        class: value,
        noteCode: null,
        created: true,
      });
    expect(
      decideNeutralOrderClassification({ ...base, class: "PARTNER" }),
    ).toEqual({ ok: false, blocker: "INVALID_CLASS" });
    expect(decideNeutralOrderClassification({ ...base, class: "" })).toEqual({
      ok: false,
      blocker: "INVALID_CLASS",
    });
  });

  test("closes the note-code set and allows no free text", () => {
    for (const note of NEUTRAL_CLASSIFICATION_NOTE_CODES)
      expect(
        decideNeutralOrderClassification({
          ...base,
          class: "OWNER_TEST",
          noteCode: note,
        }),
      ).toMatchObject({ ok: true, noteCode: note });
    expect(
      decideNeutralOrderClassification({
        ...base,
        class: "OWNER_TEST",
        noteCode: "we agreed on the phone",
      }),
    ).toEqual({ ok: false, blocker: "INVALID_NOTE_CODE" });
  });

  test("requires an admin actor key", () => {
    for (const actorKey of ["", "u1", "user:u1", "admin:", `admin:${"x".repeat(129)}`, "admin:a b"])
      expect(
        decideNeutralOrderClassification({ ...base, actorKey, class: "CUSTOMER" }),
      ).toEqual({ ok: false, blocker: "INVALID_ACTOR" });
  });

  test("is idempotent for the same class and fails closed on a different one", () => {
    expect(
      decideNeutralOrderClassification({
        ...base,
        class: "CUSTOMER",
        existingClass: "CUSTOMER",
      }),
    ).toEqual({ ok: true, class: "CUSTOMER", noteCode: null, created: false });
    expect(
      decideNeutralOrderClassification({
        ...base,
        class: "OWNER_TEST",
        existingClass: "CUSTOMER",
      }),
    ).toEqual({ ok: false, blocker: "CLASS_CONFLICT" });
  });

  test("refuses SAMPLE in a positively identified Production database (I-12)", () => {
    expect(
      decideNeutralOrderClassification({
        ...base,
        class: "SAMPLE",
        productionDatabase: true,
      }),
    ).toEqual({ ok: false, blocker: "SAMPLE_PROHIBITED_IN_PRODUCTION" });
    // Every other class is unaffected by the marker.
    for (const value of ["CUSTOMER", "OWNER_TEST", "NEGATIVE_TEST"])
      expect(
        decideNeutralOrderClassification({
          ...base,
          class: value,
          productionDatabase: true,
        }),
      ).toMatchObject({ ok: true });
  });
});

describe("classifyNeutralOutcome (I-6)", () => {
  const outcome = (deliveryStatus: string | null, orderClass: string | null) =>
    classifyNeutralOutcome({ deliveryStatus, class: orderClass });

  test("counts a served customer only for a CONFIRMED delivery of a CUSTOMER order", () => {
    expect(outcome("CONFIRMED", "CUSTOMER")).toMatchObject({
      servedCustomer: true,
      ownerTestCompleted: false,
      anomaly: false,
      unclassified: false,
    });
    for (const status of [null, "PREPARED", "RECORDED", "VOIDED"])
      expect(outcome(status, "CUSTOMER")).toMatchObject({ servedCustomer: false });
  });

  test("never counts OWNER_TEST, NEGATIVE_TEST, SAMPLE, or unclassified as served", () => {
    for (const value of ["OWNER_TEST", "NEGATIVE_TEST", "SAMPLE", null])
      expect(outcome("CONFIRMED", value)).toMatchObject({ servedCustomer: false });
  });

  test("reports an owner test completion in its own column", () => {
    expect(outcome("CONFIRMED", "OWNER_TEST")).toMatchObject({
      servedCustomer: false,
      ownerTestCompleted: true,
      anomaly: false,
    });
  });

  test("flags a CONFIRMED negative test as an anomaly, not a success", () => {
    expect(outcome("CONFIRMED", "NEGATIVE_TEST")).toMatchObject({
      servedCustomer: false,
      ownerTestCompleted: false,
      anomaly: true,
    });
    expect(outcome("VOIDED", "NEGATIVE_TEST")).toMatchObject({ anomaly: false });
  });

  test("reports an unclassified order as unclassified and never as a customer", () => {
    expect(outcome("CONFIRMED", null)).toMatchObject({
      unclassified: true,
      servedCustomer: false,
    });
    expect(outcome("CONFIRMED", "")).toMatchObject({ unclassified: true });
  });

  test("never counts a SAMPLE at all", () => {
    expect(outcome("CONFIRMED", "SAMPLE")).toMatchObject({
      servedCustomer: false,
      ownerTestCompleted: false,
      counted: false,
    });
  });

  test("treats an unknown class as unclassified rather than trusting it", () => {
    expect(outcome("CONFIRMED", "PARTNER")).toMatchObject({
      unclassified: true,
      servedCustomer: false,
      counted: false,
    });
  });
});

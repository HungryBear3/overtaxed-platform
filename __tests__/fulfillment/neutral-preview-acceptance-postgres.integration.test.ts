/** @jest-environment node */
import { Client } from "pg";
import {
  createPreviewAcceptanceRunId,
  proveAcceptanceAbsence,
  runTransactionalAcceptance,
} from "@/lib/fulfillment/neutral-preview-acceptance";

jest.mock("server-only", () => ({}), { virtual: true });

const url = process.env.OT_NEUTRAL_TEST_DIRECT_URL;
const native = url ? describe : describe.skip;

native("Preview acceptance journey against native PostgreSQL", () => {
  jest.setTimeout(60000);
  let priorDeliveryUrl: string | undefined;

  beforeAll(() => {
    // `isNeutralDeliveryFulfillment` fails closed when no neutral delivery
    // database is configured. The executor the runner injects is the one that
    // actually talks to PostgreSQL, so this only satisfies that presence gate.
    priorDeliveryUrl = process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL;
    process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL = url;
  });
  afterAll(() => {
    if (priorDeliveryUrl === undefined)
      delete process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL;
    else process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL = priorDeliveryUrl;
  });

  test("drives the production helpers through real constraints, then leaves zero rows", async () => {
    const runId = createPreviewAcceptanceRunId();
    const owner = new Client({ connectionString: url });
    await owner.connect();
    let evidence;
    try {
      evidence = await runTransactionalAcceptance(owner, runId);
    } finally {
      await owner.end();
    }
    expect(evidence.runId).toBe(runId);
    expect(evidence.probes.length).toBeGreaterThan(0);

    // A FRESH connection: the rollback must be visible to a session that never
    // saw the transaction, not merely to the one that opened it.
    const verifier = new Client({ connectionString: url });
    await verifier.connect();
    try {
      await proveAcceptanceAbsence(verifier, runId, evidence);
    } finally {
      await verifier.end();
    }
  });
});

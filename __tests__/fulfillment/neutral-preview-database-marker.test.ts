import {
  assertSameNeutralPreviewDatabase,
  parseNeutralPreviewDatabaseMarker,
} from "@/lib/fulfillment/neutral-preview-database-marker";

const INSTANCE_ID = "d82ad78b-d210-4f52-99bc-93885cb0aa17";
const marker = JSON.stringify({
  schema: "ot.database-environment.v1",
  purpose: "ot-neutral-report",
  environment: "preview",
  isolated: true,
  production: false,
  instanceId: INSTANCE_ID,
});

describe("neutral Preview database marker", () => {
  it("accepts four roles on the same durably marked database without comparing pooler hosts", () => {
    expect(
      assertSameNeutralPreviewDatabase([
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker },
      ]),
    ).toMatchObject({
      environment: "preview",
      isolated: true,
      production: false,
      instanceId: INSTANCE_ID,
    });
  });

  it.each([
    ["missing", null],
    ["invalid JSON", "preview"],
    [
      "Production",
      JSON.stringify({
        schema: "ot.database-environment.v1",
        purpose: "ot-neutral-report",
        environment: "production",
        isolated: true,
        production: true,
        instanceId: INSTANCE_ID,
      }),
    ],
    [
      "non-isolated",
      JSON.stringify({
        schema: "ot.database-environment.v1",
        purpose: "ot-neutral-report",
        environment: "preview",
        isolated: false,
        production: false,
        instanceId: INSTANCE_ID,
      }),
    ],
    [
      "Production contradiction",
      JSON.stringify({
        schema: "ot.database-environment.v1",
        purpose: "ot-neutral-report",
        environment: "preview",
        isolated: true,
        production: true,
        instanceId: INSTANCE_ID,
      }),
    ],
    [
      "wrong purpose",
      JSON.stringify({
        schema: "ot.database-environment.v1",
        purpose: "another-product",
        environment: "preview",
        isolated: true,
        production: false,
        instanceId: INSTANCE_ID,
      }),
    ],
    [
      "non-durable identifier",
      JSON.stringify({
        schema: "ot.database-environment.v1",
        purpose: "ot-neutral-report",
        environment: "preview",
        isolated: true,
        production: false,
        instanceId: "preview",
      }),
    ],
  ])("fails closed for a %s marker", (_case, hostileMarker) => {
    expect(() => parseNeutralPreviewDatabaseMarker(hostileMarker)).toThrow();
  });

  it("rejects a role connected to a different database name", () => {
    expect(() =>
      assertSameNeutralPreviewDatabase([
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_other", marker },
        { databaseName: "ot_preview_47", marker },
      ]),
    ).toThrow(/same isolated Preview database instance/);
  });

  it("rejects a role connected to a different database instance marker", () => {
    const other = marker.replace(
      INSTANCE_ID,
      "24d45e90-3a2a-4535-a4be-4ad81114b534",
    );
    expect(() =>
      assertSameNeutralPreviewDatabase([
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker },
        { databaseName: "ot_preview_47", marker: other },
        { databaseName: "ot_preview_47", marker },
      ]),
    ).toThrow(/same isolated Preview database instance/);
  });
});

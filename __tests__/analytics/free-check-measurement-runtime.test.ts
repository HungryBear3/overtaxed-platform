/** @jest-environment node */
import { recordFreeCheckCompletion } from "@/lib/analytics/free-check-measurement";
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract";
import {
  measurementClientConfig,
  validMeasurementLogin,
  withMeasurementClient,
} from "@/lib/analytics/free-check-measurement-runtime";
jest.mock("@/lib/db/prisma", () => {
  throw new Error("SHARED_DATABASE_MUST_NOT_BE_IMPORTED");
});
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});
const input = {
  body: {},
  outcome: canonicalFreeCheckOutcome(
    "insufficient_evidence",
    "no_assessed_value",
  ),
  windowStatus: "unknown",
  preview: false,
};
it.each([
  undefined,
  "postgresql://postgres@localhost:1/postgres",
  "postgresql://ot_prod_app@127.0.0.1:1/postgres",
])("fails closed without shared fallback for %s", async (value) => {
  process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
  process.env.DATABASE_URL = "postgresql://postgres@localhost/postgres";
  if (value) process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL = value;
  else delete process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL;
  expect(await recordFreeCheckCompletion(input)).toBe("unavailable");
});
it("requires verified remote TLS CA", async () => {
  process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL =
    "postgresql://ot_prod_app@example.com/postgres?sslmode=no-verify";
  delete process.env.SUPABASE_CA_PEM;
  delete process.env.OT_FREE_CHECK_MEASUREMENT_CA_PEM;
  await expect(withMeasurementClient(async () => true)).rejects.toThrow(
    "measurement_tls_ca_missing",
  );
});

it("permits only the exact configured project-qualified Supabase pooler transport login", () => {
  process.env.OT_FREE_CHECK_MEASUREMENT_SUPABASE_PROJECT_REF =
    "abcdefghijklmnopqrst";
  expect(
    validMeasurementLogin(
      new URL(
        "postgresql://ot_prod_app.abcdefghijklmnopqrst@aws-0-us-east-1.pooler.supabase.com/postgres",
      ),
    ),
  ).toBe(true);
  for (const address of [
    "postgresql://ot_prod_app.abcdefghijklmnopqrst@attacker.example/postgres",
    "postgresql://ot_prod_app.abcdefghijklmnopqrsx@aws-0-us-east-1.pooler.supabase.com/postgres",
    "postgresql://postgres.abcdefghijklmnopqrst@aws-0-us-east-1.pooler.supabase.com/postgres",
  ])
    expect(validMeasurementLogin(new URL(address))).toBe(false);
  delete process.env.OT_FREE_CHECK_MEASUREMENT_SUPABASE_PROJECT_REF;
  expect(
    validMeasurementLogin(
      new URL(
        "postgresql://ot_prod_app.abcdefghijklmnopqrst@aws-0-us-east-1.pooler.supabase.com/postgres",
      ),
    ),
  ).toBe(false);
});

it.each([
  "ssl=0",
  "user=postgres&host=attacker.example",
  "statement_timeout=0&query_timeout=0",
])("ignores pg URL override parameters: %s", async (params) => {
  process.env.SUPABASE_CA_PEM = "test-pinned-ca";
  process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL = `postgresql://ot_prod_app:p%40ss@example.com:6543/postgres?${params}`;
  const config = measurementClientConfig();
  expect(config).not.toHaveProperty("connectionString");
  // Inspect the actual driver parse, not merely our configuration object.
  const { Client } = await import("pg");
  const client = new Client(config);
  const actual = (
    client as unknown as { connectionParameters: Record<string, unknown> }
  ).connectionParameters;
  expect(actual).toMatchObject({
    user: "ot_prod_app",
    password: "p@ss",
    host: "example.com",
    port: 6543,
    database: "postgres",
    ssl: { ca: "test-pinned-ca", rejectUnauthorized: true },
    statement_timeout: 500,
    query_timeout: 600,
  });
  expect(config.connectionTimeoutMillis).toBe(500);
});

it("uses dedicated CA ahead of shared CA without changing shared configuration", () => {
  process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL =
    "postgresql://ot_prod_app@example.com/postgres";
  process.env.OT_FREE_CHECK_MEASUREMENT_CA_PEM = "dedicated-ca";
  process.env.SUPABASE_CA_PEM = "shared-ca";
  expect(measurementClientConfig().ssl).toEqual({
    ca: "dedicated-ca",
    rejectUnauthorized: true,
  });
  expect(process.env.SUPABASE_CA_PEM).toBe("shared-ca");
});

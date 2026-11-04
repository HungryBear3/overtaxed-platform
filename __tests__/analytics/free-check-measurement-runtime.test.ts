/** @jest-environment node */
import { recordFreeCheckCompletion } from "@/lib/analytics/free-check-measurement";
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract";
import {
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

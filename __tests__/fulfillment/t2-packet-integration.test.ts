/** @jest-environment node */
import { PDFDocument } from "pdf-lib";
import { get, put } from "@vercel/blob";
import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest";
import { generateT2Artifact, type T2ArtifactGateway } from "@/lib/fulfillment-runtime/t2-artifact-producer";
import { prismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store";
import { runT2ArtifactBindingWorkflow } from "@/lib/fulfillment-runtime/t2-artifact-workflow";

jest.mock("server-only", () => ({}));
jest.mock("@vercel/blob", () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock("@/lib/fulfillment-runtime/artifact-binding-store", () => ({ prismaArtifactBindingStore: { bind: jest.fn() } }));
jest.mock("@/lib/fulfillment-runtime/t2-artifact-producer", () => ({
  ...jest.requireActual("@/lib/fulfillment-runtime/t2-artifact-producer"),
  generateT2Artifact: jest.fn((input) => jest.requireActual("@/lib/fulfillment-runtime/t2-artifact-producer").generateT2Artifact(input, mockGateway)),
}));

const AT = "2026-06-08T12:00:00Z";
const input = { orderId: "ord_synthetic_integration", fulfillmentId: "ful_synthetic_integration" };
let mockGateway: T2ArtifactGateway;
let objects: Map<string, Buffer>;
const originalEnv = { ...process.env };
function gateway(): T2ArtifactGateway {
  const subject = { pin: "99010010010000", address: "1 EXAMPLE ST", city: "Chicago", township: "Example", neighborhoodCode: "99010", propertyClass: "203", residentialSubtype: "1 Story", buildingSqft: 1200, yearBuilt: 1955, assessedTotalValue: 30000, assessmentStage: "mailed" as const, taxYear: 2025, pinCount: 1, inCookCounty: true };
  const candidates = Array.from({ length: 6 }, (_, i) => ({ pin: `9901001002000${i}`, neighborhoodCode: "99010", propertyClass: "203", residentialSubtype: "1 Story", buildingSqft: 1200, yearBuilt: 1955 }));
  return {
    loadOrder: async () => ({ id: input.orderId, propertyPin: subject.pin, propertyAddress: subject.address, township: subject.township }),
    loadFulfillment: async () => ({ id: input.fulfillmentId, orderId: input.orderId, kind: "T2_APPEAL_EVIDENCE", status: "ARTIFACT_PENDING", createdAt: new Date("2026-06-08T10:15:30Z") }),
    loadCountyData: async () => ({ subject, comparableCandidates: candidates, comparableAssessedValues: new Map(candidates.map(c => [c.pin, 24000])), comparableAddresses: new Map(candidates.map((c, i) => [c.pin, `${i} EXAMPLE AVE`])), sources: [
      { datasetId: "uzyt-m557", datasetTitle: "Assessor - Assessed Values", url: "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json", retrievedAt: AT, contentSha256: "a".repeat(64) },
      { datasetId: "x54s-btds", datasetTitle: "Assessor - Single and Multi-Family Improvement Characteristics", url: "https://datacatalog.cookcountyil.gov/resource/x54s-btds.json", retrievedAt: AT, contentSha256: "b".repeat(64) },
    ] }),
    resolvePolicy: () => ({ version: "test-only-policy", ownerDecisions: ["OD-2", "OD-3"], signedAt: "2026-06-08", evidenceThreshold: { minRelativeAssessmentGap: 0.2, minComparables: 5 } }),
    resolveDeadline: async () => ({ trusted: true, status: "open", closeDate: "2026-06-30", sourceName: "Cook County Assessor", sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines", retrievedAt: AT }),
    now: () => new Date(AT),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGateway = gateway();
  objects = new Map();
  process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true";
  process.env.OT_T2_PRIVATE_STORAGE_ENABLED = "true";
  jest.mocked(get).mockImplementation(async (locator) => {
    const bytes = objects.get(String(locator));
    return bytes ? { statusCode: 200, blob: { pathname: locator, contentType: "application/pdf", size: bytes.length }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } as Awaited<ReturnType<typeof get>> : null;
  });
  jest.mocked(put).mockImplementation(async (locator, bytes, options) => {
    expect(options).toEqual({ access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf" });
    if (objects.has(locator)) throw new Error("synthetic conflict");
    objects.set(locator, Buffer.from(bytes as Buffer));
    return { pathname: locator, contentType: "application/pdf" } as Awaited<ReturnType<typeof put>>;
  });
  let boundDigest: string | undefined;
  jest.mocked(prismaArtifactBindingStore.bind).mockImplementation(async command => {
    const digest = computeArtifactSha256(command.bytes);
    expect(objects.get(`t2-artifacts/sha256/${digest}.pdf`)?.equals(command.bytes)).toBe(true);
    const created = !boundDigest;
    expect(boundDigest ?? digest).toBe(digest);
    boundDigest = digest;
    return { ok: true, created, artifactId: "artifact_synthetic", artifactSha256: digest };
  });
});
afterEach(() => { process.env = { ...originalEnv }; });

test("real generation produces a parseable private PDF, binds exact bytes, and replays without a second put", async () => {
  const first = await runT2ArtifactBindingWorkflow(input);
  expect(first).toMatchObject({ outcome: "BOUND", created: true });
  const bytes = [...objects.values()][0];
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  const second = await runT2ArtifactBindingWorkflow(input);
  expect(second).toMatchObject({ outcome: "BOUND", created: false });
  expect(put).toHaveBeenCalledTimes(1);
  expect(prismaArtifactBindingStore.bind).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(first)).not.toContain("https:");
});
test("unsigned policy refuses before any provider or binding access", async () => {
  mockGateway.resolvePolicy = () => null;
  expect(await runT2ArtifactBindingWorkflow(input)).toEqual({ outcome: "UNAVAILABLE", blocker: "ELIGIBILITY_POLICY_UNSIGNED" });
  expect(get).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(prismaArtifactBindingStore.bind).not.toHaveBeenCalled();
});
test("private storage disabled cannot fall through to public uploads", async () => {
  delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED;
  expect(await runT2ArtifactBindingWorkflow(input)).toMatchObject({ outcome: "RECONCILIATION_REQUIRED" });
  expect(get).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(prismaArtifactBindingStore.bind).not.toHaveBeenCalled();
});
test("lost response after committed put holds, then a separate retry reuses the exact private PDF", async () => {
  jest.mocked(put).mockImplementationOnce(async (locator, bytes) => { objects.set(locator, Buffer.from(bytes as Buffer)); throw new Error("synthetic lost response"); });
  expect(await runT2ArtifactBindingWorkflow(input)).toMatchObject({ outcome: "RECONCILIATION_REQUIRED" });
  expect(prismaArtifactBindingStore.bind).not.toHaveBeenCalled();
  expect(await runT2ArtifactBindingWorkflow(input)).toMatchObject({ outcome: "BOUND", created: true });
  expect(put).toHaveBeenCalledTimes(1);
});
test("corrupt stored bytes never reach binding", async () => {
  await runT2ArtifactBindingWorkflow(input);
  jest.mocked(prismaArtifactBindingStore.bind).mockClear();
  const locator = [...objects.keys()][0];
  const damaged = Buffer.from(objects.get(locator)!);
  damaged[20] ^= 1;
  objects.set(locator, damaged);
  expect(await runT2ArtifactBindingWorkflow(input)).toMatchObject({ outcome: "RECONCILIATION_REQUIRED" });
  expect(prismaArtifactBindingStore.bind).not.toHaveBeenCalled();
  expect(put).toHaveBeenCalledTimes(1);
});
test("the actual default producer still refuses unsigned live policy without a gateway override", async () => {
  const actual: typeof generateT2Artifact = jest.requireActual("@/lib/fulfillment-runtime/t2-artifact-producer").generateT2Artifact;
  expect(await actual(input)).toEqual({ ok: false, blocker: "ELIGIBILITY_POLICY_UNSIGNED" });
  expect(put).not.toHaveBeenCalled();
});

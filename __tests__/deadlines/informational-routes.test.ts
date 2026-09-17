/** @jest-environment node */
import { GET as refresh } from "@/app/api/cron/informational-deadlines/route";
import { GET as read } from "@/app/api/deadlines/informational/route";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { collectInformationalSnapshot, sourceBodyForSnapshot } from "@/lib/deadlines/collect-informational-snapshot";
import { commerceSnapshotStore } from "@/lib/deadlines/commerce-snapshot-store";
import { parseInformationalAssessorHtml } from "@/lib/deadlines/assessor-calendar-parser";
import { TOWNSHIPS } from "@/lib/townships";
import { INFORMATIONAL_SOURCE_URL as URL } from "@/lib/deadlines/informational-snapshot";
jest.mock("server-only", () => ({}));
jest.mock("@/lib/deadlines/informational-snapshot-store", () => ({ informationalSnapshotStore: jest.fn() }));
jest.mock("@/lib/deadlines/collect-informational-snapshot", () => ({ collectInformationalSnapshot: jest.fn(), sourceBodyForSnapshot: jest.fn() }));
jest.mock("@/lib/deadlines/commerce-snapshot-store", () => ({ commerceSnapshotStore: jest.fn() }));
const AT = new Date("2026-09-12T08:00:00Z");
const KEY = "synthetic-cron-test-" + "x".repeat(32);
const factory = jest.mocked(informationalSnapshotStore);
const collect = jest.mocked(collectInformationalSnapshot);
const sourceBody = jest.mocked(sourceBodyForSnapshot);
const commerceFactory = jest.mocked(commerceSnapshotStore);
const oldFlag = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
const oldSecret = process.env.CRON_SECRET;
const oldCommerceFlag = process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED;
const store = { read: jest.fn(), publish: jest.fn(), begin: jest.fn(), complete: jest.fn() };
const commerce = { read: jest.fn(), publish: jest.fn() };
const request = (auth = `Bearer ${KEY}`) => new Request("https://example.test/api/cron/informational-deadlines", { headers: { authorization: auth } });
const fixture = () => ({ schemaVersion: 1 as const, synthetic: false, sources: { bor: null, assessor: {
  authority: "cook_county_assessor" as const, sourceUrl: URL, finalUrl: URL, httpStatus: 200, retrievedAt: AT.toISOString(), sourceUpdatedAt: null,
  contentSha256: "a".repeat(64), parseStatus: "ok" as const, parserVersion: "ccao-dom/1.0.0",
} }, townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name, stages: { assessor: null } }])) });
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(AT); jest.resetAllMocks();
  process.env.CRON_SECRET = KEY; process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  delete process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED;
  store.begin.mockResolvedValue("synthetic-attempt"); store.complete.mockResolvedValue(true);
  factory.mockResolvedValue(store); store.read.mockResolvedValue(fixture()); store.publish.mockResolvedValue("PUBLISHED"); collect.mockResolvedValue(fixture());
  sourceBody.mockReturnValue(Buffer.from("official-body")); commerceFactory.mockResolvedValue(null); commerce.publish.mockResolvedValue("PUBLISHED");
});
afterEach(() => {
  jest.useRealTimers();
  if (oldFlag === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = oldFlag;
  if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
  if (oldCommerceFlag === undefined) delete process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED; else process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = oldCommerceFlag;
});
test.each([undefined, "", "short", "x".repeat(32) + " "])("missing or weak secret refuses before side effects", async secret => {
  if (secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret;
  const response = await refresh(request()); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(factory).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled();
});
test.each(["", KEY, `bearer ${KEY}`, `Bearer ${KEY}wrong`])("invalid authorization refuses", async auth => {
  expect((await refresh(request(auth))).status).toBe(401); expect(factory).not.toHaveBeenCalled();
});
test("disabled refresh and public read have no storage or provider effects", async () => {
  delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
  expect(await (await refresh(request())).json()).toEqual({ status: "disabled" });
  expect(await (await read()).json()).toBeNull(); expect(factory).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled();
});
test("authorized refresh pins trusted adapters and preserves complete source bytes", async () => {
  const value = fixture(); const response = await refresh(request());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "published" });
  expect(collect).toHaveBeenCalledWith({ fetchSource: fetch, parseHtml: parseInformationalAssessorHtml, now: expect.any(Function) });
  expect(collect.mock.calls[0][0].now()).toEqual(AT); expect(store.publish).toHaveBeenCalledWith(JSON.stringify(value));
});
test.each(["UNCHANGED", "REFUSED"])("publication %s is reported without false success", async result => {
  store.publish.mockResolvedValue(result); const response = await refresh(request());
  expect(response.status).toBe(result === "REFUSED" ? 503 : 200); expect(await response.json()).toEqual({ status: result.toLowerCase() });
});
test("failed or late-disabled collection cannot publish", async () => {
  collect.mockResolvedValueOnce(null); expect((await refresh(request())).status).toBe(503); expect(store.publish).not.toHaveBeenCalled();
  collect.mockImplementationOnce(async () => { delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; return fixture(); });
  expect((await refresh(request())).status).toBe(503); expect(store.publish).not.toHaveBeenCalled();
});
test("unavailable storage and raw exceptions remain generic", async () => {
  factory.mockResolvedValueOnce(null); expect((await refresh(request())).status).toBe(503); expect(collect).not.toHaveBeenCalled();
  factory.mockRejectedValueOnce(new Error("private driver diagnostics"));
  expect(await (await refresh(request())).json()).toEqual({ status: "unavailable" });
});
test("public read is no-store and never fetches/publishes or renews receipt", async () => {
  const response = await read(); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual(fixture());
  expect(collect).not.toHaveBeenCalled(); expect(store.publish).not.toHaveBeenCalled();
});
test("public read revalidates after storage delay or late disable and hides raw failures", async () => {
  store.read.mockImplementationOnce(async () => { jest.setSystemTime(new Date(AT.getTime() + 86_400_001)); return fixture(); });
  expect(await (await read()).json()).toBeNull(); jest.setSystemTime(AT);
  store.read.mockImplementationOnce(async () => { delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; return fixture(); });
  expect(await (await read()).json()).toBeNull(); process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  factory.mockRejectedValueOnce(new Error("private driver diagnostics")); expect(await (await read()).json()).toBeNull();
});

test("attempt must be durable before fetching, and completion must bind successful publication", async () => {
  store.begin.mockResolvedValueOnce(null); expect((await refresh(request())).status).toBe(503); expect(collect).not.toHaveBeenCalled();
  store.complete.mockResolvedValueOnce(false); expect((await refresh(request())).status).toBe(503);
  expect(store.complete).toHaveBeenCalledWith("synthetic-attempt", JSON.stringify(fixture()));
  expect(store.begin.mock.invocationCallOrder[1]).toBeLessThan(collect.mock.invocationCallOrder[0]);
  expect(store.publish.mock.invocationCallOrder[0]).toBeLessThan(store.complete.mock.invocationCallOrder[0]);
});
test("failed collection never marks its pending attempt ready", async () => {
  collect.mockResolvedValue(null); expect((await refresh(request())).status).toBe(503);
  expect(store.begin).toHaveBeenCalled(); expect(store.complete).not.toHaveBeenCalled();
});

test("late disable while completion settles never reports enabled publication", async () => {
  store.complete.mockImplementationOnce(async () => { delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; return true; });
  const response = await refresh(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({status:"refused"});
});

test("publishes commerce first and reports a reconcilable partial informational failure", async () => {
  process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = "true";
  commerceFactory.mockResolvedValue(commerce);
  store.complete.mockResolvedValueOnce(false);
  const response = await refresh(request());
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "partial" });
  expect(commerce.publish.mock.invocationCallOrder[0]).toBeLessThan(store.publish.mock.invocationCallOrder[0]);
});

test("commerce refusal prevents informational publication, while identical retry can reconcile", async () => {
  process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = "true";
  commerceFactory.mockResolvedValue(commerce);
  commerce.publish.mockResolvedValueOnce("REFUSED");
  expect((await refresh(request())).status).toBe(503); expect(store.publish).not.toHaveBeenCalled();
  commerce.publish.mockResolvedValueOnce("UNCHANGED");
  expect((await refresh(request())).status).toBe(200); expect(store.publish).toHaveBeenCalledTimes(1);
});

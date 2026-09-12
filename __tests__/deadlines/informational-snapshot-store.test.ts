/** @jest-environment node */
import { TOWNSHIPS } from "@/lib/townships";
import { INFORMATIONAL_SOURCE_URL as SOURCE } from "@/lib/deadlines/informational-snapshot";
import { createInformationalSnapshotStore, informationalSnapshotStore, INFORMATIONAL_SNAPSHOT_KEY, type InformationalSnapshotClient } from "@/lib/deadlines/informational-snapshot-store";
jest.mock("server-only", () => ({}));
let mockDatabaseLoads = 0;
jest.mock("@/lib/db", () => { mockDatabaseLoads++; throw new Error("synthetic unavailable database configuration"); });
const original = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
afterEach(() => { if (original === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = original; });
function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const transaction = jest.fn();
  const client = { $queryRaw: query, $transaction: transaction } as unknown as InformationalSnapshotClient;
  return { query, transaction, store: createInformationalSnapshotStore(client) };
}
test("default adapter avoids database initialization while off and suppresses import failure", async () => {
  delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
  expect(await informationalSnapshotStore()).toBeNull();
  expect(mockDatabaseLoads).toBe(0);
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  expect(await informationalSnapshotStore()).toBeNull();
  expect(mockDatabaseLoads).toBe(1);
});
test.each([undefined, "", "false", "1", "TRUE"])("disabled configuration %s performs no database access", async flag => {
  if (flag === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = flag;
  const { store, query, transaction } = setup();
  expect(await store.read(new Date())).toBeNull();
  expect(await store.publish("{}" )).toBe("REFUSED");
  expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
});
test("read is bounded and uses only the dedicated namespace; missing/malformed rows refuse", async () => {
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  const { store, query } = setup();
  expect(await store.read(new Date())).toBeNull();
  expect(query.mock.calls[0][0].values).toEqual([100001, INFORMATIONAL_SNAPSHOT_KEY]);
  query.mockResolvedValue([{ value: "not-json" }]);
  expect(await store.read(new Date())).toBeNull();
});
test("raw database errors are suppressed and not mistaken for publication", async () => {
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  const { store, query, transaction } = setup();
  query.mockRejectedValue(new Error("sensitive provider text"));
  transaction.mockRejectedValue(new Error("sensitive provider text"));
  expect(await store.read(new Date())).toBeNull();
  expect(await store.publish("{}")).toBe("REFUSED");
});
test("late read disable and oversized publication fail closed", async () => {
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  const { store, query, transaction } = setup();
  query.mockImplementation(async () => { delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; return []; });
  expect(await store.read(new Date())).toBeNull();
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  expect(await store.publish("x".repeat(100001))).toBe("REFUSED");
  expect(transaction).not.toHaveBeenCalled();
});

test("publication compares an explicit DB epoch rather than timezone-sensitive driver dates", async () => {
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  const at = "2026-09-12T08:22:00.000Z";
  const raw = JSON.stringify({schemaVersion:1,synthetic:false,sources:{bor:null,assessor:{authority:"cook_county_assessor",sourceUrl:SOURCE,finalUrl:SOURCE,httpStatus:200,retrievedAt:at,sourceUpdatedAt:null,contentSha256:"a".repeat(64),parseStatus:"ok",parserVersion:"ccao-dom/1.0.0"}},townships:Object.fromEntries(TOWNSHIPS.map(t=>[t.slug,{townshipName:t.name,stages:{assessor:null}}]))});
  const execute = jest.fn().mockResolvedValue(1);
  let clock = String(Date.parse(at) + 1);
  const query = jest.fn(async (sql: {text:string}) => sql.text.includes("clock_timestamp") ? [{now:clock}] : []);
  const client = {$queryRaw:query,$transaction:async(work:Function)=>work({$queryRaw:query,$executeRaw:execute})} as unknown as InformationalSnapshotClient;
  const store = createInformationalSnapshotStore(client);
  expect(await store.publish(raw)).toBe("PUBLISHED");
  expect(query.mock.calls.find(([sql])=>sql.text.includes("clock_timestamp"))?.[0].text).toContain("extract(epoch FROM clock_timestamp())");
  execute.mockClear();clock = "2026-09-12T03:22:00Z";
  expect(await store.publish(raw)).toBe("REFUSED");expect(execute).not.toHaveBeenCalled();
});

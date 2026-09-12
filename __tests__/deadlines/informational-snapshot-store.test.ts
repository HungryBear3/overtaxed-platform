/** @jest-environment node */
import { createInformationalSnapshotStore, INFORMATIONAL_SNAPSHOT_KEY, type InformationalSnapshotClient } from "@/lib/deadlines/informational-snapshot-store";
jest.mock("server-only", () => ({}));
const original = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
afterEach(() => { if (original === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = original; });
function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const transaction = jest.fn();
  const client = { $queryRaw: query, $transaction: transaction } as unknown as InformationalSnapshotClient;
  return { query, transaction, store: createInformationalSnapshotStore(client) };
}
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

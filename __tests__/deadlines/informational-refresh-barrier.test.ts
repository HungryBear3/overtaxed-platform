/** @jest-environment node */
import { createInformationalRefreshBarrier } from "@/lib/deadlines/informational-refresh-barrier";
import type { InformationalSnapshotClient } from "@/lib/deadlines/informational-snapshot-store";
jest.mock("server-only", () => ({}));
const old = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
beforeEach(() => { process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true"; });
afterEach(() => { if (old === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = old; });
function setup() {
  const values = new Map<string, string>();
  const query = jest.fn(async (sql: { text: string; values: unknown[] }) => sql.text.includes("pg_advisory") ? [] :
    values.has(String(sql.values[0])) ? [{ value: values.get(String(sql.values[0])) }] : []);
  const execute = jest.fn(async (sql: { text: string; values: unknown[] }) => {
    if (sql.text.startsWith("INSERT")) values.set(String(sql.values[1]), String(sql.values[2]));
    else values.set(String(sql.values[1]), String(sql.values[0]));
    return 1;
  });
  const transaction = jest.fn(async (work: Function) => work({ $queryRaw: query, $executeRaw: execute }));
  const barrier = createInformationalRefreshBarrier({ $queryRaw: query, $transaction: transaction } as unknown as InformationalSnapshotClient, "snapshot");
  return { barrier, values, query, execute, transaction };
}
test("pending attempt hides old data; success binds exact persisted bytes", async () => {
  const { barrier, values } = setup(); values.set("snapshot", "new");
  expect(await barrier.permits("new")).toBe(false);
  const id = (await barrier.begin())!; expect(await barrier.permits("new")).toBe(false);
  expect(await barrier.complete(id, "wrong")).toBe(false); expect(await barrier.permits("new")).toBe(false);
  expect(await barrier.complete(id, "new")).toBe(true); expect(await barrier.permits("new")).toBe(true);
  expect(await barrier.permits("old")).toBe(false);
  await barrier.begin(); expect(await barrier.permits("new")).toBe(false);
});
test("overlapping same-clock attempts cannot reopen a newer failed refresh", async () => {
  const { barrier, values } = setup(); values.set("snapshot", "new");
  const first = (await barrier.begin())!; const second = (await barrier.begin())!;
  expect(first).not.toBe(second); expect(await barrier.complete(first, "new")).toBe(false);
  expect(await barrier.permits("new")).toBe(false); expect(await barrier.complete(second, "new")).toBe(true);
  expect(await barrier.permits("new")).toBe(true);
});
test("absent/corrupt/unknown markers refuse; incomplete marker cannot authorize", async () => {
  const { barrier, values } = setup();
  for (const raw of ["bad", "{}", JSON.stringify({ id: "x".repeat(36), state: "ready", digest: "a".repeat(64) })]) {
    values.set("snapshot:attempt", raw); expect(await barrier.permits("new")).toBe(false);
  }
});
test("disabled and late-disabled reads have no success or writes", async () => {
  const { barrier, query, transaction } = setup(); delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
  expect(await barrier.begin()).toBeNull(); expect(await barrier.complete("id", "new")).toBe(false); expect(await barrier.permits("new")).toBe(false);
  expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
});
test("lost begin or completion response fails closed without raw errors", async () => {
  const { barrier, transaction, values } = setup(); values.set("snapshot", "new");
  const id = (await barrier.begin())!; transaction.mockRejectedValueOnce(new Error("private diagnostics"));
  expect(await barrier.complete(id, "new")).toBe(false); expect(await barrier.permits("new")).toBe(false);
  transaction.mockRejectedValueOnce(new Error("private diagnostics")); expect(await barrier.begin()).toBeNull();
});

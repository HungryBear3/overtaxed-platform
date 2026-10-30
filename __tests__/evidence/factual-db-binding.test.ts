import { readFileSync } from "fs";
import { join } from "path";

const mockPoolCtor = jest.fn();
const mockAdapterCtor = jest.fn();
const mockClientCtor = jest.fn();
const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock("pg", () => ({
  Pool: function (this: unknown, cfg: unknown) {
    mockPoolCtor(cfg);
    return { on: jest.fn() };
  },
}));
jest.mock("@prisma/adapter-pg", () => ({
  PrismaPg: function (pool: unknown) {
    mockAdapterCtor(pool);
    return { adapter: true };
  },
}));
jest.mock("@prisma/client", () => ({
  PrismaClient: function (opts: unknown) {
    mockClientCtor(opts);
    return { $transaction: mockTransaction };
  },
}));

const GOOD_ROLE = [{ current_user: "ot_factual_app", rolsuper: false, rolbypassrls: false }];
const URL_OK = "postgresql://ot_factual_app:s3cret@db.example:5432/factual";
const ORIGINAL_ENV = { ...process.env };

function load(): typeof import("@/lib/evidence/server/factual-db") {
  let mod!: typeof import("@/lib/evidence/server/factual-db");
  jest.isolateModules(() => {
    mod = require("@/lib/evidence/server/factual-db");
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.DATABASE_URL;
  process.env.OT_FACTUAL_DATABASE_URL = URL_OK;
  process.env.OT_FACTUAL_DATABASE_SSL = "require";
  process.env.OT_ROLE_DATABASE_HOST = "db.example";
  process.env.OT_ROLE_DATABASE_CA = readFileSync(join(__dirname, "fixtures/supabase-root.crt"), "utf8");
  delete process.env.OT_ROLE_DATABASE_PROJECT_REF;
  mockQueryRaw.mockResolvedValue(GOOD_ROLE);
  mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({ $queryRaw: mockQueryRaw }),
  );
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("factual-db binding", () => {
  it("constructs nothing at import time (build-safe without env)", () => {
    delete process.env.OT_FACTUAL_DATABASE_URL;
    delete process.env.OT_FACTUAL_DATABASE_SSL;
    expect(() => load()).not.toThrow();
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(mockClientCtor).not.toHaveBeenCalled();
  });

  it("builds PrismaClient from PrismaPg over a pg.Pool using only factual env", async () => {
    process.env.DATABASE_URL = "postgresql://paid:pw@paid.example/paid";
    const { withFactualTransaction } = load();
    await withFactualTransaction(async () => "ok");
    expect(mockPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: URL_OK, ssl: expect.objectContaining({ rejectUnauthorized: true, servername: "db.example" }) }),
    );
    expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
    expect(mockClientCtor).toHaveBeenCalledWith({ adapter: { adapter: true } });
  });

  it("supports SSL=disable as ssl:false", async () => {
    process.env.OT_FACTUAL_DATABASE_SSL = "disable";
    process.env.OT_FACTUAL_DATABASE_URL = "postgresql://ot_factual_app@localhost/factual";
    delete process.env.OT_ROLE_DATABASE_HOST;
    delete process.env.OT_ROLE_DATABASE_CA;
    await load().withFactualTransaction(async () => 1);
    expect(mockPoolCtor).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
  });

  it.each([
    ["missing url", { OT_FACTUAL_DATABASE_URL: undefined }],
    ["missing username", { OT_FACTUAL_DATABASE_URL: "postgresql://db.example/factual" }],
    ["missing database", { OT_FACTUAL_DATABASE_URL: "postgresql://ot_factual_app@db.example" }],
    ["wrong username", { OT_FACTUAL_DATABASE_URL: "postgresql://postgres@db.example/factual" }],
    ["missing ssl", { OT_FACTUAL_DATABASE_SSL: undefined }],
    ["invalid ssl", { OT_FACTUAL_DATABASE_SSL: "maybe" }],
    ["garbage url", { OT_FACTUAL_DATABASE_URL: "not a url" }],
    ["wrong protocol", { OT_FACTUAL_DATABASE_URL: "mysql://u:p@h/db" }],
    ["sslmode in url", { OT_FACTUAL_DATABASE_URL: `${URL_OK}?sslmode=disable` }],
  ])("fails closed with STORAGE_UNAVAILABLE on %s, no DATABASE_URL fallback", async (_n, env) => {
    process.env.DATABASE_URL = "postgresql://paid:pw@paid.example/paid";
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const fn = jest.fn();
    const err = await load().withFactualTransaction(fn).catch((e) => e);
    expect(err).toMatchObject({ code: "STORAGE_UNAVAILABLE", message: "Factual storage is unavailable" });
    expect(fn).not.toHaveBeenCalled();
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(JSON.stringify(err) + String((err as Error).stack)).not.toMatch(/s3cret|paid\.example/);
  });

  it("verifies role inside the same transaction before running the callback", async () => {
    const order: string[] = [];
    mockQueryRaw.mockImplementation(async () => (order.push("role"), GOOD_ROLE));
    const result = await load().withFactualTransaction(async (tx) => {
      order.push("fn");
      expect(tx.$queryRaw).toBe(mockQueryRaw);
      return 42;
    });
    expect(result).toBe(42);
    expect(order).toEqual(["role", "fn"]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong role", [{ current_user: "postgres", rolsuper: false, rolbypassrls: false }]],
    ["superuser", [{ current_user: "ot_factual_app", rolsuper: true, rolbypassrls: false }]],
    ["bypassrls", [{ current_user: "ot_factual_app", rolsuper: false, rolbypassrls: true }]],
    ["no row", []],
  ])("rejects %s without running the callback", async (_n, rows) => {
    mockQueryRaw.mockResolvedValue(rows);
    const fn = jest.fn();
    await expect(load().withFactualTransaction(fn)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("sanitizes connection/driver failures before the callback", async () => {
    mockTransaction.mockRejectedValue(new Error("password=s3cret ECONNREFUSED"));
    const err = await load().withFactualTransaction(jest.fn()).catch((e) => e);
    expect(err).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((err as Error).message).not.toMatch(/s3cret|ECONN/);
  });

  it("passes callback errors through unchanged", async () => {
    const boom = new Error("unique violation");
    await expect(
      load().withFactualTransaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("reuses one client across calls", async () => {
    const { withFactualTransaction } = load();
    await withFactualTransaction(async () => 1);
    await withFactualTransaction(async () => 2);
    expect(mockClientCtor).toHaveBeenCalledTimes(1);
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
  });

  it("source never touches @/lib/db, DATABASE_URL, SET ROLE or bypass", () => {
    const src = readFileSync(join(process.cwd(), "lib/evidence/server/factual-db.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/db/);
    expect(src).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(src).not.toMatch(/SET\s+(LOCAL\s+)?ROLE|SET\s+SESSION\s+AUTHORIZATION|row_security/i);
  });
});

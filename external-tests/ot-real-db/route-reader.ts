// otreal29 ROUTE-READER boundary: actual app/api/ot/packet/download route + (when present) the
// server-only createPacketDownloadHandlers factory, driven with actual NextRequest/Response.
// Injected deps are ONLY store=createPrismaPacketDownloadStore(real strict-TLS neutralDeliveryPrisma,
// {neutralRestricted:true}) behind a transparent forwarding instrument, and readBytes=a fixture reader
// that returns exact pinned FIXTURE_NOT_SETTLEMENT ZIP bytes for the exact approved locator only.
// No fake DB, no SQL replica, no module/provider/transport patching, no provider credentials.
// BEFORE the factory exists the injected handler is the ORIGINAL route POST (deps ignored), so the
// positive/denial groups produce a behavioral RED (native 503) instead of a missing-import failure.
// Reuses existing otstore-1cc96331-ok-* / -noqa-* fixtures. Mutations: owned ok-artifact metadata +
// QA customer hash pinned to the fixture ZIP (idempotent), <=3 issue calls per run (2 capabilities),
// temporary restored controls on owned QA/order rows. No attempts/orders/slots/reservations/QA rows.
// Credentials, capability values and capability hashes are never printed. Any failure => exit 1.
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { Client } from "pg"
import { buildNeutralPoolConfig } from "../../lib/fulfillment-runtime/neutral-db-tls"
import { computePropertyBindingFingerprint } from "../../lib/fulfillment/artifact-digest"
import {
  createNeutralCustomerZip, crc32, neutralCustomerZipLocator, neutralCustomerZipSha256,
  NEUTRAL_CUSTOMER_ZIP_FILENAME, NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE,
} from "../../lib/fulfillment/neutral-customer-zip"
import { hashPacketDownloadCapability } from "../../lib/fulfillment/packet-download"

const ROOT = "/Users/abigailclaw/.hermes/cache/scratch/otreal29"
const HANDLER_FILE = `${ROOT}/repo/lib/fulfillment-runtime/packet-download-handler.ts`
const PORT = 55479
const ca = readFileSync(`${ROOT}/secrets/ca.crt`, "utf8")
const pw = (r: string) => readFileSync(`${ROOT}/secrets/pw-${r}`, "utf8").trim()
const ROLE = "ot_neutral_delivery_runtime"
const url = (role: string) => `postgresql://${role}:${encodeURIComponent(pw(role))}@localhost:${PORT}/postgres`
const OPT = { loopbackTls: "verify-full" } as const
const FX = { order: "otstore-1cc96331-ok-order", ful: "otstore-1cc96331-ok-ful", art: "otstore-1cc96331-ok-art", res: "otstore-1cc96331-ok-res", qa: "otstore-1cc96331-ok-qa" }
const NOQA = { order: "otstore-1cc96331-noqa-order", ful: "otstore-1cc96331-noqa-ful" }
const ENDPOINT = "http://localhost/api/ot/packet/download"
const PROVIDER_ENV = ["DATABASE_URL", "DIRECT_URL", "BLOB_READ_WRITE_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "OT_T2_RESEND_WEBHOOK_SECRET", "SUPABASE_CA_PEM", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL", "VERCEL_OIDC_TOKEN",
  "OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED", "OT_T2_PRIVATE_STORAGE_ENABLED", "DATABASE_INSECURE_TLS", "NODE_TLS_REJECT_UNAUTHORIZED"]
const PRIVATE: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache", "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow, noarchive",
}
const ISSUE_BUDGET = 3
const EXPECTED = 15
const redact = (s: string) => s.replace(/postgres(ql)?:\/\/[^@\s]*@/g, "postgresql://<redacted>@").replace(/\b[0-9a-f]{64}\b/g, "<sha256>").replace(/[A-Za-z0-9_-]{43}/g, "<cap43>")

let pass = 0, fail = 0
const notRun: string[] = [], okGroups = new Set<string>()
let obs: any[] = []
async function step(key: string, name: string, fn: () => Promise<unknown>) {
  obs = []
  try {
    const r = await fn()
    if (r && typeof r === "object" && (r as any).NOT_RUN) { notRun.push(key); console.log(JSON.stringify({ group: key, name, result: "NOT_RUN", detail: r, observed: obs })); return }
    pass++; okGroups.add(key); console.log(JSON.stringify({ group: key, name, result: "PASS", detail: r ?? null, observed: obs }))
  } catch (e: any) { fail++; console.log(JSON.stringify({ group: key, name, result: "FAIL", error: redact(`${e?.code ?? ""} ${e?.message ?? e}`), observed: obs })) }
}
const need = (...keys: string[]) => { for (const k of keys) if (!okGroups.has(k)) throw new Error(`PREREQ_FAILED ${k}`) }

// ---- static FIXTURE_NOT_SETTLEMENT bytes (deterministic: identical across RED and GREEN) ----
function fixturePdf(): Buffer {
  const text = "BT /F1 12 Tf 72 720 Td (FIXTURE_NOT_SETTLEMENT - local route-reader qualification only) Tj ET"
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n%FIXTURE_NOT_SETTLEMENT\n"
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "ascii")
}
const PDF = fixturePdf()
const CSV = Buffer.from("marker,purpose\nFIXTURE_NOT_SETTLEMENT,local route-reader qualification only; not a records report\n", "ascii")
const ZIP = createNeutralCustomerZip({ pdf: PDF, csv: CSV })
const ZIP_SHA = neutralCustomerZipSha256(ZIP)
const ZIP_LOCATOR = neutralCustomerZipLocator(ZIP_SHA)
const MISSING_QA_SHA = createHash("sha256").update("FIXTURE_NOT_SETTLEMENT:route-reader:missing-qa-control").digest("hex")

/** Minimal STORE-only reader for the exact layout createNeutralCustomerZip writes; validates CRCs. */
function unzipStore(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(eocd >= 0 && eocd + 22 === buf.length, "ZIP_EOCD")
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16)
  const out: Array<{ name: string; data: Buffer }> = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "ZIP_CENTRAL_SIG")
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42)
    const name = buf.toString("ascii", p + 46, p + 46 + nlen)
    p += 46 + nlen + elen + clen
    assert.equal(buf.readUInt32LE(lho), 0x04034b50, "ZIP_LOCAL_SIG")
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
    const data = buf.subarray(start, start + csize)
    assert.equal(method, 0); assert.equal(csize, usize); assert.equal(crc32(Buffer.from(data)), crc, `ZIP_CRC ${name}`)
    out.push({ name, data: Buffer.from(data) })
  }
  assert.equal(p, cdOff + cdSize, "ZIP_CENTRAL_SIZE")
  return out
}
function assertFixtureZip(bytes: Buffer) {
  const entries = unzipStore(bytes)
  assert.deepEqual(entries.map((e) => e.name), ["report.pdf", "report.csv"])
  const pdf = entries[0].data, csv = entries[1].data
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")), "PDF_MAGIC"); assert.ok(pdf.toString("ascii").trimEnd().endsWith("%%EOF"), "PDF_EOF")
  assert.ok(pdf.equals(PDF)); assert.ok(csv.equals(CSV))
  assert.ok(pdf.toString("ascii").includes("FIXTURE_NOT_SETTLEMENT") && csv.toString("ascii").includes("FIXTURE_NOT_SETTLEMENT"))
  return { entries: entries.map((e) => ({ name: e.name, bytes: e.data.length })) }
}

// ---- the only reader handed to the factory: exact pinned bytes for the exact approved locator ----
const reads: string[] = []
let trapCalls = 0
const fixtureReader = async (input: { locator: string }): Promise<Buffer> => {
  reads.push(String(input?.locator))
  if (!input || Object.keys(input).join() !== "locator" || input.locator !== ZIP_LOCATOR) throw new Error("FIXTURE_READER_LOCATOR_REJECTED")
  return Buffer.from(ZIP)
}
const trapReader = async (): Promise<Buffer> => { trapCalls++; throw new Error("TRAP_READER_MUST_NOT_RUN") }

// Route console.warn carries only the bounded refusal code; captured and forwarded unchanged.
const warns: string[] = []
const origWarn = console.warn.bind(console)
console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); origWarn(...args) }
const refusedCodes = (w: string[]) => w.map((x) => /outcome=REFUSED code=([A-Z_]+)/.exec(x)?.[1]).filter(Boolean)

async function main() {
  console.log(JSON.stringify({ start: { nodeEnv: process.env.NODE_ENV, zipSha256: ZIP_SHA, zipBytes: ZIP.length, pdfBytes: PDF.length, csvBytes: CSV.length } }))
  assert.equal(process.env.NODE_ENV, "development")
  const providerEnvPresent = PROVIDER_ENV.filter((k) => process.env[k] !== undefined)
  for (const k of PROVIDER_ENV) delete process.env[k]

  const admin = new Client({ ...buildNeutralPoolConfig(url("postgres"), ca, OPT), connectionTimeoutMillis: 5000, application_name: "otroute-admin" } as never)
  await admin.connect()
  const capRow = async (h: string) => { const r = await admin.query(`select id, use_count, max_uses, revoked_at is not null revoked, last_used_at is not null used, artifact_sha256 = $2 pinned from ot_packet_download_capability where capability_hash=$1`, [h, ZIP_SHA]); return r.rows[0] ?? null }
  const rowJson = async (table: string, id: string) => (await admin.query(`select to_jsonb(t) j from ${table} t where id=$1`, [id])).rows[0]?.j ?? null
  const triggers = async (table: string) => (await admin.query(`select tgname from pg_trigger where tgrelid=$1::regclass and not tgisinternal order by tgname`, [table])).rows.map((r) => r.tgname as string)
  const COUNT_TABLES = ["ot_order", "ot_payment_binding", "ot_fulfillment", "ot_fulfillment_artifact", "ot_neutral_report_reservation", "ot_neutral_qa_review", "ot_delivery_attempt", "ot_packet_download_capability"]
  const counts = async () => { const o: Record<string, number> = {}; for (const t of COUNT_TABLES) o[t] = (await admin.query(`select count(*)::int n from ${t}`)).rows[0].n; return o }
  const cohort = async () => (await admin.query(`select status::text s, count(*)::int n from ot_neutral_report_reservation group by status order by status`)).rows

  process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL = url(ROLE)
  process.env.OT_NEUTRAL_DATABASE_CA_PEM = ca
  process.env.OT_NEUTRAL_DELIVERY_ENABLED = "true"
  process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
  const db = await import("../../lib/fulfillment-runtime/neutral-delivery-db")
  const { createPrismaPacketDownloadStore } = await import("../../lib/fulfillment-runtime/packet-download-store")
  // ESM resolution ignores NODE_PATH; CJS require (tsx --require hook) resolves the installed next and
  // compiles route/factory as CJS so their own `next/server` imports resolve the same way. No mocking.
  const cjs = createRequire(`${ROOT}/repo/external-tests/ot-real-db/route-reader.ts`)
  const nextServer: any = cjs("next/server")
  const NextRequest = nextServer.NextRequest ?? nextServer.default?.NextRequest
  assert.equal(typeof NextRequest, "function", "HARNESS: next/server NextRequest unavailable")
  const route: any = cjs("../../app/api/ot/packet/download/route.ts")
  const factoryPresent = existsSync(HANDLER_FILE)
  let factory: ((deps?: any) => any) | null = null
  if (factoryPresent) {
    const mod: any = cjs("../../lib/fulfillment-runtime/packet-download-handler.ts")
    assert.equal(typeof mod.createPacketDownloadHandlers, "function", "HARNESS: handler file exists but createPacketDownloadHandlers export missing")
    factory = mod.createPacketDownloadHandlers
  }
  const MODE = factory ? "FACTORY" : "BASELINE_ORIGINAL_ROUTE"
  // BASELINE: the proposed deps are ignored and the actual original route handlers run unchanged.
  const construct = (...args: any[]) => factory ? factory(...args) : { POST: route.POST, GET: route.GET }

  const p = (db.neutralDeliveryPrisma as unknown as (o?: unknown) => any)(OPT)
  // TRANSPARENT INSTRUMENT (not a mock, not a replica): forwards every store query to the real tx
  // unchanged, counts it, then reads identity/TLS inside that same real transaction.
  const sql = { tx: 0, query: 0, exec: 0, seen: [] as any[] }
  const instrumented = {
    $transaction: (work: (tx: any) => Promise<unknown>, ...rest: unknown[]) => p.$transaction(async (tx: any) => {
      sql.tx++
      const fwd = { $queryRaw: (q: unknown) => { sql.query++; return tx.$queryRaw(q) }, $executeRaw: (q: unknown) => { sql.exec++; return tx.$executeRaw(q) } }
      const result = await work(fwd)
      const who = (await tx.$queryRawUnsafe(`select current_user::text cu, session_user::text su, s.ssl, s.version from pg_stat_ssl s where s.pid=pg_backend_pid()`))[0]
      sql.seen.push({ ok: (result as any)?.ok ?? null, ...who })
      return result
    }, ...rest),
  }
  const store = createPrismaPacketDownloadStore(instrumented as any, { neutralRestricted: true })
  const assertRealTx = (from: number) => { const s = sql.seen.slice(from); assert.ok(s.length > 0, "no real tx observed"); for (const o of s) { assert.equal(o.cu, ROLE); assert.equal(o.su, ROLE); assert.equal(o.ssl, true); assert.equal(o.version, "TLSv1.3") } return s.length }

  let issued = 0
  const issue = async (capabilityHash: string, fulfillmentId: string) => { assert.ok(issued < ISSUE_BUDGET, "ISSUE_BUDGET_EXCEEDED"); issued++; return store.issue({ capabilityHash, fulfillmentId, ttlSeconds: 600, maxUses: 1 }) }

  const req = (body: string | null, o: { query?: string; contentType?: string | null; method?: string } = {}) => {
    const headers: Record<string, string> = {}
    if (o.contentType !== null) headers["content-type"] = o.contentType ?? "application/json"
    return new NextRequest(ENDPOINT + (o.query ?? ""), { method: o.method ?? "POST", headers, body: body ?? undefined })
  }
  const capBody = (v: string) => JSON.stringify({ capability: v })
  async function call(label: string, handler: (...a: any[]) => Promise<Response>, request: any, ...extra: any[]) {
    const r0 = reads.length, t0 = trapCalls, x0 = sql.tx, w0 = warns.length
    const res = await handler(request, ...extra)
    assert.ok(res instanceof Response, `${label}: not a Response`)
    let body: any = null, bytes: Buffer | null = null
    if (res.status === 200) bytes = Buffer.from(await res.arrayBuffer()); else body = await res.json()
    const o = { label, status: res.status, code: body?.code ?? null, reads: reads.length - r0, trap: trapCalls - t0, storeTx: sql.tx - x0, refused: refusedCodes(warns.slice(w0)) }
    obs.push(o)
    return { ...o, res, body, bytes }
  }
  const assertPrivate = (res: Response) => { for (const [k, v] of Object.entries(PRIVATE)) assert.equal(res.headers.get(k), v, `private header ${k}`) }
  const assertDenied = (r: any, status: number, code: string, o: { storeTx?: boolean } = {}) => {
    assert.equal(r.status, status, `${r.label}: status ${r.status} expected ${status}`)
    assert.equal(r.body?.ok, false); assert.equal(r.body?.code, code, `${r.label}: code`)
    assertPrivate(r.res); assert.equal(r.res.headers.get("content-disposition"), null)
    assert.equal(r.reads, 0, `${r.label}: fixture reads`); assert.equal(r.trap, 0)
    if (!o.storeTx) assert.equal(r.storeTx, 0, `${r.label}: injected store must not run`)
  }
  const assertFailClosed = (r: any) => {
    assert.ok(r.status === 404 || r.status === 503, `${r.label}: status ${r.status} not fail-closed`)
    assert.ok(r.body?.code === "NOT_AVAILABLE" || r.body?.code === "TEMPORARILY_UNAVAILABLE")
    assertPrivate(r.res); assert.equal(r.reads, 0); assert.equal(r.trap, 0); assert.equal(r.storeTx, 0, `${r.label}: injected store ran`)
  }

  const capZ = randomBytes(32).toString("base64url"), capD = randomBytes(32).toString("base64url"), capUnknown = randomBytes(32).toString("base64url")
  const hZ = hashPacketDownloadCapability(capZ)!, hD = hashPacketDownloadCapability(capD)!, hN = createHash("sha256").update(`otpdl:v1:${randomBytes(32).toString("base64url")}`).digest("hex")
  let countsBefore: any, fixedRows: any = {}, orderTriggers: string[] = []
  const deps = () => ({ store, readBytes: fixtureReader })
  try {
    await step("S0", "environment: NODE_ENV=development, no provider/generic-DB credentials or storage enables, mode recorded", async () => {
      for (const k of PROVIDER_ENV) assert.equal(process.env[k], undefined)
      assert.equal(process.env.NODE_ENV, "development")
      return { mode: MODE, factoryFile: factoryPresent, providerEnvPresentAtLaunchNames: providerEnvPresent, routeExports: Object.keys(route).sort() }
    })

    await step("S1", "identity: delivery role NOSUPERUSER NOBYPASSRLS TLSv1.3 PG18.3; admin TLSv1.3", async () => {
      const r = (await p.$queryRawUnsafe(`select current_user::text cu, session_user::text su, r.rolsuper, r.rolbypassrls, s.ssl, s.version, current_setting('server_version') sv
        from pg_roles r, pg_stat_ssl s where r.rolname=current_user and s.pid=pg_backend_pid()`))[0]
      assert.equal(r.cu, ROLE); assert.equal(r.su, ROLE); assert.equal(r.rolsuper, false); assert.equal(r.rolbypassrls, false)
      assert.equal(r.ssl, true); assert.equal(r.version, "TLSv1.3"); assert.match(r.sv, /^18\.3\b/)
      const a = (await admin.query(`select s.ssl, s.version from pg_stat_ssl s where s.pid=pg_backend_pid()`)).rows[0]
      assert.equal(a.ssl, true); assert.equal(a.version, "TLSv1.3")
      return { cu: r.cu, rolsuper: r.rolsuper, rolbypassrls: r.rolbypassrls, tls: r.version, serverVersion: r.sv, adminTls: a.version }
    })

    await step("S2", "exact existing FIXTURE_NOT_SETTLEMENT ok fixture (slot6, QA-consistent) + no-QA twin; cohort 8 PROMOTED/1 RESERVED; counts BEFORE", async () => {
      need("S1")
      const r = await admin.query(`select o.id "order", o.status::text ostatus, o.tier::text tier, o."propertyPin" pin, o."propertyAddress" addr,
          f.status::text fstatus, a.version, a.artifact_sha256 sha, a.storage_locator loc, a.property_binding_fingerprint fp,
          r.cohort_position pos, q.id qa, v."paymentAuthoritative" pa, r.private_references->>'fixture' marker
        from ot_order o
        join ot_fulfillment f on f.order_id=o.id and f.kind::text='NEUTRAL_RECORDS_REPORT'
        join ot_fulfillment_artifact a on a.fulfillment_id=f.id and a.version=(select max(x.version) from ot_fulfillment_artifact x where x.fulfillment_id=f.id)
        join ot_neutral_qa_review q on q.fulfillment_id=f.id and q.order_id=o.id and q.status::text='APPROVED'
        join ot_neutral_report_reservation r on r.id=q.reservation_id and r.status::text='PROMOTED' and r.superseded_by_sha256 is null
        join ot_neutral_delivery_order v on v.id=o.id
        where o.id=$1 and f.id=$2 and a.id=$3 and r.id=$4
          and q.customer_artifact_sha256=a.artifact_sha256 and q.artifact_sha256=r.bundle_sha256
          and q.property_binding_fingerprint=a.property_binding_fingerprint and q.policy_version=a.template_version`, [FX.order, FX.ful, FX.art, FX.res])
      assert.equal(r.rowCount, 1, "EXACT_FIXTURE_NOT_FOUND (refusing to seed)")
      const f = r.rows[0]
      assert.equal(f.qa, FX.qa); assert.equal(f.marker, "FIXTURE_NOT_SETTLEMENT"); assert.equal(f.pos, 6)
      assert.equal(f.ostatus, "PAID"); assert.equal(f.tier, "T2"); assert.equal(f.fstatus, "ARTIFACT_READY"); assert.equal(f.pa, true)
      assert.equal(f.fp, computePropertyBindingFingerprint({ orderId: f.order, propertyPin: f.pin, propertyAddress: f.addr }))
      assert.equal(f.loc, neutralCustomerZipLocator(f.sha))
      const twin = (await admin.query(`select f.id, f.kind::text kind, (select count(*)::int from ot_neutral_qa_review q where q.fulfillment_id=f.id) qa,
          (select r.private_references->>'fixture' from ot_neutral_report_reservation r where r.order_id=f.order_id limit 1) marker
        from ot_fulfillment f where f.id=$1 and f.order_id=$2`, [NOQA.ful, NOQA.order])).rows
      assert.equal(twin.length, 1, "NOQA_TWIN_NOT_FOUND"); assert.equal(twin[0].kind, "NEUTRAL_RECORDS_REPORT"); assert.equal(twin[0].qa, 0); assert.equal(twin[0].marker, "FIXTURE_NOT_SETTLEMENT")
      const c = await cohort()
      assert.equal(c.find((x) => x.s === "PROMOTED")?.n, 8); assert.equal(c.find((x) => x.s === "RESERVED")?.n, 1)
      countsBefore = await counts()
      orderTriggers = await triggers("ot_order")
      return { fixture: { order: f.order, ful: FX.ful, art: FX.art, res: FX.res, qa: f.qa, slot: f.pos, marker: f.marker, artifactAlreadyPinned: f.sha === ZIP_SHA },
        noQaTwin: { ful: NOQA.ful, qaRows: twin[0].qa, marker: twin[0].marker }, cohort: c, countsBefore,
        userTriggers: { ot_order: orderTriggers, ot_fulfillment_artifact: await triggers("ot_fulfillment_artifact"), ot_neutral_qa_review: await triggers("ot_neutral_qa_review") } }
    })

    await step("S3", "fixture bytes: static valid ZIP(report.pdf+report.csv, FIXTURE_NOT_SETTLEMENT); owned artifact sha/locator/size + QA customer hash pinned consistently; QA join holds", async () => {
      need("S2")
      const zip = assertFixtureZip(ZIP)
      await admin.query("BEGIN")
      let changed = false
      try {
        const a = (await admin.query(`select artifact_sha256 sha, byte_size, storage_locator loc from ot_fulfillment_artifact where id=$1 and fulfillment_id=$2 for update`, [FX.art, FX.ful])).rows[0]
        const q = (await admin.query(`select customer_artifact_sha256 sha from ot_neutral_qa_review where id=$1 and fulfillment_id=$2 for update`, [FX.qa, FX.ful])).rows[0]
        assert.ok(a && q, "fixture rows vanished")
        if (a.sha !== ZIP_SHA || Number(a.byte_size) !== ZIP.length || a.loc !== ZIP_LOCATOR || q.sha !== ZIP_SHA) {
          changed = true
          assert.equal((await admin.query(`update ot_fulfillment_artifact set artifact_sha256=$2, byte_size=$3, storage_locator=$4 where id=$1 and fulfillment_id=$5`, [FX.art, ZIP_SHA, ZIP.length, ZIP_LOCATOR, FX.ful])).rowCount, 1)
          assert.equal((await admin.query(`update ot_neutral_qa_review set customer_artifact_sha256=$2 where id=$1 and fulfillment_id=$3`, [FX.qa, ZIP_SHA, FX.ful])).rowCount, 1)
        }
        await admin.query("COMMIT")
      } catch (e) { await admin.query("ROLLBACK").catch(() => {}); throw e }
      const a = (await admin.query(`select artifact_sha256 sha, byte_size, storage_locator loc, version from ot_fulfillment_artifact where id=$1`, [FX.art])).rows[0]
      assert.equal(a.sha, ZIP_SHA); assert.equal(Number(a.byte_size), ZIP.length); assert.equal(a.loc, ZIP_LOCATOR)
      const approved = (await admin.query(`select exists (select 1 from ot_neutral_qa_review q
          join ot_neutral_report_reservation r on r.id=q.reservation_id join ot_fulfillment_artifact a on a.fulfillment_id=q.fulfillment_id
          where q.fulfillment_id=$1 and q.order_id=$2 and q.status='APPROVED' and r.status='PROMOTED' and r.superseded_by_sha256 is null
            and q.customer_artifact_sha256=a.artifact_sha256 and q.artifact_sha256=r.bundle_sha256 and q.property_binding_fingerprint=a.property_binding_fingerprint
            and q.policy_version=a.template_version and a.version=(select max(x.version) from ot_fulfillment_artifact x where x.fulfillment_id=q.fulfillment_id)) ok`, [FX.ful, FX.order])).rows[0].ok
      assert.equal(approved, true)
      fixedRows = { order: await rowJson("ot_order", FX.order), qa: await rowJson("ot_neutral_qa_review", FX.qa), art: await rowJson("ot_fulfillment_artifact", FX.art) }
      return { metadataUpdatedThisRun: changed, zipSha256: ZIP_SHA, locator: ZIP_LOCATOR, byteSize: ZIP.length, zip, qaJoinApproved: approved }
    })

    await step("S4", "actual store.issue (instrumented real SQL): capZ + capD maxUses1 pinned to fixture ZIP; no-QA twin refused CAPABILITY_BINDING_MISMATCH, no row", async () => {
      need("S3")
      const s0 = sql.seen.length
      const z = await issue(hZ, FX.ful), d = await issue(hD, FX.ful)
      assert.equal(z.ok, true, JSON.stringify(z)); assert.equal(d.ok, true, JSON.stringify(d))
      for (const x of [z, d]) if (x.ok) { assert.equal(x.artifactSha256, ZIP_SHA); assert.equal(x.artifactId, FX.art); assert.equal(x.maxUses, 1) }
      const n = await issue(hN, NOQA.ful)
      assert.deepEqual(n, { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" })
      assert.equal(await capRow(hN), null)
      const rz = await capRow(hZ), rd = await capRow(hD)
      for (const r of [rz, rd]) { assert.ok(r); assert.equal(Number(r.use_count), 0); assert.equal(Number(r.max_uses), 1); assert.equal(r.revoked, false); assert.equal(r.pinned, true) }
      return { capZ: rz.id, capD: rd.id, noQaTwin: n, issueCalls: issued, realTx: assertRealTx(s0), sqlCounts: { query: sql.query, exec: sql.exec } }
    })

    await step("H1", "native default route POST (no deps / with ignored 2nd-arg deps; no-arg factory) stays unconfigured: fail closed before any read, use unclaimed", async () => {
      need("S4")
      const a = await call("route.POST", route.POST, req(capBody(capZ)))
      assertDenied(a, 503, "TEMPORARILY_UNAVAILABLE")
      const b = await call("route.POST+2nd-arg-deps", route.POST, req(capBody(capZ)), deps())
      assertDenied(b, 503, "TEMPORARILY_UNAVAILABLE")
      let noArg: any = "FACTORY_ABSENT"
      if (factory) {
        for (const h of [factory(), factory(undefined)]) { assert.equal(typeof h.POST, "function"); assertDenied(await call("factory().POST", h.POST, req(capBody(capZ))), 503, "TEMPORARILY_UNAVAILABLE") }
        noArg = "503_FAIL_CLOSED"
      }
      const z = await capRow(hZ); assert.equal(Number(z.use_count), 0); assert.equal(z.used, false)
      return { native: [a.status, b.status], noArgFactory: noArg, capZUseCount: Number(z.use_count) }
    })

    await step("H2", "POSITIVE: injected factory POST capZ -> 200 exact fixture ZIP bytes, attachment/type/length/bodyhash, private headers, one exact read, real SQL, deps snapshot", async () => {
      need("S4")
      const d: any = deps()
      const h = construct(d)
      let inputFrozen = false
      try { d.readBytes = trapReader; d.store = undefined } catch { inputFrozen = true }
      const s0 = sql.seen.length
      const r = await call("injected.POST capZ", h.POST, req(capBody(capZ)))
      const z = await capRow(hZ)
      obs.push({ capZUseCount: Number(z.use_count), capZUsed: z.used })
      assert.equal(r.status, 200, `status ${r.status} expected 200 (code=${r.code})`)
      assertPrivate(r.res)
      assert.equal(r.res.headers.get("content-type"), NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE)
      assert.equal(r.res.headers.get("content-disposition"), `attachment; filename="${NEUTRAL_CUSTOMER_ZIP_FILENAME}"`)
      assert.equal(r.res.headers.get("content-length"), String(ZIP.length))
      assert.ok(r.bytes && r.bytes.equals(ZIP)); assert.equal(createHash("sha256").update(r.bytes!).digest("hex"), ZIP_SHA)
      const zip = assertFixtureZip(r.bytes!)
      assert.equal(r.reads, 1); assert.deepEqual(reads.slice(-1), [ZIP_LOCATOR]); assert.equal(r.trap, 0)
      assert.equal(r.storeTx, 2, "authorize + reassert through the real instrumented client")
      assert.equal(Number(z.use_count), 1); assert.equal(z.used, true); assert.equal(z.revoked, false)
      return { status: r.status, bodySha256: ZIP_SHA, bytes: r.bytes!.length, zip, reads: r.reads, realTx: assertRealTx(s0), inputFrozen, postConstructionMutationIgnored: r.trap === 0 }
    })

    await step("H3", "reused capability: second POST capZ -> 410 EXHAUSTED, zero reads, persisted use_count stays 1", async () => {
      need("S4")
      const h = construct(deps())
      const r = await call("injected.POST capZ reuse", h.POST, req(capBody(capZ)))
      assertDenied(r, 410, "EXHAUSTED", { storeTx: true })
      assert.deepEqual(r.refused, ["CAPABILITY_EXHAUSTED"])
      const z = await capRow(hZ); assert.equal(Number(z.use_count), 1)
      return { status: r.status, refused: r.refused, capZUseCount: Number(z.use_count) }
    })

    await step("H4", "request validation (query/content-type/malformed/strict body incl. body-borne deps/length/oversize/unknown capability) + GET 405; zero reads", async () => {
      need("S4")
      const h = construct(deps())
      const cases: Array<[string, any, number, string]> = [
        ["query", req(capBody(capD), { query: "?capability=x" }), 400, "QUERY_NOT_ALLOWED"],
        ["text/plain", req(capBody(capD), { contentType: "text/plain" }), 400, "INVALID_CONTENT_TYPE"],
        ["no content-type", req(capBody(capD), { contentType: null }), 400, "INVALID_CONTENT_TYPE"],
        ["malformed json", req("{\"capability\":"), 400, "INVALID_REQUEST"],
        ["body deps", req(JSON.stringify({ capability: capD, store: {}, readBytes: "x", env: { OT_T2_PACKET_DOWNLOAD_ENABLED: "true" } })), 400, "INVALID_REQUEST"],
        ["short capability", req(capBody(capD.slice(0, 42))), 400, "INVALID_REQUEST"],
        ["bad alphabet", req(capBody(capD.slice(0, 42) + "=")), 400, "INVALID_REQUEST"],
        ["oversize", req(JSON.stringify({ capability: "A".repeat(2048) })), 413, "REQUEST_TOO_LARGE"],
      ]
      for (const [label, rq, st, code] of cases) assertDenied(await call(label, h.POST, rq), st, code)
      const u = await call("unknown capability", h.POST, req(capBody(capUnknown)))
      assertDenied(u, 404, "NOT_AVAILABLE", { storeTx: true }); assert.deepEqual(u.refused, ["CAPABILITY_NOT_FOUND"])
      for (const [label, fn] of [["route.GET", route.GET], ["injected.GET", h.GET]] as const) {
        assert.equal(typeof fn, "function", `${label} missing`)
        assertDenied(await call(label, fn, req(null, { method: "GET", query: `?capability=${capD}`, contentType: null }), deps()), 405, "METHOD_NOT_ALLOWED")
      }
      const dRow = await capRow(hD); assert.equal(Number(dRow.use_count), 0)
      return { cases: cases.length + 3, capDUseCount: Number(dRow.use_count) }
    })

    await step("H5", "missing QA: owned QA customer hash temporarily diverged -> 404 NOT_AVAILABLE (CAPABILITY_BINDING_MISMATCH), zero reads; restored + full-row readback", async () => {
      need("S4")
      const h = construct(deps())
      let r: any
      try {
        assert.equal((await admin.query(`update ot_neutral_qa_review set customer_artifact_sha256=$2 where id=$1 and fulfillment_id=$3`, [FX.qa, MISSING_QA_SHA, FX.ful])).rowCount, 1)
        r = await call("injected.POST capD missingQA", h.POST, req(capBody(capD)))
      } finally {
        await admin.query(`update ot_neutral_qa_review set customer_artifact_sha256=$2 where id=$1 and fulfillment_id=$3`, [FX.qa, ZIP_SHA, FX.ful])
        assert.deepEqual(await rowJson("ot_neutral_qa_review", FX.qa), fixedRows.qa, "RESTORE_MISMATCH ot_neutral_qa_review")
      }
      assertDenied(r, 404, "NOT_AVAILABLE", { storeTx: true }); assert.deepEqual(r.refused, ["CAPABILITY_BINDING_MISMATCH"])
      assert.equal(Number((await capRow(hD)).use_count), 0)
      return { status: r.status, refused: r.refused, restored: true }
    })

    const orderControl = async (key: string, label: string, column: string, value: string, accept: string[]) => {
      need("S4")
      // Only the known baseline trigger (prisma/production-baseline/02_baseline.sql:96-106) is admitted:
      // it rewrites NEW.status only when OLD.status='SETTLEMENT_HOLD' or NEW.status='PAID' with a recorded
      // settlement reversal. Verified: exact source fragments, fixture not on hold, no reversal for its
      // payment intent => PIN/REFUNDED changes and their PAID restoration pass through unaltered.
      // Any other/unknown trigger still refuses the control.
      if (orderTriggers.length && orderTriggers.join() !== "ot_preserve_settlement_hold")
        return { NOT_RUN: true, reason: "USER_TRIGGERS_ON_ot_order (control mutation not attempted)", triggers: orderTriggers }
      if (orderTriggers.length) {
        const src = (await admin.query(`select p.prosrc from pg_trigger t join pg_proc p on p.oid=t.tgfoid
          where t.tgrelid='ot_order'::regclass and t.tgname='ot_preserve_settlement_hold' and not t.tgisinternal`)).rows
        assert.equal(src.length, 1)
        const body = String(src[0].prosrc).replace(/\s+/g, " ")
        for (const frag of ["IF OLD.status = 'SETTLEMENT_HOLD' AND NEW.status NOT IN ('CANCELLED','REFUNDED') THEN NEW.status := 'SETTLEMENT_HOLD';",
          "ELSIF NEW.status = 'PAID' AND EXISTS ( SELECT 1 FROM ot_payment_binding b JOIN ot_settlement_reversal r USING(payment_intent) WHERE b.order_id=NEW.id ) THEN NEW.status := 'SETTLEMENT_HOLD'; END IF; RETURN NEW;"])
          assert.ok(body.includes(frag), "TRIGGER_SOURCE_UNRECOGNIZED (control refused)")
        assert.equal(fixedRows.order.status, "PAID")
        const rev = (await admin.query(`select count(*)::int n from ot_payment_binding b join ot_settlement_reversal r using(payment_intent) where b.order_id=$1`, [FX.order])).rows[0].n
        assert.equal(rev, 0, "SETTLEMENT_REVERSAL_PRESENT (control refused)")
      }
      const h = construct(deps())
      const original = fixedRows.order[column]
      let r: any
      try {
        assert.equal((await admin.query(`update ot_order set "${column}"=$2 where id=$1`, [FX.order, value])).rowCount, 1)
        r = await call(label, h.POST, req(capBody(capD)))
      } finally {
        await admin.query(`update ot_order set "${column}"=$2 where id=$1`, [FX.order, original])
        assert.deepEqual(await rowJson("ot_order", FX.order), fixedRows.order, `RESTORE_MISMATCH ot_order ${key}`)
      }
      assertDenied(r, 404, "NOT_AVAILABLE", { storeTx: true })
      assert.equal(r.refused.length, 1); assert.ok(accept.includes(r.refused[0]), `refused ${r.refused}`)
      assert.equal(Number((await capRow(hD)).use_count), 0)
      return { status: r.status, refused: r.refused, restored: true }
    }
    await step("H6", "invalid PIN: owned order propertyPin temporarily drifted -> 404, zero reads; restored + readback", () =>
      orderControl("H6", "injected.POST capD invalidPIN", "propertyPin", "99999999999999", ["PROPERTY_BINDING_UNVERIFIED", "ORDER_NOT_FOUND"]))
    await step("H7", "unauthorized native state: owned order status temporarily non-PAID -> 404, zero reads; restored + readback", async () => {
      need("S4")
      const t = (await admin.query(`select t.typtype::text tt, coalesce(array_agg(e.enumlabel::text order by e.enumsortorder) filter (where e.enumlabel is not null),'{}') labels
        from pg_attribute a join pg_type t on t.oid=a.atttypid left join pg_enum e on e.enumtypid=t.oid
        where a.attrelid='ot_order'::regclass and a.attname='status' group by t.typtype`)).rows[0]
      const label = t.tt === "e" ? ["REFUNDED", "DISPUTED", "CANCELLED", "FAILED", "PENDING"].find((x) => t.labels.includes(x)) : "REFUNDED"
      if (!label) return { NOT_RUN: true, reason: "NO_NON_PAID_STATUS_LABEL", labels: t.labels }
      return { statusUsed: label, ...(await orderControl("H7", "injected.POST capD unpaid", "status", label, ["ORDER_NOT_FOUND", "ORDER_NOT_ELIGIBLE"])) }
    })

    await step("H8", "production rejects injected factory (construct-in-production and later NODE_ENV drift): fail closed, injected store/reader never run", async () => {
      need("S4")
      let constructThrew: string | null = null, prodResult: any = null;
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production"
      try {
        let h: any = null
        try { h = construct(deps()) } catch (e: any) { constructThrew = redact(String(e?.message ?? e)) }
        if (!constructThrew) { const r = await call("prod-constructed.POST capD", h.POST, req(capBody(capD))); assertFailClosed(r); prodResult = r.status }
      } finally { (process.env as { NODE_ENV?: string }).NODE_ENV = "development" }
      const drift = construct(deps())
      let driftStatus: number;
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production"
      try { const r = await call("dev-constructed,prod-drift.POST capD", drift.POST, req(capBody(capD))); assertFailClosed(r); driftStatus = r.status }
      finally { (process.env as { NODE_ENV?: string }).NODE_ENV = "development" }
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production"
      try { assertDenied(await call("route.POST in production", route.POST, req(capBody(capD))), 503, "TEMPORARILY_UNAVAILABLE") }
      finally { (process.env as { NODE_ENV?: string }).NODE_ENV = "development" }
      assert.equal(Number((await capRow(hD)).use_count), 0)
      return { constructThrew, prodResult, driftStatus: driftStatus!, capDUseCount: 0 }
    })

    await step("H9", "flag off: route POST(+deps) / injected POST / env-override attempt -> 404 NOT_AVAILABLE, zero reads, zero store SQL; GET 405", async () => {
      need("S4")
      const h = construct(deps())
      delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
      const out: any = {}
      try {
        assertDenied(await call("flagoff route.POST", route.POST, req(capBody(capD))), 404, "NOT_AVAILABLE")
        assertDenied(await call("flagoff route.POST+deps", route.POST, req(capBody(capD)), deps()), 404, "NOT_AVAILABLE")
        assertDenied(await call("flagoff injected.POST", h.POST, req(capBody(capD))), 404, "NOT_AVAILABLE")
        try {
          const e = construct({ ...deps(), env: { OT_T2_PACKET_DOWNLOAD_ENABLED: "true", NODE_ENV: "development" } })
          assertDenied(await call("flagoff env-override.POST", e.POST, req(capBody(capD))), 404, "NOT_AVAILABLE"); out.envOverride = "IGNORED_404"
        } catch (err: any) { if (err?.code === "ERR_ASSERTION") throw err; out.envOverride = `REJECTED ${redact(String(err?.message ?? err))}` }
        assertDenied(await call("flagoff route.GET", route.GET, req(null, { method: "GET", contentType: null })), 405, "METHOD_NOT_ALLOWED")
      } finally { process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true" }
      assert.equal(Number((await capRow(hD)).use_count), 0)
      return out
    })

    await step("F1", "finite integrity: no new orders/bindings/fulfillments/artifacts/reservations/QA/attempts; capabilities +2 exactly; owned rows equal pinned readback", async () => {
      need("S2", "S3")
      const after = await counts()
      for (const t of COUNT_TABLES) if (t !== "ot_packet_download_capability") assert.equal(after[t], countsBefore[t], `count drift ${t}`)
      assert.equal(after.ot_packet_download_capability, countsBefore.ot_packet_download_capability + 2)
      assert.deepEqual(await rowJson("ot_order", FX.order), fixedRows.order)
      assert.deepEqual(await rowJson("ot_neutral_qa_review", FX.qa), fixedRows.qa)
      assert.deepEqual(await rowJson("ot_fulfillment_artifact", FX.art), fixedRows.art)
      const c = await cohort(); assert.equal(c.find((x) => x.s === "PROMOTED")?.n, 8); assert.equal(c.find((x) => x.s === "RESERVED")?.n, 1)
      return { countsAfter: after, issueCalls: issued, issueBudget: ISSUE_BUDGET, fixtureReads: reads.length, trapCalls,
        storeSql: { tx: sql.tx, query: sql.query, exec: sql.exec }, legacyT2Pdf: "NOT_RUN: no existing T2_APPEAL_EVIDENCE fulfillment fixture; reaching it needs new fixture authority plus generic-store (DATABASE_URL) role, not authorized" }
    })
  } finally {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development"
    process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
    await db.disconnectNeutralDeliveryPrisma().catch(() => {})
    await admin.end().catch(() => {})
  }
  console.log(JSON.stringify({ summary: { mode: MODE, pass, fail, notRun, expected: EXPECTED } }))
  process.exit(fail === 0 && pass + notRun.length === EXPECTED ? 0 : 1)
}
main().catch((e) => { console.log(JSON.stringify({ fatal: redact(String(e?.message ?? e)) })); process.exit(1) })

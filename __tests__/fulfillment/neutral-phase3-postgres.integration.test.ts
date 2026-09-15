/** @jest-environment node */
import { Client } from "pg"

jest.mock("server-only", () => ({}), { virtual: true })
const mockReadNeutralBundle = jest.fn(async (..._args: unknown[]) => ({ pdf: Buffer.from("%PDF-1.4\n%%EOF\n"), csv: Buffer.from("field,value\nsubject,test\n") }))
jest.mock("@/lib/fulfillment-runtime/neutral-report-storage", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/neutral-report-storage")
  return { ...actual, readNeutralBundle: (...args: unknown[]) => mockReadNeutralBundle(...args) }
})
jest.mock("@/lib/fulfillment-runtime/neutral-customer-zip-storage", () => ({
  writeNeutralCustomerZip: jest.fn(async (bytes: Buffer) => { const {neutralCustomerZipSha256,neutralCustomerZipLocator}=jest.requireActual("@/lib/fulfillment/neutral-customer-zip"); const sha256=neutralCustomerZipSha256(bytes); return {sha256,locator:neutralCustomerZipLocator(sha256),byteSize:bytes.length,mediaType:"application/zip"} }),
  readNeutralCustomerZip: jest.fn(async () => { throw new Error("not expected") }),
}))

const directUrl = process.env.OT_NEUTRAL_TEST_DIRECT_URL
const runtimeUrl = process.env.OT_NEUTRAL_TEST_RUNTIME_URL
const appUrl = process.env.OT_NEUTRAL_TEST_APP_URL
const native = directUrl && runtimeUrl && appUrl ? describe : describe.skip
const h = (c: string) => c.repeat(64)

native("neutral report Phase 3 native PostgreSQL acceptance", () => {
  const owner = new Client({ connectionString: directUrl })
  const runtime = new Client({ connectionString: runtimeUrl })
  const ids = Array.from({ length: 30 }, (_, i) => `native-phase3-${i}`)

  beforeAll(async () => {
    await owner.connect(); await runtime.connect()
    const appProbe=new Client({connectionString:appUrl});await appProbe.connect()
    try { const appRole=(await appProbe.query(`select current_user as role`)).rows[0]?.role; if(!appRole)throw new Error("missing app role"); const grant=(await owner.query(`select format('GRANT ot_neutral_app_reader TO %I',$1::text) sql`,[appRole])).rows[0]?.sql; await owner.query(grant) } finally { await appProbe.end() }
    process.env.DATABASE_URL = appUrl
    process.env.OT_NEUTRAL_DATABASE_URL = runtimeUrl
    process.env.OT_NEUTRAL_QA_ENABLED = "true"
    process.env.OT_NEUTRAL_CUSTOMER_ZIP_PROMOTION_ENABLED = "true"
    process.env.OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED = "true"
    process.env.OT_NEUTRAL_REFUND_QUEUE_ENABLED = "true"
  })
  afterAll(async () => {
    const { disconnectNeutralPrisma } = await import("@/lib/fulfillment-runtime/neutral-db")
    await disconnectNeutralPrisma()
    await owner.query(`update ot_neutral_report_reservation set status='ABANDONED',updated_at=clock_timestamp() where order_id = any($1)`, [ids])
    await Promise.all([runtime.end(), owner.end()])
  })

  test("restricts Phase 3 tables and persists QA/refund/zip/corruption states without external writes", async () => {
    for (const table of ["ot_neutral_qa_review", "ot_neutral_customer_zip_attempt"]) {
      const grants = await runtime.query(`select has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE') allowed, has_table_privilege(current_user,$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive`, [table])
      expect(grants.rows[0]).toEqual({ allowed: true, excessive: false })
      const rls = await runtime.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass`, [table])
      expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      await expect(runtime.query(`delete from ${table} where false`)).rejects.toThrow()
    }

    // This suite can run after the Phase 2 capacity test in the same disposable
    // database. Retire only that synthetic cohort before exercising Phase 3.
    await owner.query(`update ot_neutral_report_reservation set status='ABANDONED',updated_at=clock_timestamp() where order_id like 'native-neutral-%'`)

    await seedOrderAndReservation(owner, ids[0], "PROMOTED", 1)
    const { openNeutralQaReview, decideNeutralQaReview } = await import("@/lib/fulfillment-runtime/neutral-qa-store")
    expect(await openNeutralQaReview({ orderId: ids[0], reviewerKey: "native-reviewer" })).toMatchObject({ ok: true })
    await owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values('evt-native-race','charge.dispute.created',$1)`, [`pi_${ids[0]}`])
    expect(await decideNeutralQaReview({ orderId: ids[0], reviewerKey: "native-reviewer", decision: "approve", minutesSpent: 1, reasonCode: "QA_PASSED" })).toEqual({ ok: false, blocker: "PAYMENT_NOT_AUTHORITATIVE" })

    // The first opened review plus twenty-four more opened/reviewed orders fill
    // the weekly capacity. Approval status is irrelevant to the opening cap.
    for (let i = 1; i <= 24; i++) {
      await seedOrderAndReservation(owner, ids[i], "ABANDONED", 1)
      await owner.query(`insert into ot_neutral_qa_review(id,reservation_id,order_id,status,reviewer_key,reviewer_week_start,started_at,decided_at,minutes_spent,reason_code,policy_version,artifact_sha256,evidence_digest_sha256,payment_binding_sha256,property_binding_fingerprint,updated_at) values($1,$2,$3,'APPROVED','native-reviewer',(clock_timestamp() at time zone 'America/Chicago')::date-(extract(isodow from clock_timestamp() at time zone 'America/Chicago')::int-1),clock_timestamp(),clock_timestamp(),1,'QA_PASSED','ot-neutral-records-report/2026-09-15',$4,$5,$6,$7,clock_timestamp())`, [`qa-${ids[i]}`, `res-${ids[i]}`, ids[i], h("a"), h("e"), h("b"), h("f")])
    }
    await seedOrderAndReservation(owner, ids[25], "PROMOTED", 2)
    expect(await openNeutralQaReview({ orderId: ids[25], reviewerKey: "native-reviewer" })).toEqual({ ok: false, blocker: "WEEKLY_REVIEW_LIMIT" })

    // The trusted database clock, not caller minutes, enforces the hard stop.
    await seedOrderAndReservation(owner, ids[26], "PROMOTED", 3)
    expect(await openNeutralQaReview({ orderId: ids[26], reviewerKey: "hard-stop-reviewer" })).toMatchObject({ok:true})
    await owner.query(`update ot_neutral_qa_review set started_at=clock_timestamp()-interval '21 minutes' where order_id=$1`, [ids[26]])
    expect(await decideNeutralQaReview({ orderId: ids[26], reviewerKey: "hard-stop-reviewer", decision: "unavailable", minutesSpent: 1, reasonCode: "REPORT_INCOMPLETE" })).toEqual({ ok: true, status: "REFUND_REQUIRED", refundInitiated: false, customerArtifactPending: false })
    const unchanged = await owner.query(`select status,"settledAmountCents" from ot_order where id=$1`, [ids[26]])
    expect(unchanged.rows[0]).toEqual({ status: "PAID", settledAmountCents: 6900 })
    const {listNeutralRefundWork,claimNeutralRefund,recordNeutralRefundReceipt,verifyNeutralRefundReceipt}=await import("@/lib/fulfillment-runtime/neutral-refund-store")
    const work=await listNeutralRefundWork();expect(work.ok).toBe(true)
    const refundId=work.ok?work.items.find(item=>item.orderId===ids[26])?.id:undefined
    expect(refundId).toBeTruthy()
    expect(await recordNeutralRefundReceipt({id:refundId!,actor:"admin:native",providerReceiptId:"bad"})).toEqual({ok:false,blocker:"INVALID_INPUT"})
    expect(await claimNeutralRefund({id:refundId!,actor:"admin:native"})).toMatchObject({ok:true,status:"REFUND_CLAIMED",refundInitiated:false,attemptKey:expect.any(String)})
    expect(await recordNeutralRefundReceipt({id:refundId!,actor:"admin:native",providerReceiptId:"re_nativeReceipt123"})).toMatchObject({ok:true,status:"RECEIPT_RECORDED_PENDING_VERIFICATION",refundInitiated:false})
    expect(await verifyNeutralRefundReceipt({id:refundId!,actor:"admin:native",retrieve:async id=>({id,payment_intent:`pi_${ids[26]}`,amount:6900,currency:"usd",status:"succeeded"})})).toMatchObject({ok:true,status:"REFUND_CONFIRMED",refundInitiated:false})
    expect((await owner.query(`select status,provider_receipt_id from ot_neutral_refund_work where id=$1`,[refundId])).rows[0]).toEqual({status:"REFUND_CONFIRMED",provider_receipt_id:"re_nativeReceipt123"})

    // Exercise the real restricted-runtime promotion and then the global app's
    // read-only authority projection. No provider or Stripe adapter is present.
    await seedOrderAndReservation(owner, ids[27], "PROMOTED", 4)
    expect(await openNeutralQaReview({orderId:ids[27],reviewerKey:"promotion-reviewer"})).toMatchObject({ok:true})
    expect(await decideNeutralQaReview({orderId:ids[27],reviewerKey:"promotion-reviewer",decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"})).toMatchObject({ok:true,status:"APPROVED"})
    const { promoteApprovedNeutralCustomerZip } = await import("@/lib/fulfillment-runtime/neutral-customer-promotion")
    expect(await promoteApprovedNeutralCustomerZip(ids[27])).toMatchObject({ok:true,created:true})
    const app = new Client({connectionString:appUrl}); await app.connect()
    try {
      const authority=await app.query(`select r.bundle_sha256,r.customer_zip_sha256,q.artifact_sha256,q.customer_artifact_sha256,q.fulfillment_id from ot_neutral_report_reservation r join ot_neutral_qa_review q on q.reservation_id=r.id where r.order_id=$1`,[ids[27]])
      expect(authority.rows[0]).toMatchObject({bundle_sha256:h("a"),artifact_sha256:h("a")})
      expect(authority.rows[0].customer_zip_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(authority.rows[0].customer_artifact_sha256).toBe(authority.rows[0].customer_zip_sha256)
      expect(authority.rows[0].fulfillment_id).toBeTruthy()
    } finally { await app.end() }

    // A reversal that lands before the final authority re-read prevents a
    // second promoted order from acquiring a customer artifact.
    await seedOrderAndReservation(owner, ids[28], "PROMOTED", 5)
    expect(await openNeutralQaReview({orderId:ids[28],reviewerKey:"reversal-reviewer"})).toMatchObject({ok:true})
    expect(await decideNeutralQaReview({orderId:ids[28],reviewerKey:"reversal-reviewer",decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"})).toMatchObject({ok:true,status:"APPROVED"})
    await owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values('evt-native-promotion-race','refund.updated',$1)`,[`pi_${ids[28]}`])
    expect(await promoteApprovedNeutralCustomerZip(ids[28])).toEqual({ok:false,blocker:"AUTHORITY_NOT_CURRENT"})

    // True concurrent settlement reversal versus QA approval always converges
    // to HELD inside PostgreSQL; no customer artifact can be promoted.
    await seedOrderAndReservation(owner, ids[29], "PROMOTED", 6)
    expect(await openNeutralQaReview({orderId:ids[29],reviewerKey:"race-reviewer"})).toMatchObject({ok:true})
    const raceFulfillment=`ful-${ids[29]}`,raceArtifact=`art-${ids[29]}`,raceCapability=`cap-${ids[29]}`
    await owner.query(`insert into ot_fulfillment(id,order_id,kind,status,status_revision,attempt_count,created_at,updated_at) values($1,$2,'NEUTRAL_RECORDS_REPORT','ARTIFACT_READY',0,0,clock_timestamp(),clock_timestamp())`,[raceFulfillment,ids[29]])
    await owner.query(`insert into ot_fulfillment_artifact(id,fulfillment_id,version,artifact_sha256,byte_size,storage_locator,generator_version,generated_at,source_order_id,property_binding_fingerprint,created_at) values($1,$2,1,$3,123,$4,'neutral-native',clock_timestamp(),$5,$6,clock_timestamp())`,[raceArtifact,raceFulfillment,h("a"),`ot-neutral-customer/sha256/${h("a")}.zip`,ids[29],h("f")])
    await owner.query(`insert into ot_packet_download_capability(id,capability_hash,fulfillment_id,artifact_id,artifact_version,artifact_sha256,source_order_id,property_binding_fingerprint,issued_at,expires_at,max_uses,use_count,created_at) values($1,$2,$3,$4,1,$5,$6,$7,clock_timestamp(),clock_timestamp()+interval '1 hour',1,0,clock_timestamp())`,[raceCapability,h("9"),raceFulfillment,raceArtifact,h("a"),ids[29],h("f")])
    await Promise.allSettled([
      decideNeutralQaReview({orderId:ids[29],reviewerKey:"race-reviewer",decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"}),
      owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values('evt-native-true-concurrent','refund.updated',$1)`,[`pi_${ids[29]}`]),
    ])
    expect((await owner.query(`select status,reason_code from ot_neutral_qa_review where order_id=$1`,[ids[29]])).rows[0]).toEqual({status:"HELD",reason_code:"PAYMENT_REVERSED"})
    const revoked=(await owner.query(`select revoked_at,revoked_reason_code from ot_packet_download_capability where id=$1`,[raceCapability])).rows[0]
    expect(revoked.revoked_at).toBeInstanceOf(Date);expect(revoked.revoked_reason_code).toBe("REFUNDED")
    const {decidePacketDownload}=await import("@/lib/fulfillment/packet-download")
    expect(decidePacketDownload({flagEnabled:true,trustedNow:new Date().toISOString(),capabilityHash:h("9"),capability:{id:raceCapability,capabilityHash:h("9"),fulfillmentId:raceFulfillment,artifactId:raceArtifact,artifactVersion:1,artifactSha256:h("a"),sourceOrderId:ids[29],propertyBindingFingerprint:h("f"),expiresAt:new Date(Date.now()+3600000),maxUses:1,useCount:0,revokedAt:revoked.revoked_at},artifact:null,fulfillment:null,order:null})).toEqual({ok:false,blocker:"CAPABILITY_REVOKED"})
    expect(await promoteApprovedNeutralCustomerZip(ids[29])).toEqual({ok:false,blocker:"AUTHORITY_NOT_CURRENT"})

    const zip = h("c")
    await runtime.query(`insert into ot_neutral_customer_zip_attempt(id,reservation_id,zip_sha256,byte_size,storage_locator,status) values($1,$2,$3,123,$4,'INTENDED')`, ["zip-phase3", `res-${ids[26]}`, zip, `ot-neutral-customer/sha256/${zip}.zip`])
    for (const [from, to] of [["INTENDED", "WRITE_CONFIRMED"], ["WRITE_CONFIRMED", "PROMOTED"]]) {
      expect((await runtime.query(`update ot_neutral_customer_zip_attempt set status=$1,observed_at=clock_timestamp() where id='zip-phase3' and status=$2`, [to, from])).rowCount).toBe(1)
    }

    // A promoted immutable-object read failure must revoke usability durably.
    mockReadNeutralBundle.mockRejectedValueOnce(new Error("synthetic immutable object corruption"))
    const { prismaNeutralReportRepository } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
    expect(await prismaNeutralReportRepository.readConfirmed(`bundle-${ids[26]}`)).toBeNull()
    const compromised = await owner.query(`select status,"incident_code","reconciliation_code" from ot_neutral_report_reservation where order_id=$1`, [ids[26]])
    expect(compromised.rows[0]).toEqual({ status: "COMPROMISED", incident_code: "PROMOTED_STORAGE_CORRUPTION", reconciliation_code: "OPERATOR_INCIDENT_REQUIRED" })
    expect((await owner.query(`update ot_neutral_report_reservation set status='SUPERSEDED',superseded_by_sha256=$2,updated_at=clock_timestamp() where order_id=$1 and status='COMPROMISED'`, [ids[26], h("a")])).rowCount).toBe(1)
  })
})

async function seedOrderAndReservation(db: Client, orderId: string, status: "PROMOTED" | "ABANDONED", cohort: number) {
  const session = `cs_${orderId}`, intent = `pi_${orderId}`
  await db.query(`insert into ot_order(id,"stripeSessionId",tier,email,"propertyPin","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency","settledAmountCents","settledCurrency","amountPaid",status,"createdAt","updatedAt") values($1,$2,'T2','native@example.invalid','10000000000000','price_69','prod_neutral',6900,'usd',6900,'usd',69,'PAID',clock_timestamp(),clock_timestamp())`, [orderId, session])
  await db.query(`insert into ot_payment_binding(order_id,session_id,payment_intent) values($1,$2,$3)`, [orderId, session, intent])
  const promoted = status === "PROMOTED"
  await db.query(`insert into ot_neutral_report_reservation(id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,official_oldest_retrieved_at,official_max_age_seconds,deadline_retrieved_at,cohort_position,precheckout_lease_expires_at,reviewer_key,reviewer_week_start,status,bundle_sha256,manifest_sha256,pdf_sha256,csv_sha256,private_references,promoted_at,created_at,updated_at) values($1,$2,'ot-neutral-records-report/2026-09-15',$3,$4,'price_69','prod_neutral',$5,$6,$7,$8,$9,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 minutes',120,clock_timestamp()-interval '1 minute',$10,clock_timestamp()+interval '30 minutes','native-reviewer',(clock_timestamp() at time zone 'America/Chicago')::date-(extract(isodow from clock_timestamp() at time zone 'America/Chicago')::int-1),$11::"OTNeutralReservationStatus",$12,$13,$14,$15,$16::jsonb,case when $17 then clock_timestamp() else null end,clock_timestamp(),clock_timestamp())`, [`res-${orderId}`, orderId, h("f"), `reservation-${orderId}`, h("d"), h("e"), h("a"), h("c"), h("b"), cohort, status, promoted ? h("a") : null, promoted ? h("b") : null, promoted ? h("c") : null, promoted ? h("d") : null, promoted ? JSON.stringify({ locator: `ot-neutral-reports/sha256/${h("a")}.json`, receipt: { key: `bundle-${orderId}` } }) : null, promoted])
}

/** @jest-environment node */
import { Client } from "pg"
import { createHash } from "node:crypto"
import { NextRequest } from "next/server"
import { computePropertyBindingFingerprint } from "@/lib/fulfillment/artifact-digest"
import { assertPreviewAcceptanceRunId } from "@/lib/fulfillment/neutral-preview-acceptance"

jest.mock("server-only", () => ({}), { virtual: true })
const mockReadNeutralBundle = jest.fn(async (...args: unknown[]) => {
  const expectedSha256 = typeof args[1] === "string" ? args[1] : "unknown"
  return {
    pdf: Buffer.from(`%PDF-1.4\n% synthetic ${expectedSha256}\n%%EOF\n`),
    csv: Buffer.from(`field,value\nsubject,${expectedSha256}\n`),
  }
})
const mockNeutralCustomerZips = new Map<string, Buffer>()
jest.mock("@/lib/fulfillment-runtime/neutral-report-storage", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/neutral-report-storage")
  return { ...actual, readNeutralBundle: (...args: unknown[]) => mockReadNeutralBundle(...args) }
})
jest.mock("@/lib/fulfillment-runtime/neutral-customer-zip-storage", () => ({
  writeNeutralCustomerZip: jest.fn(async (bytes: Buffer) => { const {neutralCustomerZipSha256,neutralCustomerZipLocator}=jest.requireActual("@/lib/fulfillment/neutral-customer-zip"); const sha256=neutralCustomerZipSha256(bytes); const locator=neutralCustomerZipLocator(sha256); mockNeutralCustomerZips.set(locator,Buffer.from(bytes)); return {sha256,locator,byteSize:bytes.length,mediaType:"application/zip"} }),
  readNeutralCustomerZip: jest.fn(async (locator: string) => { const bytes=mockNeutralCustomerZips.get(locator); if(!bytes)throw new Error("synthetic object absent"); return Buffer.from(bytes) }),
}))

const directUrl = process.env.OT_NEUTRAL_TEST_DIRECT_URL
const runtimeUrl = process.env.OT_NEUTRAL_TEST_RUNTIME_URL
const appUrl = process.env.OT_NEUTRAL_TEST_APP_URL
const deliveryUrl=process.env.OT_NEUTRAL_TEST_DELIVERY_URL
const native = directUrl && runtimeUrl && appUrl&&deliveryUrl ? describe : describe.skip
const h = (c: string) => c.repeat(64)
function zipCentralDirectoryNames(bytes:Buffer):string[]{
  const eocd=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(eocd<0)throw new Error("missing EOCD")
  const count=bytes.readUInt16LE(eocd+10),offset=bytes.readUInt32LE(eocd+16),names:string[]=[];let cursor=offset
  for(let i=0;i<count;i++){if(bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error("invalid central directory");const nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32);names.push(bytes.subarray(cursor+46,cursor+46+nameLength).toString("utf8"));cursor+=46+nameLength+extraLength+commentLength}
  return names
}

native("neutral report Phase 3 native PostgreSQL acceptance", () => {
  const owner = new Client({ connectionString: directUrl })
  const runtime = new Client({ connectionString: runtimeUrl })
  const delivery=new Client({connectionString:deliveryUrl})
  const runId = process.env.OT_NEUTRAL_ACCEPTANCE_RUN_ID
    ? assertPreviewAcceptanceRunId(process.env.OT_NEUTRAL_ACCEPTANCE_RUN_ID)
    : `ot-accept-${"a".repeat(32)}-00000000-0000-4000-8000-000000000000`
  const ids = Array.from({ length: 31 }, (_, i) => `${runId}-phase3-${i}`)
  const reviewer=(name:string)=>`${name}-${runId}`

  beforeAll(async () => {
    await owner.connect(); await runtime.connect();await delivery.connect()
    process.env.DATABASE_URL = appUrl
    process.env.OT_NEUTRAL_DATABASE_URL = runtimeUrl
    process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL=deliveryUrl
    process.env.OT_NEUTRAL_QA_ENABLED = "true"
    process.env.OT_NEUTRAL_CUSTOMER_ZIP_PROMOTION_ENABLED = "true"
    process.env.OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED = "true"
    process.env.OT_NEUTRAL_REFUND_QUEUE_ENABLED = "true"
    process.env.OT_NEUTRAL_REFUND_VERIFICATION_ENABLED = "true"
    process.env.OT_NEUTRAL_DELIVERY_ENABLED = "true"
    process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
  })
  afterAll(async () => {
    const { disconnectNeutralPrisma } = await import("@/lib/fulfillment-runtime/neutral-db")
    const {disconnectNeutralDeliveryPrisma}=await import("@/lib/fulfillment-runtime/neutral-delivery-db")
    await Promise.all([disconnectNeutralPrisma(),disconnectNeutralDeliveryPrisma()])
    await owner.query(`update ot_neutral_report_reservation set status='ABANDONED',updated_at=clock_timestamp() where order_id = any($1)`, [ids])
    await Promise.all([runtime.end(),delivery.end(), owner.end()])
  })

  test("restricts Phase 3 tables and persists QA/refund/zip/corruption states without external writes", async () => {
    for (const table of ["ot_neutral_qa_review", "ot_neutral_customer_zip_attempt"]) {
      const grants = await runtime.query(`select has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE') allowed, has_table_privilege(current_user,$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive`, [table])
      expect(grants.rows[0]).toEqual({ allowed: true, excessive: false })
      const rls = await runtime.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass`, [table])
      expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      await expect(runtime.query(`delete from ${table} where false`)).rejects.toThrow()
    }

    await seedOrderAndReservation(owner, ids[0], "PROMOTED", 1)
    const { openNeutralQaReview, decideNeutralQaReview } = await import("@/lib/fulfillment-runtime/neutral-qa-store")
    expect(await openNeutralQaReview({ orderId: ids[0], reviewerKey: reviewer("native-reviewer") })).toMatchObject({ ok: true })
    await owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values($1,'charge.dispute.created',$2)`, [`evt-${runId}-race`, `pi_${ids[0]}`])
    expect(await decideNeutralQaReview({ orderId: ids[0], reviewerKey: reviewer("native-reviewer"), decision: "approve", minutesSpent: 1, reasonCode: "QA_PASSED" })).toEqual({ ok: false, blocker: "PAYMENT_NOT_AUTHORITATIVE" })

    // The first opened review plus twenty-four more opened/reviewed orders fill
    // the weekly capacity. Approval status is irrelevant to the opening cap.
    for (let i = 1; i <= 24; i++) {
      await seedOrderAndReservation(owner, ids[i], "ABANDONED", 1)
      await owner.query(`insert into ot_neutral_qa_review(id,reservation_id,order_id,status,reviewer_key,reviewer_week_start,started_at,decided_at,minutes_spent,reason_code,policy_version,artifact_sha256,evidence_digest_sha256,payment_binding_sha256,property_binding_fingerprint,updated_at) values($1,$2,$3,'APPROVED',$4,(clock_timestamp() at time zone 'America/Chicago')::date-(extract(isodow from clock_timestamp() at time zone 'America/Chicago')::int-1),clock_timestamp(),clock_timestamp(),1,'QA_PASSED','ot-neutral-records-report/2026-09-15',$5,$6,$7,$8,clock_timestamp())`, [`qa-${ids[i]}`, `res-${ids[i]}`, ids[i], reviewer("native-reviewer"), h("a"), h("e"), h("b"), h("f")])
    }
    await seedOrderAndReservation(owner, ids[25], "PROMOTED", 2)
    expect(await openNeutralQaReview({ orderId: ids[25], reviewerKey: reviewer("native-reviewer") })).toEqual({ ok: false, blocker: "WEEKLY_REVIEW_LIMIT" })

    // The trusted database clock, not caller minutes, enforces the hard stop.
    await seedOrderAndReservation(owner, ids[26], "PROMOTED", 3)
    expect(await openNeutralQaReview({ orderId: ids[26], reviewerKey: reviewer("hard-stop-reviewer") })).toMatchObject({ok:true})
    await owner.query(`update ot_neutral_qa_review set started_at=clock_timestamp()-interval '21 minutes' where order_id=$1`, [ids[26]])
    expect(await decideNeutralQaReview({ orderId: ids[26], reviewerKey: reviewer("hard-stop-reviewer"), decision: "unavailable", minutesSpent: 1, reasonCode: "REPORT_INCOMPLETE" })).toEqual({ ok: true, status: "REFUND_REQUIRED", refundInitiated: false, customerArtifactPending: false })
    const unchanged = await owner.query(`select status,"settledAmountCents" from ot_order where id=$1`, [ids[26]])
    expect(unchanged.rows[0]).toEqual({ status: "PAID", settledAmountCents: 6900 })
    const {listNeutralRefundWork,claimNeutralRefund,recordNeutralRefundReceipt,verifyNeutralRefundReceipt}=await import("@/lib/fulfillment-runtime/neutral-refund-store")
    const work=await listNeutralRefundWork();expect(work.ok).toBe(true)
    const refundId=work.ok?work.items.find(item=>item.orderId===ids[26])?.id:undefined
    expect(refundId).toBeTruthy()
    expect(await recordNeutralRefundReceipt({id:refundId!,actor:"admin:native",providerReceiptId:"bad"})).toEqual({ok:false,blocker:"INVALID_INPUT"})
    expect(await claimNeutralRefund({id:refundId!,actor:"admin:native"})).toMatchObject({ok:true,status:"REFUND_CLAIMED",refundInitiated:false,attemptKey:expect.any(String)})
    const providerReceiptId=`re_${runId.replace(/-/g,"")}`
    expect(await recordNeutralRefundReceipt({id:refundId!,actor:`admin:${runId}`,providerReceiptId})).toMatchObject({ok:true,status:"RECEIPT_RECORDED_PENDING_VERIFICATION",refundInitiated:false})
    expect(await verifyNeutralRefundReceipt({id:refundId!,actor:"admin:native",retrieve:async()=>{throw new Error("synthetic transient outage")}})).toMatchObject({ok:false,status:"RECEIPT_RECORDED_PENDING_VERIFICATION",retryable:true,refundInitiated:false})
    expect((await owner.query(`select status,provider_lookup_attempts,last_provider_lookup_result from ot_neutral_refund_work where id=$1`,[refundId])).rows[0]).toEqual({status:"RECEIPT_RECORDED_PENDING_VERIFICATION",provider_lookup_attempts:1,last_provider_lookup_result:"RETRYABLE_PROVIDER_FAILURE"})
    expect(await verifyNeutralRefundReceipt({id:refundId!,actor:"admin:native",retrieve:async id=>({id,payment_intent:`pi_${ids[26]}`,amount:6900,currency:"usd",status:"succeeded"})})).toMatchObject({ok:true,status:"REFUND_CONFIRMED",refundInitiated:false})
    expect((await owner.query(`select status,provider_receipt_id from ot_neutral_refund_work where id=$1`,[refundId])).rows[0]).toEqual({status:"REFUND_CONFIRMED",provider_receipt_id:providerReceiptId})

    // Exercise the real restricted-runtime promotion and then the global app's
    // read-only authority projection. No provider or Stripe adapter is present.
    await seedOrderAndReservation(owner, ids[27], "PROMOTED", 4)
    expect(await openNeutralQaReview({orderId:ids[27],reviewerKey:reviewer("promotion-reviewer")})).toMatchObject({ok:true})
    expect(await decideNeutralQaReview({orderId:ids[27],reviewerKey:reviewer("promotion-reviewer"),decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"})).toMatchObject({ok:true,status:"APPROVED"})
    const { promoteApprovedNeutralCustomerZip } = await import("@/lib/fulfillment-runtime/neutral-customer-promotion")
    expect(await promoteApprovedNeutralCustomerZip(ids[27])).toMatchObject({ok:true,created:true})
    const app = new Client({connectionString:appUrl}); await app.connect()
    let promotedAuthority: { customer_zip_sha256: string; fulfillment_id: string }
    try {
      const authority=await app.query(`select r.bundle_sha256,r.customer_zip_sha256,q.artifact_sha256,q.customer_artifact_sha256,q.fulfillment_id from ot_neutral_report_reservation r join ot_neutral_qa_review q on q.reservation_id=r.id where r.order_id=$1`,[ids[27]])
      expect(authority.rows[0].bundle_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(authority.rows[0].artifact_sha256).toBe(authority.rows[0].bundle_sha256)
      expect(authority.rows[0].customer_zip_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(authority.rows[0].customer_artifact_sha256).toBe(authority.rows[0].customer_zip_sha256)
      expect(authority.rows[0].fulfillment_id).toBeTruthy()
      promotedAuthority=authority.rows[0]
    } finally { await app.end() }

    // A trusted delivery attempt is the only issuance seam. Bind a capability
    // to the exact promoted artifact, then spend it through the production POST
    // route. Storage and messaging remain local in-memory fakes.
    await owner.query(`insert into ot_delivery_attempt(id,fulfillment_id,attempt_number,artifact_version,idempotency_key,provider,requested_at,created_at) values($1,$2,1,1,$3,'synthetic-local',clock_timestamp(),clock_timestamp())`,[`attempt-${ids[27]}`,promotedAuthority.fulfillment_id,`delivery-${ids[27]}`])
    const capabilityValue="A".repeat(43)
    const {issueT2PacketCapability}=await import("@/lib/fulfillment-runtime/t2-packet-issuance")
    const deliveryDatabaseUrl=process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL;delete process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL
    expect(await issueT2PacketCapability({fulfillmentId:promotedAuthority.fulfillment_id,attemptNumber:1,provider:"synthetic-local",maxUses:1},{randomValue:()=>"D".repeat(43)})).toEqual({ok:false,blocker:"FULFILLMENT_NOT_FOUND"})
    process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL=deliveryDatabaseUrl
    expect(await issueT2PacketCapability({fulfillmentId:promotedAuthority.fulfillment_id,attemptNumber:1,provider:"synthetic-local",maxUses:5},{randomValue:()=>"B".repeat(43)})).toEqual({ok:false,blocker:"INVALID_CAPABILITY"})
    const issued=await issueT2PacketCapability({fulfillmentId:promotedAuthority.fulfillment_id,attemptNumber:1,provider:"synthetic-local",maxUses:1},{randomValue:()=>capabilityValue})
    if(!issued.ok)throw new Error(`synthetic capability issuance blocked: ${issued.blocker}`)
    expect(issued).toMatchObject({ok:true,issuance:{value:capabilityValue,artifactSha256:promotedAuthority.customer_zip_sha256,maxUses:1}})
    const {POST}=await import("@/app/api/ot/packet/download/route")
    const response=await POST(new NextRequest("http://localhost/api/ot/packet/download",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({capability:capabilityValue})}))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="overtaxed-records-report.zip"')
    expect(response.headers.get("cache-control")).toContain("no-store")
    const downloaded=Buffer.from(await response.arrayBuffer())
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(promotedAuthority.customer_zip_sha256)
    expect(zipCentralDirectoryNames(downloaded)).toEqual(["report.pdf","report.csv"])
    expect((await owner.query(`select use_count,max_uses from ot_packet_download_capability where fulfillment_id=$1`,[promotedAuthority.fulfillment_id])).rows[0]).toEqual({use_count:1,max_uses:1})
    const exhausted=await POST(new NextRequest("http://localhost/api/ot/packet/download",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({capability:capabilityValue})}))
    expect(exhausted.status).toBe(410)
    expect(await exhausted.json()).toEqual({ok:false,code:"EXHAUSTED"})

    await expect(delivery.query(`select * from ot_order where false`)).rejects.toThrow()
    for(const table of ["ot_order","ot_payment_binding","ot_settlement_reversal"]){
      expect((await runtime.query(`select has_table_privilege(current_user,$1,'SELECT') allowed`,[table])).rows[0]).toEqual({allowed:false})
      await expect(runtime.query(`select * from ${table} where false`)).rejects.toThrow()
    }
    const legacyOrder=`${runId}-legacy-delivery-probe`,legacyFulfillment=`${runId}-legacy-fulfillment-probe`
    await owner.query(`insert into ot_order(id,"stripeSessionId",tier,email,"propertyPin","propertyAddress","amountPaid",status,"createdAt","updatedAt") values($1,$2,'T2','synthetic@example.invalid','10000000000001','101 Synthetic St',69,'PAID',clock_timestamp(),clock_timestamp())`,[legacyOrder,`cs_${legacyOrder}`])
    await owner.query(`insert into ot_fulfillment(id,order_id,kind,status,status_revision,attempt_count,created_at,updated_at) values($1,$2,'T2_APPEAL_EVIDENCE','ARTIFACT_READY',0,0,clock_timestamp(),clock_timestamp())`,[legacyFulfillment,legacyOrder])
    expect((await delivery.query(`select count(*)::int count from ot_neutral_delivery_order where id=$1`,[legacyOrder])).rows[0].count).toBe(0)
    expect((await runtime.query(`select count(*)::int count from ot_neutral_runtime_order where id=$1`,[legacyOrder])).rows[0].count).toBe(0)

    // The refund-required branch never acquires fulfillment, capability, or a
    // downloadable artifact.
    expect((await owner.query(`select count(*)::int count from ot_fulfillment where order_id=$1`,[ids[26]])).rows[0].count).toBe(0)
    expect(mockNeutralCustomerZips.size).toBe(1)

    await seedOrderAndReservation(owner,ids[30],"PROMOTED",7)
    expect(await openNeutralQaReview({orderId:ids[30],reviewerKey:reviewer("storage-reviewer")})).toMatchObject({ok:true})
    expect(await decideNeutralQaReview({orderId:ids[30],reviewerKey:reviewer("storage-reviewer"),decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"})).toMatchObject({ok:true,status:"APPROVED"})
    expect(await promoteApprovedNeutralCustomerZip(ids[30])).toMatchObject({ok:true,created:true})
    const storageRow=(await owner.query(`select q.fulfillment_id,r.customer_zip_locator from ot_neutral_qa_review q join ot_neutral_report_reservation r on r.id=q.reservation_id where q.order_id=$1`,[ids[30]])).rows[0]
    await owner.query(`insert into ot_delivery_attempt(id,fulfillment_id,attempt_number,artifact_version,idempotency_key,provider,requested_at,created_at) values($1,$2,1,1,$3,'synthetic-local',clock_timestamp(),clock_timestamp())`,[`attempt-${ids[30]}`,storageRow.fulfillment_id,`delivery-${ids[30]}`])
    await expect(owner.query(`insert into ot_packet_download_capability(id,capability_hash,fulfillment_id,artifact_id,artifact_version,artifact_sha256,source_order_id,property_binding_fingerprint,expires_at,max_uses) select $1,$2,a.fulfillment_id,a.id,a.version,a.artifact_sha256,a.source_order_id,a.property_binding_fingerprint,clock_timestamp()+interval '1 hour',5 from ot_fulfillment_artifact a where a.fulfillment_id=$3`,[`${runId}-bad-neutral-budget`,h("8"),storageRow.fulfillment_id])).rejects.toThrow()
    const brokenCode="C".repeat(43);const brokenIssued=await issueT2PacketCapability({fulfillmentId:storageRow.fulfillment_id,attemptNumber:1,provider:"synthetic-local",maxUses:1},{randomValue:()=>brokenCode});expect(brokenIssued.ok).toBe(true)
    mockNeutralCustomerZips.delete(storageRow.customer_zip_locator)
    const brokenRequest=()=>new NextRequest("http://localhost/api/ot/packet/download",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({capability:brokenCode})})
    delete process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL;const unavailable=await POST(brokenRequest());expect(unavailable.status).toBe(404);process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL=deliveryDatabaseUrl
    const broken=await POST(brokenRequest());expect(broken.status).toBe(409);expect(await broken.json()).toMatchObject({ok:false,code:"REISSUE_REQUIRED"})
    const revokedStorage=(await owner.query(`select use_count,revoked_reason_code from ot_packet_download_capability where fulfillment_id=$1`,[storageRow.fulfillment_id])).rows[0];expect(revokedStorage).toEqual({use_count:1,revoked_reason_code:"STORAGE_FAILURE"})
    const brokenAgain=await POST(brokenRequest());expect(brokenAgain.status).toBe(410);expect(await brokenAgain.json()).toEqual({ok:false,code:"REVOKED"})

    // A reversal that lands before the final authority re-read prevents a
    // second promoted order from acquiring a customer artifact.
    await seedOrderAndReservation(owner, ids[28], "PROMOTED", 5)
    expect(await openNeutralQaReview({orderId:ids[28],reviewerKey:reviewer("reversal-reviewer")})).toMatchObject({ok:true})
    expect(await decideNeutralQaReview({orderId:ids[28],reviewerKey:reviewer("reversal-reviewer"),decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"})).toMatchObject({ok:true,status:"APPROVED"})
    await owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values($1,'refund.updated',$2)`,[`evt-${runId}-promotion-race`,`pi_${ids[28]}`])
    expect(await promoteApprovedNeutralCustomerZip(ids[28])).toEqual({ok:false,blocker:"AUTHORITY_NOT_CURRENT"})

    // True concurrent settlement reversal versus QA approval always converges
    // to HELD inside PostgreSQL; no customer artifact can be promoted.
    await seedOrderAndReservation(owner, ids[29], "PROMOTED", 6)
    expect(await openNeutralQaReview({orderId:ids[29],reviewerKey:reviewer("race-reviewer")})).toMatchObject({ok:true})
    const raceFulfillment=`ful-${ids[29]}`,raceArtifact=`art-${ids[29]}`,raceCapability=`cap-${ids[29]}`
    await owner.query(`insert into ot_fulfillment(id,order_id,kind,status,status_revision,attempt_count,created_at,updated_at) values($1,$2,'NEUTRAL_RECORDS_REPORT','ARTIFACT_READY',0,0,clock_timestamp(),clock_timestamp())`,[raceFulfillment,ids[29]])
    await owner.query(`insert into ot_fulfillment_artifact(id,fulfillment_id,version,artifact_sha256,byte_size,storage_locator,generator_version,generated_at,source_order_id,property_binding_fingerprint,created_at) values($1,$2,1,$3,123,$4,'neutral-native',clock_timestamp(),$5,$6,clock_timestamp())`,[raceArtifact,raceFulfillment,h("a"),`ot-neutral-customer/sha256/${h("a")}.zip`,ids[29],h("f")])
    await owner.query(`insert into ot_packet_download_capability(id,capability_hash,fulfillment_id,artifact_id,artifact_version,artifact_sha256,source_order_id,property_binding_fingerprint,issued_at,expires_at,max_uses,use_count,created_at) values($1,$2,$3,$4,1,$5,$6,$7,clock_timestamp(),clock_timestamp()+interval '1 hour',1,0,clock_timestamp())`,[raceCapability,h("9"),raceFulfillment,raceArtifact,h("a"),ids[29],h("f")])
    await Promise.allSettled([
      decideNeutralQaReview({orderId:ids[29],reviewerKey:reviewer("race-reviewer"),decision:"approve",minutesSpent:1,reasonCode:"QA_PASSED"}),
      owner.query(`insert into ot_settlement_reversal(event_id,event_type,payment_intent) values($1,'refund.updated',$2)`,[`evt-${runId}-true-concurrent`,`pi_${ids[29]}`]),
    ])
    expect((await owner.query(`select status,reason_code from ot_neutral_qa_review where order_id=$1`,[ids[29]])).rows[0]).toEqual({status:"HELD",reason_code:"PAYMENT_REVERSED"})
    const revoked=(await owner.query(`select revoked_at,revoked_reason_code from ot_packet_download_capability where id=$1`,[raceCapability])).rows[0]
    expect(revoked.revoked_at).toBeInstanceOf(Date);expect(revoked.revoked_reason_code).toBe("REFUNDED")
    const {decidePacketDownload}=await import("@/lib/fulfillment/packet-download")
    expect(decidePacketDownload({flagEnabled:true,trustedNow:new Date().toISOString(),capabilityHash:h("9"),capability:{id:raceCapability,capabilityHash:h("9"),fulfillmentId:raceFulfillment,artifactId:raceArtifact,artifactVersion:1,artifactSha256:h("a"),sourceOrderId:ids[29],propertyBindingFingerprint:h("f"),expiresAt:new Date(Date.now()+3600000),maxUses:1,useCount:0,revokedAt:revoked.revoked_at},artifact:null,fulfillment:null,order:null})).toEqual({ok:false,blocker:"CAPABILITY_REVOKED"})
    expect(await promoteApprovedNeutralCustomerZip(ids[29])).toEqual({ok:false,blocker:"AUTHORITY_NOT_CURRENT"})

    const zip = h("c")
    const zipAttemptId=`${runId}-zip-phase3`
    await runtime.query(`insert into ot_neutral_customer_zip_attempt(id,reservation_id,zip_sha256,byte_size,storage_locator,status) values($1,$2,$3,123,$4,'INTENDED')`, [zipAttemptId, `res-${ids[26]}`, zip, `ot-neutral-customer/sha256/${zip}.zip`])
    for (const [from, to] of [["INTENDED", "WRITE_CONFIRMED"], ["WRITE_CONFIRMED", "PROMOTED"]]) {
      expect((await runtime.query(`update ot_neutral_customer_zip_attempt set status=$1,observed_at=clock_timestamp() where id=$2 and status=$3`, [to, zipAttemptId, from])).rowCount).toBe(1)
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
  const propertyPin="10000000000000",propertyAddress="100 Native Test Ave"
  const propertyFingerprint=computePropertyBindingFingerprint({orderId,propertyPin,propertyAddress})
  const bundleSha256=createHash("sha256").update(`synthetic-bundle:${orderId}`).digest("hex")
  await db.query(`insert into ot_order(id,"stripeSessionId",tier,email,"propertyPin","propertyAddress","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency","settledAmountCents","settledCurrency","amountPaid",status,"createdAt","updatedAt") values($1,$2,'T2','native@example.invalid',$3,$4,'price_69','prod_neutral',6900,'usd',6900,'usd',69,'PAID',clock_timestamp(),clock_timestamp())`, [orderId, session,propertyPin,propertyAddress])
  await db.query(`insert into ot_payment_binding(order_id,session_id,payment_intent) values($1,$2,$3)`, [orderId, session, intent])
  const promoted = status === "PROMOTED"
  await db.query(`insert into ot_neutral_report_reservation(id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,official_oldest_retrieved_at,official_max_age_seconds,deadline_retrieved_at,cohort_position,precheckout_lease_expires_at,reviewer_key,reviewer_week_start,status,bundle_sha256,manifest_sha256,pdf_sha256,csv_sha256,private_references,promoted_at,created_at,updated_at) values($1,$2,'ot-neutral-records-report/2026-09-15',$3,$4,'price_69','prod_neutral',$5,$6,$7,$8,$9,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 minutes',120,clock_timestamp()-interval '1 minute',$10,clock_timestamp()+interval '30 minutes','native-reviewer',(clock_timestamp() at time zone 'America/Chicago')::date-(extract(isodow from clock_timestamp() at time zone 'America/Chicago')::int-1),$11::"OTNeutralReservationStatus",$12,$13,$14,$15,$16::jsonb,case when $17 then clock_timestamp() else null end,clock_timestamp(),clock_timestamp())`, [`res-${orderId}`, orderId, propertyFingerprint, `reservation-${orderId}`, h("d"), h("e"), h("a"), h("c"), h("b"), cohort, status, promoted ? bundleSha256 : null, promoted ? h("b") : null, promoted ? h("c") : null, promoted ? h("d") : null, promoted ? JSON.stringify({ locator: `ot-neutral-reports/sha256/${bundleSha256}.json`, receipt: { key: `bundle-${orderId}` } }) : null, promoted])
}

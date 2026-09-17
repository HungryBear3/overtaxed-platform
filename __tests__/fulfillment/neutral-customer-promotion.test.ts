import {decideCurrentArtifact,decideNeutralCustomerPromotion,decideZipWriteAction,type PromotionSnapshot} from "@/lib/fulfillment/neutral-customer-promotion"
const good:PromotionSnapshot={orderStatus:"PAID",paymentIntent:"pi_1",reversalIntent:null,propertyPin:"123",reservationStatus:"PROMOTED",bundleSha256:"a".repeat(64),customerZipSha256:null,manifestSha256:"b".repeat(64),dataEvidenceSha256:"c".repeat(64),deadlineEvidenceSha256:"d".repeat(64),policyVersion:"neutral/v1",propertyFingerprint:"e".repeat(64),supersededBySha256:null,qaStatus:"APPROVED",qaArtifactSha256:"a".repeat(64),qaPolicyVersion:"neutral/v1",qaPropertyFingerprint:"e".repeat(64),qaEvidenceDigestSha256:"f".repeat(64),currentEvidenceDigestSha256:"f".repeat(64),qaPaymentBindingSha256:"1".repeat(64),currentPaymentBindingSha256:"1".repeat(64)}
describe("neutral customer promotion recheck",()=>{
 it("accepts an identical current authority",()=>expect(decideNeutralCustomerPromotion(good,{...good})).toEqual({ok:true}))
 it("keeps the reviewed bundle immutable after a customer ZIP is promoted",()=>{const promoted={...good,customerZipSha256:"9".repeat(64)};expect(decideNeutralCustomerPromotion(promoted,{...promoted})).toEqual({ok:true})})
 it.each([
  ["refund",{orderStatus:"REFUNDED"}], ["dispute",{reversalIntent:"pi_1"}], ["pin",{propertyPin:"999"}],
  ["policy",{policyVersion:"neutral/v2",qaPolicyVersion:"neutral/v2"}], ["data",{dataEvidenceSha256:"f".repeat(64)}],
  ["deadline",{deadlineEvidenceSha256:"f".repeat(64)}], ["bundle",{bundleSha256:"f".repeat(64),qaArtifactSha256:"f".repeat(64)}],
  ["manifest",{manifestSha256:"f".repeat(64)}], ["property binding",{propertyFingerprint:"f".repeat(64),qaPropertyFingerprint:"f".repeat(64)}],
  ["payment",{paymentIntent:"pi_2"}], ["QA revoked",{qaStatus:"HELD"}], ["QA unavailable",{qaStatus:null}],
  ["evidence digest",{currentEvidenceDigestSha256:"2".repeat(64)}], ["payment digest",{currentPaymentBindingSha256:"2".repeat(64)}],
  ["superseded",{supersededBySha256:"f".repeat(64)}], ["reservation held",{reservationStatus:"QUARANTINED"}],
 ] as Array<[string,Partial<PromotionSnapshot>]>)("rejects post-write %s",(_label,change)=>expect(decideNeutralCustomerPromotion(good,{...good,...change}).ok).toBe(false))
 it("rejects a stale initial authority before a write",()=>expect(decideNeutralCustomerPromotion({...good,qaStatus:"HELD"},good)).toEqual({ok:false,blocker:"AUTHORITY_NOT_CURRENT"}))
})
describe("promotion adapter idempotency",()=>{
 it("never blindly retries an unknown write",()=>expect(decideZipWriteAction("WRITE_UNKNOWN")).toBe("RECONCILE_READ"))
 it("skips confirmed/promoted writes",()=>{expect(decideZipWriteAction("WRITE_CONFIRMED")).toBe("SKIP_WRITE");expect(decideZipWriteAction("PROMOTED")).toBe("SKIP_WRITE")})
 it("skips a durably read-confirmed reconciled write",()=>expect(decideZipWriteAction("READ_CONFIRMED")).toBe("SKIP_WRITE"))
 it("allows only the first intended write",()=>expect(decideZipWriteAction("INTENDED")).toBe("WRITE_ONCE"))
 it.each(["QUARANTINED","nonsense"])("refuses non-promotable attempt state %s",state=>expect(decideZipWriteAction(state)).toBe("REFUSE"))
 it("is idempotent for the same current artifact",()=>expect(decideCurrentArtifact("a".repeat(64),"a".repeat(64))).toEqual({ok:true,create:false}))
 it("rejects a concurrent different artifact",()=>expect(decideCurrentArtifact("a".repeat(64),"b".repeat(64))).toEqual({ok:false,blocker:"ARTIFACT_CONFLICT"}))
 it("creates only when no artifact exists",()=>expect(decideCurrentArtifact(undefined,"a".repeat(64))).toEqual({ok:true,create:true}))
})

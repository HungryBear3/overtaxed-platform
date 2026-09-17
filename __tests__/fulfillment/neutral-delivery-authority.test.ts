import { decideNeutralDeliveryAuthority } from "@/lib/fulfillment/neutral-delivery-authority"

const hash="a".repeat(64), fp="b".repeat(64), policy="ot-neutral-records-report/2026-09-15"
const base={enabled:true,orderId:"ord_1",orderStatus:"PAID",paymentAuthoritative:true,fulfillmentId:"ful_1",fulfillmentKind:"NEUTRAL_RECORDS_REPORT",fulfillmentStatus:"ARTIFACT_READY",artifactSha256:hash,propertyBindingFingerprint:fp,policyVersion:policy,qaStatus:"APPROVED",qaOrderId:"ord_1",qaFulfillmentId:"ful_1",qaArtifactSha256:hash,qaPropertyBindingFingerprint:fp,qaPolicyVersion:policy,reservationStatus:"PROMOTED",supersededBySha256:null}

describe("neutral delivery authority",()=>{
 it("admits the exact approved binding",()=>expect(decideNeutralDeliveryAuthority(base)).toEqual({ok:true}))
 it.each([
  ["disabled",{enabled:false},"FLAG_DISABLED"],
  ["refunded",{orderStatus:"REFUNDED"},"ORDER_NOT_PAID"],
  ["disputed",{paymentAuthoritative:false},"PAYMENT_NOT_AUTHORITATIVE"],
  ["not approved",{qaStatus:"IN_REVIEW"},"QA_NOT_APPROVED"],
  ["superseded",{supersededBySha256:"c".repeat(64)},"ARTIFACT_SUPERSEDED"],
  ["artifact drift",{qaArtifactSha256:"d".repeat(64)},"QA_BINDING_DRIFT"],
  ["property drift",{qaPropertyBindingFingerprint:"e".repeat(64)},"QA_BINDING_DRIFT"],
  ["policy drift",{qaPolicyVersion:"other"},"QA_BINDING_DRIFT"],
  ["refund required",{fulfillmentStatus:"CANCELLED"},"FULFILLMENT_HELD"],
 ])("fails closed for %s",(_n,patch,blocker)=>expect(decideNeutralDeliveryAuthority({...base,...patch})).toEqual({ok:false,blocker}))
})

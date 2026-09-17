export type NeutralDeliveryAuthority = {
  enabled:boolean
  orderId:string
  orderStatus:string
  paymentAuthoritative:boolean
  fulfillmentId:string
  fulfillmentKind:string
  fulfillmentStatus:string
  artifactSha256:string
  propertyBindingFingerprint:string
  policyVersion:string
  qaStatus:string|null
  qaOrderId:string|null
  qaFulfillmentId:string|null
  qaArtifactSha256:string|null
  qaPropertyBindingFingerprint:string|null
  qaPolicyVersion:string|null
  reservationStatus:string|null
  supersededBySha256:string|null
}

export type NeutralDeliveryBlocker =
  | "FLAG_DISABLED" | "ORDER_NOT_PAID" | "PAYMENT_NOT_AUTHORITATIVE"
  | "FULFILLMENT_NOT_NEUTRAL" | "QA_NOT_APPROVED" | "QA_BINDING_DRIFT"
  | "ARTIFACT_SUPERSEDED" | "FULFILLMENT_HELD"

/** Shared fail-closed gate for send, capability issuance, download and callbacks. */
export function decideNeutralDeliveryAuthority(input:NeutralDeliveryAuthority):{ok:true}|{ok:false;blocker:NeutralDeliveryBlocker}{
  if(!input.enabled)return {ok:false,blocker:"FLAG_DISABLED"}
  if(input.orderStatus!=="PAID")return {ok:false,blocker:"ORDER_NOT_PAID"}
  if(!input.paymentAuthoritative)return {ok:false,blocker:"PAYMENT_NOT_AUTHORITATIVE"}
  if(input.fulfillmentKind!=="NEUTRAL_RECORDS_REPORT")return {ok:false,blocker:"FULFILLMENT_NOT_NEUTRAL"}
  if(input.qaStatus!=="APPROVED" || input.reservationStatus!=="PROMOTED")return {ok:false,blocker:"QA_NOT_APPROVED"}
  if(input.supersededBySha256!==null)return {ok:false,blocker:"ARTIFACT_SUPERSEDED"}
  if(input.qaOrderId!==input.orderId || input.qaFulfillmentId!==input.fulfillmentId || input.qaArtifactSha256!==input.artifactSha256 || input.qaPropertyBindingFingerprint!==input.propertyBindingFingerprint || input.qaPolicyVersion!==input.policyVersion)
    return {ok:false,blocker:"QA_BINDING_DRIFT"}
  if(!["ARTIFACT_READY","DELIVERY_PENDING","PROVIDER_ACCEPTED","DELAYED","DELIVERED"].includes(input.fulfillmentStatus))return {ok:false,blocker:"FULFILLMENT_HELD"}
  return {ok:true}
}

export type PromotionSnapshot={orderStatus:string;paymentIntent:string|null;reversalIntent:string|null;propertyPin:string|null;reservationStatus:string;bundleSha256:string|null;customerZipSha256:string|null;manifestSha256:string|null;dataEvidenceSha256:string;deadlineEvidenceSha256:string;policyVersion:string;propertyFingerprint:string;supersededBySha256:string|null;qaStatus:string|null;qaArtifactSha256:string|null;qaPolicyVersion:string|null;qaPropertyFingerprint:string|null;qaEvidenceDigestSha256:string|null;currentEvidenceDigestSha256:string;qaPaymentBindingSha256:string|null;currentPaymentBindingSha256:string}
export function decideNeutralCustomerPromotion(initial:PromotionSnapshot,current:PromotionSnapshot){
 const base=(r:PromotionSnapshot)=>r.orderStatus==="PAID"&&!!r.paymentIntent&&!r.reversalIntent&&!!r.propertyPin&&r.reservationStatus==="PROMOTED"&&!!r.bundleSha256&&!!r.manifestSha256&&!r.supersededBySha256&&r.qaStatus==="APPROVED"&&r.qaArtifactSha256===r.bundleSha256&&r.qaPolicyVersion===r.policyVersion&&r.qaPropertyFingerprint===r.propertyFingerprint&&r.qaEvidenceDigestSha256===r.currentEvidenceDigestSha256&&r.qaPaymentBindingSha256===r.currentPaymentBindingSha256
 if(!base(initial))return {ok:false as const,blocker:"AUTHORITY_NOT_CURRENT"}
 if(!base(current))return {ok:false as const,blocker:"AUTHORITY_REVOKED"}
 for(const key of ["propertyPin","bundleSha256","manifestSha256","dataEvidenceSha256","deadlineEvidenceSha256","policyVersion","propertyFingerprint","paymentIntent"] as const)if(initial[key]!==current[key])return {ok:false as const,blocker:"AUTHORITY_DRIFT"}
 return {ok:true as const}
}
export function decideZipWriteAction(status:string|undefined){
 if(status==="WRITE_UNKNOWN")return "RECONCILE_READ" as const
 if(status==="WRITE_CONFIRMED"||status==="READ_CONFIRMED"||status==="PROMOTED")return "SKIP_WRITE" as const
 if(status===undefined||status==="INTENDED")return "WRITE_ONCE" as const
 return "REFUSE" as const
}
export function decideCurrentArtifact(currentSha:string|undefined,nextSha:string){
 if(!currentSha)return {ok:true as const,create:true}
 return currentSha===nextSha?{ok:true as const,create:false}:{ok:false as const,blocker:"ARTIFACT_CONFLICT"}
}

import 'server-only'
import type {AnalysisStore} from './server/analysis-store'
const refused={ok:false as const,checkoutAuthorized:false as const}
/** Informational read only. Purchase must atomically consume its own order-bound disclosure. */
export async function evaluateSnapshotAcknowledgment(store:AnalysisStore,ids:{shownResultId:string;currentResultId?:string}) {
 try {
  const shown=await store.getResult(ids.shownResultId)
  if(!shown)return refused
  const current=await store.getLatestResult(shown.subject)
  if(!current||(ids.currentResultId!==undefined&&ids.currentResultId!==current.resultId))return refused
  return {ok:true as const,redisclosureRequired:shown.resultId!==current.resultId,
   acknowledges:{resultId:current.resultId,snapshotId:current.snapshotId,snapshotVersion:current.snapshotVersion},checkoutAuthorized:false as const}
 }catch{return refused}
}
export async function issueSnapshotDisclosure(store:AnalysisStore,shownResultId:string) {
 try {
  const token=await store.issueDisclosure(shownResultId)
  return token?{ok:true as const,token,checkoutAuthorized:false as const}:refused
 }catch{return refused}
}
export async function verifySnapshotAcknowledgment(store:AnalysisStore,input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input))return refused
 const fields=input as Record<string,unknown>
 if(Object.keys(fields).length!==2||typeof fields.token!=='string'||typeof fields.shownResultId!=='string')return refused
 try {
  const current=await store.consumeDisclosure(fields.shownResultId,fields.token)
  if(!current)return refused
  return {ok:true as const,redisclosureRequired:false,acknowledges:{resultId:current.resultId,snapshotId:current.snapshotId,snapshotVersion:current.snapshotVersion},checkoutAuthorized:false as const}
 }catch{return refused}
}

import "server-only"
/** Memory implementation is a test fixture only; application uses PostgreSQL. */
import { randomBytes } from "crypto"
import { FactualResultSchema, type FactualResult } from "@/lib/evidence/public-factual-contract"
import type { CapturedResponse } from './county-source-capture'
type Subject = FactualResult["subject"]
type Awaitable<T> = T | Promise<T>
export interface AnalysisStore {
  newId(prefix: "res" | "snap"): string
  persistResult(result: FactualResult, capture?: readonly CapturedResponse[]): Awaitable<FactualResult>
  getResult(id: string): Awaitable<FactualResult | undefined>
  getLatestResult(subject: Subject): Awaitable<FactualResult | undefined>
  issueDisclosure(id: string): Awaitable<string | undefined>
  consumeDisclosure(id: string, token: string): Awaitable<FactualResult | undefined>
}
export function deepFreeze<T>(v:T):T {
  if(v && typeof v==='object') {for(const x of Object.values(v)) deepFreeze(x);Object.freeze(v)}
  return v
}
export const subjectKey=(s:Subject)=>JSON.stringify([s.pin,s.taxYear,s.township])
export const newAnalysisId=(prefix:'res'|'snap')=>`${prefix}_${randomBytes(12).toString('hex')}`
export function createInMemoryAnalysisStore() {
  const results=new Map<string,FactualResult>(), latest=new Map<string,FactualResult>()
  const snapshots=new Set<string>(),tokens=new Map<string,string>()
  const store = {
    newId:newAnalysisId,
    putResult(result:FactualResult) {
      if(results.has(result.resultId)||snapshots.has(result.snapshotId)) throw new Error('RESULT_IMMUTABLE')
      const parsed=FactualResultSchema.parse(result), k=subjectKey(parsed.subject)
      if(parsed.snapshotVersion <= (latest.get(k)?.snapshotVersion??0)) throw new Error('STALE_SNAPSHOT')
      const frozen=deepFreeze(structuredClone(parsed))
      results.set(frozen.resultId,frozen);snapshots.add(frozen.snapshotId);latest.set(k,frozen)
      return frozen
    },
    persistResult(result:FactualResult) {
      return store.putResult({...result,snapshotVersion:(latest.get(subjectKey(result.subject))?.snapshotVersion??0)+1})
    },
    getResult(id:string) {return results.get(id)},
    getLatestResult(subject:Subject) {return latest.get(subjectKey(subject))},
    issueDisclosure(id:string) {
      const result=results.get(id)
      if(!result||latest.get(subjectKey(result.subject))?.resultId!==id)return undefined
      const token=randomBytes(32).toString('hex');tokens.set(token,id);return token
    },
    consumeDisclosure(id:string,token:string) {
      if(tokens.get(token)!==id)return undefined
      tokens.delete(token)
      const result=results.get(id)
      return result&&latest.get(subjectKey(result.subject))?.resultId===id?result:undefined
    },
  }
  return store
}

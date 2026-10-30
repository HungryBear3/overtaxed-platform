import 'server-only'
import {randomBytes} from 'node:crypto'
import type {Prisma} from '@prisma/client'
import {withFactualTransaction} from './factual-db'
import {FactualResultSchema,type FactualResult} from '../public-factual-contract'
import {deepFreeze,newAnalysisId,subjectKey,type AnalysisStore} from './analysis-store'
import {sha,COUNTY_LIMITS,type CapturedResponse} from './county-source-capture'

type Tx=Prisma.TransactionClient
type Row={id:string;snapshot_id:string;subject_key:string;version:number;canonical:string;sha256:string;capture:string|null;capture_sha256:string|null}
const unavailable=()=>new Error('STORAGE_UNAVAILABLE')
function captureBytes(result:FactualResult,capture?:readonly CapturedResponse[]):string|null {
 if(result.dataOrigin!=='COUNTY_RECORD') {if(capture!==undefined)throw unavailable();return null}
 if(!capture||!result.countyCapture||capture.length!==result.countyCapture.responseCount||capture.length>COUNTY_LIMITS.requests)throw unavailable()
 let total=0
 for(const r of capture){
  const u=new URL(r.url)
  if(u.protocol!=='https:'||u.hostname!=='datacatalog.cookcountyil.gov'||u.username||u.password||u.hash||r.status!==200||!Number.isFinite(Date.parse(r.retrievedAt))||r.sha256!==sha(r.body)||r.bytes!==Buffer.byteLength(r.body)||r.bytes>COUNTY_LIMITS.responseBytes)throw unavailable()
  total+=r.bytes
 }
 const bytes=JSON.stringify(capture)
 if(total>COUNTY_LIMITS.totalBytes||sha(bytes)!==result.countyCapture.sha256)throw unavailable()
 return bytes
}
function decode(row:Row):FactualResult {
 if(sha(row.canonical)!==row.sha256)throw unavailable()
 const result=FactualResultSchema.parse(JSON.parse(row.canonical))
 if(result.resultId!==row.id||result.snapshotId!==row.snapshot_id||result.snapshotVersion!==row.version||subjectKey(result.subject)!==row.subject_key)throw unavailable()
 if(result.dataOrigin==='COUNTY_RECORD') {
  if(!row.capture||sha(row.capture)!==row.capture_sha256)throw unavailable()
  captureBytes(result,JSON.parse(row.capture))
 } else if(row.capture!==null||row.capture_sha256!==null)throw unavailable()
 return deepFreeze(result)
}
async function read(tx:Tx,id:string){const rows=await tx.$queryRaw<Row[]>`SELECT * FROM ot_factual_result WHERE id=${id}`;return rows[0]?decode(rows[0]):undefined}
async function lock(tx:Tx,key:string){
 await tx.$executeRaw`INSERT INTO ot_factual_latest(subject_key) VALUES (${key}) ON CONFLICT DO NOTHING`
 const rows=await tx.$queryRaw<{version:number;result_id:string|null}[]>`SELECT version,result_id FROM ot_factual_latest WHERE subject_key=${key} FOR UPDATE`
 if(rows.length!==1)throw unavailable();return rows[0]
}
async function safe<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn()}catch{throw unavailable()}}
/** Dedicated factual authority; paid Prisma remains unchanged. No fallback. */
export function createPostgresAnalysisStore():AnalysisStore {
 return {
  newId:newAnalysisId,
  async persistResult(candidate,capture){
   // Freeze inputs before entering any async boundary; never trust caller hashes.
   const input=FactualResultSchema.parse(candidate),captured=captureBytes(input,capture)
   return safe(()=>withFactualTransaction(async tx=>{
    const key=subjectKey(input.subject),head=await lock(tx,key)
    const result=FactualResultSchema.parse({...input,snapshotVersion:head.version+1})
    const canonical=JSON.stringify(result),digest=sha(canonical),captureDigest=captured===null?null:sha(captured)
    await tx.$executeRaw`INSERT INTO ot_factual_result(id,snapshot_id,subject_key,version,canonical,sha256,capture,capture_sha256) VALUES (${result.resultId},${result.snapshotId},${key},${result.snapshotVersion},${canonical},${digest},${captured},${captureDigest})`
    const changed=await tx.$executeRaw`UPDATE ot_factual_latest SET version=${result.snapshotVersion}, result_id=${result.resultId} WHERE subject_key=${key} AND version=${head.version}`
    if(changed!==1)throw unavailable()
    return deepFreeze(result)
   }))
  },
  getResult(id){return safe(()=>withFactualTransaction(tx=>read(tx,id)))},
  getLatestResult(subject){return safe(()=>withFactualTransaction(async tx=>{
   const rows=await tx.$queryRaw<Row[]>`SELECT r.* FROM ot_factual_latest l JOIN ot_factual_result r ON r.id=l.result_id WHERE l.subject_key=${subjectKey(subject)} AND l.version=r.version AND l.subject_key=r.subject_key`
   return rows[0]?decode(rows[0]):undefined
  }))},
  issueDisclosure(id){return safe(()=>withFactualTransaction(async tx=>{
   const result=await read(tx,id);if(!result)return undefined
   const latest=await lock(tx,subjectKey(result.subject));if(latest.result_id!==id)return undefined
   const token=randomBytes(32).toString('hex')
   await tx.$executeRaw`INSERT INTO ot_factual_disclosure(token_sha256,result_id) VALUES (${sha(token)},${id})`
   return token
  }))},
  consumeDisclosure(id,token){return safe(()=>withFactualTransaction(async tx=>{
   if(!/^[a-f0-9]{64}$/.test(token))return undefined
   const result=await read(tx,id);if(!result)return undefined
   const latest=await lock(tx,subjectKey(result.subject));if(latest.result_id!==id)return undefined
   const changed=await tx.$executeRaw`UPDATE ot_factual_disclosure SET consumed_at=CURRENT_TIMESTAMP WHERE token_sha256=${sha(token)} AND result_id=${id} AND consumed_at IS NULL`
   return changed===1?result:undefined
  }))},
 }
}

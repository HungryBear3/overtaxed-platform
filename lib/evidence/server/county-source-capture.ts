import 'server-only'
import {createHash} from 'node:crypto'
import {parseBoundedJson} from '../public-factual-contract'
export type OfficialFetch=(url:string,init?:RequestInit)=>Promise<Response>
export const COUNTY_LIMITS=Object.freeze({pool:5000,page:500,requests:200,responseBytes:1_000_000,totalBytes:32_000_000,durationMs:120_000})
export const DATASETS=Object.freeze({parcel:'pabr-t5kh',assessed:'uzyt-m557',address:'3723-97qp'})
export const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
export type CapturedResponse=Readonly<{url:string;retrievedAt:string;status:200;sha256:string;body:string;bytes:number}>
/** Server-owned detached string bytes; no caller digest is trusted. Private URLs never logged. */
export function createCountyCapture(fetcher:OfficialFetch=fetch) {
 const started=Date.now();let total=0;const responses:CapturedResponse[]=[]
 async function get(dataset:string,query?:Record<string,string>):Promise<any>{
  if(!Object.values(DATASETS).includes(dataset as any))throw Error('UNSUPPORTED_DATASET')
  if(responses.length>=COUNTY_LIMITS.requests||Date.now()-started>COUNTY_LIMITS.durationMs)throw Error('RESOURCE_BOUND')
  const url=`https://datacatalog.cookcountyil.gov/${query?'resource':'api/views'}/${dataset}.json`+(query?'?'+new URLSearchParams(query):'')
  const r=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.min(20_000,COUNTY_LIMITS.durationMs-(Date.now()-started)))})
  if(r.status!==200||!r.body||(r.url&&r.url!==url))throw Error('SOURCE_UNAVAILABLE')
  const reader=r.body.getReader();const chunks:Uint8Array[]=[];let bytes=0
  try{for(;;){const v=await reader.read();if(v.done)break;bytes+=v.value.byteLength;total+=v.value.byteLength;if(bytes>COUNTY_LIMITS.responseBytes||total>COUNTY_LIMITS.totalBytes||Date.now()-started>COUNTY_LIMITS.durationMs)throw Error('RESOURCE_BOUND');chunks.push(v.value)}}finally{await reader.cancel().catch(()=>{})}
  const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))
  const value=parseBoundedJson(body,20)
  responses.push(Object.freeze({url,retrievedAt:new Date().toISOString(),status:200,sha256:sha(body),body,bytes}))
  return value
 }
 return {get,seal:()=>Object.freeze([...responses])}
}

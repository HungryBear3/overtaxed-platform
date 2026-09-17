import "server-only"
import { get,put } from "@vercel/blob"
import { MAX_NEUTRAL_CUSTOMER_ZIP_BYTES,NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE,neutralCustomerZipLocator,neutralCustomerZipSha256 } from "@/lib/fulfillment/neutral-customer-zip"
const enabled=()=>process.env.OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED==="true"
export async function writeNeutralCustomerZip(bytes:Buffer){
  if(!enabled())throw new Error("NEUTRAL_ZIP_STORAGE_DISABLED")
  const copy=Buffer.from(bytes),sha256=neutralCustomerZipSha256(copy),locator=neutralCustomerZipLocator(sha256)
  if(copy.length===0||copy.length>MAX_NEUTRAL_CUSTOMER_ZIP_BYTES)throw new Error("NEUTRAL_ZIP_STORAGE_INVALID")
  const result=await put(locator,copy,{access:"private",addRandomSuffix:false,allowOverwrite:false,contentType:NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE})
  if(result.pathname!==locator)throw new Error("NEUTRAL_ZIP_STORAGE_UNKNOWN")
  return {sha256,locator,byteSize:copy.length,mediaType:NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE}
}
export async function readNeutralCustomerZip(locator:string){
  if(!enabled())throw new Error("NEUTRAL_ZIP_STORAGE_DISABLED")
  const sha=/^ot-neutral-customer\/sha256\/([0-9a-f]{64})\.zip$/.exec(locator)?.[1]
  if(!sha||neutralCustomerZipLocator(sha)!==locator)throw new Error("NEUTRAL_ZIP_STORAGE_INVALID")
  const result=await get(locator,{access:"private",useCache:false});if(!result?.stream||result.statusCode!==200||result.blob.pathname!==locator)throw new Error("NEUTRAL_ZIP_STORAGE_UNAVAILABLE")
  const reader=result.stream.getReader(),parts:Buffer[]=[];let size=0;try{for(;;){const p=await reader.read();if(p.done)break;const part=Buffer.from(p.value);size+=part.length;if(size>MAX_NEUTRAL_CUSTOMER_ZIP_BYTES){await reader.cancel("neutral zip too large").catch(()=>{});throw new Error("NEUTRAL_ZIP_STORAGE_INVALID")}parts.push(part)}}finally{reader.releaseLock()}
  const bytes=Buffer.concat(parts);if(neutralCustomerZipSha256(bytes)!==sha)throw new Error("NEUTRAL_ZIP_STORAGE_MISMATCH");return bytes
}

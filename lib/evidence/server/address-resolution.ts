import "server-only"
/** Server-internal, request-scoped address authority. No client capability,
 * self-hash, cached resolution or verifier flag is accepted. Each POST obtains
 * fresh records from a trusted configured source, then uses the real ranker and
 * corroborator. Public county acquisition has no such qualified source yet.
 */
import { parseFreeCheckAddress, resolveAddressCandidates, recordCorroboratesAddress, type AddressCandidateRecord } from '@/lib/free-check-address'
import type { AcquisitionRequest } from './factual-analysis'

export interface AddressRecord extends AddressCandidateRecord {
  county: string
  township: string
  taxYear: number
  crossStreet?: string
}
export interface AddressRecordSource {
  search(address: string, city: string | undefined, limit: number, options: {fragments:string[]}): Promise<{ok:boolean; records:AddressCandidateRecord[]}>
  load(pin:string): Promise<AddressRecord | null>
}
const pinPattern=/^(?:\d{14}|\d{2}-\d{2}-\d{3}-\d{3}-\d{4})$/
const pinKey=(pin:string)=>pin.replace(/-/g,'')
const bounded=(s:unknown):s is string=>typeof s==='string'&&s.length<=200
const mismatch=()=>({ok:false as const,status:409,body:{code:'ADDRESS_EVIDENCE_MISMATCH',error:'The selected record does not corroborate this address. Check the address or use the PIN.'}})
const unavailable=()=>({ok:false as const,status:503,body:{code:'ADDRESS_LOOKUP_UNAVAILABLE',retryable:true,error:'Address lookup is unavailable on our side, not your address. Please retry later.'}})

export async function resolveServerAddress(source:AddressRecordSource, request:AcquisitionRequest) {
  const parsed=parseFreeCheckAddress(request.address??'',request.city)
  if (request.unit) {
    if (parsed.unit && parsed.unit!==request.unit.toUpperCase()) return mismatch()
    parsed.unit=request.unit.toUpperCase()
  }
  try {
    let found=await source.search(parsed.street,parsed.city||undefined,100,{fragments:parsed.queryFragments})
    if (!found.ok) return unavailable()
    if (!Array.isArray(found.records)||found.records.length>100) return unavailable()
    if (found.records.length===0&&parsed.city) {
      found=await source.search(parsed.street,undefined,100,{fragments:parsed.queryFragments})
      if (!found.ok||!Array.isArray(found.records)||found.records.length>100) return unavailable()
    }
    // Validate exact PIN syntax before the legacy ranker's normalization. Do not
    // let punctuation stripping turn malformed source IDs into authoritative PINs.
    const records=found.records.filter(r=>r&&bounded(r.pin)&&pinPattern.test(r.pin)&&bounded(r.address)&&bounded(r.city)&&bounded(r.zip))
    const seen=new Map<string,string>()
    for (const r of records) {
      const key=pinKey(r.pin); const value=JSON.stringify([r.address,r.city,r.zip])
      if (seen.has(key)&&seen.get(key)!==value) return mismatch()
      seen.set(key,value)
    }
    const resolution=resolveAddressCandidates(parsed,records,{maxCandidates:8})
    if (resolution.kind==='none') return {ok:false as const,status:404,body:{code:'ADDRESS_NOT_FOUND',error:'No matching address record was found. Try the Assessor address search.',assessorAddressSearchUrl:'https://www.cookcountyassessoril.gov/address-search'}}
    const offered=resolution.selectable
    const selected=request.selectedPin ? offered.find(r=>r.pin===request.selectedPin) : resolution.kind==='unique'?resolution.candidate:undefined
    if (!selected) return {ok:false as const,status:409,body:{code:'ADDRESS_AMBIGUOUS',error:'Choose the matching parcel or refine the address.',candidateCount:resolution.kind==='ambiguous'?resolution.total:offered.length,candidates:offered.map(r=>({pin:r.pin,address:r.address,city:r.city,unit:r.unit,zipCode:r.zip}))}}
    const loaded=await source.load(selected.pin)
    if (!loaded||!bounded(loaded.pin)||!pinPattern.test(loaded.pin)||!bounded(loaded.address)||!bounded(loaded.city)||!bounded(loaded.township)||!loaded.township.trim()||loaded.county!=='Cook'||!Number.isInteger(loaded.taxYear)||loaded.taxYear<1900||loaded.taxYear>2200) return mismatch()
    if (!recordCorroboratesAddress(parsed,selected,loaded.pin,loaded.address,loaded.city)) return mismatch()
    // Locality may have been deliberately relaxed for a typo, but the loaded
    // record must still corroborate the locality actually offered by the source.
    if (selected.city && selected.city.toUpperCase()!==loaded.city.trim().toUpperCase()) return mismatch()
    if (request.taxYear && Number(request.taxYear)!==loaded.taxYear) return mismatch()
    if (request.crossStreet && (!bounded(loaded.crossStreet)||parseFreeCheckAddress(request.crossStreet).street!==parseFreeCheckAddress(loaded.crossStreet).street)) return mismatch()
    // This frozen context never crosses the JSON boundary. The only consumer
    // is this POST's acquisition guard; later requests must resolve afresh.
    return {ok:true as const,context:Object.freeze({
      normalizedRequest:JSON.stringify([parsed.street,parsed.unit,parsed.city.toUpperCase(),parsed.zip,request.taxYear??null,request.crossStreet?parseFreeCheckAddress(request.crossStreet).street:null]),
      offeredPins:Object.freeze(offered.map(r=>r.pin).sort()),
      pin:selected.pin,township:loaded.township,taxYear:loaded.taxYear,
    })}
  } catch { return unavailable() }
}

import 'server-only'
import type {Acquisition,FactualAcquisitionAdapter} from './factual-analysis'
import {createCountyCapture,DATASETS,COUNTY_LIMITS,sha,type OfficialFetch,type CapturedResponse} from './county-source-capture'
import {FactualAcquisitionSnapshotSchema} from '../public-factual-contract'
import type {AddressRecordSource} from './address-resolution'
const issued=new WeakMap<object,readonly CapturedResponse[]>()
// LOCAL process-only retention, bounded and fail-closed; never evict a capture
// behind an issued result. Native DB/multi-instance persistence is UNQUALIFIED.
const retained=new Map<string,readonly CapturedResponse[]>()
let retainedBytes=0
export const retainedCountyCapture=(digest:string)=>retained.get(digest)
export const countyCaptureFor=(a:Acquisition)=>issued.get(a)
export const isCollectedCountyAcquisition=(a:Acquisition)=>issued.has(a)
const fail=():never=>{throw Error('COUNTY_SOURCE_REJECTED')}
const text=(v:unknown,re:RegExp):string=>typeof v==='string'&&re.test(v)?v:fail()
const pin=(v:unknown)=>text(v,/^\d{14}$/)
const fmt=(p:string)=>p.replace(/^(..)(..)(...)(...)(....)$/,'$1-$2-$3-$4-$5')
const select='pin,year,class,township_code,township_name,nbhd_code'
const assessmentSelect='pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg'
const addressSelect='pin,year,prop_address_full,prop_address_city_name,prop_address_zipcode_1'
const dollars=(v:unknown)=>{const s=text(v,/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/);const [a,b='']=s.split('.');const n=BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,'0'));if(n>BigInt(100_000_000_000))fail();return Number(n)}
function rows(v:any,max:number){if(!Array.isArray(v)||v.length>max||v.some(x=>!x||typeof x!=='object'||Array.isArray(x)))fail();return v as Record<string,string>[]}
function exactKeys(r:Record<string,unknown>,keys:string){if(Object.keys(r).sort().join(',')!==keys.split(',').sort().join(','))fail()}
function parcel(p:Record<string,string>){exactKeys(p,select);pin(p.pin);text(p.year,/^(?:19|20)\d{2}$/);text(p.class,/^2(?!99$)\d{2}$/);text(p.township_code,/^\d{2}$/);text(p.nbhd_code,/^\d{5}$/);text(p.township_name,/^[A-Z][A-Za-z ]{1,30}$/)}
function epoch(m:any,id:string,fields:string){if(m?.id!==id||m.provenance!=='official'||!Number.isSafeInteger(m.rowsUpdatedAt)||!Number.isSafeInteger(m.viewLastModified)||!Number.isSafeInteger(m.tableId)||!Array.isArray(m.columns))fail();for(const f of fields.split(','))if(!m.columns.some((c:any)=>c.fieldName===f&&['text','number'].includes(c.dataTypeName)))fail();return JSON.stringify([m.rowsUpdatedAt,m.viewLastModified,m.tableId])}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v)}return v}
/** Complete broad class-2/non299 pool first; exact-class scope is value blind.
 * Raw mailed assessed joins do not depend on improvement/comparable eligibility.
 * Injection is server/test only; network default is the allowlisted GET collector. */
async function acquireCanonicalFactual(req:import('./factual-analysis').AcquisitionRequest):Promise<Acquisition> {
 const {createAcquisitionSnapshotStoreFromEnv}=await import('./acquisition-snapshot')
 const reader=createAcquisitionSnapshotStoreFromEnv()
 if(!reader)return {ok:false,hold:'STORAGE_UNAVAILABLE'}
 try {
  if(!req.pin||req.address||req.selectedPin)fail()
  const requested=pin(req.pin!.replace(/-/g,''))
  const {loadNeutralCheckoutOfficialProperty}=await import('@/lib/commerce/neutral-checkout-runtime')
  const official=await loadNeutralCheckoutOfficialProperty(requested)
  if(!official?.acquisitionSnapshot)fail()
  const ref=official!.acquisitionSnapshot!
  const stored=await reader.readPrivileged(ref.id)
  if(!stored||stored.sha256!==ref.sha256||stored.snapshot.subject.pin!==requested)fail()
  const s=stored!.snapshot
  const capture:CapturedResponse[]=stored!.pages.map(p=>({url:p.receipt.url,retrievedAt:p.receipt.retrievedAt,status:200,sha256:sha(p.bytes.toString('utf8')),body:p.bytes.toString('utf8'),bytes:p.bytes.length}))
  const assessed=new Map<string,{land:number;building:number;total:number}>()
  for(const p of stored!.pages){
   const url=new URL(p.receipt.url)
   if(p.receipt.datasetId!=='uzyt-m557'||!url.pathname.startsWith('/resource/')||!url.searchParams.get('$select')?.includes('mailed_land'))continue
   for(const row of JSON.parse(p.bytes.toString('utf8'))){
    if(assessed.has(row.pin))fail()
    const land=dollars(row.mailed_land),building=dollars(row.mailed_bldg),total=dollars(row.mailed_tot)
    if(land+building!==total)fail()
    assessed.set(row.pin,{land,building,total})
   }
  }
  // Historical raw-record fields remain exact-class for compatibility. The
  // shared comparable metric is ONLY the separately versioned paid cohort.
  const selected=s.pool.filter(p=>p.propertyClass===s.subject.propertyClass)
  const neighborhood=s.subject.neighborhoodCode.slice(0,2)+'-'+s.subject.neighborhoodCode.slice(2),propertyClass=s.subject.propertyClass[0]+'-'+s.subject.propertyClass.slice(1)
  const acq:Acquisition={ok:true,origin:'COUNTY_RECORD',atomic:false,sources:['ccao_assessed_values','ccao_parcel_universe'],subject:{pin:fmt(requested),township:s.subject.township,taxYear:s.subject.taxYear},cohort:{neighborhoodCode:neighborhood,propertyClass},acquisitionSnapshot:FactualAcquisitionSnapshotSchema.parse({...ref,sharedMetric:s.sharedMetric}),countyCapture:{sha256:sha(JSON.stringify(capture)),responseCount:capture.length,poolCount:s.pool.length,includedCount:selected.length,excludedClassCount:s.pool.length-selected.length,retrievedAt:capture[capture.length-1].retrievedAt,upstreamAtomicGuarantee:'NOT_ESTABLISHED',completeness:'COLLECTOR_ATTESTED',stage:'mailed',provisional:true},parcels:selected.map(p=>{
   const value=assessed.get(p.pin);if(!value||value.total!==p.assessedTotalCents)fail()
   return {pin:fmt(p.pin),role:p.pin===requested?'subject':'cohort',taxYear:s.subject.taxYear,assessedTotalCents:p.assessedTotalCents,landCents:value!.land,buildingCents:value!.building,propertyClass,township:s.subject.township,neighborhoodCode:neighborhood,sourceId:'ccao_assessed_values',parcelSourceId:'ccao_parcel_universe',recordDate:null}
  })}
  freeze(acq);issued.set(acq,Object.freeze(capture.map(p=>Object.freeze(p))));return acq
 }catch{return {ok:false,hold:'ACQUISITION_REJECTED'}}finally{await reader.close()}
}
export function createCountyFactualAdapter(fetcher?:OfficialFetch):FactualAcquisitionAdapter {
 const addressSource:AddressRecordSource={
  async search(address,city,limit,options){try{
   if(!Number.isInteger(limit)||limit<1||limit>100||options.fragments.length>10)fail()
   const c=createCountyCapture(fetcher);const before=epoch(await c.get(DATASETS.address),DATASETS.address,addressSelect)
   const pe=epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select)
   const years=rows(await c.get(DATASETS.parcel,{'$select':'year','$order':'year DESC','$limit':'1'}),1)
   if(years.length!==1)fail();exactKeys(years[0],'year');const year=text(years[0].year,/^(?:19|20)\d{2}$/)
   const escaped=(s:string)=>{if(s.length>200||/[\x00-\x1f]/.test(s))fail();return s.toUpperCase().replace(/'/g,"''")}
   const fragments=options.fragments.length?options.fragments:[address]
   const where=`year=${year} AND (`+fragments.map(f=>`upper(prop_address_full) like '%${escaped(f).replace(/[%_]/g,'')}%'`).join(' OR ')+')'+(city?` AND upper(prop_address_city_name)='${escaped(city)}'`:'')
   const rr=rows(await c.get(DATASETS.address,{'$select':addressSelect,'$where':where,'$order':'pin','$limit':String(limit+1)}),limit)
   const seen=new Set<string>();const records=rr.map(r=>{exactKeys(r,addressSelect);pin(r.pin);if(seen.has(r.pin))fail();seen.add(r.pin);text(r.year,/^(?:19|20)\d{2}$/);return {pin:r.pin,address:text(r.prop_address_full,/^[^\x00-\x1f]{1,200}$/),city:text(r.prop_address_city_name,/^[^\x00-\x1f]{1,100}$/),zip:text(r.prop_address_zipcode_1,/^\d{5}(?:-\d{4})?$/)}})
   if(rr.some(r=>r.year!==year))fail()
   if(epoch(await c.get(DATASETS.address),DATASETS.address,addressSelect)!==before||epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select)!==pe)fail()
   return {ok:true,records}
  }catch{return {ok:false,records:[]}}},
  async load(raw){try{const p=pin(raw.replace(/-/g,''));const c=createCountyCapture(fetcher)
   const pe=epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select),ae=epoch(await c.get(DATASETS.address),DATASETS.address,addressSelect)
   const pp=rows(await c.get(DATASETS.parcel,{'$select':select,'$where':`pin='${p}'`,'$order':'pin','$limit':'2'}),1);if(pp.length!==1)fail();parcel(pp[0]);if(pp[0].pin!==p)fail()
   const aa=rows(await c.get(DATASETS.address,{'$select':addressSelect,'$where':`pin='${p}' AND year=${pp[0].year}`,'$order':'pin','$limit':'2'}),1);if(aa.length!==1)fail();const a=aa[0];exactKeys(a,addressSelect);if(a.pin!==p||a.year!==pp[0].year)fail()
   if(epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select)!==pe||epoch(await c.get(DATASETS.address),DATASETS.address,addressSelect)!==ae)fail()
   return {pin:p,address:text(a.prop_address_full,/^[^\x00-\x1f]{1,200}$/),city:text(a.prop_address_city_name,/^[^\x00-\x1f]{1,100}$/),zip:text(a.prop_address_zipcode_1,/^\d{5}(?:-\d{4})?$/),county:'Cook',township:pp[0].township_name,taxYear:Number(pp[0].year)}
  }catch{return null}}
 }
 return {id:'cook-county-raw-factual-v1',addressSource,async acquire(req){
 // Default mounted path shares the paid acquisition/immutable snapshot contract.
 // Explicit injected transport retains the historical collector for old replay fixtures only.
 if(fetcher===undefined)return acquireCanonicalFactual(req)
 try{
  if(!req.pin||req.address||req.selectedPin)fail();const requested=pin(req.pin!.replace(/-/g,''));const c=createCountyCapture(fetcher)
  const pe=epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select),ae=epoch(await c.get(DATASETS.assessed),DATASETS.assessed,assessmentSelect)
  const ss=rows(await c.get(DATASETS.parcel,{'$select':select,'$where':`pin='${requested}'`,'$order':'pin','$limit':'2'}),1);if(ss.length!==1)fail();const s=ss[0];parcel(s);if(s.pin!==requested)fail()
  const scope=`year='${s.year}' AND township_code='${s.township_code}' AND nbhd_code='${s.nbhd_code}' AND class like '2%' AND class != '299'`
  const count=async()=>{const r=rows(await c.get(DATASETS.parcel,{'$select':'count(*) AS n','$where':scope}),1);if(r.length!==1)fail();exactKeys(r[0],'n');const n=Number(text(r[0].n,/^[1-9]\d*$/));if(!Number.isSafeInteger(n)||n>COUNTY_LIMITS.pool)fail();return n}
  const n=await count(),pool:Record<string,string>[]=[]
  for(let offset=0;offset<n;offset+=COUNTY_LIMITS.page){const page=rows(await c.get(DATASETS.parcel,{'$select':select,'$where':scope,'$order':'pin','$limit':'500','$offset':String(offset)}),500);if(page.length!==Math.min(500,n-offset))fail();pool.push(...page)}
  if(await count()!==n)fail()
  for(let i=0;i<pool.length;i++){const p=pool[i];parcel(p);if(p.year!==s.year||p.township_code!==s.township_code||p.township_name!==s.township_name||p.nbhd_code!==s.nbhd_code||(i>0&&pool[i-1].pin>=p.pin))fail()}
  const subject=pool.filter(p=>p.pin===requested);if(subject.length!==1||JSON.stringify(subject[0])!==JSON.stringify(s))fail()
  const assessed=new Map<string,Record<string,string>>()
  for(let i=0;i<n;i+=100){const batch=pool.slice(i,i+100),expected=new Set(batch.map(p=>p.pin));const rr=rows(await c.get(DATASETS.assessed,{'$select':assessmentSelect,'$where':`year=${s.year} AND pin in (${batch.map(p=>`'${p.pin}'`).join(',')})`,'$order':'pin','$limit':'201'}),100)
   if(rr.length!==batch.length)fail();let previous=''
   for(const a of rr){exactKeys(a,assessmentSelect);pin(a.pin);if(!expected.has(a.pin)||assessed.has(a.pin)||a.pin<=previous)fail();previous=a.pin;assessed.set(a.pin,a)}
  }
  // Validate required assessed identity/arithmetic across ALL candidates before scoping.
  for(const p of pool){const a=assessed.get(p.pin);if(!a||a.year!==p.year||a.class!==p.class||a.township_code!==p.township_code||a.nbhd!==p.nbhd_code)fail();if(dollars(a!.mailed_tot)!==dollars(a!.mailed_land)+dollars(a!.mailed_bldg))fail()}
  if(await count()!==n)fail()
  if(epoch(await c.get(DATASETS.parcel),DATASETS.parcel,select)!==pe||epoch(await c.get(DATASETS.assessed),DATASETS.assessed,assessmentSelect)!==ae)fail()
  const capture=c.seal();const selected=pool.filter(p=>p.class===s.class)
  const neighborhood=s.nbhd_code.slice(0,2)+'-'+s.nbhd_code.slice(2),propertyClass=s.class[0]+'-'+s.class.slice(1)
  const acq:Acquisition={ok:true,origin:'COUNTY_RECORD',atomic:false,sources:['ccao_assessed_values','ccao_parcel_universe'],subject:{pin:fmt(s.pin),township:s.township_name,taxYear:Number(s.year)},cohort:{neighborhoodCode:neighborhood,propertyClass},countyCapture:{sha256:sha(JSON.stringify(capture)),responseCount:capture.length,poolCount:n,includedCount:selected.length,excludedClassCount:n-selected.length,retrievedAt:capture[capture.length-1].retrievedAt,upstreamAtomicGuarantee:'NOT_ESTABLISHED',completeness:'COLLECTOR_ATTESTED',stage:'mailed',provisional:true},parcels:selected.map(p=>{const a=assessed.get(p.pin)!;return {pin:fmt(p.pin),role:p.pin===s.pin?'subject':'cohort',taxYear:Number(p.year),assessedTotalCents:dollars(a.mailed_tot),landCents:dollars(a.mailed_land),buildingCents:dollars(a.mailed_bldg),propertyClass,township:p.township_name,neighborhoodCode:neighborhood,sourceId:'ccao_assessed_values',parcelSourceId:'ccao_parcel_universe',recordDate:null}})}
  const digest=acq.countyCapture!.sha256,bytes=capture.reduce((n,r)=>n+r.bytes,0)
  if(!retained.has(digest)) {if(retained.size>=64||retainedBytes+bytes>128_000_000)fail();retained.set(digest,capture);retainedBytes+=bytes}
  freeze(acq);issued.set(acq,capture);return acq
 }catch{return {ok:false,hold:'ACQUISITION_REJECTED'}}}}
}

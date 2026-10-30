/** Synthetic authoritative source adapter for the retained address scenarios.
 * No county data/network. No matcher: production resolver owns all decisions.
 */
import { createFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import type { Acquisition } from '@/lib/evidence/server/factual-analysis'
export function createAddressFixture(source: {
  searchPropertiesByAddress: (...args:any[])=>Promise<any>;
  getPropertyByPIN: (...args:any[])=>Promise<any>;
  getComparableEquity: (...args:any[])=>Promise<any>;
  getComparableSales: (...args:any[])=>Promise<any>;
}) {
  const store=createInMemoryAnalysisStore()
  const loaded=new Map<string,any>()
  const format=(pin:string)=>pin.replace(/^(\d{2})(\d{2})(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3-$4-$5')
  const adapter={id:'synthetic-address-fixture', addressSource:{
    async search(...args: [string,string|undefined,number,{fragments:string[]}]) {
      const result=await source.searchPropertiesByAddress(...args)
      return {ok:result.success,records:result.data?.map((r:any)=>({pin:r.pin,address:r.property_address,city:r.property_city,zip:r.property_zip}))??[]}
    },
    async load(pin:string) {
      const result=await source.getPropertyByPIN(pin); const r=result?.data
      if (!result?.success || !r) return null
      loaded.set(pin,r)
      return {pin:r.pin,address:r.address,city:r.city,zip:r.zipCode,county:r.county,township:r.township,taxYear:r.assessmentHistory[0].year}
    },
  }, async acquire(req:{pin?:string}):Promise<Acquisition> {
    const r=loaded.get(req.pin!); if (!r) return {ok:false,hold:'ACQUISITION_REJECTED'}
    // Independent invented raw assessments, NOT conversion from a market-value estimator.
    const equity=await source.getComparableEquity(req.pin)
    const base={taxYear:r.assessmentHistory[0].year,propertyClass:r.buildingClass,township:r.township,neighborhoodCode:r.neighborhood,sourceId:'ccao_assessed_values' as const,parcelSourceId:'ccao_parcel_universe' as const,recordDate:null}
    return {ok:true,origin:'SYNTHETIC_PREVIEW',atomic:true,sources:['ccao_assessed_values','ccao_parcel_universe'],
      subject:{pin:format(r.pin),township:r.township,taxYear:base.taxYear},cohort:{propertyClass:r.buildingClass,neighborhoodCode:r.neighborhood},
      parcels:[{...base,pin:format(r.pin),role:'subject',assessedTotalCents:r.assessedTotalValue*100,landCents:null,buildingCents:null},
        ...(equity?.data??[]).filter((c:any)=>Number.isSafeInteger(c.syntheticRawCents)&&c.syntheticRawCents>0).map((c:any)=>({...base,pin:format(c.pin),role:'cohort' as const,assessedTotalCents:c.syntheticRawCents,landCents:null,buildingCents:null}))]}
  }}
  const route=createFreeCheckRoute({store,adapter})
  return {...route,store}
}

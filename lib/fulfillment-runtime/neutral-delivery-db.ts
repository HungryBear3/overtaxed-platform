import "server-only"
import {Pool} from "pg"
import {PrismaPg} from "@prisma/adapter-pg"
import {PrismaClient} from "@prisma/client"
import {Prisma} from "@prisma/client"
import {buildNeutralPoolConfig} from "@/lib/fulfillment-runtime/neutral-db-tls"

let client:PrismaClient|undefined

export function neutralDeliveryPrisma():PrismaClient{
  const url=process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL?.trim()
  if(!url)throw new Error("NEUTRAL_DELIVERY_DATABASE_DISABLED")
  const pool=buildNeutralPoolConfig(url,process.env.OT_NEUTRAL_DATABASE_CA_PEM)
  if(!client)client=new PrismaClient({adapter:new PrismaPg(new Pool({...pool,max:2,connectionTimeoutMillis:5000}))})
  return client
}

export async function disconnectNeutralDeliveryPrisma(){if(client){await client.$disconnect();client=undefined}}
type NeutralDeliveryQueryExecutor={ $queryRaw<T>(query:unknown):Promise<T> }
export async function isNeutralDeliveryFulfillment(fulfillmentId:string,executor?:NeutralDeliveryQueryExecutor):Promise<boolean>{
  if(!process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL)return false
  const rows=await (executor??neutralDeliveryPrisma()).$queryRaw<Array<{found:boolean}>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "ot_fulfillment" WHERE "id"=${fulfillmentId} AND "kind"::text='NEUTRAL_RECORDS_REPORT') "found"`)
  return rows[0]?.found===true
}

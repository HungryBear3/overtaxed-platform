import "server-only"
import {Pool} from "pg"
import {PrismaPg} from "@prisma/adapter-pg"
import {PrismaClient} from "@prisma/client"
import {Prisma} from "@prisma/client"

let client:PrismaClient|undefined

export function neutralDeliveryPrisma():PrismaClient{
  const url=process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL?.trim()
  if(!url)throw new Error("NEUTRAL_DELIVERY_DATABASE_DISABLED")
  const parsed=new URL(url)
  const local=["localhost","127.0.0.1","::1"].includes(parsed.hostname)
  const sslmode=parsed.searchParams.get("sslmode")
  if(!local&&!['require','verify-ca','verify-full'].includes(sslmode??''))throw new Error("NEUTRAL_DELIVERY_DATABASE_TLS_REQUIRED")
  if(!client)client=new PrismaClient({adapter:new PrismaPg(new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000}))})
  return client
}

export async function disconnectNeutralDeliveryPrisma(){if(client){await client.$disconnect();client=undefined}}
type NeutralDeliveryQueryExecutor={ $queryRaw<T>(query:unknown):Promise<T> }
export async function isNeutralDeliveryFulfillment(fulfillmentId:string,executor?:NeutralDeliveryQueryExecutor):Promise<boolean>{
  if(!process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL)return false
  const rows=await (executor??neutralDeliveryPrisma()).$queryRaw<Array<{found:boolean}>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "ot_fulfillment" WHERE "id"=${fulfillmentId} AND "kind"::text='NEUTRAL_RECORDS_REPORT') "found"`)
  return rows[0]?.found===true
}

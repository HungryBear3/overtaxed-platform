import "server-only"
import {Pool} from "pg"
import {PrismaPg} from "@prisma/adapter-pg"
import {PrismaClient} from "@prisma/client"
import {buildNeutralPoolConfig} from "@/lib/fulfillment-runtime/neutral-db-tls"

let client:PrismaClient|undefined
export function neutralPrisma():PrismaClient{
  const url=process.env.OT_NEUTRAL_DATABASE_URL?.trim()
  if(!url) throw new Error("NEUTRAL_DATABASE_DISABLED")
  const pool=buildNeutralPoolConfig(url,process.env.OT_NEUTRAL_DATABASE_CA_PEM)
  if(!client) client=new PrismaClient({adapter:new PrismaPg(new Pool({...pool,max:2,connectionTimeoutMillis:5000}))})
  return client
}
export async function disconnectNeutralPrisma():Promise<void>{if(client){await client.$disconnect();client=undefined}}

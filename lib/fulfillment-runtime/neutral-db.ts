import "server-only"
import {Pool} from "pg"
import {PrismaPg} from "@prisma/adapter-pg"
import {PrismaClient} from "@prisma/client"

let client:PrismaClient|undefined
export function neutralPrisma():PrismaClient{
  const url=process.env.OT_NEUTRAL_DATABASE_URL?.trim()
  if(!url) throw new Error("NEUTRAL_DATABASE_DISABLED")
  const parsed=new URL(url), local=["localhost","127.0.0.1","::1"].includes(parsed.hostname)
  const sslmode=parsed.searchParams.get("sslmode")
  if(!local && !["require","verify-ca","verify-full"].includes(sslmode??"")) throw new Error("NEUTRAL_DATABASE_TLS_REQUIRED")
  if(!client) client=new PrismaClient({adapter:new PrismaPg(new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000}))})
  return client
}
export async function disconnectNeutralPrisma():Promise<void>{if(client){await client.$disconnect();client=undefined}}

import "server-only"
import {Pool} from "pg"
import {PrismaPg} from "@prisma/adapter-pg"
import {PrismaClient} from "@prisma/client"
import {buildNeutralPoolConfig,type NeutralPoolTrustOptions} from "@/lib/fulfillment-runtime/neutral-db-tls"

export type NeutralPrismaClientOptions={url:string;caPem?:string;trust?:NeutralPoolTrustOptions}

// Inherited default construction, unchanged: an externally owned pg Pool, which
// the adapter does not end on $disconnect (left to pg-pool idle eviction).
function clientFor(pool:ReturnType<typeof buildNeutralPoolConfig>):PrismaClient{
  return new PrismaClient({adapter:new PrismaPg(new Pool({...pool,max:2,connectionTimeoutMillis:5000}))})
}

// Trusted server code only: explicit target/trust, a new client per call. Never
// reads the environment and never touches the neutralPrisma() cache below.
// The adapter receives the validated config, so it owns its pool: built lazily on
// connect, ended on $disconnect, and rebuilt from the same config on reconnect.
export function createNeutralPrismaClient({url,caPem,trust}:NeutralPrismaClientOptions):PrismaClient{
  return new PrismaClient({adapter:new PrismaPg({...buildNeutralPoolConfig(url,caPem,trust),max:2,connectionTimeoutMillis:5000})})
}

let client:PrismaClient|undefined
export function neutralPrisma():PrismaClient{
  const url=process.env.OT_NEUTRAL_DATABASE_URL?.trim()
  if(!url) throw new Error("NEUTRAL_DATABASE_DISABLED")
  const pool=buildNeutralPoolConfig(url,process.env.OT_NEUTRAL_DATABASE_CA_PEM)
  if(!client) client=clientFor(pool)
  return client
}
export async function disconnectNeutralPrisma():Promise<void>{if(client){await client.$disconnect();client=undefined}}

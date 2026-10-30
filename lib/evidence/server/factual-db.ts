import 'server-only'
import {PrismaClient, type Prisma} from '@prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {Pool} from 'pg'
import {roleTransport} from './role-transport'

// Separate protected server environment handles. Never inherit paid DB config.
export class FactualStorageUnavailableError extends Error {
 readonly code = 'STORAGE_UNAVAILABLE' as const
 constructor(){super('Factual storage is unavailable');this.name='FactualStorageUnavailableError'}
}
let client: PrismaClient | undefined
function getClient(): PrismaClient {
 if(client)return client
 const raw=process.env.OT_FACTUAL_DATABASE_URL, mode=process.env.OT_FACTUAL_DATABASE_SSL
 if(!raw || (mode!=='require' && mode!=='disable'))throw new FactualStorageUnavailableError()
 const pool=new Pool({...roleTransport(raw,'ot_factual_app',mode),max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:1000})
 pool.on('error',()=>{})
 client=new PrismaClient({adapter:new PrismaPg(pool)})
 return client
}
/** Every read/write and its authority check share one physical transaction. */
export async function withFactualTransaction<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
 let entered=false
 try{
  return await getClient().$transaction(async tx=>{
   const rows=await tx.$queryRaw<Array<{current_user:string;rolsuper:boolean;rolbypassrls:boolean}>>`SELECT current_user::text AS current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user AND session_user=current_user`
   if(rows.length!==1 || rows[0].current_user!=='ot_factual_app' || rows[0].rolsuper!==false || rows[0].rolbypassrls!==false)throw new FactualStorageUnavailableError()
   entered=true
   return fn(tx)
  })
 }catch(error){
  if(error instanceof FactualStorageUnavailableError)throw error
  if(!entered)throw new FactualStorageUnavailableError()
  throw error // The store sanitizes operation errors at its public boundary.
 }
}

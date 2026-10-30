/** @jest-environment node */
import * as reversal from '@/lib/checkout/ot-reversal'
import {trustedPaymentAuthority} from '@/lib/fulfillment-runtime/payment-authority'
import type {Prisma} from '@prisma/client'
import {readFileSync, readdirSync} from 'fs'
import {join} from 'path'

type Bind = (tx: Prisma.TransactionClient, input: Record<string, unknown>) => Promise<void>
const bindZeroTotalSettlement = (reversal as unknown as {bindZeroTotalSettlement?: Bind}).bindZeroTotalSettlement as Bind
const input = {orderId:'ord_one',sessionId:'cs_one',eventId:'evt_one',promotionCodeId:'promo_full',couponId:'coupon_full',subtotalCents:6900,discountCents:6900,currency:'usd'}
function tx(rows: object[]) {
 const calls: string[]=[]
 const values: unknown[][]=[]
 const query=jest.fn(async (s:TemplateStringsArray, ...v: unknown[])=> {calls.push(s.join('?')); values.push(v); return s.join('?').includes('advisory') ? [] : rows})
 const execute=jest.fn(async (s:TemplateStringsArray, ...v: unknown[])=>{calls.push(s.join('?')); values.push(v); return 1})
 return {store:{$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient,calls,values}
}
const row = {session_id:'cs_one',promotion_code:'promo_full',coupon:'coupon_full',subtotal_cents:6900,discount_cents:6900,currency:'usd'}

it('binds zero-total evidence only to the exact persisted order+session, never as a PaymentIntent',async()=>{
 const t=tx([row])
 await bindZeroTotalSettlement(t.store,input)
 expect(t.calls[0]).toContain('pg_advisory_xact_lock')
 expect(t.calls[1]).toContain('INSERT INTO ot_zero_total_settlement')
 expect(t.calls[1]).toContain('FROM ot_order WHERE id = ? AND "stripeSessionId" = ? AND "checkoutAmountCents" = ? AND "checkoutCurrency" = ? AND "checkoutDiscountPromotionCodeId" = ?')
 expect(t.calls[1]).toContain('ON CONFLICT (order_id) DO NOTHING')
 expect(t.calls.join('\n')).not.toContain('ot_payment_binding')
 expect(t.values.flat()).not.toContainEqual(expect.stringMatching(/^pi_/))
})
it.each([
 {rows:[]},
 {rows:[{...row,session_id:'cs_other'}]},
 {rows:[{...row,promotion_code:'promo_other'}]},
 {rows:[{...row,subtotal_cents:5000}]},
])('rejects missing/mismatched durable zero-total evidence %j',async ({rows})=>{
 await expect(bindZeroTotalSettlement(tx(rows).store,input)).rejects.toThrow('mismatch')
})
it.each([
 {discountCents:6800},{subtotalCents:0,discountCents:0},{sessionId:'pi_fake'},{promotionCodeId:'coupon_x'},{currency:''},
])('refuses non-full or malformed evidence without writes %j',async (bad)=>{
 const t=tx([row])
 await expect(bindZeroTotalSettlement(t.store,{...input,...bad})).rejects.toThrow()
 expect(t.calls).toEqual([])
})
it.each([[false],[true]])('payment authority (neutral=%s) accepts PI binding OR exact zero-total settlement, both reversal-guarded',(neutral)=>{
 const sql=trustedPaymentAuthority('o',neutral).strings.join('?')
 expect(sql).toContain("payment_intent LIKE 'pi_%'")
 expect(sql).toContain(neutral ? '"ot_neutral_runtime_zero_total_settlement"' : '"ot_zero_total_settlement"')
 expect(sql).toContain('z.session_id = "o"."stripeSessionId"')
 expect(sql).toContain('z.discount_cents = z.subtotal_cents')
 expect(sql).toContain('"o"."settledAmountCents" = 0')
 expect(sql).toContain('"o"."checkoutAmountCents" = z.subtotal_cents')
 expect(sql).toContain('settlement_reversal" r')
})
it('ships a local additive migration with the zero-total ledger and neutral view',()=>{
 const dir=join(process.cwd(),'prisma/migrations')
 const m=readdirSync(dir).find(d=>d.endsWith('_ot_zero_total_settlement'))
 expect(m).toBeDefined()
 const sql=readFileSync(join(dir,m!,'migration.sql'),'utf8')
 expect(sql).toContain('ADD COLUMN "checkoutDiscountPromotionCodeId" TEXT')
 expect(sql).toContain('CREATE TABLE ot_zero_total_settlement')
 expect(sql).toContain('CHECK (discount_cents = subtotal_cents AND subtotal_cents > 0)')
 const table=sql.slice(sql.indexOf('CREATE TABLE ot_zero_total_settlement'),sql.indexOf(');',sql.indexOf('CREATE TABLE ot_zero_total_settlement')))
 expect(table).not.toMatch(/payment_intent/)
 expect(sql).toContain('ot_settlement_evidence_immutable')
 expect(sql).toContain('CREATE VIEW "ot_neutral_runtime_zero_total_settlement"')
 const schema=readFileSync(join(process.cwd(),'prisma/schema.prisma'),'utf8')
 expect(schema).toContain('checkoutDiscountPromotionCodeId String?')
})

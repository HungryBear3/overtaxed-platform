/** @jest-environment node */
import {bindPayment, recordReversal, providerId} from '@/lib/checkout/ot-reversal'
import type {Prisma} from '@prisma/client'
function tx(rows: object[]) {
 const calls: string[]=[]
 const query=jest.fn(async (s:TemplateStringsArray)=> {const sql=s.join('?'); calls.push(sql); return sql.includes('advisory') ? [] : rows})
 const execute=jest.fn(async (s:TemplateStringsArray)=>{calls.push(s.join('?')); return 1})
 return {store:{$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient,calls,execute}
}
it('retains unmatched reversal before any binding; update joins only exact PI',async()=>{
 const t=tx([{payment_intent:'pi_one',event_type:'charge.refunded'}])
 await recordReversal(t.store,'evt_one','charge.refunded','pi_one')
 expect(t.calls[0]).toContain('pg_advisory_xact_lock'); expect(t.calls[0]).toContain('::text')
 expect(t.calls[1]).toContain('ON CONFLICT (event_id) DO NOTHING')
 expect(t.calls[3]).toContain('SELECT order_id FROM ot_payment_binding WHERE payment_intent')
})
it('does not admit reuse of event id with a different payment binding',async()=>{
 const t=tx([{payment_intent:'pi_other',event_type:'charge.refunded'}])
 await expect(recordReversal(t.store,'evt_one','charge.refunded','pi_one')).rejects.toThrow('mismatch')
 expect(t.execute).toHaveBeenCalledTimes(1)
})
it('does not admit reuse of event id with a different event type',async()=>{
 const t=tx([{payment_intent:'pi_one',event_type:'charge.dispute.created'}])
 await expect(recordReversal(t.store,'evt_one','charge.refunded','pi_one')).rejects.toThrow('mismatch')
})
it('binds only an exact persisted session and consumes earlier evidence',async()=>{
 const t=tx([{session_id:'cs_one',payment_intent:'pi_one'}])
 await bindPayment(t.store,'ord_one','cs_one','pi_one')
 expect(t.calls[1]).toContain('FROM ot_order WHERE id = ? AND "stripeSessionId" = ?')
 expect(t.calls[3]).toContain('EXISTS (SELECT 1 FROM ot_settlement_reversal')
})
it.each([{rows:[]},{rows:[{session_id:'cs_other',payment_intent:'pi_one'}]},{rows:[{session_id:'cs_one',payment_intent:'pi_other'}]}])('rejects missing/mismatched durable binding %j',async ({rows})=>{
 const t=tx(rows)
 await expect(bindPayment(t.store,'ord_one','cs_one','pi_one')).rejects.toThrow('mismatch')
})
it('fails missing PaymentIntent without writes',async()=>{
 const t=tx([])
 await expect(bindPayment(t.store,'ord','cs','')).rejects.toThrow('Missing')
 expect(t.calls).toEqual([])
})
it('extracts expanded IDs but never metadata',()=>{
 expect(providerId({id:'pi_one'})).toBe('pi_one')
 expect(providerId({metadata:{id:'pi_one'}})).toBeNull()
})

/** @jest-environment node */
const record = jest.fn(async () => {})
const retrieve = jest.fn()
const claim = jest.fn()
const construct = jest.fn((body: string, sig: string) => {
  if (sig !== 'valid') throw new Error('bad signature')
  return JSON.parse(body)
})
jest.mock('@/lib/stripe/client', () => ({stripe: {webhooks: {constructEvent: (...a: [string,string]) => construct(...a)}, charges: {retrieve: (...a: unknown[]) => retrieve(...a)}}}))
jest.mock('@/lib/db', () => ({prisma: {$transaction: async (fn: (tx: object) => Promise<unknown>) => fn({}), stripeEvent: {create: (...a: unknown[]) => claim(...a)}}}))
jest.mock('@/lib/checkout/ot-reversal', () => ({...jest.requireActual('@/lib/checkout/ot-reversal'), recordReversal: (...a: unknown[]) => record(...a as [])}))
jest.mock('@/lib/packet/generate-and-deliver', () => ({generatePacketForInvoice: jest.fn()}))
jest.mock('@/lib/email/send', () => ({sendNewOrderAlert: jest.fn(), sendOrderConfirmation: jest.fn()}))
jest.mock('@/lib/fulfillment-runtime/kickoff', () => ({kickOffT2FulfillmentEvidence: jest.fn(), t2FulfillmentEvidenceWritesEnabled: () => false}))
jest.mock('@/lib/fulfillment-runtime/t2-artifact-scheduling', () => ({scheduleT2ArtifactOrchestration: jest.fn()}))
import {POST} from '@/app/api/billing/webhook/route'
import {NextRequest} from 'next/server'
function req(type: string, data: object, sig='valid') {
 return new NextRequest('https://example.test/api/billing/webhook', {method:'POST', headers:{'stripe-signature':sig}, body:JSON.stringify({id:'evt_reversal', type, data:{object:data}})})
}
beforeEach(() => {jest.clearAllMocks(); process.env.STRIPE_WEBHOOK_SECRET='synthetic'; record.mockResolvedValue(); retrieve.mockResolvedValue({payment_intent:'pi_bound'})})
it.each(['charge.refunded','refund.created','refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'])('ingests %s before generic event claim, without automatic restoration', async type => {
 expect((await POST(req(type,{payment_intent:'pi_bound',status:'won',amount:1}))).status).toBe(200)
 expect(record).toHaveBeenCalledWith({},'evt_reversal',type,'pi_bound')
 expect(claim).not.toHaveBeenCalled()
})
it('rejects unverified input before writes',async()=>{
 expect((await POST(req('charge.refunded',{payment_intent:'pi_bound'},'bad'))).status).toBe(400)
 expect(record).not.toHaveBeenCalled()
})
it('resolves a signed charge through provider, never metadata',async()=>{
 expect((await POST(req('charge.dispute.created',{charge:'ch_trusted', metadata:{payment_intent:'pi_attacker'}}))).status).toBe(200)
 expect(retrieve).toHaveBeenCalledWith('ch_trusted')
 expect(record).toHaveBeenCalledWith({},'evt_reversal','charge.dispute.created','pi_bound')
})
it('missing association remains retryable',async()=>{
 expect((await POST(req('refund.updated',{metadata:{payment_intent:'pi_attacker'}}))).status).toBe(500)
 expect(record).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled()
})
it('failed mutation is retried without a consumed claim',async()=>{
 record.mockRejectedValueOnce(new Error('rollback'))
 const make=()=>req('charge.refunded',{payment_intent:'pi_bound'})
 expect((await POST(make())).status).toBe(500)
 expect((await POST(make())).status).toBe(200)
 expect(record).toHaveBeenCalledTimes(2); expect(claim).not.toHaveBeenCalled()
})

/** @jest-environment node */
import {readFileSync} from 'fs'
import {join} from 'path'
import * as authority from '@/lib/fulfillment-runtime/payment-authority'
import {decideNeutralCustomerPromotion, type PromotionSnapshot} from '@/lib/fulfillment/neutral-customer-promotion'

type BindingInput = (r:{orderId:string;sessionId:string|null;paymentIntent:string|null;zeroTotalPromotionCode?:string|null})=>string|null
const bindingInput = (authority as unknown as {neutralPaymentBindingInput?: BindingInput}).neutralPaymentBindingInput as BindingInput

it('keeps the PaymentIntent binding digest input byte-identical and gives zero-total a distinct non-PI namespace', () => {
  expect(bindingInput({orderId:'o',sessionId:'cs_1',paymentIntent:'pi_1'})).toBe('neutral-payment/v1\0o\0cs_1\0pi_1')
  expect(bindingInput({orderId:'o',sessionId:'cs_1',paymentIntent:null,zeroTotalPromotionCode:'promo_1'})).toBe('neutral-zero-total/v1\0o\0cs_1\0promo_1')
  expect(bindingInput({orderId:'o',sessionId:'cs_1',paymentIntent:null,zeroTotalPromotionCode:null})).toBeNull()
  expect(bindingInput({orderId:'o',sessionId:null,paymentIntent:null,zeroTotalPromotionCode:'promo_1'})).toBeNull()
})

const snap = (o: Partial<PromotionSnapshot> & {zeroTotalSettlement?: string|null} = {}) => ({
  orderStatus:'PAID',paymentIntent:null,reversalIntent:null,propertyPin:'1',reservationStatus:'PROMOTED',bundleSha256:'b',customerZipSha256:null,manifestSha256:'m',
  dataEvidenceSha256:'d',deadlineEvidenceSha256:'e',policyVersion:'p',propertyFingerprint:'f',supersededBySha256:null,qaStatus:'APPROVED',qaArtifactSha256:'b',
  qaPolicyVersion:'p',qaPropertyFingerprint:'f',qaEvidenceDigestSha256:'x',currentEvidenceDigestSha256:'x',qaPaymentBindingSha256:'y',currentPaymentBindingSha256:'y',
  zeroTotalSettlement:'promo_1',...o,
}) as PromotionSnapshot

it('customer promotion admits exact zero-total settlement and still refuses no authority, reversal, or drift', () => {
  expect(decideNeutralCustomerPromotion(snap(),snap()).ok).toBe(true)
  expect(decideNeutralCustomerPromotion(snap({zeroTotalSettlement:null}),snap({zeroTotalSettlement:null})).ok).toBe(false)
  expect(decideNeutralCustomerPromotion(snap({paymentIntent:'pi_1',zeroTotalSettlement:null}),snap({paymentIntent:'pi_1',zeroTotalSettlement:null})).ok).toBe(true)
  expect(decideNeutralCustomerPromotion(snap({paymentIntent:'pi_1',zeroTotalSettlement:null}),snap({paymentIntent:'pi_1',reversalIntent:'pi_1',zeroTotalSettlement:null})).ok).toBe(false)
  expect(decideNeutralCustomerPromotion(snap(),snap({zeroTotalSettlement:'promo_2'}))).toEqual({ok:false,blocker:'AUTHORITY_DRIFT'})
})

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
it.each([
  'lib/fulfillment-runtime/neutral-qa-store.ts',
  'lib/fulfillment-runtime/neutral-customer-promotion.ts',
  'lib/fulfillment-runtime/neutral-operator-queue.ts',
  'lib/fulfillment-runtime/neutral-operator-read-store.ts',
])('%s reads zero-total settlement authority through the shared exact join', (p) => {
  const s = src(p)
  expect(s).toContain('neutralZeroTotalSettlementJoin(')
  expect(s).toContain('"zeroTotalPromotionCode"')
  expect(s).not.toMatch(/!!row\.paymentIntent(?!\s*\|\|)/)
})
it('QA approval and provider-callback approval gate on the shared payment authority, not PI-only joins', () => {
  const qa = src('lib/fulfillment-runtime/neutral-qa-store.ts')
  expect(qa).toContain('trustedPaymentAuthority("o", true)')
  expect(qa).toMatch(/neutralPaymentBindingInput\(/)
  const cb = src('lib/fulfillment-runtime/provider-callback-store.ts')
  expect(cb).toContain('trustedPaymentAuthority("o")')
})

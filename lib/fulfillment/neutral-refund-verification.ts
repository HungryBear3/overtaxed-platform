export type ProviderRefund={id:string;payment_intent?:string|{id?:string}|null;amount?:number;currency?:string|null;status?:string|null}

function paymentIntent(value:ProviderRefund["payment_intent"]){return typeof value==="string"?value:value&&typeof value==="object"&&typeof value.id==="string"?value.id:null}

export function verifyProviderRefund(refund:ProviderRefund,expected:{receiptId:string;paymentIntent:string}){
  if(refund.id!==expected.receiptId)return {ok:false as const,reason:"RECEIPT_ID_MISMATCH"}
  if(paymentIntent(refund.payment_intent)!==expected.paymentIntent)return {ok:false as const,reason:"PAYMENT_INTENT_MISMATCH"}
  if(refund.amount!==6900)return {ok:false as const,reason:"AMOUNT_MISMATCH"}
  if(typeof refund.currency!=="string"||refund.currency.toLowerCase()!=="usd")return {ok:false as const,reason:"CURRENCY_MISMATCH"}
  if(refund.status!=="succeeded")return {ok:false as const,reason:"PROVIDER_STATUS_NOT_SUCCEEDED"}
  return {ok:true as const}
}

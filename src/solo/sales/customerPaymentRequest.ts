export type CustomerPaymentRequest={amountMinor:number;currency:string;state:string;url:string|null;remainingMinor:number;expiresAt:number|null};
const states=['prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','settled','failed','expired','cancelled'];
/** Read-only presentation of the server's existing invoice/bearer projection. */
export function readCustomerPaymentRequest(value:unknown,now=Date.now()):CustomerPaymentRequest|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const root=value as Record<string,unknown>, request=root.payment_request;
 if(!Number.isSafeInteger(root.remaining_cents)||Number(root.remaining_cents)<0||!request||typeof request!=='object'||Array.isArray(request))return null;
 const row=request as Record<string,unknown>;
 if(!Number.isSafeInteger(row.amount_minor)||Number(row.amount_minor)<=0||typeof row.currency!=='string'||!/^[a-z]{3}$/.test(row.currency)||typeof row.state!=='string'||!states.includes(row.state))return null;
 let url:string|null=null;
 if(row.state==='customer_action_required'&&Number(root.remaining_cents)>=Number(row.amount_minor)&&typeof row.expires_at==='string'&&Date.parse(row.expires_at)>now&&typeof row.provider_url==='string'){
  try{const candidate=new URL(row.provider_url);if(candidate.protocol==='https:'&&candidate.hostname==='checkout.stripe.com'&&!candidate.username&&!candidate.password&&!candidate.port)url=candidate.href;}catch{/* unavailable hosted surface */}
 }
 return {amountMinor:Number(row.amount_minor),currency:row.currency,state:row.state,url,remainingMinor:Number(root.remaining_cents),expiresAt:typeof row.expires_at==='string'&&Number.isFinite(Date.parse(row.expires_at))?Date.parse(row.expires_at):null};
}
export function customerPaymentRequestCopy(state:string):string{
 switch(state){
 case 'customer_action_required':return 'Payment requested';
 case 'prepared':return 'Payment request is being prepared';
 case 'dispatching':return 'Payment request is being created';
 case 'provider_accepted':return 'The provider accepted the request. Payment has not been confirmed yet';
 case 'outcome_unknown':return "We couldn't confirm the payment yet. The business is checking with the payment provider.";
 case 'settled':return 'Payment confirmed';
 case 'failed':return 'Payment could not be completed';
 case 'expired':return 'This payment request has expired';
 case 'cancelled':return 'This payment request was cancelled';
 default:return 'Payment status unavailable';
 }
}

export function formatPaymentMinor(amount:number,currency:string):string{
 const formatter=new Intl.NumberFormat(undefined,{style:'currency',currency});
 const exponent=formatter.resolvedOptions().maximumFractionDigits;
 return formatter.format(amount/(10**exponent));
}

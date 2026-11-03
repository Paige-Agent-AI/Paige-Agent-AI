import {verifyStripeWebhook} from '../stripe-webhook-signature.ts';
import type {SalesPaymentAdmin} from './database-port.ts';
import {routeVerifiedSalesStripeEvent,registerVerifiedSalesStripeAdjustmentEvent} from './stripe-event-adapter.ts';

/** The same canonical verifier; a distinct Sales-only secret cannot fall through
 * into platform subscription/fulfillment handling. No provider request is made. */
export async function verifySalesStripeIngress(body:string,signature:string,legacy:unknown,v2:unknown,
 legacySecret:string,v2Secret:string,salesSecret:string,cryptoProvider:unknown):Promise<{
 event:unknown;account:'legacy'|'v2'|'sales';
}|null> {
 const original=await verifyStripeWebhook(body,signature,legacy,v2,legacySecret,v2Secret,cryptoProvider);
 if(original)return original;
 if(!salesSecret)return null;
 const separate=await verifyStripeWebhook(body,signature,legacy,legacy,salesSecret,'',cryptoProvider);
 return separate?{event:separate.event,account:'sales'}:null;
}

/** Signed events are only signals. Original native registration resolves the
 * merchant, immutable payment and durable work; the original GET-only reader
 * supplies financial evidence later. No event amount/status becomes a balance. */
export async function routeSalesStripeIngress(admin:SalesPaymentAdmin,event:unknown,
 verifiedPlatform:'legacy'|'v2',secret:string,observationsEnabled:boolean,readbackSecret?:(environment:'test'|'live')=>string):Promise<{
 handled:boolean;status:number;code:string;
}> {
 if(observationsEnabled&&verifiedPlatform==='legacy'&&event&&typeof event==='object'&&!Array.isArray(event)){
  const value=event as Record<string,unknown>;
  // Platform refunds without a connected account retain their original route.
  if(typeof value.account==='string'&&typeof value.livemode==='boolean'){
   const registered=await registerVerifiedSalesStripeAdjustmentEvent(admin,event,verifiedPlatform,value.livemode?'live':'test');
   if(registered.handled)return registered;
  }
 }
 // Called only AFTER canonical signature verification. The original adapter
 // still resolves native operation/customer/merchant scope before provider GET.
 // This selector is never used by platform Billing or any provider POST.
 const value=event&&typeof event==='object'&&!Array.isArray(event)?event as Record<string,unknown>:null;
 const selected=readbackSecret&&typeof value?.livemode==='boolean'?readbackSecret(value.livemode?'live':'test'):secret;
 return routeVerifiedSalesStripeEvent(admin,event,verifiedPlatform,selected);
}

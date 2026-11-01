import {salesStripeSecret,salesStripeObservationsEnabled} from '../_shared/sales-payments/stripe-configuration.ts';
import {adminClient,isAuthorizedInternalCaller,json} from '../_shared/systems-check-http.ts';
import type {SalesPaymentAdmin} from '../_shared/sales-payments/database-port.ts';
import {salesStripeClient} from '../_shared/sales-payments/stripe-client.ts';
import {reconcileSalesPaymentWork,reconcileSalesProviderObservationWork} from '../_shared/sales-payments/reconciliation-work.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return json(405,{error:'POST_ONLY'});
 const admin=adminClient();
 if(!await isAuthorizedInternalCaller(req,admin))return json(401,{error:'UNAUTHORIZED'});
 // This tick takes no caller-defined tenant, amount, merchant, or work identity.
 try{
  const client=salesStripeClient(salesStripeSecret(name=>Deno.env.get(name))),store=admin as unknown as SalesPaymentAdmin;
  if(!salesStripeObservationsEnabled(name=>Deno.env.get(name))){
   const counts=await reconcileSalesPaymentWork(store,client);
   return json(counts.unverified?503:200,{ok:counts.unverified===0,...counts});
  }
  const [counts,observations]=await Promise.all([reconcileSalesPaymentWork(store,client,3,true),reconcileSalesProviderObservationWork(store,client)]);
  const verified=counts.unverified===0&&observations.unverified===0&&observations.verificationPending===0;
  return json(verified?200:503,{ok:verified,...counts,provider_observations:observations});
 }
 catch{return json(503,{ok:false,error:'PAYMENT_RECONCILIATION_UNAVAILABLE'});}
});

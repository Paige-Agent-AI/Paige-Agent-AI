import {adminClient,isAuthorizedInternalCaller,json} from '../_shared/systems-check-http.ts';
import type {SalesPaymentAdmin} from '../_shared/sales-payments/database-port.ts';
import {salesStripeClient} from '../_shared/sales-payments/stripe-client.ts';
import {reconcileSalesPaymentWork} from '../_shared/sales-payments/reconciliation-work.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return json(405,{error:'POST_ONLY'});
 const admin=adminClient();
 if(!await isAuthorizedInternalCaller(req,admin))return json(401,{error:'UNAUTHORIZED'});
 // This tick takes no caller-defined tenant, amount, merchant, or work identity.
 try{const counts=await reconcileSalesPaymentWork(admin as unknown as SalesPaymentAdmin,salesStripeClient(Deno.env.get('STRIPE_SECRET_KEY')??''));return json(counts.unverified?503:200,{ok:counts.unverified===0,...counts});}
 catch{return json(503,{ok:false,error:'PAYMENT_RECONCILIATION_UNAVAILABLE'});}
});

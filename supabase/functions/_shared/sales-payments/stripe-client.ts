import Stripe from 'https://esm.sh/stripe@17.5.0?target=deno';
import type {StripeHostedClient} from './stripe-hosted.ts';
import type {StripeAccountReader} from './merchant.ts';

/** Same pinned SDK/secret used by tenant-stripe-connect. Never exposed to callers. No separate
 * provider gateway, fee policy or commercial records; the domain adapter supplies account scope. */
export function salesStripeClient(secret:string):StripeHostedClient & StripeAccountReader {
 const environment=secret.startsWith('sk_test_')?'test':secret.startsWith('sk_live_')?'live':null;
 if(!environment)throw new Error('STRIPE_CONFIGURATION_UNAVAILABLE');
 const stripe=new Stripe(secret,{apiVersion:'2024-11-20.acacia',httpClient:Stripe.createFetchHttpClient(),
  maxNetworkRetries:0,timeout:15000});
 return {
  environment,
  retrieveAccount:accountId=>stripe.accounts.retrieve(accountId),
  createSession:(params,options)=>stripe.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams,options),
  retrieveSession:(id,params,options)=>stripe.checkout.sessions.retrieve(id,params,options),
  listSessions:(params,options)=>stripe.checkout.sessions.list(params,options),
 };
}

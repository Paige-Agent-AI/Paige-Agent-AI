/** Sales reuses the original Stripe adapter. An optional Sales namespace separates
 * commercial QA/configuration from platform subscription credentials. No caller
 * selects credentials; an explicitly empty value disables Sales instead of
 * falling through to a different environment. Never expose or log the result. */
export function salesStripeSecret(read:(name:string)=>string|undefined):string {
 return read('SALES_STRIPE_SECRET_KEY')??read('STRIPE_SECRET_KEY')??'';
}
/** Internal GET-only recovery. Environment comes from an original scoped native
 * record or verified signed event, never a caller. NEVER use for dispatch.
 * Empty/invalid Sales configuration still disables Sales provider access. */
export function salesStripeReadbackSecret(read:(name:string)=>string|undefined,environment:'test'|'live'):string {
 const configured=salesStripeSecret(read);
 const mode=(key:string)=>/^(?:sk|rk)_(test|live)_/.exec(key)?.[1];
 if(!mode(configured))return '';
 if(mode(configured)===environment)return configured;
 const original=read('STRIPE_SECRET_KEY')??'';
 return mode(original)===environment?original:'';
}
/** Deployment readiness only. Existing signature, native scope, Work, permission
 * and provider guards remain required; this value grants no business authority. */
export function salesStripeObservationsEnabled(read:(name:string)=>string|undefined):boolean {
 return read('SALES_STRIPE_OBSERVATIONS_ENABLED')==='true';
}

/** Sales reuses the original Stripe adapter. An optional Sales namespace separates
 * commercial QA/configuration from platform subscription credentials. No caller
 * selects credentials; an explicitly empty value disables Sales instead of
 * falling through to a different environment. Never expose or log the result. */
export function salesStripeSecret(read:(name:string)=>string|undefined):string {
 return read('SALES_STRIPE_SECRET_KEY')??read('STRIPE_SECRET_KEY')??'';
}
/** Deployment readiness only. Existing signature, native scope, Work, permission
 * and provider guards remain required; this value grants no business authority. */
export function salesStripeObservationsEnabled(read:(name:string)=>string|undefined):boolean {
 return read('SALES_STRIPE_OBSERVATIONS_ENABLED')==='true';
}

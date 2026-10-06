/** Narrow structural port permits the existing pinned SDK versions at the invoice and webhook
 * doors. Domain code treats returned JSON as unknown and validates it; no SDK version upgrade. */
export type PaymentDatabaseResult<T=unknown>={data:T;error:{code?:string}|null};
interface PaymentQuery {
 eq(column:string,value:unknown):PaymentQuery;
 maybeSingle():PromiseLike<PaymentDatabaseResult<Record<string,unknown>|null>>;
}
export interface SalesPaymentAdmin {
 from(table:string):{select(columns:string):PaymentQuery};
 rpc(name:string,args:Record<string,unknown>):PromiseLike<PaymentDatabaseResult>;
}

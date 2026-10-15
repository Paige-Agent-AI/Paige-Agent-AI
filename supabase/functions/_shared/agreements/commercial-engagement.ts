import {date,object,only} from '../sales-collections/primitives.ts';
export type CommercialEngagement={starts_on:string;ends_on:string|null;price_basis:'catalog'|'negotiated'};
/** Explicit canonical service facts. Collections remains the calendar contract. */
export function parseCommercialEngagement(value:unknown):CommercialEngagement{
 if(!object(value))throw Error('COMMERCIAL_ENGAGEMENT_REQUIRED');
 only(value,['starts_on','ends_on','price_basis']);
 if(!Object.prototype.hasOwnProperty.call(value,'ends_on')||(value.price_basis!=='catalog'&&value.price_basis!=='negotiated'))throw Error('COMMERCIAL_ENGAGEMENT_REQUIRED');
 const start=date(value.starts_on),end=value.ends_on===null?null:date(value.ends_on);
 if(end!==null&&end<start)throw Error('COMMERCIAL_ENGAGEMENT_REQUIRED');
 return {starts_on:start,ends_on:end,price_basis:value.price_basis};
}

import {UUID} from '../sales-invoice-command/contract.ts';
export type CatalogPriceFact={price_id:string;product_id:string;product_name:string;unit_minor:number;currency:'usd';kind:'one_time'|'recurring';billing_interval:'one_time'|'month';interval_count:number|null;installments_total:number|null;active:true;product_status:'active'};
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const keys=['price_id','product_id','product_name','unit_minor','currency','kind','billing_interval','interval_count','installments_total','active','product_status'];
/** Server-resolved financial/source facts only. No provider IDs, guessed totals or new calculator. */
export function validateCatalogPriceFacts(draft:Record<string,unknown>,value:unknown):CatalogPriceFact[]{
 const ids=[...new Set((draft.items as {price_id:string|null}[]).flatMap(v=>v.price_id===null?[]:[v.price_id.toLowerCase()]))].sort();
 if(!Array.isArray(value)||value.length!==ids.length||value.length<1||value.length>50)throw new TypeError('CATALOG_PRICE_FACTS_INVALID');
 const facts:CatalogPriceFact[]=value.map((v):CatalogPriceFact=>{
  if(!object(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))
   ||typeof v.price_id!=='string'||!UUID.test(v.price_id)||typeof v.product_id!=='string'||!UUID.test(v.product_id)
   ||typeof v.product_name!=='string'||!v.product_name.trim()||v.product_name.length>200
   ||!Number.isSafeInteger(v.unit_minor)||Number(v.unit_minor)<1||Number(v.unit_minor)>2147483647
   ||v.currency!=='usd'||v.active!==true||v.product_status!=='active'
   ||(draft.kind==='recurring'?(v.kind!=='recurring'||v.billing_interval!=='month'||v.interval_count!==1)
     :(v.kind!=='one_time'||v.billing_interval!=='one_time'))
   ||!(v.interval_count===null||Number.isSafeInteger(v.interval_count)&&Number(v.interval_count)>0)
   ||v.installments_total!==null)throw new TypeError('CATALOG_PRICE_FACTS_INVALID');
  return {price_id:v.price_id.toLowerCase(),product_id:v.product_id.toLowerCase(),product_name:v.product_name,unit_minor:Number(v.unit_minor),currency:'usd',kind:v.kind as CatalogPriceFact['kind'],billing_interval:v.billing_interval as CatalogPriceFact['billing_interval'],interval_count:v.interval_count as number|null,installments_total:null,active:true,product_status:'active'};
 }).sort((a,b)=>a.price_id.localeCompare(b.price_id));
 if(facts.some((v,i)=>v.price_id!==ids[i]))throw new TypeError('CATALOG_PRICE_FACTS_INVALID');
 return facts;
}

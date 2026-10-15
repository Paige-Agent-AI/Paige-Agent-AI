import type {CollectionKind} from '../../../../supabase/functions/_shared/sales-collections/contract';
import {CreditCard,Layers,Repeat,Split,Flag,SlidersHorizontal} from 'lucide-react';
export const PLAN_ICONS={full:CreditCard,installment:Layers,recurring:Repeat,deposit:Split,milestone:Flag,custom:SlidersHorizontal};
export const PLAN_KINDS:{key:CollectionKind;label:string}[]=[{key:'full',label:'Full payment'},{key:'installment',label:'Installments'},{key:'recurring',label:'Recurring'},{key:'deposit',label:'Deposit + balance'},{key:'milestone',label:'Milestones'},{key:'custom',label:'Custom'}];
export function currencyDigits(currency:string):number|null{
 const code=currency.toUpperCase(),supported=(Intl as unknown as {supportedValuesOf?(key:string):string[]}).supportedValuesOf;
 if(!/^[A-Z]{3}$/.test(code)||!supported||!supported.call(Intl,'currency').includes(code))return null;
 try{const digits=new Intl.NumberFormat(undefined,{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits;return typeof digits==='number'?digits:null}catch{return null}
}
export function minorInput(value:string,currency:string,allowZero=false):number|null{
 const digits=currencyDigits(currency);if(digits===null)return null;const pattern=digits===0?/^\d+$/:new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);if(!pattern.test(value))return null;
 const [whole,fraction='']=value.split('.'),scale=10**digits,total=Number(whole)*scale+Number(fraction.padEnd(digits,'0'));return Number.isSafeInteger(total)&&total>=(allowZero?0:1)?total:null;
}
export const collectionMoney=(n:number,currency='usd')=>{const digits=currencyDigits(currency);if(digits===null)return `Amount unavailable (${currency.toUpperCase()})`;return new Intl.NumberFormat(undefined,{style:'currency',currency:currency.toUpperCase()}).format(n/10**digits)};

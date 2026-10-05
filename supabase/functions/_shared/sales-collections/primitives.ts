export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MINOR=2147483647;
export const MAX_SCHEDULE=240;
export const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function invalid():never{throw new TypeError('COLLECTION_CONTRACT_INVALID');}
export function integer(value:unknown,min=0,max=MAX_MINOR):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)return invalid();return value;}
export function date(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'9999-12-31')return invalid();const parsed=new Date(value+'T00:00:00Z');if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value)return invalid();return value;}
export function text(value:unknown,max:number,required=false):string|null{if(value===null||value===undefined)return required?invalid():null;if(typeof value!=='string'||value.length>max||(required&&!value.trim()))return invalid();return value;}
export function only(value:Record<string,unknown>,keys:string[]):void{if(Object.keys(value).some(key=>!keys.includes(key)))invalid();}

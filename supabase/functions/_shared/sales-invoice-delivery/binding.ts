export const INVOICE_LINK_MARKER = '{{PAIGE_INVOICE_LINK}}';
export interface DeliveryBinding {
 operation_id:string;message_id:string;tenant_id:string;invoice_id:string;client_id:string;actor_user_id:string;
 issued_snapshot_version:number;expected_lifecycle_version?:number;document_digest:string;content_digest:string;recipient:string;connector_id:string|null;channel?:'email'|'sms';
 subject:string;body_html:string;state:'prepared';eligible:true;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[0-9a-f]{64}$/;
export function parseDeliveryBinding(value:unknown,tenantId:string,messageId:string):DeliveryBinding|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(v.eligible!==true||v.state!=='prepared'||v.tenant_id!==tenantId||v.message_id!==messageId)return null;
 for(const key of ['operation_id','message_id','tenant_id','invoice_id','client_id','actor_user_id'])if(typeof v[key]!=='string'||!uuid.test(v[key] as string))return null;
 if(!Number.isSafeInteger(v.issued_snapshot_version)||(v.issued_snapshot_version as number)<1)return null;
 if(v.expected_lifecycle_version!==undefined&&(!Number.isSafeInteger(v.expected_lifecycle_version)||(v.expected_lifecycle_version as number)<1))return null;
 if(typeof v.document_digest!=='string'||!digest.test(v.document_digest)||typeof v.content_digest!=='string'||!digest.test(v.content_digest))return null;
 const channel=v.channel??'email';
 if(channel!=='email'&&channel!=='sms')return null;
 if(channel==='email'&&(typeof v.connector_id!=='string'||!uuid.test(v.connector_id)))return null;
 if(channel==='sms'&&v.connector_id!==null)return null;
 if(typeof v.recipient!=='string'||v.recipient.length>320||!(channel==='email'?/^\S+@\S+\.\S+$/:/^\+[1-9]\d{6,14}$/).test(v.recipient)||/[\r\n]/.test(v.recipient))return null;
 if(typeof v.subject!=='string'||!v.subject.trim()||v.subject.length>200||/[\r\n]/.test(v.subject))return null;
 if(typeof v.body_html!=='string'||v.body_html.length>100000||(channel==='sms'&&v.body_html.length>1400)||v.body_html.split(INVOICE_LINK_MARKER).length!==2)return null;
 return Object.fromEntries(['operation_id','message_id','tenant_id','invoice_id','client_id','actor_user_id','connector_id','issued_snapshot_version','expected_lifecycle_version','document_digest','content_digest','recipient','subject','body_html','state','eligible','channel'].map(k=>[k,v[k]])) as unknown as DeliveryBinding;
}
export function invoicePublicOriginReady(origin:string):boolean {
 try { const base=new URL(origin); return base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/'; } catch { return false; }
}
/** No token belongs in durable message HTML. Only provider input receives this copy. */
export function renderTransientInvoiceLink(binding:Pick<DeliveryBinding,'body_html'|'invoice_id'>,origin:string,token:string):string {
 const base=new URL(origin);
 if(!invoicePublicOriginReady(origin)||!digest.test(token))throw new TypeError('INVOICE_LINK_INVALID');
 const link=`${base.origin}/invoice?token=${token}`;
 return binding.body_html.replace(INVOICE_LINK_MARKER,link.split('&').join('&amp;'));
}
export function requireImmediateInvoiceDelivery(scheduledFor:unknown,outcome:string):boolean {return scheduledFor==null&&outcome==='proceed';}

export function renderTransientInvoiceText(binding:Pick<DeliveryBinding,'body_html'>,origin:string,token:string):string {if(!invoicePublicOriginReady(origin)||!digest.test(token))throw new TypeError('INVOICE_LINK_INVALID');return binding.body_html.replace(INVOICE_LINK_MARKER,origin+'/invoice?token='+token);}

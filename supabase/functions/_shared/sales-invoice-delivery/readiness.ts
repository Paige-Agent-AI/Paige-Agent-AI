import { emailSenderReadiness, type EmailSenderFacts } from '../comms-email/readiness.ts';
// The email-sender check has ONE home (_shared/comms-email/readiness.ts); invoice delivery uses it unchanged.
export type InvoiceDeliveryChannel='email'|'sms'|'imessage';
export interface ReadinessFacts {
 channel:InvoiceDeliveryChannel; recipient:string|null; tenantMatches:boolean;
 sender?:EmailSenderFacts;
 resendConfigured:boolean;googleConfigured:boolean;
 sms?:{credentialsPresent:boolean;numberPresent:boolean;a2pApproved:boolean};
 preSend?:{proceed:boolean;outcome:string};
}
export type InvoiceDeliveryReadiness={eligible:boolean;state:'ready'|'needs_setup'|'held'|'unavailable';reason:string;provider_execution_verified:false};
/** No credentials, raw recipient, provider errors or body are exposed in readiness. */
export function invoiceDeliveryReadiness(f:ReadinessFacts):InvoiceDeliveryReadiness {
 const result=(state:InvoiceDeliveryReadiness['state'],reason:string):InvoiceDeliveryReadiness=>({eligible:state==='ready',state,reason,provider_execution_verified:false});
 if(f.channel==='imessage')return result('unavailable','IMESSAGE_UNAVAILABLE');
 if(!f.tenantMatches)return result('unavailable','WORKSPACE_CHANGED');
 if(!f.recipient||(f.channel==='email'?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recipient):!/^\+[1-9]\d{6,14}$/.test(f.recipient)))return result('needs_setup','INVOICE_RECIPIENT_MISSING');
 if(f.channel==='email') {
  const sender=emailSenderReadiness(f.sender,f);
  if(sender)return result(sender.state,sender.reason);
 }else {
  if(!f.sms?.credentialsPresent)return result('needs_setup','SMS_ACCOUNT_MISSING');
  if(!f.sms.numberPresent)return result('needs_setup','SMS_NUMBER_MISSING');
  if(!f.sms.a2pApproved)return result('needs_setup','SMS_A2P_NOT_APPROVED');
 }
 if(!f.preSend)return result('held','RECIPIENT_PREFERENCES_UNVERIFIED');
 if(!f.preSend.proceed||f.preSend.outcome!=='proceed')return result('held',['blocked_client_dnd','blocked_suppressed','blocked_no_consent','queued_tenant_dnd','queued_quiet_hours'].includes(f.preSend.outcome)?f.preSend.outcome.toUpperCase():'RECIPIENT_PREFERENCES_UNVERIFIED');
 return result('ready','READY_FOR_GOVERNED_REVIEW');
}

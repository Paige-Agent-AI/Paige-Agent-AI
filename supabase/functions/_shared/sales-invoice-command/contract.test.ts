import { parseSalesInvoiceCommand, SALES_INVOICE_ACTIONS } from './contract.ts';
const base={invoice_id:'00000000-0000-4000-8000-000000000001',expected_version:1};
function rejected(value:unknown){try{parseSalesInvoiceCommand(value);}catch{return;}throw new Error('unsafe command accepted');}
Deno.test('SMS uses the canonical invoice send policy and server tenant connection',()=>{
 const parsed=parseSalesInvoiceCommand({...base,action:'invoice.sms_send'});
 if(parsed.connector_id!==null||SALES_INVOICE_ACTIONS[parsed.action]!=='billing_send_invoice')throw new Error('wrong SMS seam');
 rejected({...base,action:'invoice.sms_send',connector_id:'00000000-0000-4000-8000-000000000002'});
 rejected({...base,action:'invoice.sms_send',to:'+15555555555'});
 rejected({...base,action:'invoice.sms_send',tenant_id:'00000000-0000-4000-8000-000000000002'});
});
Deno.test('Email retains an explicit eligible connector and immutable version',()=>{
 rejected({...base,action:'invoice.email_send'});
 rejected({...base,action:'invoice.email_send',connector_id:null});
 const parsed=parseSalesInvoiceCommand({...base,action:'invoice.email_send',connector_id:'00000000-0000-4000-8000-000000000002'});
 if(parsed.expected_version!==1)throw new Error('version lost');
 rejected({...base,expected_version:0,action:'invoice.sms_send'});
});

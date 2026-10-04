import {describe,it,expect} from 'vitest';
import {executeSalesInvoiceDelivery} from './adapter.ts';
const id='11111111-1111-4111-8111-111111111111';
const input={actorUserId:id,tenantId:id,operationId:id,command:{invoice_id:id,expected_version:2,connector_id:id},governance:{decision_receipt_recorded:true}};
describe('governed invoice delivery executor',()=>{
 it('never dispatches when invoice scope/version is invalid',async()=>{let sends=0;const result=await executeSalesInvoiceDelivery(input,{readInvoice:async()=>({tenant_id:'foreign'}),prepare:async()=>null,send:async()=>{sends++;return{}},readOutcome:async()=>null,hash:async()=> 'a'.repeat(64),stillCurrent:async()=>true});expect(result.outcome).toBe('refused');expect(sends).toBe(0)});
 it('does not redispatch unknown persisted operation',async()=>{let sends=0;const result=await executeSalesInvoiceDelivery(input,{readInvoice:async()=>null,prepare:async()=>null,send:async()=>{sends++;return{}},readOutcome:async()=>({outcome:'unknown'}),hash:async()=> 'a'.repeat(64),stillCurrent:async()=>true});expect(result.outcome).toBe('outcome_unknown');expect(sends).toBe(0)});
 it('returns unknown after network interruption and never fabricates delivery',async()=>{const result=await executeSalesInvoiceDelivery(input,{readInvoice:async()=>({id,tenant_id:id,version:2,issued_snapshot_version:2,status:'issued',remaining_cents:5000,amount_total_cents:10000,invoice_number:'INV-1',document_input_digest:'a'.repeat(64)}),prepare:async()=>({message_id:id,recipient:'billing@example.test',client_id:id}),send:async()=>{throw Error('network')},readOutcome:async()=>null,hash:async()=> 'a'.repeat(64),stillCurrent:async()=>true});expect(result.outcome).toBe('outcome_unknown')});
});

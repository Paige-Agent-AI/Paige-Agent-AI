import { describe,expect,it } from 'vitest';
import { parseCollectionCommand,parseCollectionImportRows } from './contract.ts';
const client='30000000-0000-0000-0000-000000000001';
const invoice={entity:'invoice',entity_id:'inv-1',client_id:client,invoice_id:null,invoice_number:'source-1',currency:'jpy',amount_cents:1000,due_date:'2026-10-31',memo:null};
const receipt={entity:'receipt',entity_id:'pay-1',invoice_entity_id:'inv-1',invoice_id:null,payment_id:null,currency:'jpy',amount_cents:400,method:'cash',received_at:'2026-10-01T12:00:00Z',reference:null};
describe('Collections import contract',()=>{
  it('binds imported history to existing customer and currency without a paid/verified field',()=>{
    const command=parseCollectionCommand({action:'collection.stage_import',source_account:'my-ledger',rows:[invoice,receipt]});
    expect(command).toMatchObject({action:'collection.stage_import',rows:[{currency:'jpy',amount_cents:1000},{currency:'jpy',amount_cents:400,received_at:'2026-10-01T12:00:00.000Z'}]});
  });
  it('requires canonical client and receipt allocation mapping',()=>{
    for(const row of [{...invoice,client_id:null},{...receipt,invoice_entity_id:null},{...receipt,invoice_id:client},{...receipt,received_at:'2026-02-30T12:00:00Z'}])expect(()=>parseCollectionImportRows([row])).toThrow();
  });
  it('rejects opening balances, fake verification, raw authority and unmatched currency types',()=>{
    for(const patch of [{opening_balance:500},{verified:true},{tenant_id:client},{amount_cents:'1000'},{currency:'USD'},{amount_cents:1.5}])expect(()=>parseCollectionImportRows([{...invoice,...patch}])).toThrow();
  });
  it('bounds staging and rejects duplicate source entities',()=>{
    expect(()=>parseCollectionImportRows([])).toThrow();expect(()=>parseCollectionImportRows(Array.from({length:201},(_,i)=>({...invoice,entity_id:String(i)})))).toThrow();expect(()=>parseCollectionImportRows([invoice,invoice])).toThrow();
  });
  it('pins commit to exact reviewed digest; no force-conflict or supplied governance',()=>{
    const command={action:'collection.commit_import',batch_id:client,expected_digest:'a'.repeat(64)};
    expect(parseCollectionCommand(command)).toEqual(command);
    for(const patch of [{expected_digest:'x'},{force:true},{approved_fingerprint:'a'.repeat(16)}])expect(()=>parseCollectionCommand({...command,...patch})).toThrow();
  });
  it('normalizes imported receipt commands and requires bounded exact correction identity',()=>{
    expect(parseCollectionCommand({action:'collection.record_receipt',invoice_id:client,expected_version:1,amount_cents:40,currency:'jpy',method:'cash',received_at:'2026-10-01T12:00:00Z'})).toMatchObject({currency:'jpy',received_at:'2026-10-01T12:00:00.000Z',reference:null,notes:null});
    expect(parseCollectionCommand({action:'collection.reverse_receipt',invoice_id:client,expected_version:2,payment_id:client,reason:'Correct'})).toMatchObject({action:'collection.reverse_receipt'});
    for(const reason of ['',null,' '.repeat(3),'x'.repeat(501)])expect(()=>parseCollectionCommand({action:'collection.reverse_receipt',invoice_id:client,expected_version:2,payment_id:client,reason})).toThrow();
  });
});

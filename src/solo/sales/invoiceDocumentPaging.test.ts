import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('supabase/functions/sales-invoice-document/index.ts','utf8');
const snippet=source.slice(source.indexOf('const record='),source.indexOf('const refuse='));
const collect=new Function(ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return collectLedger;')() as (client:{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>},name:string,args:Record<string,unknown>)=>Promise<Record<string,unknown>|null>;
const page=(n:number,more:boolean,count:number)=>({version:1,current_invoice_number:'INV-1',payment_ledger:{rows:Array.from({length:n},()=>({})),count,as_of:'2026-10-04'},has_more:more,next_cursor:more?{ordinal:n}:null});
describe('actual document edge bounded ledger collector',()=>{
 it('collects scoped pages with only server cursor and marks complete',async()=>{const calls:Record<string,unknown>[]=[];const pages=[page(100,true,101),page(1,false,101)];const result=await collect({rpc:async(name,args)=>{expect(name).toBe('read_public_sales_invoice_payment_ledger');calls.push(args);return {data:pages.shift(),error:null};}},'read_public_sales_invoice_payment_ledger',{_token_hash:'hash'});expect(result?.ledger_complete).toBe(true);expect(calls[1]).toEqual({_token_hash:'hash',_limit:100,_cursor:{ordinal:100}});});
 it('stops at 1000 and labels omitted records incomplete',async()=>{let calls=0;const result=await collect({rpc:async()=>{calls++;return{data:page(100,true,1001),error:null};}},'read_sales_invoice_payment_ledger',{});expect(calls).toBe(10);expect(result?.ledger_complete).toBe(false);expect((result?.payment_ledger as {rows:unknown[]}).rows).toHaveLength(1000);});
 it('refuses changed version, backend denial and oversized page',async()=>{let n=0;expect(await collect({rpc:async()=>({data:{...page(100,true,200),version:++n},error:null})},'x',{})).toBeNull();expect(await collect({rpc:async()=>({data:null,error:{code:'42501'}})},'x',{})).toBeNull();expect(await collect({rpc:async()=>({data:page(101,false,101),error:null})},'x',{})).toBeNull();});
});

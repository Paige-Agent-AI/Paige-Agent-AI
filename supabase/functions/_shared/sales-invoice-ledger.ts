const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export async function collectInvoiceLedger(client:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>},name:string,args:Record<string,unknown>):Promise<Record<string,unknown>|null>{
  let first:Record<string,unknown>|null=null;const rows:unknown[]=[];let cursor:unknown=null;
  for(let page=0;page<10;page++){
    const result=await client.rpc(name,{...args,_limit:100,_cursor:cursor});
    if(result.error||!record(result.data)||!record(result.data.payment_ledger)||!Array.isArray(result.data.payment_ledger.rows))return null;
    const data=result.data,ledger=data.payment_ledger as Record<string,unknown>;
    if(!first)first=data;
    else if(data.version!==first.version||data.current_invoice_number!==first.current_invoice_number||ledger.as_of!==(first.payment_ledger as Record<string,unknown>).as_of)return null;
    if((ledger.rows as unknown[]).length>100)return null;
    rows.push(...ledger.rows as unknown[]);
    if(data.has_more!==true){const complete=rows.length===ledger.count;return {...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete},ledger_complete:complete};}
    if(!data.next_cursor)return null;cursor=data.next_cursor;
  }
  return first?{...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete:false},ledger_complete:false}:null;
}

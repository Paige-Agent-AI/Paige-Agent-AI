const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
type LedgerQuery = PromiseLike<{data: unknown; error: unknown}> & {setHeader?: (name: string, value: string) => unknown};

// Compare native JSON facts, including financial representation and frozen document,
// without making object-property order significant or recalculating any money.
const jsonFacts = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function snapshot(data: Record<string, unknown>, ledger: Record<string, unknown>): string {
  const {payment_ledger: _ledger, has_more: _more, next_cursor: _cursor, ...invoice} = data;
  const {rows: _rows, complete: _complete, ...history} = ledger;
  return jsonFacts({invoice, history});
}

export async function collectInvoiceLedger(client:{rpc:(name:string,args:Record<string,unknown>)=>LedgerQuery},name:string,args:Record<string,unknown>):Promise<Record<string,unknown>|null>{
  let first:Record<string,unknown>|null=null;const rows:unknown[]=[];let cursor:unknown=null;
  let originalSnapshot: string | null = null;
  const cursors = new Set<string>();
  try {
    for(let page=0;page<10;page++){
      const request=client.rpc(name,{...args,_limit:100,_cursor:cursor});
      // The incumbent SDK's builder supports per-read headers. Older transports
      // and servers retain the legacy payload; only the native response marker
      // establishes actual-receivable semantics. No new RPC or authority fallback.
      request.setHeader?.('X-PAIGE-Invoice-Evidence-Version','2');
      const result=await request;
      if(result.error||!record(result.data)||!record(result.data.payment_ledger)||!Array.isArray(result.data.payment_ledger.rows))return null;
      const data=result.data,ledger=data.payment_ledger as Record<string,unknown>;
      if (!Number.isSafeInteger(ledger.count) || Number(ledger.count) < 0 || typeof data.has_more !== 'boolean') return null;
      const currentSnapshot = snapshot(data, ledger);
      if(!first){first=data;originalSnapshot=currentSnapshot;}
      else if(currentSnapshot!==originalSnapshot)return null;
      if((ledger.rows as unknown[]).length>100)return null;
      rows.push(...ledger.rows as unknown[]);
      if (rows.length > Number(ledger.count)) return null;
      if(data.has_more===false){
        if (rows.length !== ledger.count) return null;
        return {...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete:true},ledger_complete:true};
      }
      if ((ledger.rows as unknown[]).length === 0 || rows.length === ledger.count || !record(data.next_cursor)) return null;
      const next = jsonFacts(data.next_cursor);
      if (cursors.has(next)) return null;
      cursors.add(next);
      cursor=data.next_cursor;
    }
    return first?{...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete:false},ledger_complete:false}:null;
  } catch {
    // Interrupted/invalid reads produce no downloadable artifact and no automatic
    // retry under another reader, invoice, bearer token, business or customer.
    return null;
  }
}

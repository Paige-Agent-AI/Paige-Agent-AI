import React from 'react';
import {useSoloDealClients} from './useSoloDealClients';
export function DealClientPicker({tenantId,value,onChange}:{tenantId:string|null;value:string;onChange(value:string):void}){
 const {phase,clients,retry,loadMore,hasMore}=useSoloDealClients(tenantId);
 const [search,setSearch]=React.useState('');const hint=React.useId();
 const selected=clients.find(c=>c.id===value),visible=clients.filter(c=>c.id===value||`${c.name} ${c.primaryEmail??''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 return <div className="pipeline-client-picker">
  <label><span>Find a client</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Client name or email"/></label>
  <label><span>Client</span><select value={selected?value:''} disabled={phase!=='ready'} onChange={e=>onChange(e.target.value)} aria-describedby={hint}><option value="">{phase==='loading'?'Loading clients…':'Choose a client'}</option>{visible.map(c=><option key={c.id} value={c.id}>{c.name}{c.primaryEmail?` · ${c.primaryEmail}`:''}</option>)}</select></label>
  <p id={hint} className="pipeline-evidence">{phase==='error'?'Client records could not be read. Retry before choosing a client.':phase==='ready'&&!clients.length?'No clients found. Create the client first, or explicitly choose an unlinked prospect.':'Choose the actual client record. Matching names require a deliberate selection.'}</p>
  {phase==='error'&&<button className="btn btn-s" type="button" onClick={retry}>Retry client read</button>}
  {hasMore&&<button className="btn btn-s" type="button" onClick={loadMore}>Load more clients</button>}
  {selected&&<p className="pipeline-client-selected"><strong>{selected.name}</strong>{selected.primaryEmail&&<span>{selected.primaryEmail}</span>}</p>}
 </div>;
}

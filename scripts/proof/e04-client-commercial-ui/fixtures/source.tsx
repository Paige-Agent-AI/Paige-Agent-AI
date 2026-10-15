import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route,Outlet} from 'react-router-dom';
import {ClientDeliveryPortalContext} from '../../../../src/components/client/client-delivery-portal-context';
import {ClientInvoices} from '../../../../src/components/client/ClientInvoices';
import ClientScopedInvoiceDocument from '../../../../src/pages/ClientScopedInvoiceDocument';
import {actor,client,tenant,invoice,scenario,signOut} from './sdk';
import '../../../../src/index.css';
import '../../../../src/components/client/client-delivery-portal.css';

const portal={work:{actorId:actor,loading:false,result:null},opening:null,notice:'',preview:false,attachList:()=>()=>{},refresh:()=>{},open:async()=>{}};
function Fixture(){
 const [phase,setPhase]=useState('ready'),[theme,setTheme]=useState('light'),[version,setVersion]=useState(0);
 const documentMode=new URLSearchParams(location.search).has('document');
 return <div className={theme==='dark'?'dark':''} style={{minHeight:'100dvh',background:'hsl(var(--background))',color:'hsl(var(--foreground))'}}>
  <style>{`[aria-label="Synthetic review controls"] select{color:hsl(var(--foreground));background:hsl(var(--background));border:1px solid hsl(var(--border));padding:4px}`}</style>
  <aside aria-label="Synthetic review controls" style={{padding:16,display:'flex',flexWrap:'wrap',gap:16,alignItems:'center',borderBottom:'1px solid hsl(var(--border))'}}>
   <strong>Actual components · synthetic transport · no customer acceptance</strong>
   <label>State <select aria-label="State" value={phase} onChange={event=>{scenario(event.target.value);setPhase(event.target.value);setVersion(v=>v+1);}}>{['ready','loading','empty','offline','denied','partial','test','large'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Theme <select aria-label="Theme" value={theme} onChange={event=>setTheme(event.target.value)}><option>light</option><option>dark</option></select></label>
   <button type="button" onClick={signOut}>Simulate sign-out</button>
  </aside>
  {documentMode?<ClientScopedInvoiceDocument key={version} target={{tenantId:tenant,clientId:client,invoiceId:invoice}}/>:
   <main style={{maxWidth:720,margin:'auto',padding:'24px 20px',fontFamily:'"Schibsted Grotesk",sans-serif'}}>
    <ClientDeliveryPortalContext.Provider value={portal}><MemoryRouter><Routes><Route element={<Outlet context={{session:{user:{id:actor}}}}/>}><Route index element={<ClientInvoices key={version}/>}/></Route></Routes></MemoryRouter></ClientDeliveryPortalContext.Provider>
   </main>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

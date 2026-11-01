import {useState} from "react";
import {createRoot} from "react-dom/client";
import {Toaster} from "sonner";
import {PeopleContactEditor} from "./PeopleContactEditor.prototype";
import {record,tenant,scenario} from "./ports";
import type {RelationshipPerson} from "@/components/tenant-relationships/useTenantRelationshipsData";
import "@/index.css";
import "../portal-access-mount/fonts.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/components/tenant-relationships/tenant-relationships-clients-workspace.css";
const params=new URLSearchParams(location.search),theme=params.get("theme")==="dark"?"dark":"light";
document.documentElement.classList.toggle("dark",theme==="dark");
Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>scenario!=="offline"});
function current():RelationshipPerson{return {id:record.id,firstName:"Jordan",lastName:"Rivera",name:"Jordan Rivera",recordType:"person",contactMethods:[],tags:[],status:"active",lifecycleStage:"new_lead",doNotContact:false,notes:record.current_notes,timezone:record.timezone,timezoneVerified:record.timezone_verified,updatedAt:record.updated_at} as RelationshipPerson;}
function App(){const [open,setOpen]=useState(true),[person,setPerson]=useState(current);return <div data-pg={theme} data-tenant-shell style={{height:"100vh",color:"var(--pg-ink)",background:"var(--pg-canvas)",padding:16,display:"grid",gridTemplateRows:"auto minmax(0,1fr)",gap:14}}>
 <aside aria-label="Prototype review controls" style={{fontSize:12,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}><strong>LOCAL PROTOTYPE · fictional contact · no live writes</strong><label>Scenario <select aria-label="Prototype scenario" value={scenario} onChange={e=>{params.set("scenario",e.target.value);location.search=params.toString();}}>{["success","stale","refused","unknown","unavailable","offline"].map(s=><option key={s}>{s}</option>)}</select></label><label>Theme <select aria-label="Prototype theme" value={theme} onChange={e=>{params.set("theme",e.target.value);location.search=params.toString();}}><option>light</option><option>dark</option></select></label><span>Chapter panel retains focus and owns overflow; haptics N/A.</span></aside>
 <main style={{containerType:"inline-size",containerName:"solo-people-workspace",minHeight:0}}>{open?<PeopleContactEditor open={open} onOpenChange={setOpen} tenantId={tenant} contact={person} onSaved={()=>{}}/>:<section><h1>Jordan Rivera</h1><p>Local saved record: {record.timezone} · {record.timezone_verified?"confirmed":"unconfirmed"}</p><button onClick={()=>{setPerson(current());setOpen(true);}}>Reopen contact</button></section>}</main><Toaster/>
 <style>{`.trc-contact-editor-panel:has([data-zone-controls]){overflow:auto} select{color:inherit;background:var(--pg-surface);border:1px solid var(--pg-line);padding:4px} input[type=checkbox]{min-height:18px;width:18px;accent-color:var(--pg-gold-core)}`}</style>
 </div>;}
createRoot(document.getElementById("root")!).render(<App/>);

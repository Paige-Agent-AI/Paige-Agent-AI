import {useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ComposeThreadDialog} from "@/pages/admin/conversations/ComposeThreadDialog";
import {Toaster} from "@/components/ui/sonner";
import {TENANT,CONTACT} from "./stubs";
import "@/index.css";
import "../portal-access-mount/fonts.css";
const theme=new URLSearchParams(location.search).get("theme")==="dark"?"dark":"light";
document.documentElement.classList.toggle("dark",theme==="dark");
export function App(){const[open,setOpen]=useState(true);return <div data-pg={theme} className="paige-solo" data-theme={theme} style={{height:"100vh",padding:16}}>
<p>Synthetic UI prototype · fictional data and injected response · no live texts or saved customer record</p><button onClick={()=>setOpen(true)}>Reopen conversation</button>
<ComposeThreadDialog open={open} onOpenChange={setOpen} tenantId={TENANT} activeTenantId={TENANT} initialContact={{id:CONTACT,name:"Jordan Rivera"}} activeConnectors={[{id:"e0300000-0000-4000-8000-0000000e0002",channel_type:"sms",display_name:"Northwind texts",provider:"twilio",from_address:"+12025550199"}]} onSent={()=>{Object.assign(window,{smsUncertainReturns:(Reflect.get(window,"smsUncertainReturns") as number)+1});}}/><Toaster/></div>;}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><App/></BrowserRouter></QueryClientProvider>);

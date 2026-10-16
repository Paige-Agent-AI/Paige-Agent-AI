import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import JoinWorkspace from "../../../src/pages/JoinWorkspace";
let root=createRoot(document.getElementById("root")!);
const mount=()=>root.render(<HelmetProvider><MemoryRouter initialEntries={["/join/synthetic-entry-token"]}><Routes><Route path="/join/:token" element={<JoinWorkspace/>}/><Route path="/app" element={<main><h1>Verified portal test destination</h1><p>Offline route target only. Actual customer shell is not represented in this capsule.</p></main>}/></Routes></MemoryRouter></HelmetProvider>);
mount();
Object.assign((window as unknown as {entryProof:object}).entryProof,{remount:()=>{root.unmount();root=createRoot(document.getElementById("root")!);mount();}});

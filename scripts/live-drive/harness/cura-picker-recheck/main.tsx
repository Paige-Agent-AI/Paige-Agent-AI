import React,{useRef} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {CustomerChatAttachments} from "@/components/chat/CustomerChatAttachments";
import {useCustomerChatAttachments} from "@/hooks/useCustomerChatAttachments";
import {setChecking,retire,useFixtureState} from "./ports";
import "@/index.css";

document.documentElement.classList.toggle("dark",new URLSearchParams(location.search).get("theme")==="dark");
function SourceFrame(){
  const fixture=useFixtureState(),host=useRef<HTMLDivElement>(null);
  const files=useCustomerChatAttachments("e0993000-0000-4000-8000-000000000004",fixture.phase==="ready");
  const interruptedChoice=()=>{
    const input=host.current?.querySelector<HTMLInputElement>('input[type="file"]');if(!input)return;
    input.addEventListener("click",event=>event.preventDefault(),{once:true});input.click();
    flushSync(()=>setChecking(true));
    Object.defineProperty(input,"files",{configurable:true,value:[new File(["Synthetic Harbor note"],"Harbor.pdf",{type:"application/pdf"}),new File(["Synthetic Willow note"],"Willow.pdf",{type:"application/pdf"})]});
    input.dispatchEvent(new Event("change",{bubbles:true}));
  };
  return <main className="bg-background text-foreground" style={{minHeight:"100dvh",padding:24}}>
    <div style={{maxWidth:720,margin:"0 auto"}}>
      <p className="text-sm text-muted-foreground">Synthetic interface check · original component and hook · no business records</p>
      <h1 className="text-2xl font-semibold mt-3">Private files for Cura</h1>
      <p className="text-sm text-muted-foreground mt-2 mb-6">A chooser completion is held privately during the original access recheck. No upload or message is executed.</p>
      <div className="flex flex-wrap gap-2 mb-6">
        <button className="border rounded-md px-3 min-h-11" disabled={fixture.phase!=="ready"} onClick={interruptedChoice}>Start interrupted choice</button>
        <button className="border rounded-md px-3 min-h-11" disabled={fixture.phase==="ready"} onClick={()=>setChecking(false)}>Finish access check</button>
        <button className="border rounded-md px-3 min-h-11" onClick={retire}>Retire original context</button>
      </div>
      <p role="status" className="text-sm mb-3">{fixture.phase==="ready"?"Access checked":"Checking access — selected names concealed"}</p>
      <div ref={host} className="rounded-xl border border-border bg-card p-3">
        <CustomerChatAttachments enabled={files.available} files={files.files} issues={files.issues} busy={files.busy} notice={files.notice}
          upload={files.nativeUpload} onSelect={files.append} onBeginSelection={files.beginSelection} onRemove={files.remove}
          onCheck={files.check} onResume={files.resume} onStop={files.stop}/>
      </div>
      <p className="text-sm text-muted-foreground mt-4">Source-only test. Native authorization, actual picker delivery and saved history require separate signed-in production checks.</p>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<SourceFrame/>);

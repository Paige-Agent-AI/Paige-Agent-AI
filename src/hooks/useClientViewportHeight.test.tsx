import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {useClientViewportHeight} from "./useClientViewportHeight";

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,pending:FrameRequestCallback|null;
let viewport:EventTarget&{height:number;scale:number};
const cancel=vi.fn();
function Probe(){const height=useClientViewportHeight();return <output>{height??"native"}</output>;}
function frame(){act(()=>{const callback=pending;pending=null;callback?.(0);});}
function resize(){act(()=>window.dispatchEvent(new Event("resize")));frame();}
beforeEach(()=>{
  viewport=Object.assign(new EventTarget(),{height:744,scale:1});pending=null;cancel.mockClear();
  vi.stubGlobal("innerWidth",390);vi.stubGlobal("innerHeight",844);vi.stubGlobal("visualViewport",viewport);
  vi.stubGlobal("requestAnimationFrame",vi.fn((callback:FrameRequestCallback)=>{pending=callback;return 7;}));
  vi.stubGlobal("cancelAnimationFrame",cancel);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const mount=()=>act(()=>root.render(<Probe/>));
describe("customer visual viewport lifetime",()=>{
  it("fits the visible phone area, follows keyboard changes and restores on close",()=>{
    mount();expect(host.textContent).toBe("744");
    viewport.height=350;act(()=>viewport.dispatchEvent(new Event("resize")));frame();expect(host.textContent).toBe("350");
    viewport.height=744;resize();expect(host.textContent).toBe("744");
  });
  it("retains native sizing on unsupported browsers and desktop layouts",()=>{
    vi.stubGlobal("visualViewport",null);mount();expect(host.textContent).toBe("native");
    vi.stubGlobal("visualViewport",viewport);vi.stubGlobal("innerWidth",1024);resize();expect(host.textContent).toBe("native");
    vi.stubGlobal("innerWidth",390);resize();expect(host.textContent).toBe("744");
  });
  it("does not shrink the shell to a pinch-zoom viewport",()=>{
    mount();viewport.scale=2;viewport.height=300;resize();expect(host.textContent).toBe("native");
    viewport.scale=1;resize();expect(host.textContent).toBe("300");
  });
  it.each([0,-1,NaN,Infinity])("uses native recovery for invalid visible height %s",height=>{
    viewport.height=height;mount();expect(host.textContent).toBe("native");
  });
  it("bounds the result to the layout viewport and coalesces resize events",()=>{
    viewport.height=1000.8;mount();expect(host.textContent).toBe("844");
    act(()=>{viewport.dispatchEvent(new Event("resize"));viewport.dispatchEvent(new Event("scroll"));window.dispatchEvent(new Event("resize"));});
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();frame();expect(host.textContent).toBe("844");
  });
  it("retires listeners and a pending frame on unmount",()=>{
    const remove=vi.spyOn(viewport,"removeEventListener");mount();act(()=>viewport.dispatchEvent(new Event("resize")));
    act(()=>root.unmount());root=createRoot(host);
    expect(cancel).toHaveBeenCalledWith(7);expect(remove).toHaveBeenCalledWith("resize",expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll",expect.any(Function));
  });
});

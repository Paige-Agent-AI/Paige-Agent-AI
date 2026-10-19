import {useEffect,useState} from "react";

/** Fit the existing customer shell to a phone keyboard without disabling zoom.
 * Unsupported browsers retain the incumbent dynamic-viewport CSS fallback.
 */
export function useClientViewportHeight():number|undefined{
  const [height,setHeight]=useState<number>();
  useEffect(()=>{
    let frame:number|null=null;
    const update=()=>{
      frame=null;
      const viewport=window.visualViewport;
      const next=window.innerWidth<768&&viewport&&viewport.scale===1&&
        Number.isFinite(viewport.height)&&viewport.height>0
        ?Math.floor(Math.min(window.innerHeight,viewport.height)):undefined;
      setHeight(previous=>previous===next?previous:next);
    };
    const queue=()=>{if(frame===null)frame=window.requestAnimationFrame(update);};
    const viewport=window.visualViewport;
    update();window.addEventListener("resize",queue);
    viewport?.addEventListener("resize",queue);
    viewport?.addEventListener("scroll",queue);
    return()=>{
      window.removeEventListener("resize",queue);
      viewport?.removeEventListener("resize",queue);
      viewport?.removeEventListener("scroll",queue);
      if(frame!==null)window.cancelAnimationFrame(frame);
    };
  },[]);
  return height;
}

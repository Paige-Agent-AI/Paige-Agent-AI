import React from 'react';
import type {PDFDocumentProxy,PDFDocumentLoadingTask,RenderTask} from 'pdfjs-dist';
import {FileWarning,Loader2,RefreshCw} from 'lucide-react';
import {documentDescriptorSchema,type DocumentDescriptor,type DocumentPage} from './agreementDocumentModel';
import {loadAgreementPdf,matchesDocumentPage} from './agreementPdfRenderer';

type Props={
  bytes:Uint8Array;document:DocumentDescriptor;pageNumber:number;authorityKey:string;canView:boolean;
  zoom:'fit'|number;onReady:(ready:{page:number;sha256:string;zoom:'fit'|number}|null)=>void;onRetry:()=>void;
  onDocumentClick?:(event:React.MouseEvent<HTMLDivElement>,page:DocumentPage)=>void;
  purpose?:'preparation'|'signing';
  children?:React.ReactNode;
};
/** Owning workspace supplies ONE leave guard and actual scoped bytes. This view
 * does not fetch records, persist fields, authorize or start signing. */
export function AgreementPdfPage(props:Props){
  const parsed=documentDescriptorSchema.safeParse(props.document);
  if(!props.canView)return <div className="e04-pdf-notice" role="status">The document is hidden while business access is being checked.</div>;
  if(!parsed.success||!Number.isSafeInteger(props.pageNumber)||props.pageNumber<1||props.pageNumber>parsed.data.pages.length
    ||props.zoom!=='fit'&&(!Number.isFinite(props.zoom)||props.zoom<.25||props.zoom>2))
    return <div className="e04-pdf-notice" role="alert">This document version could not be verified.</div>;
  return <ScopedPdfPage key={`${props.authorityKey}:${props.document.sha256}`} {...props}/>;
}
function ScopedPdfPage({bytes,document,pageNumber,zoom,onReady,onRetry,onDocumentClick,children,purpose='preparation'}:Props){
  const [pdf,setPdf]=React.useState<PDFDocumentProxy|null>(null);
  const [phase,setPhase]=React.useState<'loading'|'rendering'|'ready'|'error'>('loading');
  const [text,setText]=React.useState('');
  const [width,setWidth]=React.useState(0);
  const [rendered,setRendered]=React.useState<{pdf:PDFDocumentProxy;page:number;width:number}|null>(null);
  const well=React.useRef<HTMLDivElement>(null),canvas=React.useRef<HTMLCanvasElement>(null);
  const readyCallback=React.useRef(onReady);readyCallback.current=onReady;
  const currentPage=document.pages[pageNumber-1];
  const renderWidth=zoom==='fit'?width:currentPage.width*zoom;
  const pageReady=phase==='ready'&&rendered?.pdf===pdf&&rendered.page===pageNumber&&rendered.width===renderWidth;
  React.useEffect(()=>{
    const observer=new ResizeObserver(entries=>{const value=entries[0]?.contentRect.width;if(value&&Number.isFinite(value))setWidth(value);});
    if(well.current)observer.observe(well.current);return()=>observer.disconnect();
  },[]);
  React.useEffect(()=>{
    let current=true,loaded:{task:PDFDocumentLoadingTask;pdf:PDFDocumentProxy}|null=null;
    const controller=new AbortController();
    const deadline=window.setTimeout(()=>{if(current){setPhase('error');setPdf(null);readyCallback.current(null);controller.abort();}},20000);
    setPhase('loading');setPdf(null);setText('');readyCallback.current(null);
    void loadAgreementPdf(bytes,document,()=>current,controller.signal).then(result=>{
      window.clearTimeout(deadline);
      if(!current){void result.task.destroy().catch(()=>{});return;}
      loaded=result;setPdf(result.pdf);
    }).catch(()=>{window.clearTimeout(deadline);if(current){setPhase('error');readyCallback.current(null);}});
    return()=>{current=false;window.clearTimeout(deadline);controller.abort();readyCallback.current(null);if(loaded)void loaded.task.destroy().catch(()=>{});};
  },[bytes,document]);
  React.useEffect(()=>{
    if(!pdf||!renderWidth||!canvas.current)return;
    let current=true,render:RenderTask|null=null;
    const element=canvas.current;
    const deadline=window.setTimeout(()=>{if(current){current=false;render?.cancel();void pdf.destroy().catch(()=>{});element.width=0;element.height=0;setPhase('error');setText('');setRendered(null);readyCallback.current(null);}},20000);
    setPhase('rendering');setText('');setRendered(null);readyCallback.current(null);
    // Clear the old pixels before another page can receive editing controls.
    element.width=0;element.height=0;
    void (async()=>{
      const page=await pdf.getPage(pageNumber);
      if(!current)return;
      if(!matchesDocumentPage(page,currentPage))throw new Error('DOCUMENT_GEOMETRY_UNAVAILABLE');
      const viewport=page.getViewport({scale:renderWidth/currentPage.width});
      const ratio=Math.min(window.devicePixelRatio||1,2);
      if(viewport.width*viewport.height*ratio*ratio>16777216)throw new Error('DOCUMENT_CANVAS_UNAVAILABLE');
      element.width=Math.ceil(viewport.width*ratio);element.height=Math.ceil(viewport.height*ratio);
      const context=element.getContext('2d');if(!context)throw new Error('DOCUMENT_CANVAS_UNAVAILABLE');
      render=page.render({canvasContext:context,canvas:element,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0],annotationMode:1});
      await render.promise;
      if(!current)return;
      const content=await page.getTextContent();
      if(!current)return;
      window.clearTimeout(deadline);
      setText(content.items.flatMap(item=>'str'in item?[item.str]:[]).join(' '));
      setRendered({pdf,page:pageNumber,width:renderWidth});setPhase('ready');readyCallback.current({page:pageNumber,sha256:document.sha256,zoom});
    })().catch(()=>{window.clearTimeout(deadline);if(current){element.width=0;element.height=0;setPhase('error');setText('');setRendered(null);readyCallback.current(null);}});
    return()=>{current=false;window.clearTimeout(deadline);render?.cancel();element.width=0;element.height=0;readyCallback.current(null);};
  },[pdf,renderWidth,pageNumber,currentPage,document.sha256,zoom]);
  return <div className="e04-pdf-view">
    <div ref={well} className="e04-pdf-well" tabIndex={0} role="region" aria-label="Scrollable document page" aria-busy={phase!=='error'&&!pageReady}>
      {phase==='error'?<div className="e04-pdf-notice" role="alert"><FileWarning size={24} aria-hidden="true"/><h3>Document preview unavailable</h3><p>The exact document could not be verified or displayed. {purpose==='signing'?'Signing stays unavailable until the original page is available.':'No fields can be placed on this preview.'}</p><button onClick={onRetry}><RefreshCw size={16} aria-hidden="true"/>Reload original document</button></div>:
        <div className="e04-pdf-paper" data-rendered-page={pageReady?pageNumber:undefined} data-rendered-zoom={pageReady?zoom:undefined} style={{width:zoom==='fit'?'100%':renderWidth,aspectRatio:`${currentPage.width} / ${currentPage.height}`}} onClick={event=>{if(pageReady)onDocumentClick?.(event,currentPage);}}>
          <canvas key={pageNumber} ref={canvas} style={{visibility:pageReady?'visible':'hidden'}} aria-label={`Document page ${pageNumber}`} role="img"/>
          {pageReady?children:<div className="e04-pdf-progress" role="status"><Loader2 size={22} aria-hidden="true"/><span>{phase==='loading'?'Verifying document…':'Preparing page…'}</span></div>}
        </div>}
    </div>
    {pageReady&&<details className="e04-pdf-text"><summary>Read page text</summary><div>{text||'This page has no selectable text. Review the original page image above.'}</div></details>}
  </div>;
}

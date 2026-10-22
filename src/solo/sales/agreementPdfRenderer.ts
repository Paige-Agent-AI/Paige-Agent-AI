import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {PDFDocumentLoadingTask,PDFDocumentProxy} from 'pdfjs-dist';
import {documentDescriptorSchema,type DocumentDescriptor} from './agreementDocumentModel';

// Public CODE/font resources only. Document bytes never enter these URLs or a
// browser cache. A manifest whitelist prevents PDF-authored external asset URLs.
const fonts=import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const cmaps=import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
async function localAsset(assets:Record<string,string>,name:string):Promise<Uint8Array>{
  const path=Object.keys(assets).find(key=>key.split('/').at(-1)===name);
  if(!path)throw new Error('DOCUMENT_ASSET_UNAVAILABLE');
  const url=new URL(assets[path],location.href);
  if(url.origin!==location.origin)throw new Error('DOCUMENT_ASSET_UNAVAILABLE');
  const response=await fetch(url,{credentials:'omit',cache:'force-cache'});
  if(!response.ok)throw new Error('DOCUMENT_ASSET_UNAVAILABLE');
  return new Uint8Array(await response.arrayBuffer());
}
class LocalFonts {fetch({filename}:{filename:string}){return localAsset(fonts,filename);}}
class LocalCMaps {async fetch({name}:{name:string}){return {cMapData:await localAsset(cmaps,name+'.bcmap'),isCompressed:true};}}

export async function verifyDocumentBytes(bytes:Uint8Array,expected:DocumentDescriptor):Promise<Uint8Array>{
  const document=documentDescriptorSchema.parse(expected);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==document.byte_length)throw new Error('DOCUMENT_INTEGRITY_UNAVAILABLE');
  const captured=bytes.slice();
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',captured))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==document.sha256)throw new Error('DOCUMENT_INTEGRITY_UNAVAILABLE');
  return captured;
}

/** Browser page renderer only, never the web viewer/scripting manager or an
 * approval/signing client. Caller owns cancellation and current authority epoch. */
export async function loadAgreementPdf(bytes:Uint8Array,expected:DocumentDescriptor,isCurrent:()=>boolean,signal?:AbortSignal):Promise<{pdf:PDFDocumentProxy;task:PDFDocumentLoadingTask}>{
  const current=()=>!signal?.aborted&&isCurrent();
  const captured=await verifyDocumentBytes(bytes,expected);
  if(!current())throw new Error('DOCUMENT_CONTEXT_RETIRED');
  const engine=await import('pdfjs-dist');
  if(!current())throw new Error('DOCUMENT_CONTEXT_RETIRED');
  engine.GlobalWorkerOptions.workerSrc=workerSource;
  const task=engine.getDocument({data:captured,isEvalSupported:false,enableXfa:false,stopAtErrors:true,useWasm:false,
    useWorkerFetch:false,useSystemFonts:false,StandardFontDataFactory:LocalFonts,CMapReaderFactory:LocalCMaps});
  const abort=()=>{void task.destroy().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    const pdf=await task.promise;
    if(!current())throw new Error('DOCUMENT_CONTEXT_RETIRED');
    if(pdf.numPages!==expected.pages.length)throw new Error('DOCUMENT_GEOMETRY_UNAVAILABLE');
    return {pdf,task};
  }catch(error){await task.destroy().catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);}
}

export function matchesDocumentPage(page:{pageNumber:number;rotate:number;view:number[];userUnit:number;getViewport(options:{scale:number}):{width:number;height:number}},expected:DocumentDescriptor['pages'][number]):boolean{
  const viewport=page.getViewport({scale:1});
  const [x,y,right,top]=page.view;
  return page.pageNumber===expected.page&&page.userUnit===1&&page.rotate===expected.rotation
    &&[x-expected.crop_x,y-expected.crop_y,right-x-expected.crop_width,top-y-expected.crop_height,viewport.width-expected.width,viewport.height-expected.height].every(v=>Number.isFinite(v)&&Math.abs(v)<.001);
}

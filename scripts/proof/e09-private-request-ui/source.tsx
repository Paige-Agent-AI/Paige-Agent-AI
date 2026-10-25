import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {PrivateRequestEditor,type PrivateRequestModel} from '../../../src/components/tenant-relationships/ClientPrivateRequests';
import '../../../src/components/tenant-relationships/client-shared-work.css';
import '../../../src/components/tenant-relationships/client-action-items.css';
const params=new URLSearchParams(location.search);
const saved={schema_version:1 as const,actor_id:'test-actor',tenant_id:'test-business',contact_id:'test-contact',intent_id:'test-intent',found:true,
 request:{work_id:'test-work',status:'assigned',created_at:'2026-10-24T12:00:00.123456Z',version:'2026-10-24T12:00:01.123456Z',content_state:'prepared' as const,title:'Review your service plan',body:'Read the shared guide and let us know which milestone you would like to work on first.',customer_action_id:null},recipient_available:true,missing_is_rejection:false as const,read_at:'2026-10-24T12:00:02Z'};
function Fixture(){
 const mode=params.get('state'),[expanded,setExpanded]=useState(true);
 const [phase,setPhase]=useState<PrivateRequestModel['phase']>(mode==='saved'?'saved':mode==='unknown'?'unknown':mode==='refused'?'refused':'idle');
 const [result,setResult]=useState<PrivateRequestModel['result']>(mode==='saved'?saved:null);
 const history={schema_version:1 as const,actor_id:'test-actor',tenant_id:'test-business',contact_id:'test-contact',requests:[{intent_id:'test-intent',request:saved.request}],more:false,next_cursor:null,recipient_available:true,missing_is_rejection:false as const,read_at:'2026-10-24T12:00:02Z'};
 const readHistory=useCallback(async()=>{},[]);
 const model:PrivateRequestModel={phase,result,historyPhase:mode==='refused'?'refused':mode==='loading'?'loading':mode==='error'?'error':'ready',history,
  readHistory,prepare:async words=>{setPhase('preparing');await Promise.resolve();setResult({...saved,request:{...saved.request,...words}});setPhase('saved');},
  checkSaved:async()=>{setPhase('checking');await Promise.resolve();setResult(saved);setPhase('saved');},startAnother:()=>{setResult(null);setPhase('idle');}};
 return <main className="trc-record-section trc-shared trc-customer-actions"><header className="trc-shared-head"><div className="trc-shared-heading"><h3>Customer action items</h3><p>Requests shared with Jordan Rivera and their saved responses.</p></div>
  <button type="button" className="trc-shared-quiet" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Prepare request</button></header>
  <div className="trc-action-body"><PrivateRequestEditor model={model} clientName="Jordan Rivera" expanded={expanded} ownerPhase="ready" onCollapse={()=>setExpanded(false)}/>
   <article className="trc-action-item"><h4>Choose your first milestone</h4><div className="trc-action-meta"><span>Customer asked a question</span><span>Created Oct 24, 2026</span></div><p className="trc-action-words">Review the shared plan before our next session.</p><blockquote><strong>Question</strong><p className="trc-action-words">Which section should I start with?</p></blockquote></article></div></main>;
}
document.documentElement.dataset.pg=params.get('theme')==='dark'?'dark':'light';
createRoot(document.getElementById('root')!).render(<Fixture/>);

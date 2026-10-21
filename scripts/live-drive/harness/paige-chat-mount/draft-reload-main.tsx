import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PaigeAIChat} from '@/components/dashboard/PaigeAIChat';
import {ComposerDraftSessionBinding} from '@/components/paige/ComposerDraftSessionBinding';
import {mode} from './draft-reload-stubs';
import '@/index.css';
const params=new URLSearchParams(location.search),theme=params.get('theme')??'light',layout=params.get('layout')??'page',scope=params.get('scope')??'none';
document.documentElement.classList.toggle('dark',theme==='dark');
let requests=0;
window.fetch=async()=>{requests++;document.querySelector('[data-requests]')!.textContent=String(requests);throw new Error('Synthetic proof: network disabled');};
if(mode==='blocked'){
 const original=Storage.prototype.setItem;
 Storage.prototype.setItem=function(key,value){if(key==='paige.composer.drafts.v1')throw new Error('Synthetic storage quota failure');return original.call(this,key,value);};
}
const css=document.createElement('style');css.textContent=`
@font-face{font-family:'Schibsted Grotesk';src:url('/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2') format('woff2');font-weight:100 900;font-display:swap}
html,body,#root{height:100%;margin:0} .proof{height:100dvh;display:flex;flex-direction:column;background:var(--pg-canvas);color:var(--pg-ink)}
.proof-cap{flex:none;padding:6px 12px;font-size:11px;border-bottom:1px solid var(--pg-line);display:flex;flex-wrap:wrap;gap:8px}
.proof-body{flex:1;min-height:0;display:flex}.proof-work{flex:1;min-width:0;padding:24px}.proof-chat{min-width:0;flex:1;display:flex;flex-direction:column}
.proof-chat.docked{flex:none;width:clamp(320px,34vw,520px);border-left:1px solid var(--pg-line)}
@media(max-width:760px){.proof-work{display:none}.proof-chat.docked{width:100%;border-left:0}}
`;document.head.append(css);
export function App(){return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
 <MemoryRouter><ComposerDraftSessionBinding/><div className="proof" data-pg={theme} data-tenant-shell>
 <header className="proof-cap"><strong>Synthetic proof — account/history/model doubles</strong><span>{mode} · {scope} · {layout}</span><span>Requests: <b data-requests>0</b></span>
 <a href={`?layout=${layout}&theme=${theme}`}>Ordinary</a><a href={`?mode=blocked&layout=${layout}&theme=${theme}`}>Storage failure</a>
 <a href={`?mode=operator&layout=${layout}&theme=${theme}`}>Operator exclusion</a><a href={`?mode=effective&layout=${layout}&theme=${theme}`}>Effective view</a>
 <a href={`?scope=client&layout=${layout}&theme=${theme}`}>Client context</a><a href={`?scope=play&layout=${layout}&theme=${theme}`}>Play context</a></header>
 <main className="proof-body">{layout==='drawer'&&<section className="proof-work">Illustrative workspace, not the authenticated SOLO shell.</section>}
 <section className={'proof-chat'+(layout==='drawer'?' docked':'')} aria-label="Actual Chat component">
 <PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} renderRail={()=>null}
 clientId={scope==='client'?'test-client-a':null} businessMissionId={scope==='play'?'test-play-a':null}
 greeting="What needs your attention today? Ask a question using the business evidence." />
 </section></main></div></MemoryRouter></QueryClientProvider>}
createRoot(document.getElementById('root')!).render(<App/>);

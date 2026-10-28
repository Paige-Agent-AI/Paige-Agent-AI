import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {FixtureContext} from './ports';
import {OwnerTaskAutomations} from './parent';
function Location(){const l=useLocation();return <p role="status">Local fixture route: {l.pathname}{l.search}</p>}
function App(){const[mode,setMode]=useState('verified'),[scope,setScope]=useState('A'),[dark,setDark]=useState(false);return <div className="paige-solo" data-pg={dark?'dark':'light'}>
 <div className="fixture-controls"><p>NEUTRAL NATIVE QA. Byte-exact original Task parent/history; synthetic read ports only. No authentication, network, saved work or effects.</p>{['verified','unconfirmed','refused','unavailable'].map(s=><button key={s} onClick={()=>setMode(s)}>Fixture {s}</button>)}<button onClick={()=>setScope(scope==='A'?'B':'A')}>Fixture switch context</button><button onClick={()=>setDark(!dark)}>Fixture switch theme</button></div>
 <main><FixtureContext.Provider value={{mode,scope}}><OwnerTaskAutomations/></FixtureContext.Provider><Location/></main></div>}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/solo/123/operations/playbooks']}><App/></MemoryRouter>);

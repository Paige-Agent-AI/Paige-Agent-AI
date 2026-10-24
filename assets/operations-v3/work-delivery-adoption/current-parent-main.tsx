import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ThemeProvider,useTheme} from 'next-themes';
import {OperationsWorkspace} from '@/solo/operations/OperationsWorkspace';
import {setFixture} from './root-fixtures';
import '@/index.css';
function Proof(){const[view,setView]=useState('work'),[read,setRead]=useState('Not queried'),guard=useRef<(()=>string|null)|null>(null),{theme,setTheme}=useTheme();return <div className="paige-solo" data-pg={theme} data-theme={theme} style={{minHeight:'100vh',background:'var(--pg-canvas)',color:'var(--pg-text)',padding:16}}>
 <aside aria-label="Synthetic proof controls" style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',padding:'0 0 16px',fontSize:12}}>
  <strong>Synthetic source proof · no live effects</strong>
  <button type="button" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>Switch proof theme</button>
  <button type="button" onClick={()=>setFixture('partial')}>Make team unavailable</button>
  <button type="button" onClick={()=>setFixture('populated')}>Restore fixture reads</button>
  <button type="button" onClick={()=>setRead(guard.current?.()??'Clear')}>Read original navigation hold</button>
  <output aria-label="Original navigation hold">{read}</output>
  {['prepare','review','unknown','accepted','unavailable'].map(mode=><a key={mode} href={location.pathname+'?delivery='+mode}>{mode} fixture</a>)}
  <a href={location.pathname+'?delivery=prepare&single=1'}>Single-person fixture</a>
 </aside>
 <OperationsWorkspace view={view} onViewChange={setView} onNavigationGuardChange={next=>{guard.current=next;}}/>
 </div>;}
createRoot(document.getElementById('root')!).render(<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}><MemoryRouter><Proof/></MemoryRouter></ThemeProvider>);

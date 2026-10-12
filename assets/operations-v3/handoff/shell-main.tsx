import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { AgentPresenceProvider, useAgentPresence } from '@/components/ui/paige/AgentPresenceContext';
import { TenantCommandCenterShell } from '@/components/tenant-shell/TenantCommandCenterShell';
import { OperationsRoute } from '@/solo/operations/OperationsRoute';
import '@/index.css';
function Body(){const {expandRail}=useAgentPresence();return <TenantCommandCenterShell accountName="Synthetic shell test · no live effects" accountType="standalone" userRole="admin" onSignOut={()=>{}} brandHomeHref="/solo/999/command-center" soloPaigeWorkspace={<div style={{padding:24}}>Synthetic PAIGE body · no executor or provider connection</div>}><OperationsRoute openPaige={expandRail}/></TenantCommandCenterShell>}
createRoot(document.getElementById('root')!).render(<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><MemoryRouter initialEntries={['/solo/999/operations/overview']}><AgentPresenceProvider><Body/></AgentPresenceProvider></MemoryRouter></ThemeProvider>);

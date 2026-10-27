// DEVELOPMENT ONLY: actual original reference producer/renderer, synthetic read input.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { TenantCommandCenterShell } from '@/components/tenant-shell/TenantCommandCenterShell';
import { PaigeRecordLinks } from '@/components/chat/PaigeRecordLinks';
import { readRecordLinks } from '../../../../supabase/functions/_shared/paige-turn/record-links';
import nativeResult from './email-links-result.json';
import { HarnessPresence } from './stubs';
import '@/index.css';
import '@/solo/solo-tokens.css';

function Proof() {
  const location = useLocation();
  // Native factory runs in Node, then its closed synthetic references are parsed
  // by the ORIGINAL browser-safe contract. No backend module is browser-bundled.
  const links = readRecordLinks(new URLSearchParams(location.search).get('state') === 'denied' ? nativeResult.denied : nativeResult.available);
  return <TenantCommandCenterShell accountName="Example Services" accountType="standalone" userRole="admin" onSignOut={() => {}}
    soloPaigeWorkspace={<section style={{padding:24}} aria-label="Original email read reference proof"><h2>Recorded email review</h2><p>Explicit synthetic read input. No model, provider or business action runs.</p><PaigeRecordLinks links={links} account={{account_type:'standalone',parent_tenant_id:null,account_number:'1234567'}} />{!links.length&&<p role="status">No authorized source reference was returned.</p>}</section>}>
    <section style={{padding:24}}><h1>Original source reference component</h1><p>This development-only page verifies the existing read-link presentation, not an authenticated Chat or department outcome.</p><p>{location.pathname}</p></section>
  </TenantCommandCenterShell>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}><HarnessPresence><Proof /></HarnessPresence></ThemeProvider></BrowserRouter>);

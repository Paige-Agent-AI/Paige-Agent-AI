import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { TenantCommandCenterShell } from '@/components/tenant-shell/TenantCommandCenterShell';
import { FinanceWorkspace } from '@/solo/finance/FinanceWorkspace';
import { HarnessPresence } from '../executive-mount/stubs';
import { SECOND_REVIEW_TENANT } from '../executive-mount/slice-fixtures';
import { TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import uiFont from '../../../../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2?url';
import '@/index.css';
import '@/solo/solo-tokens.css';

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
function App() {
  const current = useLocation(), p = new URLSearchParams(current.search);
  const tenant = p.get('workspace') === 'b' ? SECOND_REVIEW_TENANT : TEST_REVIEW_TENANT;
  return <><style>{`@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:100 900;src:url("${uiFont}") format("woff2");font-display:swap}.e2-finance-proof>[data-tenant-shell]{height:100%}`}</style>
    <div className="e2-finance-proof" style={{ height: 'calc(100dvh - 28px)' }}><TenantCommandCenterShell accountName="SYNTHETIC / Example Services" accountType="standalone" userRole={p.get('state') === 'member' ? 'member' : 'admin'} onSignOut={() => {}} soloPaigeWorkspace={<p style={{ padding: 20 }}>Synthetic conversation geometry. No model or business action.</p>}>
      <Routes><Route path="/solo/:account/*" element={current.pathname.includes('/finance') ? <FinanceWorkspace epoch={tenant} /> : <section style={{ padding: 24 }}><h2>Existing integrations destination</h2><p>No provider setup or backend call is available in this fixture.</p><Link to="/solo/1234567/finance/banking-cash">Return to Banking</Link></section>} /></Routes>
    </TenantCommandCenterShell></div><aside style={{ height: 28, padding: 4, fontSize: 11 }}>SYNTHETIC NATIVE PROOF · NO BACKEND · NOT CUSTOMER ACCEPTANCE</aside></>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><ThemeProvider attribute="class" defaultTheme={theme} forcedTheme={theme} enableSystem={false} storageKey={'paige.e2.finance.proof.theme.' + theme}><HarnessPresence><App /></HarnessPresence></ThemeProvider></BrowserRouter>);

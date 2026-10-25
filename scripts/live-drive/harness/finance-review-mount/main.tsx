import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import SoloApp from '@/solo/SoloApp';
import uiFont from '../../../../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2?url';
import '@/index.css';
import '@/solo/solo-tokens.css';

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
function App() {
  return <><style>{`@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:100 900;src:url("${uiFont}") format("woff2");font-display:swap}.e2-finance-proof>[data-tenant-shell]{height:100%}`}</style>
    <div className="e2-finance-proof" style={{ height: 'calc(100dvh - 28px)' }}><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes></div><aside style={{ height: 28, padding: 4, fontSize: 11 }}>SYNTHETIC NATIVE PROOF · NO BACKEND · NOT CUSTOMER ACCEPTANCE</aside></>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><ThemeProvider attribute="class" defaultTheme={theme} forcedTheme={theme} enableSystem={false} storageKey={'paige.e2.finance.proof.theme.' + theme}><App /></ThemeProvider></BrowserRouter>);

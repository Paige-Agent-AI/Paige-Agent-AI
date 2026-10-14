// Actual new presenter, actual existing Operations and Radix; synthetic data and shell only.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Outlet, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { ClientDeliveryReviewProvider } from '@/components/client/ClientDeliveryReviewProvider';
import { ClientReleasedWork } from '@/components/client/ClientReleasedWork';
import { fixture, useFixtureActor } from './fixture';
import '@/index.css';

const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
export function ClientLayout() {
  const actor = useFixtureActor();
  return <Outlet context={{ session: actor ? { user: { id: actor } } : null }} />;
}
export function Actions() {
  return <main className="mx-auto max-w-2xl p-4 sm:p-6"><h1 className="mb-6 text-2xl font-semibold">Your action items</h1><ClientReleasedWork /><section className="mt-8 border-t pt-6"><h2 className="text-xl font-semibold">Existing action-bus slot</h2><p className="mt-2 text-sm text-muted-foreground">The incumbent ActionItems and activity are preserved in production. This isolated fixture supplies no messages or action receipts.</p></section></main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider attribute="class" forcedTheme={theme} enableSystem={false}>
  <BrowserRouter><ClientDeliveryReviewProvider>
    <div className="border-b bg-muted p-3 text-sm">LOCAL SYNTHETIC COMPOSITION · real presenter/Operations/Radix · shell/data mocked · customer auth/provider/native zoom UNVERIFIED</div>
    <nav className="flex flex-wrap items-center gap-4 border-b p-4" aria-label="Synthetic background portal"><strong className="mr-auto">Test service studio</strong><Link to="/app/actions">Action items</Link><Link to="/app/settings">Settings</Link><button type="button" onClick={fixture.logout}>Sign out</button></nav>
    <Routes>
      <Route path="/app" element={<ClientLayout />}><Route path="actions" element={<Actions />} /><Route path="settings" element={<main className="p-6"><h1 className="text-2xl">Client settings</h1></main>} /></Route>
      <Route path="*" element={<main className="p-6"><h1 className="text-2xl">Portal sign in</h1><p className="my-4">Synthetic outside-/app route.</p><Link to="/app/actions">Open action items</Link></main>} />
    </Routes>
  </ClientDeliveryReviewProvider></BrowserRouter>
</ThemeProvider>);

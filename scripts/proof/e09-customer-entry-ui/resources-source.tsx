import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import AppShell from '../../../src/pages/AppShell';
import Resources from '../../../src/pages/app/Resources';
const queries=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queries}><MemoryRouter initialEntries={['/app/learn']}><Routes>
 <Route path="/app" element={<AppShell/>}><Route path="learn" element={<Resources/>}/><Route path="documents" element={<p>Existing Documents destination — offline placeholder</p>}/><Route path="support" element={<p>Existing Support destination — offline placeholder</p>}/></Route>
</Routes></MemoryRouter></QueryClientProvider>);

import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShellBody} from '@/pages/AppShell';
import Sessions from '@/pages/app/Sessions';
import {CustomerIdentityProvider} from '@/lib/portal/customerIdentity';
import {frame,user,session} from './ports';
const query=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const options=new URLSearchParams(window.location.search);
document.documentElement.classList.toggle('dark',options.has('dark'));
function Review(){const location=useLocation();return <CustomerIdentityProvider state={{frame,phase:'ready',staff:false} as any}>
 <AppShellBody activeUser={user as any} scopedUser={user as any} session={session as any} effectiveUserId={user.id} isImpersonating={false}
  fundingReadiness={false} showOnboarding={false} onOnboardingDone={()=>{}} consentsBlocking={false} onConsentsBlockingChange={()=>{}}
  showTimeoutWarning={false} staySignedIn={()=>{}} viewportHeight={null} pathname={location.pathname}/>
 </CustomerIdentityProvider>;}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/app/sessions']}><Routes>
 <Route path="/app" element={<Review/>}><Route path="sessions" element={<Sessions/>}/><Route path="*" element={<p>Local review exit — no connected business record.</p>}/></Route>
 </Routes></MemoryRouter></QueryClientProvider>);

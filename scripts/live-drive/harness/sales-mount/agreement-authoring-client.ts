// Actual SDK and actual production adapter; only the network is synthetic.
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('https://authoring.fixture.invalid', 'synthetic-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const documentProof=new URLSearchParams(location.search).get('preparationsProof')==='1';
    if(documentProof&&url.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:'bbbbbbbb-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'owner@example.test',is_anonymous:false,created_at:'2026-10-21T12:00:00Z'}),{status:200,headers:{'Content-Type':'application/json'}});
    if(documentProof&&url.pathname==='/functions/v1/agreement-document')return fetch('/__e04_document__'+url.search,{method:request.method,
      ...(request.method==='POST'?{body:await request.text()}:{}),headers:{'Content-Type':'application/json',Authorization:request.headers.get('Authorization')??''},signal:request.signal});
    if (new URLSearchParams(location.search).get('uploadProof') === '1'
      && url.pathname.startsWith('/storage/v1/object/tenant-agreements/')) {
      console.info('[e04-local-proof] Storage upload request observed');
      throw new Error('Synthetic lost upload acknowledgement');
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      return fetch(`/__e04_rpc__/${url.pathname.split('/').at(-1)}`, { method: request.method,
        body: await request.text(), headers: { 'Content-Type': 'application/json' }, signal: request.signal });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
/** Purely synthetic local Auth transport for actual SDK getSession. This is no
 * hosted credential, identity, account or permission/acceptance proof. */
export async function prepareDocumentProofSession(){
  const encode=(value:unknown)=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:'bbbbbbbb-0000-4000-8000-000000000001',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.'+encode('local-synthetic-signature');
  const result=await supabase.auth.setSession({access_token:token,refresh_token:'local-synthetic-refresh'});
  if(result.error)throw new Error('Controlled local Auth transport failed');
}

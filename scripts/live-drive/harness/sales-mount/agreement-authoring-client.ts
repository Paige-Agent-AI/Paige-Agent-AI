// Actual SDK and actual production adapter; only the network is synthetic.
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('https://authoring.fixture.invalid', 'synthetic-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      return fetch(`/__e04_rpc__/${url.pathname.split('/').at(-1)}`, { method: request.method,
        body: await request.text(), headers: { 'Content-Type': 'application/json' }, signal: request.signal });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});

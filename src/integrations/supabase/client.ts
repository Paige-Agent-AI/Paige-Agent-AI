import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { detectsSessionFromUrl, scrubTenantHostAuthParams } from '@/lib/hostRouting';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Cross-browser safe storage. Safari (Block all cookies / Private Browsing /
// locked-down privacy) can THROW just on accessing window.localStorage — a
// SecurityError on the getter, or QuotaExceededError on write. A bare
// `storage: localStorage` reference is evaluated at module load, so that throw
// would blank the entire app in Safari (this client is imported app-wide) and
// make login impossible. We probe once inside try/catch and fall back to an
// in-memory store so the session still works for the tab, degrading gracefully
// instead of hard-failing. This also keeps PKCE OAuth working, since it stashes
// the code-verifier in this same storage.
function createSafeStorage(): Storage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__paige_ls_probe__';
      window.localStorage.setItem(probe, probe);
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to in-memory */
  }
  const mem = new Map<string, string>();
  return {
    getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
    setItem: (key: string, value: string) => { mem.set(key, String(value)); },
    removeItem: (key: string) => { mem.delete(key); },
    clear: () => { mem.clear(); },
    key: (index: number) => Array.from(mem.keys())[index] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

// On a tenant host, auth-callback parameters (tokens, codes, errors) are removed from the address bar
// before anything else can read location.href. This module is the earliest seam the app graph offers:
// it is evaluated while main.tsx's static imports load (App -> BusinessProvider -> here), so before
// main.tsx calls initObservability (Sentry, PostHog), before React renders MetaPixel, SpeedInsights and
// usePageView, and before useHostRouting's effect. With detectSessionInUrl off there, auth-js no longer
// clears the hash itself. Every other host: untouched. (The Plausible loader in index.html is an inline
// script that runs before any module, so this cannot be guaranteed to beat it.)
scrubTenantHostAuthParams();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: createSafeStorage(),
    persistSession: true,
    autoRefreshToken: true,
    // A session is born only on the app origin. On a tenant host (<slug>.paigeagent.ai) tokens in the
    // URL are ignored rather than adopted; every other host keeps supabase-js's default (true).
    detectSessionInUrl: detectsSessionFromUrl(typeof window !== 'undefined' ? window.location.hostname : ''),
  }
});

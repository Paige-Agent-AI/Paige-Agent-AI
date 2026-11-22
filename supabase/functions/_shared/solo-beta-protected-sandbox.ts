export const PROTECTED_SOLO_LOCAL_ORIGIN = "http://localhost:5173";

/** Test credentials may drive only the protected offer in an isolated local project. */
export function isProtectedSoloSandbox(enabled: boolean, supabaseUrl: string, stripeKey: string): boolean {
  if (!enabled || !/^(sk|rk)_test_/.test(stripeKey)) return false;
  const target = URL.parse(supabaseUrl);
  return !!target && target.protocol === "http:" && target.hostname === "127.0.0.1" &&
    target.port !== "" && !target.username && !target.password &&
    target.pathname === "/" && !target.search && !target.hash;
}

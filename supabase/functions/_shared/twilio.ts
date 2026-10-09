// _shared/twilio.ts — the ONE authenticated Twilio client for the whole platform.
//
// Comms C-2 foundation. Every Twilio REST call (subaccount create, number search,
// number purchase, SMS send, A2P registration) goes THROUGH this seam so there is
// exactly one home for Twilio auth + form-encoding + retry + structured errors
// (§12/§18 — one capability, one home). It replaces the ~8 inline-REST duplicates
// scattered across the legacy send-sms* functions as a fast-follow; C-2's
// per-tenant SMS path uses it now.
//
// DESIGN CONTRACT
//   • Pure Deno/esm, no product logic, no table writes. It authenticates and speaks
//     Twilio's HTTP API and hands back a uniform result — callers own the DB/audit.
//   • Structured result, never a throw for an API-level failure: every call resolves
//     to { ok, status, error, data }. A thrown exception is reserved for genuinely
//     exceptional misuse; network faults degrade to { ok:false, status:0, error }.
//   • Secrets NEVER appear in an error string or a log. The auth token travels only
//     in the Basic-auth header; Twilio's own error bodies carry no secret, and we
//     cap the echoed body so a stray payload can't smuggle one out.
//   • HONESTY (§13): the A2P wrappers (createBrand/createCampaign) are NOT wired to
//     TrustHub yet — they return { ok:false, needs_config:true } and NEVER a fake
//     brand/campaign SID. A missing platform master credential likewise returns a
//     needs_config result, never a crash.
//
// PER-TENANT CREDENTIAL MODEL (§9, D1 + C-2a API-Key auth 2026-07-28)
//   tenant_twilio_subaccounts is the 1-per-tenant ACCOUNT entity: it holds the Twilio
//   SUBaccount SID + a SUBACCOUNT-scoped API Key SID (api_key_sid, "SK…") + a Vault REF
//   (name) to that API Key's SECRET — never the raw secret. Under MASTER API-Key auth
//   Twilio's subaccount-create response OMITS auth_token, so we no longer depend on it;
//   provisioning mints a subaccount API Key (createSubaccountApiKey) and vaults that
//   secret. resolveTwilioCreds() reads the row, decrypts the API-Key secret through the
//   proven Vault bridge RPC (read_channel_secret), and builds Basic auth as
//   api_key_sid : <secret> (the master API-Key pattern — username is the SK…, NOT the
//   subaccount SID). Master (platform) creds come from env via masterCreds() and are
//   used to mint subaccounts, mint subaccount API Keys, and for the +1 470 super-admin
//   path (D2/D3).

// -----------------------------------------------------------------------------
// Result + credential shapes
// -----------------------------------------------------------------------------

/** Uniform return of every Twilio call. `data` is the parsed JSON body on success. */
export interface TwilioResult<T = Record<string, unknown>> {
  ok: boolean;
  /** HTTP status, or 0 for a transport-level failure (never reached the API). */
  status: number;
  /** Structured error message on failure, else null. Never contains a secret. */
  error: string | null;
  /** Parsed JSON body, or null when the call failed / returned no body. */
  data: T | null;
  /**
   * Present + true when the call could not run because something isn't wired yet
   * (unwired A2P stub, missing master credential, missing tenant subaccount). This
   * is an HONEST degrade (§13) — distinct from an API error — so callers can branch
   * to "not configured" UX instead of "send failed".
   */
  needs_config?: boolean;
}

/** A resolved Twilio credential pair (either a subaccount's or the platform master's). */
export interface TwilioCreds {
  /** AC… — the account the request ACTS ON, used only in the URL path. */
  accountSid: string;
  /** Basic-auth PASSWORD: an API Key Secret (master path) or a subaccount auth token. */
  authToken: string;
  /**
   * SK… — Basic-auth USERNAME for the API-Key auth path (Twilio best-practice). When
   * present the Basic-auth username is this API Key SID, NOT accountSid; the account is
   * still addressed by accountSid in the URL path. Set on BOTH the master path (D2/D3
   * master creds) AND the per-subaccount path (C-2a: the subaccount-scoped api_key_sid
   * resolved by resolveTwilioCreds). Callers thread it to twilioRequest as `authUser`.
   */
  apiKeySid?: string;
}

/** Minimal shape of the tenant_twilio_subaccounts row this helper reads (§9, D1/C-2a). */
interface TenantSubaccountRow {
  subaccount_sid: string | null;
  /** SK… — the subaccount-scoped API Key SID; Basic-auth USERNAME (C-2a). */
  api_key_sid: string | null;
  /** Vault ref for the API-Key SECRET (Basic-auth password). Meaning changed in C-2a. */
  auth_token_vault_ref: string | null;
  status?: string | null;
}

// -----------------------------------------------------------------------------
// Core request primitive
// -----------------------------------------------------------------------------


// Deno-in-vitest guard (house pattern): edge runtime reads env through Deno.env; a
// vitest/app-tsc import of this module resolves the same reads to undefined instead
// of failing to typecheck. Behavior in the edge runtime is byte-identical.
const denoEnv = (globalThis as unknown as { Deno?: { env?: { get?: (k: string) => string | undefined } } })
  .Deno?.env?.get
  ?.bind((globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno.env)
  ?? ((): string | undefined => undefined);

const TWILIO_API_HOST = "https://api.twilio.com";
const MAX_ERROR_BODY = 400; // cap echoed error bodies (belt-and-suspenders on secrets)

type TwilioParamValue = string | number | boolean | undefined | null | string[];

/**
 * Form-encode a flat param map to application/x-www-form-urlencoded. Undefined/null
 * values are dropped; array values are repeated (Twilio's convention for e.g.
 * multiple MediaUrl entries). Booleans/numbers are stringified.
 */
function formEncode(params: Record<string, TwilioParamValue>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.append(k, String(v));
    }
  }
  return usp.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The single authenticated Twilio REST call. Basic-auth with the supplied creds,
 * form-encodes params (for write verbs) or query-strings them (for GET), retries
 * ONCE on a 429 or 5xx (transient), and always resolves to a structured
 * TwilioResult — never leaking the auth token into an error.
 *
 * @param accountSid  The account the request ACTS ON (master or subaccount) — used to
 *                    address the account in the URL path. Also the Basic-auth username
 *                    UNLESS `authUser` is supplied.
 * @param authToken   The Basic-auth PASSWORD (a subaccount auth token, or an API Key
 *                    Secret when `authUser` is an API Key SID). Never logged.
 * @param path        Either an absolute https URL or a path beginning with "/"
 *                    (prefixed with https://api.twilio.com). Lets A2P/TrustHub hosts
 *                    be addressed by passing their full URL.
 * @param method      HTTP verb.
 * @param params      Flat param map. For GET these become the query string; for
 *                    write verbs, the form body.
 * @param authUser    Optional Basic-auth USERNAME override. When set (e.g. an API Key
 *                    SID `SK…` for the master path), the Basic-auth username is this
 *                    instead of `accountSid`, while the URL still addresses `accountSid`.
 *                    This is how API-Key auth (Twilio best-practice) decouples the
 *                    credential from the account it acts on.
 */
export async function twilioRequest<T = Record<string, unknown>>(
  accountSid: string,
  authToken: string,
  path: string,
  method: "GET" | "POST" | "DELETE" = "POST",
  params: Record<string, TwilioParamValue> = {},
  authUser?: string,
): Promise<TwilioResult<T>> {
  // The Basic-auth username is the API Key SID when provided, else the account SID.
  const basicUser = (authUser && authUser.length > 0) ? authUser : accountSid;
  if (!basicUser || !authToken) {
    return { ok: false, status: 0, error: "twilio_missing_credentials", data: null, needs_config: true };
  }

  const isAbsolute = /^https?:\/\//i.test(path);
  let url = isAbsolute ? path : `${TWILIO_API_HOST}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    // Credentials live ONLY here, never in the URL — so a fetch-reject TypeError (which
    // echoes the request URL) can never surface the secret. username = API Key SID
    // (master, best-practice) or subaccount SID; password = API Key Secret / auth token.
    Authorization: "Basic " + btoa(`${basicUser}:${authToken}`),
  };

  let bodyStr: string | undefined;
  const encoded = formEncode(params);
  if (method === "GET" || method === "DELETE") {
    if (encoded) url += (url.includes("?") ? "&" : "?") + encoded;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    bodyStr = encoded;
  }

  const attempt = async (): Promise<TwilioResult<T>> => {
    try {
      const res = await fetch(url, { method, headers, body: bodyStr });
      const raw = await res.text();
      let json: unknown = null;
      if (raw) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
      }
      if (!res.ok) {
        // Twilio error bodies are { code, message, more_info, status } — safe to echo,
        // but cap length defensively. Prefer the API's own message.
        const apiMsg =
          (json && typeof json === "object" && "message" in (json as Record<string, unknown>)
            ? String((json as Record<string, unknown>).message)
            : raw) || `twilio_http_${res.status}`;
        return {
          ok: false,
          status: res.status,
          error: `twilio_${res.status}: ${apiMsg.slice(0, MAX_ERROR_BODY)}`,
          data: (json as T) ?? null,
        };
      }
      return { ok: true, status: res.status, error: null, data: (json as T) ?? null };
    } catch (e) {
      // Transport-level failure — never reached Twilio. status 0 signals "retryable".
      return { ok: false, status: 0, error: `twilio_network: ${(e as Error).message.slice(0, MAX_ERROR_BODY)}`, data: null };
    }
  };

  let result = await attempt();
  // Retry ONCE on a transient failure: 429 (rate limit), any 5xx, or a transport fault (status 0).
  if (!result.ok && (result.status === 0 || result.status === 429 || result.status >= 500)) {
    await sleep(result.status === 429 ? 1000 : 400);
    result = await attempt();
  }
  return result;
}

// -----------------------------------------------------------------------------
/** JSON request variant for Twilio Compliance Embeddable. */
export async function twilioJsonRequest<T = Record<string, unknown>>(
  creds: TwilioCreds,
  url: string,
  method: "GET" | "POST" = "POST",
  payload?: Record<string, unknown>,
): Promise<TwilioResult<T>> {
  const user = creds.apiKeySid || creds.accountSid;
  if (!user || !creds.authToken || !/^https:\/\/(trusthub|messaging)\.twilio\.com\//i.test(url)) {
    return { ok: false, status: 0, error: "twilio_invalid_compliance_request", data: null };
  }
  const attempt = async (): Promise<TwilioResult<T>> => {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: "Basic " + btoa(`${user}:${creds.authToken}`),
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const raw = await res.text();
      let parsed: unknown = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
      if (!res.ok) {
        const message = parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as Record<string, unknown>).message) : `twilio_http_${res.status}`;
        return { ok: false, status: res.status, error: `twilio_${res.status}: ${message.slice(0, MAX_ERROR_BODY)}`, data: null };
      }
      return { ok: true, status: res.status, error: null, data: parsed as T };
    } catch (error) {
      return { ok: false, status: 0, error: `twilio_network: ${String((error as Error).message).slice(0, MAX_ERROR_BODY)}`, data: null };
    }
  };
  let result = await attempt();
  if (!result.ok && (result.status === 0 || result.status === 429 || result.status >= 500)) {
    await sleep(result.status === 429 ? 1000 : 400);
    result = await attempt();
  }
  return result;
}
// Master (platform) credentials — env only (D2/D3)
// -----------------------------------------------------------------------------

/**
 * The platform master Twilio credentials from env. Read at CALL time (never module
 * load) so rotation needs no redeploy. Returns null when unset — callers surface a
 * needs_config degrade, never a crash (§13).
 *
 * CREDENTIAL PATTERN (owner-confirmed 2026-07-27): prod carries an API KEY trio —
 * TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID (SK…) + TWILIO_API_KEY_SECRET — and NOT the
 * master TWILIO_AUTH_TOKEN (intentionally absent; Twilio best-practice is scoped,
 * rotatable API Keys over the all-powerful account Auth Token). So the master Basic-auth
 * USERNAME is the API Key SID and the PASSWORD is the API Key Secret, while the URL path
 * still addresses the master Account SID (returned as `accountSid`, threaded to
 * twilioRequest, and paired with `apiKeySid` as the auth username).
 *
 * Legacy fallback: if the API Key trio isn't fully set but a legacy TWILIO_AUTH_TOKEN
 * IS present (e.g. an older env), fall back to account-SID:auth-token Basic auth so the
 * change is safe across environments. Prod uses the API Key path.
 */
export function masterCreds(): TwilioCreds | null {
  const accountSid = denoEnv("TWILIO_ACCOUNT_SID") ?? "";
  if (!accountSid) return null;
  const apiKeySid = denoEnv("TWILIO_API_KEY_SID") ?? "";
  const apiKeySecret = denoEnv("TWILIO_API_KEY_SECRET") ?? "";
  if (apiKeySid && apiKeySecret) {
    // Preferred: API Key auth. username = SK…, password = secret, path account = AC….
    return { accountSid, authToken: apiKeySecret, apiKeySid };
  }
  // Legacy fallback: master Auth Token (username = account SID). Prod does NOT carry this.
  const legacyToken = denoEnv("TWILIO_AUTH_TOKEN") ?? "";
  if (legacyToken) return { accountSid, authToken: legacyToken };
  return null;
}

/**
 * The ready-to-use `Authorization: Basic …` header value for the platform MASTER
 * account, honoring the API-Key-first credential pattern above (username = API Key SID,
 * password = API Key Secret; legacy fallback = account SID : auth token). Returns null
 * when no master credential is configured (honest degrade — the caller surfaces
 * needs_config, never sends with an empty password). This is the ONE master-auth home
 * (§18) the legacy inline SMS senders reuse so none of them re-derive the auth pattern.
 */
export function masterBasicAuthHeader(): string | null {
  const m = masterCreds();
  if (!m) return null;
  const user = (m.apiKeySid && m.apiKeySid.length > 0) ? m.apiKeySid : m.accountSid;
  return "Basic " + btoa(`${user}:${m.authToken}`);
}

// -----------------------------------------------------------------------------
// Per-tenant credential resolution (Vault bridge, §9 / D1)
// -----------------------------------------------------------------------------

/**
 * Loose structural type for the supabase-js admin (service-role) client this helper
 * needs — kept permissive (mirrors railAutomation's RpcClient) so any service-role
 * SupabaseClient assigns without friction, and twilio.ts stays dependency-free /
 * importable by the pure layer. The caller passes the real service-role client.
 */
// deno-lint-ignore no-explicit-any
export type SupabaseAdminLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

/**
 * Resolve a tenant's Twilio subaccount credentials: read tenant_twilio_subaccounts
 * for the tenant, then decrypt the API-Key SECRET from Vault via the read_channel_secret
 * SECURITY-DEFINER RPC (the only path an edge function can read vault.decrypted_secrets;
 * precedent: cron_token_header()). Returns a TwilioResult<TwilioCreds>:
 *   • ok:true  + data:{accountSid, authToken, apiKeySid} — tenant is provisioned
 *   • ok:false + needs_config:true                       — no subaccount / no api_key_sid / no vault ref
 *   • ok:false + error                                   — a real lookup/decrypt failure
 *
 * C-2a (owner-confirmed 2026-07-28): the Basic-auth USERNAME is the subaccount-scoped
 * API Key SID (api_key_sid, "SK…"), NOT the subaccount SID, and the PASSWORD is the
 * vaulted API-Key SECRET (auth_token_vault_ref now refs that secret). This is exactly
 * the master API-Key pattern (masterBasicAuthHeader). If api_key_sid is null (a legacy/
 * none row) we degrade to needs_config rather than send with the WRONG username.
 * The URL path still addresses the subaccount via accountSid.
 *
 * MUST be called with a SERVICE-ROLE client — the RPC is granted to service_role only,
 * and the secret must never transit an anon/authenticated context.
 */
export async function resolveTwilioCreds(
  supabaseAdmin: SupabaseAdminLike,
  tenantId: string,
): Promise<TwilioResult<TwilioCreds>> {
  if (!tenantId) {
    return { ok: false, status: 0, error: "twilio_missing_tenant_id", data: null };
  }

  const { data, error: rowErr } = await supabaseAdmin
    .from("tenant_twilio_subaccounts")
    // NOTE: the column is `twilio_subaccount_sid` on tenant_twilio_subaccounts;
    // alias it to subaccount_sid so the reads below stay stable (verify-crew fix #3).
    .select("subaccount_sid:twilio_subaccount_sid, api_key_sid, auth_token_vault_ref, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const row = data as TenantSubaccountRow | null;

  if (rowErr) {
    return { ok: false, status: 0, error: `twilio_subaccount_lookup_failed: ${String((rowErr as { message?: string })?.message ?? rowErr).slice(0, MAX_ERROR_BODY)}`, data: null };
  }
  if (!row || !row.subaccount_sid || !row.auth_token_vault_ref) {
    // Tenant hasn't been provisioned a Twilio subaccount yet — honest degrade.
    return { ok: false, status: 0, error: "twilio_subaccount_not_provisioned", data: null, needs_config: true };
  }
  if (!row.api_key_sid) {
    // Legacy/none row without a subaccount-scoped API Key — under API-Key auth we cannot
    // send with the subaccount SID as the username, so degrade honestly (§13) instead of
    // authing with the wrong username (which Twilio would 401).
    return { ok: false, status: 0, error: "twilio_subaccount_api_key_missing", data: null, needs_config: true };
  }

  const { data: secret, error: secErr } = await supabaseAdmin.rpc("read_channel_secret", {
    _ref: row.auth_token_vault_ref,
  });
  if (secErr) {
    return { ok: false, status: 0, error: `twilio_vault_read_failed: ${String((secErr as { message?: string })?.message ?? secErr).slice(0, MAX_ERROR_BODY)}`, data: null };
  }
  const apiKeySecret = typeof secret === "string" ? secret : "";
  if (!apiKeySecret) {
    return { ok: false, status: 0, error: "twilio_vault_ref_empty", data: null, needs_config: true };
  }

  // authToken = API-Key SECRET (password); apiKeySid = SK… (username). accountSid = the
  // subaccount SID (URL path). twilioRequest uses apiKeySid as the Basic-auth username
  // whenever the caller threads it through (see sendSms/purchaseNumber/listAvailableNumbers).
  return {
    ok: true,
    status: 200,
    error: null,
    data: { accountSid: row.subaccount_sid, authToken: apiKeySecret, apiKeySid: row.api_key_sid },
  };
}

// -----------------------------------------------------------------------------
// Typed wrappers used by C-2
// -----------------------------------------------------------------------------

/**
 * Create a Twilio SUBaccount under the platform master account (D1: the 1-per-tenant
 * account entity). Uses master creds (env). The response `data.sid` is the subaccount
 * SID — the caller stores it on tenant_twilio_subaccounts.
 *
 * IMPORTANT (C-2a, owner-confirmed 2026-07-28): under MASTER API-KEY auth Twilio's
 * POST /Accounts.json returns the new subaccount's `sid` but OMITS `auth_token`
 * (confirmed empirically). So `data.auth_token` may be absent — the caller MUST NOT
 * depend on it. Instead it mints a subaccount-scoped API Key via createSubaccountApiKey()
 * and vaults THAT secret. Returns needs_config when master creds are unset.
 */
/**
 * INT-345 K-4 — READ-ONLY subaccount inventory under the master account (the
 * orphan-inspection step of the authorized reconciliation: which subaccounts
 * exist at Twilio, and which of them have no DB row). GET only; no writes, no
 * secrets. Returns needs_config when master creds are unset.
 */
export async function listSubaccounts(): Promise<TwilioResult> {
  const master = masterCreds();
  if (!master) {
    return { ok: false, status: 0, error: "twilio_master_not_configured", data: null, needs_config: true };
  }
  return await twilioRequest(
    master.accountSid,
    master.authToken,
    "/2010-04-01/Accounts.json?PageSize=400",
    "GET",
    undefined,
    master.apiKeySid,
  );
}

export async function createSubaccount(friendlyName: string): Promise<TwilioResult> {
  const master = masterCreds();
  if (!master) {
    return { ok: false, status: 0, error: "twilio_master_not_configured", data: null, needs_config: true };
  }
  return await twilioRequest(
    master.accountSid,
    master.authToken,
    "/2010-04-01/Accounts.json",
    "POST",
    { FriendlyName: friendlyName },
    master.apiKeySid, // API Key SID as the Basic-auth username (master path); undefined on legacy fallback
  );
}

/** Twilio's response body for a new subaccount API Key (the SECRET is shown ONCE). */
export interface SubaccountApiKey {
  /** SK… — the API Key SID (Basic-auth USERNAME). Non-secret. */
  sid: string;
  /** The API Key SECRET (Basic-auth PASSWORD). Shown ONCE by Twilio — vault it immediately. */
  secret: string;
}

/**
 * Mint a SUBACCOUNT-scoped API Key on an existing subaccount, authenticated with MASTER
 * creds (the master API Key is account-scoped, so it can create keys on any subaccount
 * under the master account). POSTs to /2010-04-01/Accounts/{subaccountSid}/Keys.json;
 * Twilio returns { sid: "SK…", secret } and the SECRET is shown ONCE. Returns both so
 * the caller can vault the secret immediately (§34 — the secret is NEVER logged, NEVER
 * persisted outside Vault). Reuses the ONE Twilio seam (twilioRequest + masterCreds,
 * §18). Returns needs_config when master creds are unset, and a structured error if
 * Twilio's response is missing the SK/secret pair (§13 — never a fabricated key).
 */
export async function createSubaccountApiKey(subaccountSid: string): Promise<TwilioResult<SubaccountApiKey>> {
  if (!subaccountSid) {
    return { ok: false, status: 0, error: "twilio_missing_subaccount_sid", data: null };
  }
  const master = masterCreds();
  if (!master) {
    return { ok: false, status: 0, error: "twilio_master_not_configured", data: null, needs_config: true };
  }
  const res = await twilioRequest<SubaccountApiKey>(
    // URL path addresses the SUBaccount; Basic-auth is the MASTER API Key (account-scoped).
    subaccountSid,
    master.authToken,
    `/2010-04-01/Accounts/${encodeURIComponent(subaccountSid)}/Keys.json`,
    "POST",
    { FriendlyName: "Paige subaccount API key (C-2a)" },
    master.apiKeySid, // master API Key SID as the Basic-auth username; undefined on legacy fallback
  );
  if (!res.ok) return res;
  const sid = res.data?.sid;
  const secret = res.data?.secret;
  if (!sid || !secret) {
    // Twilio should always return both on a 2xx; guard so a caller never vaults an empty
    // secret or stores a null SID (§13 — honest, no fabricated key).
    return { ok: false, status: res.status, error: "twilio_api_key_missing_sid_or_secret", data: null };
  }
  return { ok: true, status: res.status, error: null, data: { sid, secret } };
}

export interface AvailableNumberSearch {
  areaCode?: string;
  /**
   * Twilio's `Contains` pattern. Digits match literally and `*` is a single-character
   * wildcard, so a caller wanting numbers that BEGIN with something passes the trailing
   * wildcards themselves (`555****`). Letters are accepted and mapped to the keypad by
   * Twilio, which is how a vanity search works.
   */
  contains?: string;
  /** ISO country for the AvailablePhoneNumbers path; defaults to "US". */
  country?: string;
  /** Number type segment; defaults to "Local". `TollFree` is how an 800/833/844… is found. */
  type?: "Local" | "TollFree" | "Mobile";
  smsEnabled?: boolean;
  /**
   * Two-letter state or province, e.g. `GA`. Twilio's `InRegion`.
   *
   * Added 2026-08-31: every other filter below was already reaching Twilio and simply had
   * no control on any surface, but region genuinely was not passed at all — searching by
   * state was impossible rather than merely unexposed.
   */
  inRegion?: string;
  /** City, e.g. `Atlanta`. Twilio's `InLocality`. Same story as `inRegion`. */
  inLocality?: string;
}

/**
 * Search available phone numbers to purchase, authenticated as the tenant's SUBaccount
 * (numbers are bought into the subaccount). `data.available_phone_numbers` is the list.
 */
export async function listAvailableNumbers(
  subaccountSid: string,
  subToken: string,
  opts: AvailableNumberSearch = {},
  authUser?: string,
): Promise<TwilioResult> {
  const country = opts.country || "US";
  const type = opts.type || "Local";
  return await twilioRequest(
    subaccountSid,
    subToken,
    `/2010-04-01/Accounts/${encodeURIComponent(subaccountSid)}/AvailablePhoneNumbers/${encodeURIComponent(country)}/${encodeURIComponent(type)}.json`,
    "GET",
    {
      AreaCode: opts.areaCode,
      Contains: opts.contains,
      InRegion: opts.inRegion,
      InLocality: opts.inLocality,
      // Capabilities are DISPLAY, not a gate (§36, bug #149): when the caller does not
      // explicitly constrain SMS, OMIT the SmsEnabled param entirely so Twilio returns
      // ALL numbers (SMS-capable or not) — undefined is dropped by formEncode. Only pass
      // the flag when a caller deliberately set it.
      SmsEnabled: opts.smsEnabled === undefined ? undefined : String(opts.smsEnabled),
    },
    // C-2a: the subaccount-scoped API Key SID as the Basic-auth username. Omitted →
    // username falls back to subaccountSid (wrong under API-Key auth), so callers that
    // resolve via resolveTwilioCreds MUST pass creds.data.apiKeySid here.
    authUser,
  );
}

export interface PurchaseNumberOptions {
  /** Delivery/status callback URL Twilio hits with message status events. */
  statusCallback?: string;
  /** Inbound SMS webhook URL (the C-2 Twilio inbound handler). */
  smsUrl?: string;
  friendlyName?: string;
}

/**
 * Purchase a phone number into the tenant's SUBaccount. `data.sid` is the
 * IncomingPhoneNumber SID; `data.phone_number` the E.164 number.
 */
export async function purchaseNumber(
  subaccountSid: string,
  subToken: string,
  phoneNumber: string,
  opts: PurchaseNumberOptions = {},
  authUser?: string,
): Promise<TwilioResult> {
  return await twilioRequest(
    subaccountSid,
    subToken,
    `/2010-04-01/Accounts/${encodeURIComponent(subaccountSid)}/IncomingPhoneNumbers.json`,
    "POST",
    {
      PhoneNumber: phoneNumber,
      FriendlyName: opts.friendlyName,
      SmsUrl: opts.smsUrl,
      StatusCallback: opts.statusCallback,
    },
    // C-2a: the subaccount-scoped API Key SID as the Basic-auth username. Omitted →
    // username falls back to subaccountSid (wrong under API-Key auth), so callers that
    // resolve via resolveTwilioCreds MUST pass creds.data.apiKeySid here.
    authUser,
  );
}

export interface SendSmsOptions {
  from: string;
  to: string;
  body: string;
  /** Per-message delivery status callback (overrides the number-level one). */
  statusCallback?: string;
  /** Optional Messaging Service SID (A2P) to send through instead of a bare From. */
  messagingServiceSid?: string;
}

/**
 * Send an SMS authenticated as the tenant's SUBaccount. `data.sid` is the Twilio
 * message SID (the vendor_message_id the caller records). Mirrors the shape the
 * legacy inline path posted — but through the ONE authenticated seam.
 */
export async function sendSms(
  subaccountSid: string,
  subToken: string,
  opts: SendSmsOptions,
  authUser?: string,
): Promise<TwilioResult> {
  const params: Record<string, TwilioParamValue> = {
    To: opts.to,
    Body: opts.body,
    StatusCallback: opts.statusCallback,
  };
  // A2P Messaging Service takes precedence over a bare From when present.
  if (opts.messagingServiceSid) {
    params.MessagingServiceSid = opts.messagingServiceSid;
  } else {
    params.From = opts.from;
  }
  // `authUser` (an API Key SID) is the master-path Basic-auth username for the
  // Super-Admin +1 470 number, which lives on the MASTER account (not a subaccount).
  // For the subaccount path it's omitted → username = subaccountSid. The URL always
  // addresses the account passed as `subaccountSid` (master AC… or subaccount AC…).
  return await twilioRequest(
    subaccountSid,
    subToken,
    `/2010-04-01/Accounts/${encodeURIComponent(subaccountSid)}/Messages.json`,
    "POST",
    params,
    authUser,
  );
}

// -----------------------------------------------------------------------------
// A2P 10DLC stubs — NOT wired yet (§13 honest degrade)
// -----------------------------------------------------------------------------
//
// A2P brand/campaign registration runs through Twilio TrustHub
// (https://trusthub.twilio.com/v1 + https://messaging.twilio.com/v1) and requires
// business-profile onboarding we haven't built. Until that lands these return a
// needs_config result so no caller ever mistakes an unwired stub for a real
// brand/campaign SID. When wired, replace the body with a twilioRequest to the
// TrustHub endpoint — the signature stays stable so callers don't change.

export interface CreateBrandInput {
  tenantId: string;
  legalBusinessName?: string;
  ein?: string;
  [k: string]: unknown;
}

export interface CreateCampaignInput {
  tenantId: string;
  brandSid?: string;
  useCase?: string;
  [k: string]: unknown;
}

/** A2P brand registration — NOT wired. Returns needs_config, never a fake brand SID. */
export function createBrand(_input: CreateBrandInput): Promise<TwilioResult> {
  return Promise.resolve({
    ok: false,
    status: 0,
    error: "a2p_brand_registration_not_wired",
    data: null,
    needs_config: true,
  });
}

/** A2P campaign registration — NOT wired. Returns needs_config, never a fake campaign SID. */
export function createCampaign(_input: CreateCampaignInput): Promise<TwilioResult> {
  return Promise.resolve({
    ok: false,
    status: 0,
    error: "a2p_campaign_registration_not_wired",
    data: null,
    needs_config: true,
  });
}

// -----------------------------------------------------------------------------
// Voice — Access Token (JWT) + TwiML Application (Comms C-2v, #140 Slice A1)
// -----------------------------------------------------------------------------
//
// Twilio Voice for the browser SDK needs two server-minted things, both built HERE on
// the ONE Twilio seam (§18 — no second client, no new npm dep):
//   • a per-subaccount TwiML Application (ensureTwimlApp) whose VoiceUrl points at the
//     future voice-twiml webhook — the ApplicationSid the outgoing VoiceGrant
//     references. Minted once per subaccount, reused (idempotent on twiml_app_sid).
//   • a SHORT-LIVED Access Token JWT (mintVoiceAccessToken), HS256-signed with the
//     tenant subaccount's API-Key SECRET (Vault, via resolveTwilioCreds), carrying a
//     VoiceGrant. The browser uses it to register with Twilio and place/receive calls
//     billed to the tenant subaccount.
//
// The token is a bearer credential: whoever holds it can place calls as `identity` on
// the tenant subaccount, billed to it. So (§9/§13):
//   • the caller derives `identity` SERVER-SIDE from the verified JWT (tenant + user),
//     NEVER from the request body — a token can never impersonate another tenant/user;
//   • the TTL is SHORT (default 600s, hard-capped 3600s) so a leaked token expires fast.
// No new dependency: the JWT is signed with Web Crypto HMAC (the webhookSig.ts
// precedent), which also gives full control of Twilio's required `cty:"twilio-fpa;v=1"`
// header (djwt's Header shape is awkward for the custom content-type). The secret NEVER
// leaves this module — it is used only as the HMAC key and never logged/returned.

/** SHORT-lived Access Token defaults — a leaked token must expire fast (§9/§13). */
const VOICE_TOKEN_DEFAULT_TTL_SECONDS = 600; // 10 minutes
const VOICE_TOKEN_MIN_TTL_SECONDS = 60;
const VOICE_TOKEN_MAX_TTL_SECONDS = 3600; // hard cap — a body value can only shorten within this

/** base64url (no padding) of a UTF-8 string or raw bytes — JWT segment encoding. */
function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 sign (Web Crypto) — the same primitive as webhookSig.ts. */
async function hmacSha256Bytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/** Clamp a requested TTL into [MIN, MAX], defaulting when unset/invalid. */
function clampVoiceTtl(requested?: number): number {
  const n = typeof requested === "number" && Number.isFinite(requested)
    ? Math.floor(requested)
    : VOICE_TOKEN_DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(n, VOICE_TOKEN_MIN_TTL_SECONDS), VOICE_TOKEN_MAX_TTL_SECONDS);
}

/**
 * The VoiceUrl a newly-minted TwiML Application points at — the FUTURE voice-twiml
 * webhook (Slice B). Nothing calls it in A1; the Application just needs a VoiceUrl to
 * be created, and storing the intended URL now means the webhook slice doesn't have to
 * re-point every app. Overridable via VOICE_TWIML_URL for non-default deployments.
 */
export function voiceTwimlUrl(secret?: string | null): string | null {
  const explicit = denoEnv("VOICE_TWIML_URL");
  const baseUrl = explicit && explicit.length > 0
    ? explicit
    : (() => {
      const base = (denoEnv("SUPABASE_URL") ?? "").replace(/\/$/, "");
      return base ? `${base}/functions/v1/voice-twiml` : null;
    })();
  if (!baseUrl) return null;
  if (!secret) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("t", secret);
  return url.toString();
}

/** Minimal shape of the tenant_twilio_subaccounts row ensureTwimlApp reads (C-2v). */
interface SubaccountVoiceRow {
  subaccount_sid: string | null;
  api_key_sid: string | null;
  auth_token_vault_ref: string | null;
  twiml_app_sid: string | null;
  inbound_webhook_secret: string | null;
  config: Record<string, unknown> | null;
}
const VOICE_WEBHOOK_AUTH_VERSION = "tenant_secret_v1";

export interface EnsureTwimlAppResult {
  /** AP… — the tenant subaccount's TwiML Application SID. */
  applicationSid: string;
  /** true when this call created the app; false when it reused an existing one. */
  created: boolean;
}

/**
 * Ensure the tenant subaccount has a TwiML Application (the outgoing VoiceGrant target),
 * minting it once and persisting twiml_app_sid on tenant_twilio_subaccounts. Idempotent:
 * if the row already has a twiml_app_sid it is returned without touching Twilio.
 *
 *   • ok:true  + data:{applicationSid, created} — app exists/created + persisted
 *   • needs_config:true                          — subaccount not provisioned / creds missing
 *   • ok:false + error                           — a real Twilio/persist failure (§13)
 *
 * MUST be called with a SERVICE-ROLE client (Vault read + subaccount write). Reuses the
 * ONE Twilio seam (twilioRequest) and resolveTwilioCreds — no second client (§18). The
 * caller may pass already-resolved creds (opts.creds) to avoid a second Vault round-trip
 * (provisioning does this with the just-minted key).
 */
export async function ensureTwimlApp(
  supabaseAdmin: SupabaseAdminLike,
  tenantId: string,
  opts: { voiceUrl?: string; creds?: TwilioCreds; forceRepair?: boolean } = {},
): Promise<TwilioResult<EnsureTwimlAppResult>> {
  if (!tenantId) {
    return { ok: false, status: 0, error: "twilio_missing_tenant_id", data: null };
  }

  const { data, error: rowErr } = await supabaseAdmin
    .from("tenant_twilio_subaccounts")
    .select("subaccount_sid:twilio_subaccount_sid, api_key_sid, auth_token_vault_ref, twiml_app_sid, inbound_webhook_secret, config")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (rowErr) {
    return { ok: false, status: 0, error: `twilio_subaccount_lookup_failed: ${String((rowErr as { message?: string })?.message ?? rowErr).slice(0, MAX_ERROR_BODY)}`, data: null };
  }
  const row = data as SubaccountVoiceRow | null;
  if (!row || !row.subaccount_sid) {
    return { ok: false, status: 0, error: "twilio_subaccount_not_provisioned", data: null, needs_config: true };
  }

  if (!row.inbound_webhook_secret) {
    return { ok: false, status: 0, error: "voice_webhook_secret_missing", data: null, needs_config: true };
  }
  if (!opts.forceRepair && row.twiml_app_sid && row.config?.voice_webhook_auth === VOICE_WEBHOOK_AUTH_VERSION) {
    return { ok: true, status: 200, error: null, data: { applicationSid: row.twiml_app_sid, created: false } };
  }

  // Resolve creds (given, or via the Vault bridge) to create or repair the app on the subaccount.
  let creds = opts.creds;
  if (!creds) {
    const r = await resolveTwilioCreds(supabaseAdmin, tenantId);
    if (!r.ok || !r.data) {
      return { ok: false, status: r.status, error: r.error, data: null, needs_config: r.needs_config };
    }
    creds = r.data;
  }
  if (!creds.apiKeySid) {
    return { ok: false, status: 0, error: "twilio_subaccount_api_key_missing", data: null, needs_config: true };
  }

  const baseVoiceUrl = opts.voiceUrl && opts.voiceUrl.length > 0
    ? opts.voiceUrl
    : voiceTwimlUrl(null);
  let voiceUrl: string | null = null;
  if (baseVoiceUrl) {
    try {
      const stamped = new URL(baseVoiceUrl);
      stamped.searchParams.set("t", row.inbound_webhook_secret);
      voiceUrl = stamped.toString();
    } catch {
      voiceUrl = null;
    }
  }
  // §13: refuse to mint a TwiML app without a real VoiceUrl (see defaultVoiceTwimlUrl). Better a
  // needs_config than a subaccount app silently pointed at an invalid host.
  if (!voiceUrl) {
    return { ok: false, status: 0, error: "voice_twiml_url_unavailable", data: null, needs_config: true };
  }

  // Existing apps must be repaired too. A stored Application SID proves neither
  // that the provider resource still exists nor that its VoiceUrl carries the
  // tenant proof required by voice-twiml. Updating the same resource is
  // idempotent and avoids creating a parallel app.
  if (row.twiml_app_sid) {
    const repaired = await twilioRequest(
      creds.accountSid,
      creds.authToken,
      `/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Applications/${encodeURIComponent(row.twiml_app_sid)}.json`,
      "POST",
      { VoiceUrl: voiceUrl, VoiceMethod: "POST" },
      creds.apiKeySid,
    );
    if (!repaired.ok) {
      return { ok: false, status: repaired.status, error: repaired.error, data: null, needs_config: repaired.needs_config };
    }
    const { error: markerError } = await supabaseAdmin
      .from("tenant_twilio_subaccounts")
      .update({ config: { ...(row.config ?? {}), voice_webhook_auth: VOICE_WEBHOOK_AUTH_VERSION } })
      .eq("tenant_id", tenantId);
    if (markerError) {
      console.error("[twilio] repaired VoiceUrl but could not persist repair marker", {
        code: (markerError as { code?: string })?.code ?? null,
      });
    }
    return { ok: true, status: repaired.status, error: null, data: { applicationSid: row.twiml_app_sid, created: false } };
  }
  const res = await twilioRequest(
    creds.accountSid, // URL path addresses the SUBaccount
    creds.authToken, // API-Key SECRET (password)
    `/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Applications.json`,
    "POST",
    { FriendlyName: "Paige Voice (C-2v)", VoiceUrl: voiceUrl, VoiceMethod: "POST" },
    creds.apiKeySid, // API Key SID (username) — API-Key auth
  );
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error, data: null, needs_config: res.needs_config };
  }
  const appSid = (res.data as Record<string, unknown> | null)?.sid as string | undefined;
  if (!appSid) {
    return { ok: false, status: res.status, error: "twilio_application_missing_sid", data: null };
  }

  // Persist. `.is('twiml_app_sid', null)` so a concurrent minter that already stored a
  // SID is never clobbered (the loser's app is a harmless Twilio orphan; primary minter
  // is single-threaded provisioning, so the race is rare).
  const { error: uErr } = await supabaseAdmin
    .from("tenant_twilio_subaccounts")
    .update({
      twiml_app_sid: appSid,
      config: { ...(row.config ?? {}), voice_webhook_auth: VOICE_WEBHOOK_AUTH_VERSION },
    })
    .eq("tenant_id", tenantId)
    .is("twiml_app_sid", null);
  if (uErr) {
    // The app was created at Twilio but persistence failed — report honestly so an
    // operator can reconcile; never return a success that isn't stored (§13).
    return {
      ok: false,
      status: 0,
      error: `twiml_app_persist_failed: ${String((uErr as { message?: string })?.message ?? uErr).slice(0, MAX_ERROR_BODY)}`,
      data: { applicationSid: appSid, created: true },
    };
  }
  // Re-read the authoritative value (a concurrent minter may have won the update race).
  const { data: after } = await supabaseAdmin
    .from("tenant_twilio_subaccounts")
    .select("twiml_app_sid")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const finalSid = (after as { twiml_app_sid: string | null } | null)?.twiml_app_sid ?? appSid;
  return { ok: true, status: res.status, error: null, data: { applicationSid: finalSid, created: true } };
}

// -----------------------------------------------------------------------------
// Twilio request-signature validation (X-Twilio-Signature) — the ONE home (§18)
// -----------------------------------------------------------------------------
//
// Twilio signs every webhook it POSTs with X-Twilio-Signature: an HMAC-SHA1 over
// the full request URL + the POST params sorted by key and concatenated as
// key+value (no separators), base64-encoded, keyed by the Auth Token of the
// account that owns the resource. Three inbound-SMS/DLR functions each carried an
// INLINE copy of this (handle-inbound-sms, twilio-status-callback,
// twilio-inbound-webhook). The voice-twiml webhook needs the same check, so per
// §18 the canonical implementation now lives HERE and voice-twiml reuses it rather
// than forking a fourth copy. (The three SMS copies are left untouched in this
// slice — refactoring them is a §37-scoped follow-up, not a voice deliverable.)
//
// PURE + TESTABLE (§32): computeTwilioSignature is a deterministic function of
// (authToken, url, rawBody) — a Node smoke can mint a signature with a known token
// and assert validateTwilioSignature accepts it and rejects a tampered body.

/**
 * Compute the base64 X-Twilio-Signature Twilio would send for a form-encoded POST:
 *   base64( HMAC-SHA1( authToken, url + Σ sortedByKey(key + value) ) )
 * `rawBody` is the raw application/x-www-form-urlencoded body. Params are sorted by
 * key (stable, duplicate-key-safe via URLSearchParams entry order) exactly as the
 * legacy inline SMS validators did, so the two agree byte-for-byte.
 */
export async function computeTwilioSignature(
  authToken: string,
  url: string,
  rawBody: string,
): Promise<string> {
  const params = new URLSearchParams(rawBody);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const concatenated = url + sorted.map(([k, v]) => k + v).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(concatenated));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/**
 * Validate an incoming X-Twilio-Signature against the recomputed value. Returns
 * false for a missing signature or a mismatch. The caller supplies the Auth Token
 * (a subaccount's or the master's) — this helper is agnostic to which. The compare
 * is length-then-char (Web Crypto has no timing-safe compare in this runtime; the
 * secret is the HMAC key, never revealed by the comparison of two base64 digests).
 */
export async function validateTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  rawBody: string,
): Promise<boolean> {
  if (!authToken || !signature) return false;
  const computed = await computeTwilioSignature(authToken, url, rawBody);
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export interface VoiceAccessToken {
  /** The signed Twilio Access Token JWT (bearer — SHORT-lived). */
  token: string;
  /** The server-derived, tenant-scoped principal the token acts as. */
  identity: string;
  /** Unix seconds at which the token expires. */
  expiresAt: number;
  /** The (clamped) TTL actually applied, in seconds. */
  ttlSeconds: number;
  /** AP… — the TwiML Application the outgoing VoiceGrant references. */
  applicationSid: string;
}

/**
 * Mint a SHORT-lived Twilio Voice Access Token for `identity`, HS256-signed with the
 * tenant subaccount's API-Key SECRET (Vault). Resolves creds + ensures the TwiML app,
 * then builds the JWT:
 *   header  { alg:"HS256", typ:"JWT", cty:"twilio-fpa;v=1" }
 *   iss     = apiKeySid (SK…)          sub = accountSid (the tenant SUBaccount, AC…)
 *   iat/nbf = now       exp = now + ttl (SHORT — clamped to [60,3600], default 600)
 *   grants  { identity, voice:{ incoming:{allow:true}, outgoing:{application_sid} } }
 *
 * §9/§13 — the CALLER derives `identity` server-side from the verified JWT and passes
 * it here; this helper NEVER reads a request body and REJECTS a blank identity, so a
 * token can never be minted for a caller-forged principal. Returns:
 *   • ok:true  + data:{token, identity, expiresAt, ttlSeconds, applicationSid}
 *   • needs_config:true — subaccount/app not provisioned (never a fabricated token)
 *   • ok:false + error  — a real resolve/sign failure
 *
 * MUST be called with a SERVICE-ROLE client (Vault + subaccount access).
 */
export async function mintVoiceAccessToken(
  supabaseAdmin: SupabaseAdminLike,
  opts: { tenantId: string; identity: string; ttlSeconds?: number; voiceUrl?: string },
): Promise<TwilioResult<VoiceAccessToken>> {
  const { tenantId, identity } = opts;
  if (!tenantId) {
    return { ok: false, status: 0, error: "twilio_missing_tenant_id", data: null };
  }
  // §9/§13: identity MUST be a non-empty, server-derived principal. A blank identity is
  // a caller bug (it forgot to derive from the JWT), not a token we sign.
  if (!identity || identity.length === 0) {
    return { ok: false, status: 0, error: "voice_identity_required", data: null };
  }

  // Resolve the tenant subaccount creds (Vault). needs_config when unprovisioned.
  const credsRes = await resolveTwilioCreds(supabaseAdmin, tenantId);
  if (!credsRes.ok || !credsRes.data) {
    return { ok: false, status: credsRes.status, error: credsRes.error ?? "twilio_creds_unavailable", data: null, needs_config: credsRes.needs_config };
  }
  const creds = credsRes.data;
  if (!creds.apiKeySid) {
    return { ok: false, status: 0, error: "twilio_subaccount_api_key_missing", data: null, needs_config: true };
  }

  // Ensure the tenant's TwiML app exists (the outgoing VoiceGrant references it). Reuse
  // the creds we already resolved — no second Vault round-trip.
  const appRes = await ensureTwimlApp(supabaseAdmin, tenantId, { creds, voiceUrl: opts.voiceUrl });
  if (!appRes.ok || !appRes.data) {
    return { ok: false, status: appRes.status, error: appRes.error ?? "twiml_app_unavailable", data: null, needs_config: appRes.needs_config };
  }
  const applicationSid = appRes.data.applicationSid;

  const ttlSeconds = clampVoiceTtl(opts.ttlSeconds);
  // §18 ONE home for the token assembly — both the tenant minter (here) and the operator minter
  // (mintOperatorVoiceAccessToken) build the identical Twilio-fpa JWT via buildVoiceAccessTokenJwt.
  return await buildVoiceAccessTokenJwt({
    apiKeySid: creds.apiKeySid, // SK… (API Key SID) — iss + HMAC identity
    apiKeySecret: creds.authToken, // API-Key SECRET — HMAC signing key
    accountSid: creds.accountSid, // AC… (the tenant SUBaccount SID the token acts on) — sub
    identity,
    applicationSid,
    ttlSeconds,
  });
}

/**
 * §18 ONE home for the Twilio Voice Access Token JWT assembly. Given a resolved API-Key credential
 * (SK… + secret), the account the token acts on (AC…), the server-derived identity, the TwiML
 * application the outgoing VoiceGrant references, and a clamped TTL, produce the HS256-signed
 * twilio-fpa JWT. Used by BOTH the tenant minter (subaccount creds + subaccount TwiML app) and the
 * operator minter (master creds + master TwiML app). Kept private — callers use the two minters,
 * which own the credential/app resolution (tenant Vault vs master env).
 */
async function buildVoiceAccessTokenJwt(p: {
  apiKeySid: string;
  apiKeySecret: string;
  accountSid: string;
  identity: string;
  applicationSid: string;
  ttlSeconds: number;
}): Promise<TwilioResult<VoiceAccessToken>> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + p.ttlSeconds;
  // Backdate nbf by 30s to absorb clock skew between us and Twilio's registrar. An nbf set
  // to exactly `now` makes the token momentarily "not yet valid" if Twilio's clock lags ours,
  // an intermittent device-registration/first-call flake that compiles clean but fails live
  // (§32). exp still bounds the token; twilio-node omits nbf entirely, so this is a superset.
  const nbfSec = nowSec - 30;

  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${p.apiKeySid}-${nowSec}`,
    iss: p.apiKeySid, // SK… (API Key SID)
    sub: p.accountSid, // AC… (the account the token acts on)
    iat: nowSec,
    nbf: nbfSec,
    exp: expiresAt,
    grants: {
      identity: p.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: p.applicationSid },
      },
    },
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await hmacSha256Bytes(p.apiKeySecret, signingInput);
  const token = `${signingInput}.${b64url(sig)}`;

  return {
    ok: true,
    status: 200,
    error: null,
    data: { token, identity: p.identity, expiresAt, ttlSeconds: p.ttlSeconds, applicationSid: p.applicationSid },
  };
}

/**
 * Mint a SHORT-lived Twilio Voice Access Token for the PLATFORM OPERATOR (God/Super-Admin) —
 * Phase 3 (§9/§53). The operator is tenant-LESS: their voice runs on the platform MASTER account
 * (the SAME account as operator SMS + the +1 470 number), NOT a tenant subaccount. So this NEVER
 * reads tenant_twilio_subaccounts / Vault (§9 — no tenant creds, no tenant data); it uses master
 * creds (env, masterCreds) + a MASTER-account TwiML Application.
 *
 * §588 — the CALLER derives `identity` (operator.<userId>) server-side from the verified JWT and
 * passes it here; this helper NEVER reads a request body and REJECTS a blank identity.
 *
 * §13 HONEST DEGRADE — returns needs_config (never a fabricated token) when:
 *   • master creds are unset (twilio_master_not_configured), or
 *   • master creds carry no API Key SID (twilio_master_api_key_missing) — Twilio Access Tokens
 *     require the API-Key credential model (iss = SK…, HMAC key = API-Key secret); the legacy
 *     account-auth-token master path cannot mint one, so degrade rather than sign an invalid token, or
 *   • the master TwiML Application SID is not configured (operator_twiml_app_not_configured).
 *
 * OWED SECRET (§13/§34 — NAMES only): TWILIO_OPERATOR_TWIML_APP_SID (an AP… TwiML Application on the
 * MASTER account whose VoiceUrl points at voice-twiml). There is NO master row in
 * tenant_twilio_subaccounts to persist a minted app on (unlike ensureTwimlApp for tenants), so the
 * operator app SID is env-provided. If the owner has not created/pointed a master TwiML app yet, the
 * operator token honestly degrades to needs_config until this is set.
 */
export async function mintOperatorVoiceAccessToken(
  opts: { identity: string; ttlSeconds?: number },
): Promise<TwilioResult<VoiceAccessToken>> {
  const { identity } = opts;
  // §9/§13: identity MUST be a non-empty, server-derived operator principal.
  if (!identity || identity.length === 0) {
    return { ok: false, status: 0, error: "voice_identity_required", data: null };
  }

  const master = masterCreds();
  if (!master) {
    return { ok: false, status: 0, error: "twilio_master_not_configured", data: null, needs_config: true };
  }
  if (!master.apiKeySid) {
    // Access Tokens require the API-Key credential model (iss=SK…, HMAC key=API-Key secret). The
    // legacy account-auth-token master fallback has no SK… and can't sign a valid token → degrade.
    return { ok: false, status: 0, error: "twilio_master_api_key_missing", data: null, needs_config: true };
  }

  // The MASTER-account TwiML Application the outgoing VoiceGrant references. Env-provided (there is
  // no master subaccount row to persist a minted app on). needs_config when unset (§13 — owed secret).
  const applicationSid = denoEnv("TWILIO_OPERATOR_TWIML_APP_SID") ?? "";
  if (!applicationSid) {
    return { ok: false, status: 0, error: "operator_twiml_app_not_configured", data: null, needs_config: true };
  }

  const ttlSeconds = clampVoiceTtl(opts.ttlSeconds);
  return await buildVoiceAccessTokenJwt({
    apiKeySid: master.apiKeySid,
    apiKeySecret: master.authToken, // API-Key SECRET (master path)
    accountSid: master.accountSid, // AC… (the MASTER account the operator token acts on)
    identity,
    applicationSid,
    ttlSeconds,
  });
}

// _shared/mcp-client.ts — the ONE Model Context Protocol client (§18).
//
// Remote MCP servers speak the same wire protocol, so they share one client
// rather than one inline copy each. The provider differences that actually exist are
// narrow and expressed as arguments: how the request is authorised (a Bearer token, or
// a provider-named header), and how the response is framed (a JSON body, or a
// Server-Sent Events stream — Streamable HTTP allows either for the same call).
//
// Every outbound request goes through `safeFetch`, so the whole surface inherits the
// same guarantees at connect, at discovery and at call: https only, no embedded
// credentials, public addresses only, no redirects followed, bounded wall clock,
// bounded response size, and a stable reason on every failure.
//
// SECRET DISCIPLINE. The token is read here, put on a header, and dropped. It is never
// returned, never placed in an error, never logged, and never part of any value this
// module hands back to a caller. `describeMcpError` exists so callers have something
// safe to surface without reaching for the raw text themselves.
import { safeFetch, SsrfError, type SsrfReason } from "./ssrfGuard.ts";

/** How a provider expects the tenant's credential to be presented. */
export type McpAuth = (
  | { kind: "bearer"; token: string }
  | { kind: "header"; name: string; token: string }
  // The endpoint itself carries the credential, so there is no header to send. Zapier's
  // per-user MCP server is this shape: the secret is a path segment of the URL. Modelled
  // as its own kind rather than a bearer with an empty token, so a missing credential can
  // never be mistaken for a deliberate one.
  | { kind: "none" }) & { headers?: Record<string, string> };

export type McpErrorCode =
  | SsrfReason
  | "mcp_http_error"
  | "mcp_malformed_response"
  | "mcp_protocol_error";

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    /** Bounded, provider-supplied text. Never contains our credential. */
    public readonly detail?: string,
    public readonly httpStatus?: number,
  ) {
    super(code);
    this.name = "McpError";
  }
}

/** MCP requires a protocol version on every request; this is the revision we speak. */
const PROTOCOL_VERSION = "2025-06-18";

/** Discovery and calls are cheap; a provider that cannot answer inside this is down. */
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Header names this transport sets itself, and which a tenant's custom header name may
 * therefore not be. The token-grammar check below stops a NEW header being injected; it
 * does nothing about an EXISTING one being replaced, and the auth headers are spread last,
 * so a workspace that named its header `Accept` silently decided this client's content
 * negotiation — or, worse, named it `Authorization` and decided its own credential was the
 * bearer token for a server that reads both.
 */
const RESERVED_HEADERS = new Set([
  // `mcp-session-id` is the negotiated session header this transport sets on every post AFTER the
  // auth headers' insertion point, so a credential named it would override the real session id and
  // the acknowledgement + tool calls would be rejected — reserve it so a header facet named it fails
  // closed at the loader (authUsable) and at dispatch (authHeaders), never a false `prepared`.
  "authorization", "content-type", "accept", "mcp-protocol-version", "mcp-session-id",
  // Not set here, but set by the runtime, and a value that changes which virtual host
  // answers is not a thing a credential field gets to decide.
  "host", "content-length", "connection", "transfer-encoding",
]);

/** A custom auth header name is tenant-supplied, so it must be a valid RFC 9110 token. ONE home for
 *  the grammar so `authHeaders` (which throws at dispatch) and `authUsable`/`isUsableHeaderName`
 *  (which a caller uses to refuse a facet BEFORE dispatch) can never drift apart. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Whether a custom header name is one the client can actually set: a valid RFC 9110 token AND not a
 *  header this transport reserves for itself. */
export function isUsableHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name) && !RESERVED_HEADERS.has(name.toLowerCase());
}

/** Same bounded wire contract as _mcp_assert_custom_headers. Values are private: never returned
 * in validation errors. Reject transport/routing overrides and duplicate names BEFORE fetch. */
export function customHeadersUsable(headers: unknown, primaryName?: string): headers is Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  const entries = Object.entries(headers);
  if (entries.length > 16) return false;
  const seen = new Set<string>();
  let bytes = 0;
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    if (name.length > 64 || !isUsableHeaderName(name) || seen.has(lower)
      || lower === primaryName?.toLowerCase()
      || /^(proxy-|sec-|x-forwarded-)/.test(lower)
      || ["forwarded", "via", "origin", "referer", "cookie", "set-cookie", "te", "trailer", "upgrade", "accept-encoding"].includes(lower)
      || typeof value !== "string" || value.length < 1 || value.length > 4096
      || !/^[\x20-\x7e]+$/.test(value) || value.trim() !== value) return false;
    seen.add(lower);
    bytes += name.length + value.length;
  }
  return bytes <= 16384;
}

/** Whether this resolved auth can actually be PRESENTED by the client. A `header` auth whose name is
 *  invalid or reserved cannot (authHeaders throws on it at dispatch), so a caller that resolves a
 *  connection should refuse it up front rather than let `prepare` affirm what `execute` will reject.
 *  bearer/none are always presentable. */
export function authUsable(auth: McpAuth): boolean {
  if (auth.headers !== undefined && !customHeadersUsable(auth.headers, auth.kind === "header" ? auth.name : undefined)) return false;
  if (auth.kind === "header") return isUsableHeaderName(auth.name);
  return true;
}

/** The stored connection's shape, as `get_tenant_mcp_secret` returns it. */
export type StoredMcpSecret = {
  server_url?: unknown;
  auth_token?: unknown;
  auth_kind?: unknown;
  auth_header_name?: unknown;
  custom_headers?: unknown;
};

/**
 * How to authenticate as this stored connection, or null if it cannot be used.
 *
 * ONE HOME, because three copies of this drifted apart and shipped. The guard ("does it
 * have a credential?") and the mapping ("which credential?") were written separately in
 * `call-zapier-action`, in `resolveConnection` and in `probeAndRecord`. When a 'url'
 * connection was added, the mapping learned about it in all three and the GUARD learned
 * about it in one -- so a correctly saved Zapier address was mapped to the right auth and
 * then rejected before it was used, reported as "not connected" by discovery and recorded
 * as an error by the probe.
 *
 * Answering both questions in one place is what stops that: a caller cannot get the auth
 * without also getting the verdict, so the two cannot disagree again.
 */
export function authFromSecret(secret: StoredMcpSecret | null | undefined): McpAuth | null {
  if (!secret || typeof secret.server_url !== "string" || !secret.server_url) return null;
  const headers = secret.custom_headers;
  if (headers !== undefined && !customHeadersUsable(headers,
    secret.auth_kind === "header" && typeof secret.auth_header_name === "string" ? secret.auth_header_name : undefined)) return null;
  const extra = headers === undefined ? {} : { headers: headers as Record<string, string> };
  // The address carries the credential; there is no header to send and no token to want.
  if (secret.auth_kind === "url") return { kind: "none", ...extra };
  // A public MCP server carries no credential at all — schema-supported `auth_kind='none'`, which
  // `get_mcp_connection_secret` returns as configured with null tokens and the client drives with no
  // auth header. Map it to tokenless auth BEFORE the token guard, or a valid public server would be
  // wrongly rejected here as "no credential".
  if (secret.auth_kind === "none") return { kind: "none", ...extra };
  if (typeof secret.auth_token !== "string" || !secret.auth_token) return null;
  if (secret.auth_kind === "header" && typeof secret.auth_header_name === "string" && secret.auth_header_name) {
    return { kind: "header", name: secret.auth_header_name, token: secret.auth_token, ...extra };
  }
  return { kind: "bearer", token: secret.auth_token, ...extra };
}

function authHeaders(auth: McpAuth): Record<string, string> {
  if (auth.headers !== undefined && !customHeadersUsable(auth.headers, auth.kind === "header" ? auth.name : undefined)) {
    throw new McpError("mcp_protocol_error", "invalid supplementary headers");
  }
  // A custom header name is tenant-supplied, so it is constrained to the RFC 9110 token
  // grammar. Without this a newline in the name would let a tenant inject headers.
  if (auth.kind === "header") {
    if (!HEADER_NAME_RE.test(auth.name)) {
      throw new McpError("mcp_protocol_error", "invalid header name");
    }
    if (RESERVED_HEADERS.has(auth.name.toLowerCase())) {
      throw new McpError("mcp_protocol_error", "reserved header name");
    }
    return { ...auth.headers, [auth.name]: auth.token };
  }
  if (auth.kind === "none") return { ...auth.headers };
  return { ...auth.headers, Authorization: `Bearer ${auth.token}` };
}

export type McpSessionOptions = {
  serverUrl: string;
  auth: McpAuth;
  timeoutMs?: number;
  maxBytes?: number;
};

export type McpRequestOptions = McpSessionOptions & {
  method: string;
  params?: Record<string, unknown>;
};

/**
 * One MCP JSON-RPC request. The method and params are always chosen by OUR caller from a
 * validated shape — a tenant never supplies the method — and the tenant's only influence
 * on the destination is the server URL, which `safeFetch` has already vetted.
 *
 * The result is returned unwrapped and UNPROJECTED. It is untrusted provider output and
 * must not reach a model, a transcript, memory or Rail: `_shared/mcp-outcome.ts` is the
 * boundary that decides what may. Nothing here is a safe thing to forward.
 */
/** One POST to the endpoint. No lifecycle opinion — the caller supplies the frame. */
async function post(
  opts: McpSessionOptions,
  payload: Record<string, unknown>,
  sessionId: string | null,
): Promise<Awaited<ReturnType<typeof safeFetch>>> {
  try {
    return await safeFetch(
      opts.serverUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Streamable HTTP lets the server answer with either framing for the same
          // request, so both are advertised and both are handled below.
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": PROTOCOL_VERSION,
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          ...authHeaders(opts.auth),
        },
        body: JSON.stringify(payload),
      },
      {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
      },
    );
  } catch (e) {
    if (e instanceof SsrfError) throw new McpError(e.reason);
    if (e instanceof McpError) throw e;
    throw new McpError("mcp_protocol_error");
  }
}

/** The JSON-RPC result, or the mapped failure. Shared by the handshake and the call. */
function resultOf(res: Awaited<ReturnType<typeof safeFetch>>): unknown {
  if (res.status < 200 || res.status >= 300) {
    // The STATUS is carried and the body is not. Nothing reads the detail — every surface
    // words these failures from the code — so a bounded slice of provider text bought
    // nothing and put arbitrary third-party content into an Error message, which is the
    // one object in this path that gets logged, wrapped and stringified by code that never
    // asked what was in it.
    throw new McpError("mcp_http_error", undefined, res.status);
  }

  // A truncated envelope is not a short envelope: half a JSON-RPC response parses as
  // nothing, or worse, as something.
  if (res.truncated) throw new McpError("response_too_large");

  const envelope = parseEnvelope(res.body, res.headers.get("content-type") ?? "");
  if (envelope === null) throw new McpError("mcp_malformed_response");

  const e = envelope as { error?: { message?: unknown; code?: unknown }; result?: unknown };
  if (e.error) {
    const message = typeof e.error.message === "string" ? e.error.message.slice(0, 300) : undefined;
    throw new McpError("mcp_protocol_error", message);
  }
  if (!("result" in e)) throw new McpError("mcp_malformed_response");
  return e.result;
}

/**
 * One MCP session, opened and closed around whatever the caller needs to do inside it.
 *
 * WHY A SESSION AND NOT A REQUEST
 *
 * Verification and invocation have to happen in the SAME session. `callApprovedCapability`
 * reads the provider's current contract and then, only if it matches what was approved,
 * runs the tool. With a session per call those are two different sessions, so a provider
 * mid-deployment — or one whose catalogue is session-scoped — could show the pinned
 * contract to the first and execute a changed one in the second. That is a race on the
 * exact check that exists to fail closed, which makes it worse than no check at all.
 *
 * The session is also CLOSED. A stateful server allocates one per initialize and expects a
 * DELETE to release it; without that, every probe, discovery and action leaked one until
 * the provider expired it or refused new ones. Servers that keep no state answer 405, which
 * is a normal answer and not a failure.
 */
async function withMcpSession<T>(
  opts: McpSessionOptions,
  body: (call: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  // MCP requires `initialize`, then the `notifications/initialized` notification, before
  // any normal operation. This client used to send `tools/list` first and nothing else,
  // which a compliant server rejects outright.
  const initRes = await post(opts, {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "paige", version: "1" },
    },
  }, null);
  // The header is read BEFORE the body is judged. A server can allocate a session and then
  // answer with a malformed, truncated, or error envelope; validating first meant the throw
  // happened while the session id was still unread, so the DELETE below had nothing to send
  // and the session was abandoned. Header names are case-insensitive; `Headers.get` handles
  // that.
  const sessionId = initRes.headers.get("mcp-session-id");

  // Everything from here on is inside the cleanup, because from here on there is a session
  // to release — including the validation of the initialize result itself. The
  // acknowledgement used to sit ABOVE this `try`, and so did that validation: on an outage
  // or a protocol disagreement the throw left an allocated session behind, which is exactly
  // the leak the DELETE exists to prevent, on exactly the path where a provider is already
  // unhealthy.
  try {
    resultOf(initRes);

    // A notification has no id and expects no result. A server answering 202 with an empty
    // body is the normal case, so its response is not parsed as an envelope.
    const ackRes = await post(opts, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
    if (ackRes.status < 200 || ackRes.status >= 300) {
      throw new McpError("mcp_http_error", undefined, ackRes.status);
    }

    return await body(async (method, params) => resultOf(await post(opts, {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: params ?? {},
    }, sessionId)));
  } finally {
    // Best effort, and deliberately silent. Failing to release a session is not a reason
    // to turn a completed action into a reported failure, and a stateless server has
    // nothing to release.
    if (sessionId) {
      try {
        await safeFetch(opts.serverUrl, {
          method: "DELETE",
          headers: {
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "Mcp-Session-Id": sessionId,
            ...authHeaders(opts.auth),
          },
        }, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes: 4096 });
      } catch { /* 405, a closed socket, an expired session — none of it changes the result */ }
    }
  }
}

/**
 * One MCP request in its own session. For a caller that needs exactly one operation.
 *
 * A caller that needs its verification and its call to agree must use
 * {@link withApprovedCapabilitySession} instead — two `mcpRequest`s are two sessions.
 */
export async function mcpRequest(opts: McpRequestOptions): Promise<unknown> {
  return await withMcpSession(opts, (call) => call(opts.method, opts.params));
}

/**
 * Lists the provider's tools and then, inside the SAME session, hands the caller a way to
 * run one. This is the shape the governed path needs: what was verified and what runs are
 * the same catalogue, on the same session, with no window between them.
 */
export async function withApprovedCapabilitySession<T>(
  opts: McpSessionOptions,
  body: (session: {
    tools: McpToolFingerprint[];
    call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }) => Promise<T>,
): Promise<T> {
  return await withMcpSession(opts, async (call) => {
    const tools = await fingerprintsOf(await collectToolPages(call));
    return await body({
      tools,
      call: (name, args) => call("tools/call", { name, arguments: args }),
    });
  });
}

/**
 * Reads the JSON-RPC envelope out of either framing. For an SSE stream the last complete
 * `data:` payload that parses as an object wins, which is the JSON-RPC response — earlier
 * events on the stream are progress notifications.
 */
function parseEnvelope(body: string, contentType: string): unknown | null {
  if (contentType.includes("text/event-stream")) {
    let last: unknown = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === "object") last = parsed;
      } catch { /* a partial or non-JSON event — keep the last good one */ }
    }
    return last;
  }
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export type McpTool = { name: string; description: string };

/**
 * A discovered tool, with its input schema reduced to a fingerprint.
 *
 * The schema itself never leaves this module. What is kept is a hash, which is enough to
 * answer the only question anyone downstream needs: is this the same tool the workspace
 * approved, or has it changed since? A tool whose inputs changed after approval is not
 * the tool that was approved — the name is the same and the contract is not — and that is
 * exactly the substitution a pinned fingerprint exists to catch.
 *
 * `description` is provider-written text. It is bounded here and is safe to show a HUMAN
 * deciding what to approve; it must never reach a model. That distinction is the caller's
 * to keep, and `_shared/mcp-outcome.ts` is where it is kept.
 */
export type McpToolFingerprint = McpTool & {
  /** SHA-256 of the tool's INPUT SCHEMA only. Its value is FROZEN: n8n's discovery pin
   *  (`_shared/n8n-oauth.ts`) is derived from it, and the probe RPC wipes a workspace's
   *  approved workflows when that pin moves. Widening THIS field would silently revoke
   *  every n8n workspace's approvals. Widen `pin` instead. */
  schemaHash: string;
  /** SHA-256 of the AUTHORITY the tool claims: which connected account it acts on, what
   *  kind of action it is, and what it is able to do. */
  authorityHash: string;
  /** What an approval is pinned to: the schema AND the authority, together. This is the
   *  value shown at approval, echoed back by the browser, stored in `capability_pins`,
   *  and compared before anything runs. */
  pin: string;
  app: string;
  actionType: string;
  effects: string[];
};

/**
 * Discovery, reduced to identity and purpose. Input schemas are deliberately dropped
 * here: nothing downstream of this slice is allowed to act on an unpinned schema, and
 * not returning one is a stronger guarantee than returning one nobody reads.
 */
export async function mcpListTools(opts: {
  serverUrl: string;
  auth: McpAuth;
  timeoutMs?: number;
}): Promise<McpTool[]> {
  // One session, every page: the same reason `withApprovedCapabilitySession` collects them.
  // This is the discovery the approval screen renders, so a missed page is a tool the
  // operator is never offered and, once approvals are saved, one that gets revoked.
  const tools = await withMcpSession(opts, (call) => collectToolPages(call));
  return tools
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string")
    .map((t) => ({
      name: String(t.name).slice(0, 200),
      description: typeof t.description === "string" ? t.description.slice(0, 500) : "",
    }));
}

/**
 * Discovery that also fingerprints each tool's input schema.
 *
 * Used at approval time, so the workspace's decision can be pinned to a specific contract,
 * and at call time, so drift can be detected before anything runs.
 */
export async function mcpListToolFingerprints(opts: {
  serverUrl: string;
  auth: McpAuth;
  timeoutMs?: number;
}): Promise<McpToolFingerprint[]> {
  return await fingerprintsOf(await withMcpSession(opts, (call) => collectToolPages(call)));
}

/** Every page of a `tools/list`, read inside ONE session.
 *
 *  A compliant server may return `nextCursor` and hold the rest back. Reading only the
 *  first page is not a partial list with a partial consequence: approvals are saved as a
 *  WHOLE set, so a workspace editing any visible approval would have silently revoked every
 *  approved tool it could not see, and an invocation of one would then be refused as
 *  `no_longer_offered` — a capability the operator approved, reported as withdrawn by the
 *  provider. The pages are collected in the caller's session because a cursor is only
 *  meaningful within the session that issued it.
 *
 *  Bounded twice, because a cursor chain is provider-controlled: a page ceiling, and a
 *  ceiling on how many tools may be accumulated. A server that returns the cursor it was
 *  just given would otherwise loop forever, so that is stopped explicitly rather than left
 *  to the page cap. */
const MAX_TOOL_PAGES = 20;
const MAX_TOOLS = 2000;

async function collectToolPages(
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = await call("tools/list", cursor === undefined ? {} : { cursor }) as
      { tools?: unknown; nextCursor?: unknown } | null;
    const tools = result?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (all.length >= MAX_TOOLS) break;
        all.push(t);
      }
    }
    const next = result?.nextCursor;
    if (typeof next !== "string" || next === "" || next === cursor) break;
    if (all.length >= MAX_TOOLS) break;
    cursor = next;
  }
  return all;
}

/** The shared reading of `tools/list` pages, used inside and outside a session. */
async function fingerprintsOf(tools: unknown): Promise<McpToolFingerprint[]> {
  if (!Array.isArray(tools)) return [];
  const out: McpToolFingerprint[] = [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.name !== "string" || !t.name) continue;
    const meta=t._meta&&typeof t._meta==="object"&&!Array.isArray(t._meta)?t._meta as Record<string,unknown>:{};
    const annotations=t.annotations&&typeof t.annotations==="object"&&!Array.isArray(t.annotations)?t.annotations as Record<string,unknown>:{};
    const explicitEffects=Array.isArray(meta.effects)?meta.effects.filter((v):v is string=>typeof v==="string"&&["read","create","update","send","delete"].includes(v)):[];
    if(annotations.readOnlyHint===true&&!explicitEffects.includes("read"))explicitEffects.push("read");
    // ONE representation of the effect set, used for the hash AND for what the operator is
    // shown, so the thing pinned is exactly the thing read.
    const effects = [...new Set(explicitEffects)].sort();
    const app = typeof meta.connected_app==="string"?meta.connected_app.slice(0,100):typeof meta.app_name==="string"?meta.app_name.slice(0,100):"";
    const actionType = typeof meta.action_type==="string"?meta.action_type.slice(0,80):"";
    // Hash the TRUNCATED values, because those are the ones that reached the screen.
    const schemaHash = await fingerprintSchema(t.inputSchema);
    const authorityHash = await fingerprintAuthority({ app, actionType, effects });
    out.push({
      name: t.name.slice(0, 200),
      description: typeof t.description === "string" ? t.description.slice(0, 500) : "",
      schemaHash,
      authorityHash,
      pin: await fingerprintCapability(schemaHash, authorityHash),
      app,
      actionType,
      effects,
    });
  }
  return out;
}

/**
 * A stable hash of a tool's input schema.
 *
 * Canonicalised first — object keys sorted, so a provider that serialises the same schema
 * in a different key order does not read as drift and cause a working integration to fail
 * closed for no reason. Array order is preserved, because in a schema it is meaningful
 * (`required`, `enum`) and reordering it IS a contract change.
 *
 * An absent schema hashes the empty object rather than being skipped: "this tool declared
 * no inputs" is itself a contract, and a later tool that grows inputs must register as
 * changed.
 */
export async function fingerprintSchema(schema: unknown): Promise<string> {
  return await sha256Hex(canonicalJson(schema === undefined || schema === null ? {} : schema));
}

/** Domain tag, so a pin produced under a future scheme can never be mistaken for one
 *  produced under this one. */
const PIN_SCHEME = "mcp-pin/v1";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A stable hash of the AUTHORITY a tool claims — the connected account it acts on, the kind
 * of action it is, and the effects it declares. Approving used to record none of this, so a
 * provider could keep a tool's name and inputs while moving it to a different connected
 * account, or turn a read into a send, and the old approval still ran.
 *
 * WHY EFFECTS SORT AND A SCHEMA'S ARRAYS DO NOT. `effects` is a SET the provider happens to
 * serialise in some order; `["send","read"]` and `["read","send"]` are the same authority,
 * and failing a working integration closed because a provider reordered its own list is
 * noise, not drift. A schema's `required` and `enum` are SEQUENCES whose order IS the
 * contract, so `canonicalJson` leaves them alone. The asymmetry is deliberate.
 */
export async function fingerprintAuthority(
  a: { app: string; actionType: string; effects: readonly string[] },
): Promise<string> {
  return await sha256Hex(canonicalJson({
    app: a.app,
    actionType: a.actionType,
    effects: [...new Set(a.effects)].sort(),
  }));
}

/**
 * What an approval is actually pinned to. Both inputs are fixed-width 64-hex digests, so the
 * join is unambiguous by construction: no provider-supplied string reaches this
 * concatenation, and no field can be shifted into another by a value containing a separator.
 */
export async function fingerprintCapability(schemaHash: string, authorityHash: string): Promise<string> {
  return await sha256Hex(`${PIN_SCHEME}\n${schemaHash}\n${authorityHash}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * A connectivity probe, and the ONLY thing entitled to move a saved connection to
 * `connected`. It proves three things at once: the address is reachable under the SSRF
 * rules, the credential is accepted, and the endpoint actually speaks MCP. Saving a row
 * proves none of them, which is why the setter writes `pending_verification`.
 */
export async function mcpProbe(opts: {
  serverUrl: string;
  auth: McpAuth;
  timeoutMs?: number;
}): Promise<{ ok: true; toolCount: number } | { ok: false; code: McpErrorCode; httpStatus?: number }> {
  try {
    const tools = await mcpListTools(opts);
    return { ok: true, toolCount: tools.length };
  } catch (e) {
    if (e instanceof McpError) return { ok: false, code: e.code, httpStatus: e.httpStatus };
    return { ok: false, code: "mcp_protocol_error" };
  }
}

/**
 * Owner-facing language for every failure this client models. Keeping the mapping here
 * means no caller has to decide what is safe to show, and no raw provider text or
 * credential can reach a surface by way of an error message.
 */
export function describeMcpError(code: McpErrorCode): string {
  switch (code) {
    case "invalid_url": return "That address is not a valid URL.";
    case "url_must_be_https": return "The address has to start with https:// so the credential is never sent in the clear.";
    case "url_has_embedded_credentials": return "Remove the username and password from the address; the credential belongs in its own field.";
    case "url_host_not_allowed":
    case "url_resolves_to_private_address": return "That address points somewhere private, so it was not contacted.";
    case "url_host_unresolvable": return "That address could not be looked up.";
    case "url_redirect_refused": return "That address redirects somewhere else, which is not followed. Use the address it points at.";
    case "request_timed_out": return "The server did not answer in time.";
    case "response_too_large": return "The server sent more than can be read safely.";
    case "mcp_http_error": return "The server rejected the connection. Check the credential and the address.";
    case "mcp_malformed_response":
    case "mcp_protocol_error": return "That address answered, but not as an MCP server.";
    case "request_failed":
    default: return "The server could not be reached.";
  }
}

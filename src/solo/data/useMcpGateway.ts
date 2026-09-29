/**
 * useMcpGateway — the Solo-facing binding of the Connected MCP Gateway.
 *
 * SLICE ④ REBIND. Writes that the `mcp-gateway` edge function owns now go THROUGH it
 * (`supabase.functions.invoke("mcp-gateway", { body: { action, … } })`), instead of calling the
 * registry RPCs directly. §18: one door, many actions — this hook connects to that door, it does
 * not build beside it.
 *
 * WHICH CALL GOES WHERE, AND WHY — the honest map (§13). The edge dispatches on `body.action` and
 * today serves exactly five: verify · create · oauth_begin · approve · execute. So:
 *
 *   EDGE (an action exists)         RPC (no edge action exists — kept, never silently removed, §58)
 *   ─────────────────────────       ──────────────────────────────────────────────────────────────
 *   createMcp   → create/mcp        rekeyMcp    → set_mcp_connection_endpoint
 *   createRest  → create/rest       rekeyRest   → set_mcp_rest_connection_endpoint
 *   verify      → verify            disconnect  → disconnect_mcp_connection
 *   beginOAuth  → oauth_begin       reads       → get_mcp_connections_v2 + is_current_user_tenant_admin
 *   approveTool → approve
 *
 * The right-hand column is NOT an oversight and NOT a half-finished rebind. The gateway edge has no
 * `rekey`, no `disconnect` and no read action, and those three RPCs are live, granted to
 * `authenticated`, and carry shipped, owner-visible capability. Routing them through a door that
 * does not exist would delete working features to make a diagram tidy (§58). When the edge grows
 * those actions, they move — and this comment is the record of why they had not yet.
 *
 * WHAT MOVING TO THE EDGE BUYS (it is not cosmetic):
 *   - The workspace-switch race is caught SERVER-side. The edge re-derives the tenant from the JWT
 *     and compares it to `expected_tenant_id`, answering 409 `tenant_mismatch`. The direct RPC path
 *     passed `_tenant_id` as a hint, which a writer either raises 42501 on or — for a platform owner
 *     — silently honours as an override. Neither is what a browser switching workspaces wants.
 *   - verify / oauth_begin / approve are edge-ONLY by construction: each needs a service-role read
 *     (decrypt a secret, store a PKCE verifier, read a tool pin) that no browser may ever hold (§59).
 *     Before this rebind the UI could not reach them at all, which is why the surface said
 *     "Sign-in soon" and "Paige will check this tool" instead of doing either.
 *
 * TWO ERROR VOCABULARIES, ONE MAP. The edge answers lowercase, snake_case codes of its own
 * (`tenant_mismatch`, `tool_not_verified`, `expiry_in_past`, …) AND passes the writers' uppercase
 * closed set (`MCP_FORBIDDEN`, `MCP_CREDENTIAL_TOO_SHORT`, `MCP_ENDPOINT_CHANGED`, …) straight
 * through `mapWriterError`. Both land in `ERR` below, so a caller maps one way whichever door the
 * refusal came from. An unknown code degrades to a plain sentence — never a raw code, never a
 * framework string.
 *
 * Truth boundaries (the backend contract, mirrored here so the UI can never over-claim):
 *   - Tenant is resolved SERVER-SIDE. Reads pass NO tenant argument; writes pass the caller's own
 *     `activeTenantId` only as an expected-tenant guard (a foreign id → 409 `tenant_mismatch`).
 *   - Secrets are NEVER returned. The list read gives the endpoint HOST and aggregate counts only.
 *     A last-4 exists transiently in a create/re-key response and nowhere else.
 *   - A newly created / re-keyed row is `pending_verification / unknown` until a verify probe
 *     promotes it. This hook never fabricates a `connected` state.
 *   - The per-connection TOOL LIST is readable via `listTools`, and every judgement in it — whether
 *     consent is needed and why, whether an approval has expired or drifted — is the SERVER's.
 *     This hook renders those verdicts; it never recomputes one. An EMPTY list means the catalogue
 *     has been read and found empty; `observedAt: null` means it has never been read at all. Those
 *     are different facts and the surface must not collapse them into one sentence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";

export type GatewayStatus = "unconfigured" | "pending_verification" | "connected" | "error";
export type GatewayHealth = "unknown" | "checking" | "healthy" | "needs_attention";

/** A row as the UI consumes it — host + aggregates only, never a secret. */
export type GatewayConnection = {
  id: string;
  providerKey: string;
  label: string;
  transport: string | null;
  authKind: string | null;
  configured: boolean;
  enabled: boolean;
  status: GatewayStatus;
  health: GatewayHealth;
  lastCheckedAt: string | null;
  grantedScopes: string[];
  visibility: string | null;
  serverUrlHost: string | null;
  toolCount: number | null;
  approvedCount: number | null;
  /** Safe presence only. null/absent means the deployment did not prove this fact. */
  addressConfigured?: boolean | null;
  credentialsConfigured?: boolean | null;
  customHeaderCount?: number | null;
  configGeneration?: number | null;
};

/** The generic-remote-MCP credential shapes the create door accepts. */
export type GatewayAuthKind = "bearer" | "header" | "oauth" | "url" | "none";

export type CreateMcpDraft = {
  providerKey: string;
  label: string;
  serverUrl: string;
  authKind: GatewayAuthKind;
  authToken?: string | null;
  authHeaderName?: string | null;
  /** Write-only, encrypted by the canonical writer; never retained in hook state. */
  customHeaders?: Record<string, string>;
};

export type CreateRestDraft = { label: string; baseUrl: string; apiKey: string };

/* ──────────────────────────────────────────────────────────────────────────────
   THE CREDENTIAL FLOOR (INT-153) — a client guard that mirrors the server's rule EXACTLY.

   `_mcp_assert_credential_bundle` (migration 20270332000000:465,485) rejects a bearer or header
   token whose `btrim` length is under 12, raising the closed code MCP_CREDENTIAL_TOO_SHORT. It
   exists so verify.ts's credential-reflection scanner (MIN_SECRET_SCAN_LEN = 12) cannot be slipped
   under by a short secret a hostile server echoes back into the tool catalogue.

   Mirrored here so a person who pastes a short token is told SO, in the field, instead of watching
   a round-trip come back with a refusal. THE SERVER REMAINS THE AUTHORITY — this never widens the
   rule, only reports it earlier.

   SCOPE IS EXACT, and the exactness is the point (§13). The floor applies to `bearer` and `header`
   ONLY. It is deliberately NOT applied to:
     - `oauth`   — the token is provider-minted and verify.ts does not scan it (the migration says so
                   in terms at :505). Gating it here would refuse a provider's own token shape.
     - `api_key` — the n8n REST facet never reaches the bundle helper at all; its writer requires
                   only a non-empty key. A floor here would refuse an n8n key the server accepts,
                   which is a client inventing a rule the backend does not have.
   ────────────────────────────────────────────────────────────────────────────── */
export const MCP_CREDENTIAL_MIN_LENGTH = 12;

/** Whether an auth kind's credential is subject to the INT-153 floor. bearer/header only. */
export function credentialFloorApplies(authKind: GatewayAuthKind | "api_key" | string | null): boolean {
  return authKind === "bearer" || authKind === "header";
}

/** True when `token` is too short for `authKind` under the server's own rule. Trims first, exactly
 *  as the SQL does (`length(btrim(_auth_token)) < 12`). */
export function credentialTooShort(authKind: GatewayAuthKind | "api_key" | string | null, token: string | null | undefined): boolean {
  if (!credentialFloorApplies(authKind)) return false;
  return (token ?? "").trim().length < MCP_CREDENTIAL_MIN_LENGTH;
}

/* ──────────────────────────────────────────────────────────────────────────────
   THE APPROVAL-LIFETIME FLOOR — a UI-to-backend contract, and honestly labelled as one.

   Slice ④ is the first caller of the approve door's optional `expires_at`. The backend's only rule
   is "not already past": the edge pre-filters `expiry_in_past` against its own clock
   (approve.ts:114) and the trigger `trg_mcp_reject_past_approval_expiry` (migration 20270334000000)
   settles it atomically inside the writer's transaction with MCP_EXPIRY_IN_PAST.

   FOUR CLOCKS, NO TOLERANCE. The value is minted on the BROWSER clock (below), pre-filtered on the
   EDGE isolate's clock (approve.ts:114), written under the DB's `clock_timestamp()`
   (20270334000000:45), and spent at execute time against `now()` (20270323000000:228). The platform
   grants a 60-second skew budget elsewhere for exactly this browser-vs-server mismatch
   (`_shared/mcp-oauth.ts` isExpired skewSeconds = 60; `_shared/zoomMeetings.ts` EXPIRY_SKEW_MS) —
   but NEITHER approval check grants any: both are a bare `<=` against the server's own clock, with
   no grace term and no skew allowance anywhere in either expression. So the skew has to be absorbed
   by the FLOOR, because it is absorbed nowhere else. That, not the round-trip count, is the
   dominant machine term.

   (§13 correction, caught by this PR's peer-gate: an earlier draft of this comment quoted
   "exact <=, no skew/grace" from 20270330000000:173 / 20270331000000:196 / 20270332000000:501 as
   though it described the approval checks. It does not — all three are the OAuth ACCESS-TOKEN
   expiry check on `_access_token_expires_at`. The phrase is real and the no-grace conclusion is
   still true of the approval path, but it is true by reading the approval checks themselves, not
   by borrowing a sentence written about a different one. The quotation is withdrawn; the
   conclusion stands on its own citations above.)

   TWO WINDOWS THE FLOOR MUST CLEAR:
     A. Surviving its own write — five sequential round trips between the edge clock check and the
        trigger (current_user_tenant_id, is_current_user_tenant_admin, get_mcp_connections_v2, the
        tool-pin read, get_mcp_connection_secret), then a `SELECT … FOR UPDATE` that can block on a
        concurrent endpoint write. The repo's own ceiling for one gateway invocation is 30 s
        (`MAX_EXECUTE_TIMEOUT_MS`, execute.ts).
     B. Surviving to FIRST USE — consent is verified only AFTER the runner opens a session to the
        external provider and lists its tools (runner.ts), so the first execute spends up to another
        30 s before it even asks whether the consent is still alive.

   So the absolute machine minimum is ~30 s + 60 s skew + ~30 s ≈ two minutes. A lifetime at or
   under that can be accepted, stored, answered `approved: true`, and be dead at or before first use
   — a consent that authorises nothing (§13).

   THE FLOOR IS 15 MINUTES, which clears that worst case by roughly 7.5× (not, as an earlier draft
   of this comment claimed, by three orders of magnitude — that was true only of the warm happy
   path, and it is the worst case that decides a floor). It also leaves ~13 minutes of real human
   think time, because the owner approves a tool IN ORDER TO USE IT: a floor that only protects the
   machine has not protected the person. It keeps a genuine tight-leash lane alive, which §68 wants.
   And it is not a novel number — `analytics_evidence_bundle` already uses a 15-minute human-usable
   window (20261004000000:382).

   THE DEFAULT IS 24 HOURS and THE MAXIMUM IS 30 DAYS, both borrowed rather than invented:
   `set_trust_posture` already defaults a time-boxed grant of elevated authority to
   `_hours int DEFAULT 24` (20260929000000:105 — the function is `set_trust_posture`; an earlier
   draft of this comment and of the Slice ④ commit message called it `set_trust_session_posture`,
   which exists nowhere in the repo), and §68's `trust_attestation_window` gives 30 days
   as the longest window for any rung at which anything acts unread (20261001000000:93-96).

   THERE IS DELIBERATELY NO "UNTIL I REVOKE IT" OPTION, for two independent reasons:
     1. §68 — no authority is permanent. The approvals column comment invokes §68 by name
        (20270323000000:59), and the platform already refused this exact option in code for
        postures: "A posture ALWAYS expires … it is why there is no 'until I clear it' option"
        (20260929000000:131-132).
     2. THERE IS NO REVOKE TO NAME. No per-tool revoke RPC exists and the edge dispatches no
        `revoke` action; every `DELETE FROM mcp_connection_approvals` in the schema is
        CONNECTION-scoped (the endpoint-change trigger, both endpoint setters, disconnect). So
        `expires_at` is the ONLY per-tool withdrawal mechanism that exists today, and offering "no
        expiry" would make the sole way to withdraw one tool's consent opt-out — the owner picks it,
        later wants that tool withdrawn, and finds no control (§70.2). A per-tool revoke is named in
        the close-out as the larger gap.

   THE HONEST LIMIT OF THIS CONTRACT (§13/§60). The server enforces only `> clock_timestamp()`. The
   15 min / 24 h / 30 days shape holds at the UI layer only, so an RPC caller, a script, or a future
   surface can still write a shorter lifetime. It is a product contract this hook keeps, NOT a
   security boundary — do not describe it as server-enforced anywhere. Moving it into the trigger is
   one line, but it NARROWS the writer's accepted contract, so §37 requires a producer inventory
   across all eight caller classes first. Named in the close-out, not done here.
   ────────────────────────────────────────────────────────────────────────────── */
export const APPROVAL_MIN_LIFETIME_MINUTES = 15;
export const APPROVAL_DEFAULT_LIFETIME_MINUTES = 60 * 24;
export const APPROVAL_MAX_LIFETIME_MINUTES = 60 * 24 * 30;

/** The lifetimes the approve surface offers. Every one clears the floor and none exceeds the max. */
export const APPROVAL_LIFETIME_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 60, label: "1 hour" },
  { minutes: 60 * 8, label: "8 hours" },
  { minutes: APPROVAL_DEFAULT_LIFETIME_MINUTES, label: "1 day" },
  { minutes: 60 * 24 * 7, label: "1 week" },
  { minutes: APPROVAL_MAX_LIFETIME_MINUTES, label: "30 days" },
];

/**
 * What an approval's lifetime resolved to. THREE outcomes, deliberately not two.
 *
 * An earlier version of this returned `string | null` and FAILED OPEN: `null` meant both "the owner
 * chose no expiry" and "that lifetime was under the floor", and the write site omits `expires_at`
 * when it has none — so the backend stored NO EXPIRY. A surface asking for one minute was therefore
 * rewarded with a PERMANENT approval: maximum permissiveness for the most suspicious input, the
 * exact inverse of what a floor is for. The doc comment even claimed the function "refuses" a
 * sub-floor value, while what it actually did was grant more.
 *
 * Making the three outcomes distinct in the TYPE is what stops that collapsing again: a caller
 * cannot pass a rejection to `approveTool`, because a rejection is not a thing `approveTool` takes.
 */
export type ApprovalExpiry =
  | { kind: "expires"; at: string }
  /** No time limit. Not offered by the UI (see above) — reachable only by an explicit caller. */
  | { kind: "no_expiry" }
  | { kind: "below_floor"; minimumMinutes: number };

/**
 * Turn a chosen lifetime into the instant the approve door takes. `now` is injected so this is
 * testable without a clock. A value under the floor is REFUSED, never silently raised and never
 * quietly converted into "no expiry".
 */
export function approvalExpiryFromMinutes(minutes: number, now: number): ApprovalExpiry {
  if (!Number.isFinite(minutes) || minutes < APPROVAL_MIN_LIFETIME_MINUTES) {
    return { kind: "below_floor", minimumMinutes: APPROVAL_MIN_LIFETIME_MINUTES };
  }
  const capped = Math.min(minutes, APPROVAL_MAX_LIFETIME_MINUTES);
  return { kind: "expires", at: new Date(now + capped * 60_000).toISOString() };
}

/** Result of a write — carries the honest server outcome, never a hoped-for one. */
export type GatewayWriteResult = {
  ok: boolean;
  code: string | null;
  message: string | null;
  connectionId?: string | null;
  status?: string | null;
  /** last-4 is only ever present here (a create/re-key response), never in the list read. */
  last4?: string | null;
  mode?: string | null;
};

/** One action a connected tool offers, as the owner is shown it. Mirrors the edge's `GatewayTool`.
 *  Every judgement here is the SERVER's: whether consent is needed and why, whether an existing
 *  approval has expired against the server clock, and whether the tool has changed since it was
 *  approved. The browser renders these; it never computes them. */
export type GatewayToolRow = {
  name: string;
  effects: string[];
  app: string;
  actionType: string;
  requiresApproval: boolean;
  approvalBasis: "server_name_floor" | "provider_declared_effect" | "effects_undeclared" | null;
  approved: boolean;
  approvedAt: string | null;
  expiresAt: string | null;
  approvalExpired: boolean;
  approvalStale: boolean;
  approvedByYou: boolean;
  /** Why an existing approval would NOT authorize a run, or null when nothing a catalogue can see
   *  would stop it. `approved` alone is a WEAKER claim than "the runner will allow this": the
   *  function that decides at dispatch refuses on seven conditions, and a row can carry a live,
   *  unexpired, unstale approval that is nonetheless bound to an endpoint this connection no
   *  longer uses, or to no endpoint at all. Null is never a promise — two of those conditions
   *  depend on the dispatch itself and cannot be known from a list. */
  approvalBlockedReason:
    | "endpoint_missing"
    | "contract_changed"
    | "approval_not_endpoint_bound"
    | "endpoint_changed"
    | "approval_expired"
    | null;
  observedAt: string | null;
};

export type GatewayToolsResult = {
  ok: boolean;
  code: string | null;
  message: string | null;
  tools: GatewayToolRow[];
  /** The SERVER's counts, carried rather than recomputed. `approvedCount` is consent that still
   *  authorises something, which is not the same number as the connection list's `approvedCount`
   *  (that one counts approval rows). Two homes for one definition drift; this is the one. */
  toolCount: number;
  approvedCount: number;
  /** Freshness of the ROWS. Derived from their own discovery times, so it is null whenever the
   *  list is empty — it can date a catalogue that has content, and it cannot tell "never read"
   *  from "read and empty". The connection's `lastCheckedAt` is what separates those two. */
  observedAt: string | null;
};

/** What a verify probe actually found. `ok:false` with a status is a REAL answer (the server was
 *  reached and refused / failed), distinct from `code` being set (the request never got that far). */
export type GatewayVerifyResult = GatewayWriteResult & {
  probeStatus?: GatewayStatus | null;
  probeHealth?: GatewayHealth | null;
  toolCount?: number | null;
  /** The probe's own reason when it could not reach or read the server (`unreachable`,
   *  `provider_reflected_credential`, `config_changed_during_verify`, …). */
  probeError?: string | null;
};

/** Where to send the browser to sign in, when the gateway could start a flow. */
export type GatewayOAuthResult = GatewayWriteResult & { authorizeUrl?: string | null };

export type McpGatewayState = {
  tools: GatewayConnection[];
  loading: boolean;
  /** A failed READ — distinct from an empty account (no connections yet). */
  error: boolean;
  /** capability `mcp.connections.manage` proxy (owner / tenant-admin); the server is the real gate. */
  canWrite: boolean;
  saving: boolean;
  /** Owner-language message for the last failed write, or null. */
  writeError: string | null;
};

const EMPTY: McpGatewayState = {
  tools: [],
  loading: true,
  error: false,
  canWrite: false,
  saving: false,
  writeError: null,
};

const STATUSES = new Set<GatewayStatus>(["unconfigured", "pending_verification", "connected", "error"]);
const HEALTHS = new Set<GatewayHealth>(["unknown", "checking", "healthy", "needs_attention"]);

/**
 * Closed-set code → owner-facing copy, covering BOTH vocabularies the gateway can answer in.
 *
 * UPPERCASE `MCP_*` are the SECURITY DEFINER writers' closed set, surfaced by the edge's
 * `mapWriterError`. lowercase snake_case are the edge handlers' own. A caller maps once, whichever
 * door refused. Every entry below was read out of a handler or a migration — never guessed (§13);
 * an unknown code degrades to a plain sentence rather than a raw token.
 */
const ERR: Record<string, string> = {
  /* ── writer closed set (uppercase, via mapWriterError) ───────────────────── */
  MCP_FORBIDDEN: "You don't have permission to manage tools for this workspace.",
  MCP_BAD_PROVIDER: "That provider isn't recognized.",
  MCP_BAD_LABEL: "Enter a name for this tool.",
  MCP_BAD_VISIBILITY: "That visibility isn't valid for this tool.",
  MCP_BAD_AUTH_KIND: "That sign-in type isn't valid for this tool.",
  MCP_AUTH_KIND_NOT_EXECUTABLE:
    "An API key can't be used for a remote MCP server — add it as an n8n API-key tool instead.",
  MCP_BAD_ENDPOINT:
    "That address can't be used. Enter a public https:// address — local, private, or non-HTTPS addresses aren't allowed.",
  MCP_BAD_CREDENTIAL_BUNDLE: "Those credentials are incomplete for this sign-in type.",
  MCP_BAD_CUSTOM_HEADERS: "Check the header names and values. Duplicate, reserved, or oversized headers cannot be saved.",
  // INT-153. Previously absent from this map, so the commonest paste mistake — a short token —
  // fell through to the generic "that didn't go through" and told the person nothing actionable.
  MCP_CREDENTIAL_TOO_SHORT: `That key is too short. Paste the full one — it needs at least ${MCP_CREDENTIAL_MIN_LENGTH} characters.`,
  MCP_OAUTH_TOKEN_EXPIRED: "That access token has already expired. Get a fresh one and try again.",
  MCP_DUPLICATE_LABEL: "You already have a tool with that name — pick a different name.",
  MCP_NOT_A_REST_CONNECTION: "This isn't an API-key tool, so it can't be re-keyed this way.",
  MCP_NO_CONNECTION: "That tool could not be found.",
  // The endpoint moved between the review and the write. Actionable and deliberately distinct from
  // the uniform 403 — the person needs to look at the address again, not at their permissions.
  MCP_ENDPOINT_CHANGED:
    "This tool's address changed since you reviewed it. Open it, check the address, then approve again.",
  MCP_EXPIRY_IN_PAST: "That approval would already have expired. Pick a longer window.",
  MCP_BAD_REQUEST: "Some of those details weren't valid. Check them and try again.",
  // A projection of the shipped n8n/Zapier path, which still owns it. Naming the surface that CAN
  // act beats an instruction this one cannot carry out.
  MCP_LEGACY_CONNECTION_READONLY:
    "This one is managed on its own integration card below — open n8n or Zapier there to change it.",

  /* ── gateway edge's own set (lowercase) ──────────────────────────────────── */
  // wrapper (index.ts)
  unauthorized: "Your session has expired. Sign in again, then try once more.",
  method_not_allowed: "That request couldn't be sent. Reload the page and try again.",
  unsupported_action: "Paige can't do that with this tool yet.",
  // shared across handlers
  no_tenant: "We couldn't tell which workspace you're in. Reload the page and try again.",
  tenant_mismatch:
    "You switched workspace while this was in flight, so nothing was changed. Try again in this workspace.",
  forbidden: "You don't have permission to manage tools for this workspace.",
  not_found: "That tool could not be found.",
  lookup_failed: "We couldn't read this tool just now. Try again in a moment.",
  // create
  unsupported_facet: "That kind of tool isn't supported here.",
  create_failed: "That tool couldn't be added just now. Try again in a moment.",
  // verify
  bad_connection_id: "We couldn't tell which tool you meant. Reload and try again.",
  probe_write_failed: "The check ran but its result couldn't be saved. Try again in a moment.",
  config_changed_during_verify:
    "This tool was changed while it was being checked, so the result was discarded. Check it again.",
  provider_reflected_credential:
    "This server sent your key back inside its own tool list, so Paige refused it. Replace the key and check with the provider before using it.",
  unreachable: "Paige couldn't reach that address. Check it, then try again.",
  // oauth_begin
  connection_unconfigured: "This tool has no address or key yet, so there's nothing to sign in to.",
  // Deliberately names NO control. This one entry serves two routes with opposite truths — on a
  // turned-off non-OAuth row "Re-key it" is correct, on a turned-off OAuth row Re-key does not
  // render at all — so any imperative here is wrong half the time. That is how the first fix for
  // this string failed: it swapped one absent control for another. The drawer carries the specific
  // recovery, because it is the only place that knows which row this is.
  connection_disabled: "This tool is turned off, so Paige can't reach it right now.",
  // Raised when the redirect URI cannot be derived server-side — a configuration state that waiting
  // never clears, so "try again shortly" was advice that could not work (§13).
  callback_not_configured:
    "Sign-in isn't switched on for this workspace yet. Nothing was changed — this one is on us, not something you can fix here.",
  // "…or add it with a key instead" was wrong at BOTH call sites and shipped past the first fix,
  // because this map — not the caller's fallback — is what actually renders. A row created for
  // sign-in carries no credential, and Re-key offers no key field for a credential-less tool nor
  // any way to change a tool's sign-in type; an existing OAuth tool is not re-keyable at all
  // (`rekeyable = authKind !== "oauth"`). So the instruction named a control that exists on
  // neither path (§70.1). Caught by the peer-gate, then caught AGAIN — in the right place — by the
  // regression test written for the first fix.
  // REASON ONLY, deliberately — the advice moved to the call site (`SignInFlow`), which is the
  // only place that knows a connection row now EXISTS and can therefore say "it is saved under
  // that name" in the same breath. Leaving the advice here produced it twice, and leaving it here
  // ALONE produced a banner that read "nothing happened" directly above a locked Name field
  // reading "Saved under this name." A render caught that contradiction; no unit test did.
  oauth_begin_failed: "That provider didn't offer a sign-in Paige can use.",
  // approve
  bad_tool_name: "We couldn't tell which action you meant. Reload and try again.",
  bad_expected_endpoint: "We couldn't confirm the address you reviewed. Reload and try again.",
  bad_args_shape: "We couldn't read the shape of that action. Reload and try again.",
  // These two used to name no control, because the picker they would have pointed at did not
  // render anywhere. It does now — the drawer's action list offers the listed windows — so they
  // can finally say what to do about it instead of only what went wrong.
  bad_expiry: "That approval's time limit couldn't be read, so nothing was approved. Pick a window and try again.",
  bad_timestamp: "That approval's time limit isn't a real date, so nothing was approved. Pick a window and try again.",
  expiry_in_past: "That approval would already have expired. Pick a longer window.",
  tool_not_verified:
    "Paige hasn't confirmed this action exists on the server yet. Check the tool first, then approve.",
  no_endpoint: "This tool has no confirmed address yet, so there's nothing to bind an approval to.",
  approve_failed: "That approval couldn't be saved just now. Try again in a moment.",
  // execute
  execute_not_enabled: "Paige isn't cleared to run this tool's actions yet.",
  // client-side only: `approvalExpiryFromMinutes` refused a lifetime under the floor, so nothing was
  // sent. Distinct from the server's `expiry_in_past`, which is about a date already gone.
  expiry_below_floor: `An approval needs to last at least ${APPROVAL_MIN_LIFETIME_MINUTES} minutes. Pick a longer window.`,
};

/**
 * The line a caller gets when the map has NOTHING for the code that came back.
 *
 * Named and exported because "the map answered" and "the map had nothing" are different facts and
 * a caller sometimes has to act on the difference. `SignInFlow` is the case: by the time it reads
 * a refusal a connection row EXISTS, so "That didn't go through" is flatly false there and has to
 * be swapped for a line about the step that actually failed. Comparing against a string literal
 * spelled out at the call site would drift the moment this one is reworded.
 */
export const MCP_GATEWAY_GENERIC_REFUSAL = "That didn't go through. Check the details and try again.";

/** Owner-facing copy for a gateway code. Exported so the hook and its callers map identically. */
export function mcpGatewayMessage(code: string | null): string {
  if (code && ERR[code]) return ERR[code];
  return MCP_GATEWAY_GENERIC_REFUSAL;
}

/** Pull the closed-set MCP_* token out of a Postgres error (raised as the exception MESSAGE).
 *  Still needed for the RPC lane — rekey and disconnect answer in Postgres errors, not HTTP. */
function extractCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { message?: unknown; details?: unknown; hint?: unknown };
  for (const field of [e.message, e.details, e.hint]) {
    if (typeof field === "string") {
      const m = field.match(/MCP_[A-Z_]+/);
      if (m) return m[0];
    }
  }
  return null;
}

/**
 * Every RPC answer this hook acts on, reduced to a shape it can always read.
 *
 * `.catch` only fires when the adapter REJECTS. An adapter that RESOLVES with something unusable —
 * `undefined`, `null`, a primitive — sails past it, and the very next line then throws on a property
 * read, escaping as an unhandled rejection: the caller never settles, so the surface sits on
 * "Loading your tools…" forever instead of reaching the honest error state. That is the exact
 * failure this guard exists to prevent, so the guarantee is unconditional rather than left
 * dependent on HOW the adapter failed.
 *
 * An unreadable answer is treated as a failed read, never as an empty account, and — on the write
 * path — never as a confirmed write. `{}` carries no confirmation that anything happened, so
 * reporting it as success would close the drawer on a write the server never acknowledged (§13).
 */
function rpcResult(value: unknown): { data: unknown; error: unknown } {
  if (typeof value !== "object" || value === null) return { data: null, error: true };
  const row = value as { data?: unknown; error?: unknown };
  // An object carrying NEITHER field is not an RPC envelope — `{}`, `[]`, a bare Response, a builder
  // that never ran. Absence of an `error` key is not evidence of success.
  if (!("data" in row) && !("error" in row)) return { data: null, error: true };
  return { data: row.data ?? null, error: row.error ?? null };
}

/**
 * The shared success shape of every writer that acknowledges with a connection id — the create
 * door's 200 body and the three RPC writers alike, which return the same four safe fields.
 * A body with no `connection_id` confirmed nothing and is reported as a failure, never as a write
 * that "probably worked" (§13).
 */
function interpretWrite(data: Record<string, unknown>): GatewayWriteResult {
  const connectionId = str(data.connection_id);
  if (!connectionId || data.ok === false) {
    return { ok: false, code: null, message: mcpGatewayMessage(null) };
  }
  return {
    ok: true,
    code: null,
    message: null,
    connectionId,
    status: str(data.status),
    last4: str(data.auth_token_last4),
    // `mode` is the disconnect writer's soft/hard answer, so it is only ever set on the RPC lane.
    // The create door returns connection_id/status/endpoint_hash/auth_token_last4 and no mode, so
    // this is legitimately null there rather than a field that went missing.
    mode: str(data.mode),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function bool(value: unknown): boolean {
  return value === true;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function scopes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Parse one registry row into the host-only, secret-free shape the UI renders.
 *
 * A row must carry the fields the contract promises. An id-only row used to be accepted and its
 * identity INVENTED — "generic-remote", "Tool", a default status — which renders a tool the owner
 * never added, described in words the server never said. Fabricated state is worse than a visible
 * read failure, because nothing on screen marks it as a guess (§13).
 */
function readRow(value: unknown): GatewayConnection | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const id = str(r.connection_id);
  const providerKey = str(r.provider_key);
  const label = str(r.label);
  const rawStatus = str(r.status);
  if (!id || !providerKey || !label || !rawStatus) return null;
  const status = rawStatus as GatewayStatus;
  const health = (str(r.health) ?? "unknown") as GatewayHealth;
  if (!STATUSES.has(status)) return null;
  return {
    id,
    providerKey,
    label,
    transport: str(r.transport),
    authKind: str(r.auth_kind),
    configured: bool(r.configured),
    enabled: bool(r.enabled),
    status,
    health: HEALTHS.has(health) ? health : "unknown",
    lastCheckedAt: str(r.last_checked_at),
    grantedScopes: scopes(r.granted_scopes),
    visibility: str(r.visibility),
    serverUrlHost: str(r.server_url_host),
    toolCount: count(r.tool_count),
    approvedCount: count(r.approved_count),
    addressConfigured: typeof r.address_configured === "boolean" ? r.address_configured : null,
    credentialsConfigured: typeof r.credentials_configured === "boolean" ? r.credentials_configured : null,
    customHeaderCount: count(r.custom_header_count),
    configGeneration: count(r.config_generation),
  };
}

/**
 * `get_mcp_connections_v2` returns a jsonb array; a `{connections:[…]}` wrapper is tolerated
 * defensively. Returns null for a payload this reader does not recognise, or one whose entries
 * are all unreadable — an older deployment, an RPC regression or a corrupt row must NOT be
 * flattened into an empty list, because "no tools" is a claim about the account and this reader
 * would be making it without evidence (§13). Only a validated empty array yields [].
 */
function readList(value: unknown): GatewayConnection[] | null {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { connections?: unknown }).connections)
      ? (value as { connections: unknown[] }).connections
      : null;
  if (rows === null) return null;
  const parsed = rows.map(readRow);
  // ANY unreadable row fails the whole read. Dropping the bad ones and rendering the rest is a
  // quieter lie than dropping all of them: the list would look complete while silently missing
  // whatever did not parse, and the owner has no way to tell.
  if (parsed.some((row) => row === null)) return null;
  return parsed;
}

export type UseMcpGateway = McpGatewayState & {
  createMcp: (draft: CreateMcpDraft) => Promise<GatewayWriteResult>;
  createRest: (draft: CreateRestDraft) => Promise<GatewayWriteResult>;
  /** Run the read-only probe: handshake the server, load its tool catalogue, persist the result. */
  verify: (connectionId: string) => Promise<GatewayVerifyResult>;
  /** Start a provider sign-in. Resolves with the URL to send the browser to. */
  beginOAuth: (connectionId: string) => Promise<GatewayOAuthResult>;
  /** List the ACTIONS one connection offers, with each one's approval story. A refusal here is
   *  deliberately uniform — unknown, another tenant's, and an owner_only one this caller may not
   *  see are indistinguishable, so the list cannot be used to probe for what exists. */
  listTools: (connectionId: string) => Promise<GatewayToolsResult>;
  /** Record durable per-tool consent. `expiry` is built by `approvalExpiryFromMinutes`, which is
   *  where the lifetime floor is applied; a `below_floor` result is refused here rather than being
   *  sent as "no expiry". */
  approveTool: (connectionId: string, toolName: string, expiry: ApprovalExpiry) => Promise<GatewayWriteResult>;
  rekeyMcp: (
    connectionId: string,
    serverUrl: string,
    authKind: GatewayAuthKind,
    authToken?: string | null,
    authHeaderName?: string | null,
    customHeaders?: Record<string, string>,
  ) => Promise<GatewayWriteResult>;
  rekeyRest: (connectionId: string, baseUrl: string, apiKey: string) => Promise<GatewayWriteResult>;
  disconnect: (connectionId: string, hard: boolean) => Promise<GatewayWriteResult>;
  reload: () => void;
  dismissWriteError: () => void;
};

/** The closed vocabulary the gateway may answer with. An unrecognised non-empty value means the
 *  server knows something this build does not, so it is treated as a BLOCK rather than dropped —
 *  dropping it would silently promote a blocked approval back to "fine", which is the exact
 *  direction this field exists to stop the surface failing in. */
function blockedReason(v: unknown): GatewayToolRow["approvalBlockedReason"] {
  if (typeof v !== "string" || !v) return null;
  const known = ["endpoint_missing", "contract_changed", "approval_not_endpoint_bound", "endpoint_changed", "approval_expired"];
  return (known.includes(v) ? v : "contract_changed") as GatewayToolRow["approvalBlockedReason"];
}

export function useMcpGateway(): UseMcpGateway {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const gate = useRef(createSettingsRequestGate());
  // The gateway lists ALL of a tenant's connections, so the scope is provider-agnostic.
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${tenantLoading}`;
  const scopeRef = useRef(scope);
  const mounted = useRef(false);
  const mutation = useRef(0);
  const pendingMutation = useRef(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [state, setState] = useState<McpGatewayState>({ ...EMPTY });

  // Mask stale data the instant the workspace identity changes — before any effect can paint it.
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    gate.current.clear();
    mutation.current += 1;
    pendingMutation.current = false;
    if (loadedScope !== null) setLoadedScope(null);
    setState({ ...EMPTY });
  }

  const load = useCallback(async () => {
    if (tenantLoading) return;
    const token = gate.current.begin();
    const answers = (await Promise.all([
      // Reads take NO tenant argument — the server derives the tenant. (Locked by the settings
      // truth-boundary test: every get_* call carries exactly its own name and no args.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("get_mcp_connections_v2"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("is_current_user_tenant_admin"),
    ]).catch(() => [])) as unknown[];
    // Normalized per answer, so a rejection and an unusable resolution land in the same place.
    const list = rpcResult(answers[0]);
    const admin = rpcResult(answers[1]);

    if (!mounted.current || scopeRef.current !== scope || !gate.current.isCurrent(token)) return;
    setLoadedScope(scope);
    if (list.error) {
      // A failed READ is never rendered as "no connections" — that would lie about the account.
      setState((prev) => ({
        ...EMPTY,
        loading: false,
        error: true,
        canWrite: false,
        saving: pendingMutation.current,
        writeError: prev.writeError,
      }));
      return;
    }
    const parsed = readList(list.data);
    if (parsed === null) {
      // Same honest posture as a failed read: never render an unreadable account as an empty one.
      setState((prev) => ({
        ...EMPTY,
        loading: false,
        error: true,
        canWrite: false,
        saving: pendingMutation.current,
        writeError: prev.writeError,
      }));
      return;
    }
    setState((prev) => ({
      tools: parsed,
      loading: false,
      error: false,
      canWrite: admin.error ? false : admin.data === true,
      saving: pendingMutation.current,
      writeError: prev.writeError,
    }));
  }, [scope, tenantLoading]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /**
   * The shared pre-flight every mutating call takes: real tenant, current scope, write authority,
   * no write already in flight. Returns a refusal to hand straight back, or null to proceed.
   *
   * These are NOT rejections by the server — nothing was sent — so their codes are deliberately
   * outside both server vocabularies and carry no message on the two that mean "not yet" (§13).
   */
  const preflight = useCallback((): GatewayWriteResult | null => {
    if (!activeTenantId || tenantLoading) return { ok: false, code: "MCP_NOT_READY", message: null };
    if (!state.canWrite) return { ok: false, code: "MCP_FORBIDDEN", message: ERR.MCP_FORBIDDEN };
    if (pendingMutation.current) return { ok: false, code: "MCP_BUSY", message: null };
    return null;
  }, [activeTenantId, tenantLoading, state.canWrite]);

  /**
   * Call one action on the `mcp-gateway` edge function.
   *
   * `expected_tenant_id` rides on every call — the edge compares it to the tenant it re-derives
   * from the JWT and answers 409 `tenant_mismatch` if the workspace changed mid-flight.
   *
   * On a NON-2xx, supabase-js sets `data = null` and puts the honest JSON body inside the
   * FunctionsHttpError's `.context` Response. Reading the code off `data` alone would therefore
   * miss every refusal and fall back to the framework's own "non-2xx status code" string — jargon
   * no owner should ever read (§3/§36). `readFunctionErrorBody` is the one home for both shapes.
   */
  const callEdge = useCallback(
    async (
      action: string,
      body: Record<string, unknown>,
      /** When true, a NON-2xx whose body carries no `error` key is handed back to the caller's
       *  interpreter instead of being collapsed into an opaque refusal.
       *
       *  This exists for exactly one real shape. `verify` answers 409 with
       *  `{ok:false, status:"pending_verification", tool_count:0, error_code:"config_changed_during_verify"}`
       *  — a genuine verdict about the probe, keyed on `error_code`, with NO `error` key at all. Read
       *  as a plain refusal it produced the generic "that didn't go through", and the race message
       *  written for it was unreachable. The caller decides what the body means; this only stops the
       *  body being thrown away. */
      opts: { bodyOnRefusal?: boolean } = {},
    ): Promise<{ ok: boolean; code: string | null; data: Record<string, unknown> }> => {
      const answer = await Promise.resolve(
        supabase.functions.invoke("mcp-gateway", {
          body: { action, expected_tenant_id: activeTenantId, ...body },
        }),
      ).catch(() => null);

      // An adapter that resolves with something unusable is a failed call, never a silent success.
      if (!answer || typeof answer !== "object") {
        return { ok: false, code: null, data: {} };
      }
      const { data, error } = answer as { data?: unknown; error?: unknown };
      const failure = await readFunctionErrorBody(error, data).catch(() => null);
      const failureCode = typeof failure?.error === "string" ? failure.error : null;
      if (error || failureCode) {
        // A structured non-2xx the caller can read (see `bodyOnRefusal`): hand the body through
        // rather than discarding the one field that explains what happened.
        if (opts.bodyOnRefusal && !failureCode && failure && typeof failure === "object") {
          return { ok: true, code: null, data: failure };
        }
        return { ok: false, code: failureCode, data: {} };
      }
      // A 2xx whose body is not an object confirms nothing. Treating it as success would close a
      // drawer on a write the server never acknowledged (§13).
      if (!data || typeof data !== "object") {
        return { ok: false, code: null, data: {} };
      }
      return { ok: true, code: null, data: data as Record<string, unknown> };
    },
    [activeTenantId],
  );

  /**
   * Run one mutating call under the write lock, then reload from the server on success.
   *
   * `send` returns the raw outcome; `interpret` turns it into the caller's result type. Splitting
   * them keeps ONE home for the lock, the staleness check and the error plumbing while letting each
   * action keep its own success contract — create answers with a connection_id, verify with a probe
   * verdict, oauth_begin with a URL. Collapsing those into one shape would have forced every caller
   * to re-check which fields its action actually sets.
   */
  const guarded = useCallback(
    async <T extends GatewayWriteResult>(
      send: () => Promise<{ ok: boolean; code: string | null; data: Record<string, unknown> }>,
      interpret: (data: Record<string, unknown>) => T,
      opts: { reloadOnSuccess?: boolean } = {},
    ): Promise<T> => {
      const refusal = preflight();
      if (refusal) return refusal as T;

      const request = ++mutation.current;
      pendingMutation.current = true;
      const current = () => mounted.current && scopeRef.current === scope && mutation.current === request;
      setState((prev) => ({ ...prev, saving: true, writeError: null }));

      const outcome = await send();

      if (!current()) {
        // A stale request must NOT release a lock it no longer owns: if a write for the previous
        // workspace resolves after the current one started, clearing the shared ref here would let
        // a second concurrent write run and discard the live one as stale.
        if (mutation.current === request) pendingMutation.current = false;
        return { ok: false, code: "MCP_STALE", message: null } as T;
      }
      pendingMutation.current = false;

      if (!outcome.ok) {
        const message = mcpGatewayMessage(outcome.code);
        setState((prev) => ({ ...prev, saving: false, writeError: message }));
        return { ok: false, code: outcome.code, message } as T;
      }

      const result = interpret(outcome.data);
      if (!result.ok) {
        // The call succeeded at the transport but the ACTION reported a failure of its own (a probe
        // that could not reach the server, a body that confirmed nothing). Surface it as written.
        setState((prev) => ({ ...prev, saving: false, writeError: result.message }));
        if (opts.reloadOnSuccess !== false) void load();
        return result;
      }
      setState((prev) => ({ ...prev, saving: false, writeError: null }));
      if (opts.reloadOnSuccess !== false) void load();
      return result;
    },
    [preflight, scope, load],
  );

  /* ── Edge-bound actions ───────────────────────────────────────────────────── */

  const createMcp = useCallback(
    (draft: CreateMcpDraft) =>
      guarded(
        () => {
          const usesToken = draft.authKind === "bearer" || draft.authKind === "header";
          return callEdge("create", {
            facet: "mcp",
            provider_key: draft.providerKey,
            label: draft.label,
            server_url: draft.serverUrl,
            auth_kind: draft.authKind,
            // Only the credential the chosen auth_kind actually uses is sent; nothing else. The
            // writer rejects a stray field belonging to another scheme, so sending more than the
            // kind needs is a refusal, not a kindness.
            auth_token: usesToken ? draft.authToken ?? null : null,
            auth_header_name: draft.authKind === "header" ? draft.authHeaderName ?? null : null,
            ...(draft.customHeaders === undefined ? {} : { custom_headers: draft.customHeaders }),
          });
        },
        (data) => interpretWrite(data),
      ),
    [guarded, callEdge],
  );

  const createRest = useCallback(
    (draft: CreateRestDraft) =>
      guarded(
        () =>
          callEdge("create", {
            facet: "rest",
            provider_key: "n8n",
            label: draft.label,
            base_url: draft.baseUrl,
            api_key: draft.apiKey,
          }),
        (data) => interpretWrite(data),
      ),
    [guarded, callEdge],
  );

  /**
   * Check a tool: handshake its server read-only, load its tool catalogue, persist the verdict.
   *
   * A probe that REACHES the server and finds it broken answers 200 with `ok:false` plus a status
   * and an `error_code`. That is a real, useful answer — not a transport failure — so it is
   * reported as `ok:false` carrying `probeStatus`/`probeError`, and the list still reloads because
   * the row's status genuinely changed on the server.
   */
  const verify = useCallback(
    (connectionId: string) =>
      guarded<GatewayVerifyResult>(
        // The 409 config-race body is a verdict, not a refusal — see `bodyOnRefusal`.
        () => callEdge("verify", { connection_id: connectionId }, { bodyOnRefusal: true }),
        (data) => {
          const probeStatus = str(data.status) as GatewayStatus | null;
          const probeHealth = str(data.health) as GatewayHealth | null;
          const probeError = str(data.error_code);
          const reached = data.ok === true;
          return {
            ok: reached,
            // A probe verdict is not a request refusal, so it never borrows a refusal's code.
            code: null,
            message: reached ? null : mcpGatewayMessage(probeError),
            probeStatus: probeStatus && STATUSES.has(probeStatus) ? probeStatus : null,
            probeHealth: probeHealth && HEALTHS.has(probeHealth) ? probeHealth : null,
            toolCount: count(data.tool_count),
            probeError,
          };
        },
      ),
    [guarded, callEdge],
  );

  /**
   * List the actions a connection offers.
   *
   * A pure READ, so it takes no write lock and does not reload the connection list: nothing on
   * the server changed, and a reload would only re-fetch rows the drawer already holds.
   *
   * Every field is rendered, never recomputed. `requiresApproval`, `approvalExpired` and
   * `approvalStale` are the SERVER's verdicts — expiry in particular is judged on the Postgres
   * clock, which is the whole point: the approval lifetime floor exists because a value minted on
   * the browser clock and judged on the server's can be dead before first use, so the browser is
   * the last thing that should be deciding whether consent is still live.
   */
  const listTools = useCallback(
    async (connectionId: string): Promise<GatewayToolsResult> => {
      const answer = await callEdge("tools", { connection_id: connectionId });
      if (!answer.ok) {
        return {
          ok: false,
          code: answer.code,
          message: mcpGatewayMessage(answer.code),
          tools: [],
          toolCount: 0,
          approvedCount: 0,
          observedAt: null,
        };
      }
      const raw = Array.isArray(answer.data.tools) ? answer.data.tools : [];
      const tools: GatewayToolRow[] = [];
      for (const t of raw) {
        if (!t || typeof t !== "object") continue;
        const r = t as Record<string, unknown>;
        const name = str(r.name);
        // A row with no name cannot be approved and cannot be labelled; rendering it would put an
        // unnamed control in front of the owner. The edge already drops these — this is the
        // second belt, not the first.
        if (!name) continue;
        tools.push({
          name,
          effects: Array.isArray(r.effects) ? r.effects.filter((e): e is string => typeof e === "string") : [],
          app: str(r.app) ?? "",
          actionType: str(r.actionType) ?? "",
          requiresApproval: r.requiresApproval === true,
          approvalBasis: (str(r.approvalBasis) as GatewayToolRow["approvalBasis"]) ?? null,
          approved: r.approved === true,
          approvedAt: str(r.approvedAt),
          expiresAt: str(r.expiresAt),
          approvalExpired: r.approvalExpired === true,
          approvalStale: r.approvalStale === true,
          approvedByYou: r.approvedByYou === true,
          approvalBlockedReason: blockedReason(r.approvalBlockedReason),
          observedAt: str(r.observedAt),
        });
      }
      return {
        ok: true,
        code: null,
        message: null,
        tools,
        // Fall back to the rows only when the server sent no count. A server count and a local
        // count disagreeing would mean the definitions have drifted, and the server's is the one
        // that governs.
        toolCount: count(answer.data.tool_count) ?? tools.length,
        approvedCount:
          count(answer.data.approved_count) ??
          tools.filter((t) => t.approved && t.approvalBlockedReason === null).length,
        observedAt: str(answer.data.observed_at),
      };
    },
    [callEdge],
  );

  /**
   * Start a provider sign-in and hand back where to send the browser.
   *
   * Deliberately does NOT navigate: the caller decides when to leave the page, and a hook that
   * assigned `window.location` would make this untestable and would strand an open drawer's unsaved
   * state without warning.
   */
  const beginOAuth = useCallback(
    (connectionId: string) =>
      guarded<GatewayOAuthResult>(
        () => callEdge("oauth_begin", { connection_id: connectionId }),
        (data) => {
          const authorizeUrl = str(data.authorize_url);
          // No URL is no flow. Reporting success here would send the caller to `undefined`.
          if (!authorizeUrl) {
            return { ok: false, code: null, message: mcpGatewayMessage("oauth_begin_failed"), authorizeUrl: null };
          }
          return { ok: true, code: null, message: null, authorizeUrl };
        },
        // Nothing has changed on the server yet — the grant lands in the JWT-less callback, after
        // the person actually signs in. Reloading now would only re-fetch an unchanged list.
        { reloadOnSuccess: false },
      ),
    [guarded, callEdge],
  );

  /**
   * Record durable consent for ONE action on ONE tool.
   *
   * A `below_floor` expiry never reaches the wire. That matters because omitting `expires_at` means
   * NO EXPIRY to the handler, so sending a rejected lifetime as an omission would turn the most
   * suspicious input into the most permissive outcome — the fail-open this type exists to prevent.
   */
  const approveTool = useCallback(
    (connectionId: string, toolName: string, expiry: ApprovalExpiry) =>
      guarded(
        () => {
          if (expiry.kind === "below_floor") {
            return Promise.resolve({ ok: false, code: "expiry_below_floor", data: {} });
          }
          return callEdge("approve", {
            connection_id: connectionId,
            tool_name: toolName,
            // Omitted only for a DELIBERATE no-expiry. `below_floor` was refused above, so an
            // absent key here can only ever mean the caller asked for no time limit.
            ...(expiry.kind === "expires" ? { expires_at: expiry.at } : {}),
          });
        },
        (data) => {
          // The handler answers { ok, connection_id, tool_name, approved }. `approved !== true` is
          // not a consent we may claim, whatever else the body says (§13).
          const approved = data.approved === true && data.ok === true;
          return {
            ok: approved,
            code: null,
            message: approved ? null : mcpGatewayMessage("approve_failed"),
            connectionId: str(data.connection_id),
          };
        },
      ),
    [guarded, callEdge],
  );

  /* ── RPC-bound actions (no edge door exists — §58, kept rather than dropped) ──
     These three call the SECURITY DEFINER writers directly, exactly as before this rebind. Their
     authority is each writer's own in-body §9 gate, and `_tenant_id` rides along as the caller's
     expected-tenant hint. When `rekey` and `disconnect` actions land on the gateway edge, these
     move across and this block goes away; until then they are the only doors that exist. */

  const runRpc = useCallback(
    async (name: string, params: Record<string, unknown>): Promise<GatewayWriteResult> => {
      const refusal = preflight();
      if (refusal) return refusal;

      const request = ++mutation.current;
      pendingMutation.current = true;
      const current = () => mounted.current && scopeRef.current === scope && mutation.current === request;
      setState((prev) => ({ ...prev, saving: true, writeError: null }));

      // `supabase.rpc()` returns a PostgrestFilterBuilder — a thenable with NO `.catch`, so it is
      // adopted by Promise.resolve BEFORE any rejection handler is attached. Calling `.catch` on the
      // builder directly throws before the request is sent (and an `as Promise<…>` assertion hides
      // that from tsc). Same idiom as useN8nConnection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (supabase as any).rpc(name, { ...params, _tenant_id: activeTenantId });
      const { data, error } = rpcResult(await Promise.resolve(call).catch(() => null));

      if (!current()) {
        if (mutation.current === request) pendingMutation.current = false;
        return { ok: false, code: "MCP_STALE", message: null };
      }
      pendingMutation.current = false;

      if (error) {
        const code = extractCode(error);
        const message = mcpGatewayMessage(code);
        setState((prev) => ({ ...prev, saving: false, writeError: message }));
        return { ok: false, code, message };
      }
      const out = (data ?? {}) as Record<string, unknown>;
      // Every shipped writer acknowledges with `connection_id` (all 7 returns in
      // 20270331000000_mcp_gateway_native_writers.sql, disconnect's three branches included). An
      // answer without it did not confirm the operation, and the reload that follows cannot make a
      // success claim retroactively true (§13).
      const result = interpretWrite(out);
      if (!result.ok) {
        setState((prev) => ({ ...prev, saving: false, writeError: result.message }));
        return result;
      }
      setState((prev) => ({ ...prev, saving: false, writeError: null }));
      void load();
      return result;
    },
    [preflight, activeTenantId, scope, load],
  );

  const rekeyMcp = useCallback(
    (
      connectionId: string,
      serverUrl: string,
      authKind: GatewayAuthKind,
      authToken?: string | null,
      authHeaderName?: string | null,
      customHeaders?: Record<string, string>,
    ) =>
      runRpc("set_mcp_connection_endpoint", {
        _connection_id: connectionId,
        _server_url: serverUrl,
        _auth_kind: authKind,
        // `url` and `none` carry no credential by contract; every other kind carries what it was given.
        _auth_token: authKind === "url" || authKind === "none" ? null : authToken ?? null,
        _auth_header_name: authKind === "header" ? authHeaderName ?? null : null,
        ...(customHeaders === undefined ? {} : { _custom_headers: customHeaders }),
      }),
    [runRpc],
  );

  const rekeyRest = useCallback(
    (connectionId: string, baseUrl: string, apiKey: string) =>
      runRpc("set_mcp_rest_connection_endpoint", {
        _connection_id: connectionId,
        _base_url: baseUrl,
        _api_key: apiKey,
      }),
    [runRpc],
  );

  const disconnect = useCallback(
    (connectionId: string, hard: boolean) =>
      runRpc("disconnect_mcp_connection", { _connection_id: connectionId, _hard: hard }),
    [runRpc],
  );

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const dismissWriteError = useCallback(() => {
    setState((prev) => ({ ...prev, writeError: null }));
  }, []);

  // While the scope has not finished loading (or the tenant is still resolving), present the masked
  // EMPTY state rather than another workspace's rows.
  const visible: McpGatewayState =
    loadedScope !== scope || tenantLoading
      ? { ...EMPTY, loading: true, saving: state.saving, writeError: state.writeError }
      : state;

  return {
    ...visible,
    createMcp,
    createRest,
    verify,
    beginOAuth,
    listTools,
    approveTool,
    rekeyMcp,
    rekeyRest,
    disconnect,
    reload,
    dismissWriteError,
  };
}

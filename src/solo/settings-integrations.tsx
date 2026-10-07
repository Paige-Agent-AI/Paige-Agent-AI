import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Link2Off, Plug, RefreshCw, TriangleAlert, Workflow, X, Zap } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { SoloAutomationsView } from "./settings-automations";
import { IntegrationsGatewaySection, connectionForProvider, type GatewayLegacyTarget } from "./settings-integrations-gateway";
import { useMcpGateway } from "./data/useMcpGateway";
import { IntegrationLogo } from "./integration-logos";
import { SocialDrawer } from "./settings-integrations-social";
import { socialCardState } from "./settings-integrations-social-state";
import { SOCIAL_PLATFORMS, type SocialPlatformDefinition } from "./social-platform-catalog";
import { useSocialConnections } from "./data/useSocialConnections";
import { useN8nConnection, readN8nReadiness, type N8nConnection } from "./data/useN8nConnection";
import { useN8nOAuth, n8nMcpStateWords, type N8nReadiness } from "./data/useN8nOAuth";
import { useMcpConnection } from "./data/useMcpConnection";
import { useMcpCapabilities } from "./data/useMcpCapabilities";
import { useZapierApi, readZapierApi, zapierApiWords, type ZapierApiReadiness } from "./data/useZapierApi";
import { useStripeMerchant, stripeMerchantWords } from "./data/useStripeMerchant";
import { StripeMerchantDrawer } from "./settings-integrations-stripe";
import { supabase } from "@/integrations/supabase/client";
import { armOAuthReturn } from "./data/oauthReturn";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { createSettingsRequestGate, type SettingsTruth } from "./settings-contract";
import "./settings-integrations.css";

type SafeConnectionStatus = {
  configured?: boolean;
  enabled?: boolean;
  label?: string | null;
  status?: "unconfigured" | "connected" | "error" | string;
  last_sync_at?: string | null;
  last_probed_at?: string | null;
  workflow_count?: number | null;
  server_url_host?: string | null;
};

type IntegrationReadState = {
  scopeKey: string | null;
  apiError: boolean;
  mcpError: boolean;
  tenantId: string | null;
  loading: boolean;
  error: boolean;
  /** The shipped n8n API-key connection. Separate from n8n's MCP endpoint. */
  n8n: N8nConnection | null;
  zapierApi: ZapierApiReadiness | null;
  zapierApiError: boolean;
  /**
   * MCP connections keyed by provider. The registry is provider-scoped: one
   * workspace may hold an n8n MCP endpoint AND a Zapier one at the same time,
   * so a single `mcp` slot can no longer represent it.
   */
  mcp: Partial<Record<"n8n" | "zapier", SafeConnectionStatus>>;
};

/**
 * Whitelists what may cross into the surface. `last_error` and any raw payload
 * are deliberately absent: provider error text is unbounded external content.
 */
function sanitizeSafeConnectionStatus(value: unknown): SafeConnectionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    configured: typeof source.configured === "boolean" ? source.configured : undefined,
    enabled: typeof source.enabled === "boolean" ? source.enabled : undefined,
    label: typeof source.label === "string" ? source.label : null,
    status: typeof source.status === "string" ? source.status : undefined,
    last_sync_at: typeof source.last_sync_at === "string" ? source.last_sync_at : null,
    last_probed_at: typeof source.last_probed_at === "string" ? source.last_probed_at : null,
    workflow_count: typeof source.workflow_count === "number" ? source.workflow_count : null,
    server_url_host: typeof source.server_url_host === "string" ? source.server_url_host : null,
  };
}

/**
 * The provider-scoped getter returns `{ n8n: {...}, zapier: {...} }`. Each entry
 * goes through the same field whitelist as a single connection, so `last_error`
 * and any provider payload stay out of the browser exactly as before.
 */
function sanitizeMcpByProvider(value: unknown): Partial<Record<"n8n" | "zapier", SafeConnectionStatus>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Partial<Record<"n8n" | "zapier", SafeConnectionStatus>> = {};
  for (const provider of ["n8n", "zapier"] as const) {
    const entry = sanitizeSafeConnectionStatus(source[provider]);
    if (entry) out[provider] = entry;
  }
  return out;
}

type ProviderIdentity = "n8n" | "zapier" | "mcp" | "quickbooks" | "stripe" | "docusign" | "apollo" | "plaid" | "api";
type CatalogueCategory = "all" | "social" | "marketing" | "automation" | "financial" | "documents" | "client-data" | "developer";


function statusPresentation(value: SafeConnectionStatus | null) {
  if (!value?.configured || value.status === "unconfigured") {
    return { truth: "UNAVAILABLE" as SettingsTruth, account: "Not connected", tone: "neutral" };
  }
  if (value.enabled === false) return { truth: "PARTIAL" as SettingsTruth, account: "Turned off", tone: "warn" };
  if (value.status === "error") return { truth: "PARTIAL" as SettingsTruth, account: "Needs attention", tone: "bad" };
  if (value.status === "connected") return { truth: "LIVE" as SettingsTruth, account: "Connected", tone: "ok" };
  // Anything else means it exists but has not been proven to work — for a granted
  // connection, that the consent completed but the check has not. It is never rendered
  // as connected, and never as a status code the reader has to interpret.
  return { truth: "PARTIAL" as SettingsTruth, account: "Setup not finished", tone: "neutral" };
}

function useIntegrationStatus() {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const scopeKey = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${tenantLoading}`;
  const gate = useRef(createSettingsRequestGate());
  const identity = useRef(scopeKey); identity.current = scopeKey;
  const mounted = useRef(false);
  const [state, setState] = useState<IntegrationReadState>({ scopeKey: null, tenantId: null, loading: true, error: false, apiError: false, mcpError: false, n8n: null, zapierApi:null, zapierApiError:false, mcp: {} });
  const load = useCallback(async () => {
    if (!mounted.current || identity.current !== scopeKey || tenantLoading) return;
    const token = gate.current.begin();
    setState({ scopeKey: null, tenantId: null, loading: true, error: false, apiError: false, mcpError: false, n8n: null, zapierApi:null, zapierApiError:false, mcp: {} });
    if (!activeTenantId) { setState({ scopeKey, tenantId: null, loading: false, error: false, apiError: true, mcpError: true, n8n: null, zapierApi:null, zapierApiError:true, mcp: {} }); return; }
    const results = await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("get_tenant_n8n_api_readiness"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("get_tenant_mcp_connections"),
      // Some isolated catalogue harnesses intentionally provide an RPC-only client.
      // Treat a missing function transport as an unavailable Zapier status, never as an
      // unhandled render failure; the production client always supplies this transport.
      supabase.functions?.invoke
        ? supabase.functions.invoke("tenant-zapier-api-connect", { body: { action: "status", expected_tenant_id: activeTenantId } })
        : Promise.resolve({ data: null, error: { message: "transport_unavailable" } }),
    ]);
    if (!gate.current.isCurrent(token) || identity.current !== scopeKey || !mounted.current) return;
    const api = results[0].status === "fulfilled" ? results[0].value : null;
    const mcp = results[1].status === "fulfilled" ? results[1].value : null;
    const zapier = results[2].status === "fulfilled" ? results[2].value : null;
    const apiConnection = api && !api.error ? readN8nReadiness(api.data, activeTenantId) : null;
    const apiError = !apiConnection;
    const mcpError = !mcp || !!mcp.error || !mcp.data || typeof mcp.data !== "object" || Array.isArray(mcp.data);
    const zapierApi=zapier&&!zapier.error?readZapierApi(zapier.data?.connection,activeTenantId):null;const zapierApiError=!zapierApi;
    setState({ scopeKey, tenantId: activeTenantId, loading: false, error: apiError || mcpError || zapierApiError, apiError, mcpError,zapierApiError,
      n8n: apiConnection,zapierApi, mcp: mcpError ? {} : sanitizeMcpByProvider(mcp.data) });
  }, [activeTenantId, scopeKey, tenantLoading]);
  useEffect(() => { const activeGate = gate.current; mounted.current = true; if (!tenantLoading) void load(); return () => { mounted.current = false; activeGate.clear(); }; }, [load, tenantLoading]);
  return { ...state, loading: tenantLoading || state.loading || state.scopeKey !== scopeKey, retry: load };
}

/* ── The catalogue ────────────────────────────────────────────────────────────
   One row per provider. `connectable` is the whole product rule: a card either
   owns a real, tenant-safe connection contract for that exact provider, or it
   says so plainly. It never points at another surface. */

type ProviderRow = {
  id: ProviderIdentity;
  name: string;
  kind: string;
  filter: Exclude<CatalogueCategory, "all">;
  /** Only true where an audited, tenant-scoped connection seam exists today. */
  connectable: boolean;
  /** Why the connection cannot be offered yet. Shown in the panel, not the card. */
  note: string;
};

const PROVIDERS: ReadonlyArray<ProviderRow> = [
  { id: "n8n", name: "n8n", kind: "Automation", filter: "automation", connectable: true,
    note: "" },
  // Connectable through an authorization grant rather than a pasted credential, so the
  // panel offers consent instead of a form. The card's label is CD's to set; this row
  // only changes whether the connection can be made.
  // The Zapier slot. It can only ever hold Zapier: the setter writes that provider and
  // that endpoint, and the registry's CHECK refuses a Zapier row that is not OAuth. So
  // the card is named for what it is rather than for the protocol underneath it.
  { id: "mcp", name: "Zapier", kind: "Automation", filter: "automation", connectable: true,
    note: "" },
  { id: "quickbooks", name: "QuickBooks", kind: "Financial tools", filter: "financial", connectable: false,
    note: "The sync seams exist, but nothing yet proves a connection belongs to this workspace, so no setup is offered." },
  { id: "stripe", name: "Stripe Connect", kind: "Commerce", filter: "financial", connectable: true,
    note: "Connect the account your business uses to receive customer payments." },
  { id: "docusign", name: "DocuSign", kind: "Documents", filter: "documents", connectable: false,
    note: "The signature seams are older than the tenant-safe rules this surface follows, so setup is not offered yet." },
  { id: "apollo", name: "Apollo", kind: "Client data", filter: "client-data", connectable: false,
    note: "Enrichment settings are shared platform-wide, which cannot establish a connection for this workspace on its own." },
  { id: "plaid", name: "Plaid", kind: "Financial tools", filter: "financial", connectable: false,
    note: "Bank-link scaffolding exists but does not amount to a connection this workspace owns." },
  { id: "api", name: "Webhooks & direct API", kind: "Developer tools", filter: "developer", connectable: false,
    note: "Platform webhook and key records are not the same thing as a connection for this workspace." },
];

function providerMark(id: ProviderIdentity) {
  if (id === "n8n") return "n8n";
  if (id === "mcp") return "zap";
  return id.slice(0, 2).toUpperCase();
}

/**
 * The category ladder. Social is a CATEGORY — never a label restated under every tool inside it —
 * so it is named once, on the group heading, and the tools below it carry only their own identity.
 * Each group takes one of the platform's existing --k-* accents; no new colour enters the system.
 */
type GroupId = "automation" | "social" | "financial" | "documents" | "client-data" | "developer";
const GROUPS: ReadonlyArray<{ id: GroupId; label: string; accent: string; blurb: string; note?: string }> = [
  { id: "automation", label: "Automation", accent: "var(--k-automation)", blurb: "Run workflows and reach other apps." },
  {
    id: "social", label: "Social", accent: "var(--k-template)", blurb: "Post, schedule and read.",
    // Shipped copy, kept verbatim and on its original condition (it showed only while the Social
    // filter was active). It moved from above the wall to under this group's heading — the group
    // it was always about — rather than being dropped in the restructure (§58).
    note: "Connect each platform with its own secure sign-in. Add as many distinct accounts as this workspace is authorized to use. Channels that require pasted credentials are not offered here.",
  },
  { id: "financial", label: "Finance", accent: "var(--k-integration)", blurb: "Invoices, payments and books." },
  { id: "documents", label: "Documents", accent: "var(--k-agent)", blurb: "Send, sign and track." },
  { id: "client-data", label: "Client data", accent: "var(--k-skill)", blurb: "Find and enrich contacts." },
  { id: "developer", label: "Developer", accent: "var(--pg-muted)", blurb: "Wire it up yourself." },
];
/** Providers whose own `filter` value already names their group; the rest map straight across. */
const GROUP_OF: Record<string, GroupId> = {
  automation: "automation", social: "social", financial: "financial",
  documents: "documents", "client-data": "client-data", developer: "developer",
  marketing: "social",
};

/* ── n8n: the one provider with a real connection flow ────────────────────── */

function N8nPanelBody({ a, onDirtyChange, onChanged }: { a: ReturnType<typeof useN8nConnection>; onDirtyChange: (dirty: boolean) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  useEffect(() => { if (a.error) { setEditing(false); setConfirmingDisconnect(false); onDirtyChange(false); } }, [a.error, onDirtyChange]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const commit = useCallback(async (run: () => Promise<boolean>) => {
    const ok = await run();
    if (alive.current && ok) onChanged();
    return alive.current && ok;
  }, [onChanged]);
  const failureCopy = a.failureCode === "authentication_rejected" || a.failureCode === "request_refused"
    ? "The saved n8n connection needs attention. Check the API key or its access in n8n, then reconnect."
    : a.failureCode === "endpoint_not_found" || a.failureCode === "address_rejected"
      ? "The saved n8n connection needs attention. Check the instance address, then reconnect."
      : a.failureCode === "inventory_incomplete" || a.failureCode === "response_invalid"
        ? "The saved n8n connection could not provide a complete workflow list. Its workflow count is unavailable. Check again or reconnect."
        : "The saved n8n connection could not be checked. Its workflow count is unavailable. Check again or reconnect.";
  return <>
    <p className="ig-lede">Let Paige see the n8n workspace and its available workflows.</p>
    {a.loading ? <p className="ig-state" role="status">Checking the API connection…</p> : a.error ? <div className="ig-state" role="alert"><span>{a.writeError ?? "The API connection could not be read. Its status and workflow count are unavailable."}</span><button type="button" className="ig-btn" onClick={() => void a.reload()}>Try again</button></div> : <>
      {!editing && <>
        <dl className="ig-facts">
          <div><dt>API connection</dt><dd>{n8nApiSummary(a, false, false).account}</dd></div>
          <div><dt>Workflow visibility</dt><dd>{!a.configured ? "Not connected" : a.health === "connected" && a.workflowCount !== null ? `${a.workflowCount} ${a.workflowCount === 1 ? "workflow" : "workflows"} available` : "Unavailable until a complete check succeeds"}</dd></div>
          {a.baseUrl && <div><dt>Instance address</dt><dd className="ig-mono">{a.baseUrl}</dd></div>}
          {a.configured && <div><dt>API key</dt><dd>Stored</dd></div>}
          {a.checkedAt && <div><dt>Last check</dt><dd>{safeCheckDate(a.checkedAt)}</dd></div>}
          {a.lastSuccessAt && <div><dt>Last successful check</dt><dd>{safeCheckDate(a.lastSuccessAt)}</dd></div>}
        </dl>
        {a.configured && <p className="ig-note" role="status">{a.health === "connected" ? "The API connection was verified. Workflow visibility does not grant Paige permission to run tools." : a.health === "needs_attention" ? failureCopy : a.health === "checking" ? "Checking this saved connection…" : "The API connection is saved; health has not been verified for this saved configuration."} This does not describe Paige tools access.</p>}
      </>}
      {a.writeError && <div className="ig-error" role="alert"><span>{a.writeError}</span><button type="button" className="ig-btn" disabled={a.saving} onClick={() => void a.reload()}>Refresh status</button></div>}
      {!a.canWrite && <p className="ig-note">Only a workspace admin can change this connection. You can see its state here.</p>}
      {editing && a.canWrite ? <N8nForm a={a} existing={a.configured} onDirtyChange={onDirtyChange} onCommit={commit} onDone={() => { setEditing(false); onDirtyChange(false); }} /> : <div className="ig-actions">
        {a.canWrite && <><button type="button" className="ig-btn" data-primary disabled={a.saving || a.health === "checking"} onClick={() => setEditing(true)}>{!a.configured ? "Connect API" : a.health !== "connected" ? "Reconnect API" : "Edit API connection"}</button>{a.configured && <><button type="button" className="ig-btn" disabled={a.saving} onClick={() => setConfirmingDisconnect(true)}>Disconnect API</button></>}</>}
        <button type="button" className="ig-btn" disabled={a.saving} onClick={() => void (a.canWrite && a.configured && a.health !== "checking" ? commit(a.validate) : a.reload())}>Refresh status</button>
      </div>}
      {confirmingDisconnect && <div className="ig-confirm-close" role="alertdialog" aria-label="Confirm API disconnect"><p>Disconnect the API connection? Paige tools access will stay unchanged.</p><div className="ig-actions"><button type="button" className="ig-btn" data-danger autoFocus disabled={a.saving} onClick={() => { setConfirmingDisconnect(false); void commit(a.disconnect); }}>Confirm disconnect</button><button type="button" className="ig-btn" onClick={() => setConfirmingDisconnect(false)}>Keep connection</button></div></div>}
    </>}
  </>;
}
function suggestedMcpAddress(value: string | null) {
  try { if (!value) return null; const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null; url.pathname = `${url.pathname.replace(/\/$/, "")}/mcp-server/http`; return url.href; } catch { return null; }
}
function safeCheckDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

/* ── What Paige may actually run ───────────────────────────────────────────
   A connection is reachability. This is authority, and it is a separate act on
   purpose: a workspace that connected a provider has not thereby agreed that
   Paige may do everything on it. Nothing is approved until somebody says so
   here, and until then every call is refused. */

function CapabilityApproval({ provider, onChanged }: { provider: "n8n" | "zapier"; onChanged?: () => void }) {
  const { activeTenantId } = useTenantContext();
  const caps = useMcpCapabilities(provider);
  const [chosen, setChosen] = useState<string[] | null>(null);

  // The unsaved draft belongs to the workspace it was made in. Resetting the hook's tool
  // list was not enough: this state lives in the parent, so an admin who ticked boxes for
  // one workspace, switched to another with the drawer open, and loaded ITS tools would
  // find the draft still overriding what the second workspace has actually approved —
  // matching names arriving pre-ticked and approvable on the strength of a decision made
  // somewhere else.
  useEffect(() => { setChosen(null); }, [activeTenantId]);

  // The list on screen is the source of the choice until it is saved; before that,
  // what is ticked is whatever the server said is approved.
  const selection = chosen ?? (caps.tools ?? []).filter((t) => t.approved).map((t) => t.name);
  const dirty = chosen !== null
    && JSON.stringify([...chosen].sort()) !== JSON.stringify((caps.tools ?? []).filter((t) => t.approved).map((t) => t.name).sort());
  useBeforeUnloadGuard(dirty || caps.saving);

  const toggle = (name: string) =>
    setChosen(selection.includes(name) ? selection.filter((n) => n !== name) : [...selection, name]);

  return <div className="ig-caps ig-capability-approval">
    <h4>What Paige may run</h4>

    {caps.tools === null && !caps.loading && <>
      <p className="ig-lede">
        Nothing is approved yet, so Paige will not run anything here. Load the list to choose what she may do.
      </p>
      <div className="ig-actions">
        <button type="button" className="ig-btn" onClick={() => void caps.discover()}>
          <RefreshCw aria-hidden size={14} />See what is available
        </button>
      </div>
    </>}

    {caps.loading && <p className="ig-state" role="status"><RefreshCw className="ig-spin" aria-hidden />Asking the provider…</p>}

    {caps.error && <p className="ig-error" role="alert"><TriangleAlert aria-hidden size={14} />{caps.error}</p>}

    {caps.tools !== null && caps.tools.length === 0 && !caps.loading &&
      <p className="ig-note">The provider offers nothing this workspace can run.</p>}

    {caps.tools !== null && caps.tools.length > 0 && <>
      <ul className="ig-caplist">
        {caps.tools.map((tool) => {
          const on = selection.includes(tool.name);
          return <li key={tool.name}>
            <button type="button" aria-pressed={on} onClick={() => toggle(tool.name)} disabled={caps.saving}>
              <span className="ig-cap-name">{tool.name}</span>
              {/* The provider wrote this. It is shown to a person deciding, and never
                  travels on the path that reaches a model, where provider prose is an
                  instruction surface rather than a description. */}
              {tool.description && <span className="ig-cap-desc">{tool.description}</span>}
              {provider === "zapier" && <span className="ig-cap-meta">App: {tool.connectedApp || "Not reported by Zapier"} · Action: {tool.actionType || "Not reported"} · Authority: Ask first</span>}
              {provider === "zapier" && <span className="ig-cap-meta">Effects: {tool.effects.length ? tool.effects.join(", ") : "read/create/update/send/delete not reported — treat as a write"}</span>}
            </button>
          </li>;
        })}
      </ul>
      <p className="ig-note">
        Approving records the exact shape of each action as it is today. If the provider changes one,
        Paige stops running it until you approve it again.
      </p>
      <div className="ig-actions">
        <button type="button" className="ig-btn" data-primary disabled={!dirty || caps.saving}
          onClick={() => void caps.approve(selection).then((ok) => { if (ok) { setChosen(null); onChanged?.(); } })}>
          {caps.saving ? "Saving…" : `Approve ${selection.length} of ${caps.tools.length}`}
        </button>
        {dirty && <button type="button" className="ig-btn" onClick={() => setChosen(null)} disabled={caps.saving}>Cancel</button>}
      </div>
    </>}
  </div>;
}

function ZapierApiPanel({ api, onChanged }: { api: ReturnType<typeof useZapierApi>; onChanged: () => void }) {
  const[confirming,setConfirming]=useState(false);
  const begin=async()=>{const url=await api.begin();if(url){armOAuthReturn(`${window.location.pathname}${window.location.search}`);window.location.assign(url);}};
  if(api.loading)return <p className="ig-state" role="status">Checking the Zapier API connection…</p>;
  if(api.error)return <div className="ig-state" role="alert"><span>{api.message}</span><button className="ig-btn" onClick={()=>void api.reload()}>Try again</button></div>;
  return <><p className="ig-lede">Connect the workspace’s Zapier account for provider-supported, read-only workflow visibility.</p>
   <dl className="ig-facts"><div><dt>API connection</dt><dd>{zapierApiWords(api.state)}</dd></div><div><dt>Accessible workflows</dt><dd>{api.state==="connected"&&api.accessibleZapCount!==null?api.accessibleZapCount:"Unavailable until a complete check succeeds"}</dd></div><div><dt>Authority</dt><dd>Read workflows and run a safe connection check</dd></div>{api.lastCheckedAt&&<div><dt>Last check</dt><dd>{safeCheckDate(api.lastCheckedAt)}</dd></div>}</dl>
   <p className="ig-note">This connection does not list workflow contents here and cannot edit, activate, deactivate, archive, delete, or run Zaps. PAIGE tools are authorized separately.</p>
   {api.message&&<p className="ig-error" role="alert">{api.message}</p>}
   {!api.canManage?<p className="ig-note">Only the workspace owner can authorize or remove this API connection.</p>:<div className="ig-actions">
    <button type="button" className="ig-btn" data-primary disabled={api.busy||api.state==="capability_unavailable"} onClick={()=>void begin()}><KeyRound aria-hidden size={14}/>{api.state==="capability_unavailable"?"Provider authorization unavailable":api.busy?"Opening Zapier…":api.state==="not_connected"?"Connect API":"Reconnect API"}</button>
    {api.hasPendingAuthorization&&<button type="button" className="ig-btn" disabled={api.busy} onClick={()=>void api.cancel().then(onChanged)}>Cancel authorization</button>}
    {api.hasLocalConnection&&!api.hasPendingAuthorization&&api.state!=="capability_unavailable"&&<button type="button" className="ig-btn" disabled={api.busy} onClick={()=>void api.test().then(onChanged)}><RefreshCw aria-hidden size={14}/>Run safe connection test</button>}
    {api.hasLocalConnection&&(confirming?<span className="ig-confirm"><button type="button" className="ig-btn" data-danger disabled={api.busy} onClick={()=>{setConfirming(false);void api.disconnect().then(onChanged);}}>Disconnect API</button><button type="button" className="ig-btn" onClick={()=>setConfirming(false)}>Keep it</button></span>:<button type="button" className="ig-btn" onClick={()=>setConfirming(true)}>Disconnect API</button>)}
   </div>}</>;
}

/**
 * The SAME rule tenant-mcp-connect applies (index.ts, isZapierMcpAddress), restated here so the
 * button refuses exactly what the server refuses -- and SAYS SO. It previously gated on a raw
 * `startsWith` against the untrimmed field, so an address pasted with any surrounding
 * whitespace, or with the host in capitals, left the button dead with no reason shown and no
 * way for the owner to find out why. A control that refuses in silence is not usable.
 * Returns null when the address is acceptable, otherwise the reason to show the owner.
 * solo-zapier-release-contract.test.ts pins this against the edge function's predicate.
 */
export function zapierMcpAddressProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let u: URL;
  try { u = new URL(value); } catch { return "That is not a complete web address. Paste the whole address, starting with https://"; }
  if (u.protocol !== "https:") return "The address must start with https://";
  if (u.hostname.toLowerCase() !== "mcp.zapier.com") return "This is the Zapier connection, so the address must be on mcp.zapier.com";
  if (u.username || u.password) return "Remove the sign-in details from the address";
  // A fragment is never sent to a server, so it means the address came out of a browser
  // bar. A query string is fine and Zapier's own copy-to-clipboard address carries one.
  if (u.hash) return "Remove everything from the # onward";
  if (!u.pathname.startsWith("/api/v1/") && !u.pathname.startsWith("/api/mcp/")) {
    return "That is a Zapier address, but not an MCP server one. Open your server's Connect tab at mcp.zapier.com and copy the address it shows there.";
  }
  return null;
}

function ZapierMcpPanel({ m, onChanged }: { m: ReturnType<typeof useMcpConnection>; onChanged: () => void }) {
 const{activeTenantId}=useTenantContext();const[serverUrl,setServerUrl]=useState("");const[starting,setStarting]=useState(false);const[message,setMessage]=useState<string|null>(null);const[confirming,setConfirming]=useState(false);const[editing,setEditing]=useState(false);useBeforeUnloadGuard(serverUrl.trim().length > 0 || starting || m.saving);
 const begin=async()=>{setStarting(true);setMessage(null);const{data,error}=await supabase.functions.invoke("tenant-mcp-connect",{body:{provider:"zapier",action:"oauth_begin",server_url:serverUrl.trim(),expected_tenant_id:activeTenantId}});const url=data?.authorize_url;setServerUrl("");if(error||typeof url!=="string"){setStarting(false);setMessage("Zapier did not offer a compatible authorization flow for that MCP server. Confirm the server address and try again.");return;}armOAuthReturn(`${window.location.pathname}${window.location.search}`);window.location.assign(url);};
 if(m.loading)return <p className="ig-state" role="status">Checking PAIGE tools access…</p>;
 if(m.error)return <div className="ig-state" role="alert"><span>The PAIGE tools connection could not be read, so no state is being claimed.</span><button className="ig-btn" onClick={()=>void m.reload()}>Try again</button></div>;
 const oauth=m.authKind==="oauth";const addressProblem=zapierMcpAddressProblem(serverUrl);
 return <><p className="ig-lede">Connect PAIGE to the narrow Zapier MCP server and app actions you approve.</p><dl className="ig-facts"><div><dt>PAIGE tools (MCP)</dt><dd>{zapierMcpSummary(m).account}</dd></div><div><dt>Authorization</dt><dd>{oauth?"Granted through Zapier OAuth":m.configured?"Legacy connection — reconnect with OAuth":"Not authorized"}</dd></div><div><dt>Approved tools</dt><dd>{m.approvedToolCount??"Unavailable"}</dd></div><div><dt>Last health check</dt><dd>{m.lastProbedAt?safeCheckDate(m.lastProbedAt):"No successful check yet"}</dd></div></dl>
  <p className="ig-note">Create a Zapier MCP server, add only the app actions this workspace needs, then paste its HTTPS server address to begin Zapier’s authorization. The address is cleared immediately and credentials are never shown.</p>
  {m.canWrite&&(!m.configured||editing)&&<form className="ig-form" onSubmit={e=>{e.preventDefault();void begin();}}><label className="ig-field"><span>Zapier MCP server address</span><input type="url" required autoComplete="off" spellCheck={false} placeholder="https://mcp.zapier.com/api/v1/connect" value={serverUrl} onChange={e=>setServerUrl(e.target.value)} disabled={starting||m.saving}/><small>{addressProblem??"From the MCP server you created at Zapier. Connecting does not approve every action."}</small></label><div className="ig-actions"><button type="submit" className="ig-btn" data-primary disabled={starting||m.saving||!serverUrl.trim()||addressProblem!==null}>{starting?"Opening Zapier…":oauth?"Reconnect to Zapier MCP":"Connect to Zapier MCP"}</button>{m.configured&&<button type="button" className="ig-btn" onClick={()=>{setServerUrl("");setEditing(false);}}>Cancel</button>}</div></form>}
  {oauth&&m.status==="connected"&&m.canWrite&&<CapabilityApproval provider="zapier" onChanged={onChanged}/>}
  {(message||m.writeError)&&<p className="ig-error" role="alert">{message??m.writeError}</p>}
  {!m.canWrite?<p className="ig-note">Only a workspace admin can change PAIGE tools access.</p>:m.configured&&<div className="ig-actions"><button type="button" className="ig-btn" data-primary disabled={m.saving||starting} onClick={()=>setEditing(true)}>Reconnect authorization</button><button type="button" className="ig-btn" disabled={m.saving} onClick={()=>void m.verify().then(onChanged)}>Check it again</button>{confirming?<span className="ig-confirm"><button type="button" className="ig-btn" data-danger disabled={m.saving} onClick={()=>{setConfirming(false);void m.disconnect().then(onChanged);}}>Disconnect</button><button type="button" className="ig-btn" onClick={()=>setConfirming(false)}>Keep it</button></span>:<button type="button" className="ig-btn" onClick={()=>setConfirming(true)}><Link2Off aria-hidden size={14}/>Disconnect</button>}</div>}
 </>;
}

// `epoch` advances on every mutation in this drawer. Without it the effect depended only on
// activeTenantId, so a test, disconnect, verify or approval change wrote a new Rail row and
// this list kept showing the history from before the action until the drawer was reopened.
function ZapierRecentActivity({epoch}:{epoch:number}){const{activeTenantId}=useTenantContext();const[rows,setRows]=useState<Array<{id:string;title:string;summary:string;occurred_at:string}>|null>(null);const[failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;setRows(null);setFailed(false);if(!activeTenantId)return()=>{live=false;};void (async()=>{
  // Generated types follow production migrations and do not include this additive RPC yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const{data,error}=await (supabase as any).rpc("get_zapier_rail_activity",{p_limit:5});if(!live)return;if(error||!Array.isArray(data)){setFailed(true);return;}setRows(data.map((r:Record<string,unknown>)=>({id:String(r.id),title:String(r.title??"Zapier activity"),summary:String(r.summary??""),occurred_at:String(r.occurred_at??"")})));})();return()=>{live=false;};},[activeTenantId,epoch]);
 return <div className="ig-caps"><h4>Recent safe activity</h4>{rows===null&&!failed?<p className="ig-state" role="status">Loading recent Zapier activity…</p>:failed?<p className="ig-note">Recent activity is unavailable. Connection states above are unchanged.</p>:rows.length===0?<p className="ig-note">No Zapier activity has been recorded for this workspace.</p>:<ul className="ig-activity-list">{rows.map(r=><li key={r.id}><strong>{r.title}</strong><span>{r.summary}</span><time>{r.occurred_at?safeCheckDate(r.occurred_at):"Time unavailable"}</time></li>)}</ul>}</div>;
}
/**
 * The ONE derivation of "is PAIGE connected to Zapier", read by both the card tile and the
 * drawer's own fact row. They must not each answer it: production carries a row with
 * status='connected' and no credential at all, and the drawer used to render the stored
 * status directly — so the card said "Not connected" and the drawer said "Connected" about
 * the same row, on the same screen. `configured` is the server's "we hold a credential",
 * and a connection we cannot authenticate is not connected whatever the status column says.
 */
function zapierMcpSummary(value: ReturnType<typeof useMcpConnection>) {
 if(value.loading)return{account:"Checking…",tone:"neutral"};
 if(value.error)return{account:"Status unavailable",tone:"neutral"};
 if(!value.configured)return{account:"Not connected",tone:"neutral"};
 if(value.status==="connected"&&value.authKind==="oauth")return{account:"Connected",tone:"ok"};
 if(value.authKind!=="oauth")return{account:"Needs attention",tone:"warn"};
 return{account:mcpStateWords(value.status),tone:"warn"};
}

function ZapierDrawer({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
 // Every mutation in this drawer writes a Rail row. `changed` advances the activity epoch as
 // well as telling the parent to re-read connection status, so the list below reflects the
 // action the owner just took rather than the state before it.
 const[activityEpoch,setActivityEpoch]=useState(0);
 const api=useZapierApi();const m=useMcpConnection("zapier");const[tab,setTab]=useState<"api"|"mcp">("api");
 // A mutation here moves three things that are read independently: the outer catalogue (via
 // the parent), the Rail list below, and this drawer's OWN connection row -- which is where
 // the approved-tool count is read from. Refreshing only the first two left that count showing
 // its pre-save value until the drawer was reopened. `reload` re-reads the row; it does not
 // re-probe the provider, so this costs no outbound request.
 const mReload=m.reload;
 const changed=useCallback(()=>{setActivityEpoch(n=>n+1);void mReload();onChanged();},[mReload,onChanged]);const panel=useRef<HTMLElement>(null);const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const opener=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(opener&&document.contains(opener))opener.focus();};},[]);
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{const root=panel.current;if(!root)return;if(event.key==="Escape"){event.preventDefault();onClose();return;}if(event.key!=="Tab")return;const items=Array.from(root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')).filter(item=>!item.hasAttribute("disabled")&&item.tabIndex!==-1&&item.offsetParent!==null);if(!items.length)return;if(!root.contains(document.activeElement)){event.preventDefault();items[0].focus();}else if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items[items.length-1].focus();}else if(!event.shiftKey&&document.activeElement===items[items.length-1]){event.preventDefault();items[0].focus();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[onClose]);
 const choose=(next:"api"|"mcp")=>{setTab(next);panel.current?.querySelector<HTMLButtonElement>(`#ig-zapier-tab-${next}`)?.focus();};
 const tabKeys=(event:React.KeyboardEvent)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();choose(event.key==="Home"?"api":event.key==="End"?"mcp":tab==="api"?"mcp":"api");};
 const apiSummary=api.loading?{account:"Checking…",tone:"neutral"}:api.error?{account:"Status unavailable",tone:"neutral"}:{account:zapierApiWords(api.state),tone:api.state==="connected"?"ok":api.state==="not_connected"?"neutral":"warn"};
 return <div className="ig-layer" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><aside className="ig-panel ig-n8n-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="ig-panel-title">
  <header><span className="ss-provider-mark" data-provider-mark="mcp" aria-hidden>zap</span><div><h2 id="ig-panel-title">Zapier</h2><span>API visibility and Paige tools</span></div><button ref={close} className="ig-close" type="button" aria-label="Close Zapier" onClick={onClose}><X aria-hidden size={16}/></button></header>
  <div className="ig-n8n-overview"><div className="ig-n8n-summary" aria-label="Independent Zapier connection states"><div><span>API connection</span><N8nStateLabel value={apiSummary}/></div><div><span>Paige tools (MCP)</span><N8nStateLabel value={zapierMcpSummary(m)}/></div></div>
   <div className="ss-segment ig-n8n-tabs" role="tablist" aria-label="Zapier connections" onKeyDown={tabKeys}>{(["api","mcp"] as const).map(value=><button key={value} type="button" id={`ig-zapier-tab-${value}`} role="tab" aria-selected={tab===value} aria-controls={`ig-zapier-panel-${value}`} tabIndex={tab===value?0:-1} onClick={()=>choose(value)}>{value==="api"?"API connection":"Paige tools (MCP)"}</button>)}</div>
  </div>
  <div className="ig-panel-body">{tab==="api"?<section id="ig-zapier-panel-api" role="tabpanel" aria-labelledby="ig-zapier-tab-api"><ZapierApiPanel api={api} onChanged={changed}/></section>:<section id="ig-zapier-panel-mcp" role="tabpanel" aria-labelledby="ig-zapier-tab-mcp"><ZapierMcpPanel m={m} onChanged={changed}/></section>}<ZapierRecentActivity epoch={activityEpoch}/></div>
  <footer><span>API visibility and Paige tools authorization are separate.</span></footer>
 </aside></div>;
}

/* ── n8n's tool bridge: the same provider, a second connection ─────────────
   An n8n workspace can expose an MCP endpoint as well as its REST API, and the
   two are independent: one can work while the other does not. They live in the
   same drawer because they belong to the same provider, and in separate
   sections because connecting one says nothing about the other. */



function n8nApiSummary(value: N8nConnection | null, loading: boolean, error: boolean) {
  if (loading) return { account: "Checking…", tone: "neutral" };
  if (error || !value || typeof value.configured !== "boolean") return { account: "Status unavailable", tone: "neutral" };
  if (value.health === "checking") return { account: "Checking…", tone: "neutral" };
  if (value.health === "connected") return { account: "Connected", tone: "ok" };
  return value.configured ? { account: "Needs attention", tone: "warn" } : { account: "Not connected", tone: "neutral" };
}
function n8nMcpSummary(value: N8nReadiness | null, loading: boolean, error: boolean) {
  if (loading) return { account: "Checking…", tone: "neutral" };
  if (!value || error) return { account: "Status unavailable", tone: "neutral" };
  if (value.attemptState === "consent_in_progress") return { account: "Authorization in progress", tone: "neutral" };
  if (["connected_no_approved_tools", "connected_approved_tools", "connected"].includes(value.mcp.state)) return { account: "Connected", tone: "ok" };
  if (["mcp_not_configured", "not_configured", "not_connected"].includes(value.mcp.state)) return { account: "Not connected", tone: "neutral" };
  return { account: n8nMcpStateWords(value.mcp.state), tone: "warn" };
}
function N8nStateLabel({ value }: { value: { account: string; tone: string } }) {
  return <span className="ig-card-state" data-tone={value.tone}><i aria-hidden />{value.account}</span>;
}
function N8nMcpSection({ oauth, suggestedAddress, onDirtyChange, onChanged }: { suggestedAddress?: string | null; oauth: ReturnType<typeof useN8nOAuth>; onDirtyChange: (dirty: boolean) => void; onChanged: () => void }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [serverUrl, setServerUrl] = useState(oauth.readiness?.mcp.serverUrl ?? suggestedAddress ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const r = oauth.readiness;
  const selection = chosen ?? oauth.workflows?.filter(w => w.approved).map(w => w.id) ?? [];
  useEffect(() => { onDirtyChange((editing || !r?.mcp.authKind) && serverUrl !== (r?.mcp.serverUrl ?? suggestedAddress ?? "") || chosen !== null); }, [serverUrl, chosen, editing, r?.mcp.authKind, r?.mcp.serverUrl, suggestedAddress, onDirtyChange]);
  const commit = async (action: () => Promise<boolean>) => { const ok = await action(); if (ok && mounted.current) { setChosen(null); onChanged(); } };
  if (oauth.loading) return <p className="ig-state" role="status">Checking the n8n MCP connection…</p>;
  if (!r) return <div className="ig-state" role="alert"><span>The n8n MCP connection could not be read, so nothing is being claimed either way.</span><button className="ig-btn" onClick={() => void oauth.reload()}>Try again</button></div>;
  const connected = ["connected_no_approved_tools", "connected_approved_tools"].includes(r.mcp.state);
  const inProgress = r.attemptState === "consent_in_progress";
  return <>
    <p className="ig-lede">Let Paige use the n8n tools and workflows you explicitly authorize.</p>
    <dl className="ig-facts">
      <div><dt>State</dt><dd>{n8nMcpStateWords(r.mcp.state)}</dd></div>
      <div><dt>Saved MCP configuration</dt><dd>{r.mcp.authKind === "oauth" ? "OAuth" : r.mcp.authKind === "bearer" || r.mcp.authKind === "header" ? "Legacy static credential (not OAuth)" : "No authorization saved"}</dd></div>
      <div><dt>Approved workflows</dt><dd>{r.mcp.approvedWorkflowCount ?? "Unavailable"}</dd></div>
      <div><dt>Approved tools</dt><dd>{r.mcp.approvedToolCount ?? "Unavailable"}</dd></div>
      <div><dt>Last successful check</dt><dd>{r.mcp.lastSuccessAt ? new Date(r.mcp.lastSuccessAt).toLocaleString() : "No successful check yet"}</dd></div>
    </dl>
    {r.attemptState && r.attemptState !== "success" && <p className="ig-note" role="status">Latest OAuth attempt: {n8nMcpStateWords(r.attemptState)}</p>}
    <p className="ig-lede">Authorize controlled MCP access through n8n. The optional API connection is separate. Keep n8n auto-expose off and enable only workflows you deliberately approve.</p>
    <p className="ig-note">OAuth authorizes a read/write connection. Connecting does not automatically approve workflow changes or execution. Changes require separate approval through Paige’s governed action flow; this screen verifies read access only.</p>
    {oauth.busy && <p className="ig-state" role="status">Checking Paige tools access…</p>}
    {oauth.error && <p className="ig-error" role="alert">{oauth.error}</p>}
    <button type="button" className="ig-btn" disabled={oauth.busy} onClick={() => void oauth.reload()}>Refresh status</button>
    {!r.canManage ? <p className="ig-note">Only the workspace owner can authorize or change MCP access. You can see its state here.</p> : <>
      {!inProgress && (!r.mcp.authKind || editing) && <form className="ig-form" onSubmit={async event => {
        event.preventDefault(); if (oauth.busy) return;
        const launch = await oauth.begin(serverUrl);
        if (launch && mounted.current) {
          setServerUrl(""); onDirtyChange(false);
          // Fresh authenticated begin response only. Proof never enters a URL or storage.
          const form = document.createElement("form");
          form.method = "POST"; form.action = launch.launchUrl; form.hidden = true;
          for (const [name, value] of [["launch_ticket", launch.launchTicket], ["launch_proof", launch.launchProof]]) {
            const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
          }
          document.body.appendChild(form);
          try { form.submit(); } finally { form.remove(); }
        }
      }}>
        <label className="ig-field"><span>Instance-level MCP address</span><input type="url" required autoComplete="off" spellCheck={false} placeholder="https://your-instance.app.n8n.cloud/mcp-server/http" value={serverUrl} onChange={event => setServerUrl(event.target.value)} disabled={oauth.busy} /><small>Confirm the HTTPS address from n8n Settings → Instance-level MCP. A suggested address does not grant access.</small></label>
        {r.mcp.authKind && <p className="ig-note">Your saved connection stays in place until OAuth completes successfully. Completing OAuth replaces MCP authorization only.</p>}
        <div className="ig-actions"><button className="ig-btn" data-primary disabled={oauth.busy || !/^https:\/\//i.test(serverUrl.trim())}>{oauth.busy ? "Starting authorization…" : "Connect n8n with OAuth"}</button><button type="button" className="ig-btn" disabled={oauth.busy} onClick={() => { setEditing(false); setServerUrl(""); onDirtyChange(false); }}>Cancel</button></div>
      </form>}
      <div className="ig-actions">
        {!inProgress && r.mcp.authKind && !editing && <button type="button" className="ig-btn" data-primary disabled={oauth.busy} onClick={() => { setServerUrl(r.mcp.serverUrl ?? suggestedAddress ?? ""); setEditing(true); }}>Reconnect authorization</button>}
        {inProgress && <button className="ig-btn" disabled={oauth.busy} onClick={() => void commit(oauth.cancel)}>Cancel authorization</button>}
        {r.mcp.authKind === "oauth" && <button className="ig-btn" disabled={oauth.busy} onClick={() => void commit(oauth.verify)}>Check it again</button>}
        {r.mcp.authKind === "oauth" && (confirmingDisconnect ? <span className="ig-confirm"><button className="ig-btn" data-danger disabled={oauth.busy} onClick={() => { setConfirmingDisconnect(false); void commit(oauth.disconnect); }}>Disconnect OAuth</button><button className="ig-btn" onClick={() => setConfirmingDisconnect(false)}>Keep it</button></span> : <button className="ig-btn" disabled={oauth.busy} onClick={() => setConfirmingDisconnect(true)}>Disconnect</button>)}
      </div>
      {connected && r.mcp.authKind === "oauth" && <div className="ig-caps"><h4>Approved read/preview workflows</h4>
        <p className="ig-note">Saving replaces the current read/preview selection with the workflows selected here. If the discovered inventory changes, review and approve the selection again before read access can continue.</p>
        <button className="ig-btn" disabled={oauth.busy} onClick={() => { setChosen(null); void oauth.discover(); }}>Manage access</button>
        {oauth.inventory && !oauth.inventory.complete && <p className="ig-note" role="status">Partial workflow list: {oauth.workflows?.length ?? 0} shown{oauth.inventory.totalCount !== null ? ` of ${oauth.inventory.totalCount} reported by n8n` : ""}. This bounded list does not prove that other workflows are unavailable. Only workflows shown here can be selected.</p>}
        {oauth.workflows?.length === 0 && oauth.inventory?.complete && <p className="ig-note">No eligible workflows are available. Enable only deliberately approved workflows in n8n, with auto-expose off, then check again.</p>}
        {!!oauth.workflows?.length && <><ul className="ig-caplist">{oauth.workflows.map(workflow => <li key={workflow.id}><button type="button" aria-pressed={selection.includes(workflow.id)} disabled={oauth.busy} onClick={() => setChosen(selection.includes(workflow.id) ? selection.filter(id => id !== workflow.id) : [...selection, workflow.id])}><span className="ig-cap-name">{workflow.name}</span></button>{workflow.approved && <button className="ig-btn" type="button" disabled={oauth.busy} onClick={() => void oauth.preview(workflow.id)}>Check approved read access</button>}</li>)}</ul><button className="ig-btn" disabled={chosen === null || oauth.busy} onClick={() => void commit(() => oauth.approve(selection))}>Approve {selection.length} for read/preview only</button></>}
      </div>}
      {oauth.previewName && <p className="ig-note" role="status">Read access verified for {oauth.previewName}. No workflow was executed.</p>}
    </>}
  </>;
}


/**
 * A saved connection and a proven one are different states and are never shown as the
 * same word. `pending_verification` means it was stored but the check has not finished;
 * `error` means the check ran and failed. Rendering either as "Connected" would be the
 * exact false green this whole path exists to prevent.
 */
function mcpStateWords(status: string | null): string {
  if (status === "connected") return "Connected";
  if (status === "error") return "Saved, not working";
  if (status === "pending_verification") return "Saved, not checked yet";
  return "Set up";
}

/**
 * The credential lives only here, only while it is being typed, and is cleared on every
 * submit — success or failure alike. It is never lifted into the hook, never stored,
 * never logged, and never echoed into an error message.
 */
/**
 * The key lives only here, only while it is being typed, and is cleared on
 * every submit — success or failure alike. It is never lifted into the hook,
 * never written to storage, never logged, and never echoed back into an error
 * message. On a failed save the field is empty on purpose: re-entering it is a
 * smaller cost than holding a secret in memory for a retry that may not come.
 */
function N8nForm({
  a, existing, onDone, onDirtyChange, onCommit,
}: {
  a: ReturnType<typeof useN8nConnection>;
  existing: boolean;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCommit: (run: () => Promise<boolean>) => Promise<boolean>;
}) {
  const [baseUrl, setBaseUrl] = useState(a.baseUrl ?? "");
  const [label, setLabel] = useState(a.label ?? "");
  const [apiKey, setApiKey] = useState("");

  // The seam coalesces an empty `_label` to the stored one, so a name that
  // already exists cannot be removed here. Rather than accept the edit and
  // silently restore the old name on reload, an emptied name is not treated as
  // a change at all, and the field says so.
  const nameLocked = Boolean(a.label) && label.trim() === "";
  const dirty = apiKey.length > 0 || baseUrl !== (a.baseUrl ?? "") || (!nameLocked && label !== (a.label ?? ""));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const valid = baseUrl.trim().length > 0 && apiKey.length > 0;

  return <form
    className="ig-form"
    onSubmit={async (event) => {
      event.preventDefault();
      if (!valid || a.saving) return;
      const submitted = apiKey;
      setApiKey("");
      const ok = await onCommit(() => a.connect({ baseUrl, apiKey: submitted, label }));
      if (ok) onDone();
    }}
  >
    <label className="ig-field">
      <span>Instance address</span>
      <input
        autoFocus type="url" inputMode="url" autoComplete="off" spellCheck={false}
        placeholder="https://your-instance.app.n8n.cloud"
        value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={a.saving}
      />
      <small>Has to start with https://</small>
    </label>
    <label className="ig-field">
      <span>API key</span>
      <input
        type="password" autoComplete="off" spellCheck={false}
        placeholder={existing ? "Enter the key again to reconnect" : "Paste your n8n API key"}
        value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={a.saving}
      />
      <small>{existing ? "The stored key is never shown, so a change needs it again." : "Stored encrypted. It is never displayed after this."}</small>
    </label>
    <label className="ig-field">
      <span>Name <em>optional</em></span>
      <input
        type="text" autoComplete="off" placeholder="What you call this instance"
        value={label} onChange={(event) => setLabel(event.target.value)} disabled={a.saving}
      />
      {nameLocked && <small>A name can be changed here but not removed, so this keeps “{a.label}”.</small>}
    </label>
    <p className="ig-note">Saving also checks the API key and workflow visibility. It does not enable Paige tools.</p>
    {a.saving && <p className="ig-state" role="status">Saving and checking this connection…</p>}
    <div className="ig-actions">
      <button type="submit" className="ig-btn" data-primary disabled={!valid || a.saving}>
        {a.saving ? "Saving and checking…" : "Save and check connection"}
      </button>
      <button type="button" className="ig-btn" onClick={onDone} disabled={a.saving}>Cancel</button>
    </div>
  </form>;
}

/* ── The contextual panel ─────────────────────────────────────────────────── */

type N8nTab = "api" | "mcp";
function N8nDrawer({ a, m, initialMcp, onClose, onChanged }: { initialMcp?: boolean; a: ReturnType<typeof useN8nConnection>; m: ReturnType<typeof useN8nOAuth>; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<N8nTab>(initialMcp ? "mcp" : "api");
  const [dirty, setDirty] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<"close" | N8nTab | null>(null);
  const [formEpoch, setFormEpoch] = useState(0);
  useBeforeUnloadGuard(dirty || a.saving || m.busy);
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const discard = useRef<HTMLButtonElement>(null);
  const requestLeave = useCallback((target: "close" | N8nTab) => {
    if (target === tab) return;
    if (a.saving || m.busy) { if (target === "close") setSavingClose(true); return; }
    if (dirty) { setDiscardTarget(target); return; }
    if (target === "close") onClose(); else setTab(target);
  }, [a.saving, m.busy, dirty, onClose, tab]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  useEffect(() => { if (discardTarget) discard.current?.focus(); }, [discardTarget]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = panel.current;
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const confirmation = root.querySelector('[role="alertdialog"]');
        if (confirmation) { const buttons = confirmation.querySelectorAll<HTMLButtonElement>("button"); buttons[buttons.length - 1]?.click(); }
        else requestLeave("close");
        return;
      }
      if (event.key !== "Tab") return;
      const focusRoot = root.querySelector<HTMLElement>('[role="alertdialog"]') ?? root;
      const items = Array.from(focusRoot.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')).filter(item => !item.hasAttribute("disabled") && item.tabIndex !== -1 && item.offsetParent !== null);
      if (!items.length) return;
      if (!focusRoot.contains(document.activeElement)) { event.preventDefault(); items[0].focus(); }
      else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestLeave]);
  const tabKeys = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "api" : event.key === "End" ? "mcp" : tab === "api" ? "mcp" : "api";
    requestLeave(next);
    if (!dirty) panel.current?.querySelector<HTMLButtonElement>(`#ig-n8n-tab-${next}`)?.focus();
  };
  return <div className="ig-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) requestLeave("close"); }}>
    <aside className="ig-panel ig-n8n-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="ig-panel-title">
      <header><span className="ss-provider-mark" data-provider-mark="n8n" aria-hidden>n8n</span><div><h2 id="ig-panel-title">n8n</h2><span>API visibility and Paige tools</span></div><button ref={close} className="ig-close" type="button" aria-label="Close n8n" onClick={() => requestLeave("close")}><X aria-hidden size={16} /></button></header>
      <div className="ig-n8n-overview"><div className="ig-n8n-summary" aria-label="Independent n8n connection states"><div><span>API connection</span><N8nStateLabel value={n8nApiSummary(a, a.loading, a.error)} /></div><div><span>Paige tools (MCP)</span><N8nStateLabel value={n8nMcpSummary(m.readiness, m.loading, !!m.error)} /></div></div>
        <div className="ss-segment ig-n8n-tabs" role="tablist" aria-label="n8n connections" onKeyDown={tabKeys}>{(["api", "mcp"] as const).map(value => <button key={value} type="button" id={`ig-n8n-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`ig-n8n-panel-${value}`} tabIndex={tab === value ? 0 : -1} disabled={a.saving || m.busy} onClick={() => requestLeave(value)}>{value === "api" ? "API connection" : "Paige tools (MCP)"}</button>)}</div>
      </div>
      <div className="ig-panel-body">
        {savingClose && <div className="ig-confirm-close" role="alertdialog" aria-label="Saving is in progress"><p>Saving is still in progress. Closing will not cancel it.</p><div className="ig-actions"><button type="button" autoFocus className="ig-btn" onClick={onClose}>Close while saving</button><button type="button" className="ig-btn" onClick={() => setSavingClose(false)}>Keep open</button></div></div>}
        {discardTarget && <div className="ig-confirm-close" role="alertdialog" aria-label="Discard unsaved connection details"><p>You have unsaved {tab === "api" ? "API" : "MCP"} details. Discard them {discardTarget === "close" ? "and close" : "and change tabs"}?</p><div className="ig-actions"><button ref={discard} type="button" className="ig-btn" data-danger onClick={() => { const next = discardTarget; setDirty(false); setDiscardTarget(null); setFormEpoch(value => value + 1); if (next === "close") onClose(); else { setTab(next); panel.current?.querySelector<HTMLButtonElement>(`#ig-n8n-tab-${next}`)?.focus(); } }}>Discard changes</button><button type="button" className="ig-btn" onClick={() => { setDiscardTarget(null); panel.current?.querySelector<HTMLInputElement>("input")?.focus(); }}>Keep editing</button></div></div>}
        {tab === "api" ? <section id="ig-n8n-panel-api" role="tabpanel" aria-labelledby="ig-n8n-tab-api"><N8nPanelBody key={formEpoch} a={a} onDirtyChange={setDirty} onChanged={onChanged} /></section> : <section id="ig-n8n-panel-mcp" role="tabpanel" aria-labelledby="ig-n8n-tab-mcp"><N8nMcpSection key={formEpoch} oauth={m} suggestedAddress={suggestedMcpAddress(a.baseUrl)} onDirtyChange={setDirty} onChanged={onChanged} /></section>}
      </div>
      <footer><span>API visibility and Paige tools authorization are separate.</span></footer>
    </aside>
  </div>;
}
function ProviderPanel(props: { initialMcp?: boolean; m: ReturnType<typeof useN8nOAuth>; a: ReturnType<typeof useN8nConnection>; row: ProviderRow; onClose: () => void; onChanged: () => void }) {
  return props.row.id === "n8n" ? <N8nDrawer initialMcp={props.initialMcp} m={props.m} a={props.a} onClose={props.onClose} onChanged={props.onChanged} /> : props.row.id === "mcp" ? <ZapierDrawer onClose={props.onClose} onChanged={props.onChanged}/> : <LegacyProviderPanel {...props} />;
}

function LegacyProviderPanel({ row, onClose, onChanged }: { row: ProviderRow; onClose: () => void; onChanged: () => void }) {
  // A drawer can hold more than one connection, so unsaved input is tracked per
  // section. Closing is guarded if EITHER has something unsaved — a single shared
  // flag would let one section clear the other's guard and silently discard input.
  const [apiDirty, setApiDirty] = useState(false);
  const [mcpDirty, setMcpDirty] = useState(false);
  const dirty = apiDirty || mcpDirty;
  useBeforeUnloadGuard(dirty);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const requestClose = useCallback(() => {
    if (dirty) { setConfirmingClose(true); return; }
    onClose();
  }, [dirty, onClose]);

  // Captured on mount and restored on unmount: without it every close path
  // drops focus to the document body and a keyboard user has to walk the page
  // again to get back to where they were.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { requestClose(); return; }
      if (event.key !== "Tab") return;
      // This dialog declares aria-modal, so focus has to stay inside it.
      // Without this, Tab walks out into the page behind while assistive
      // technology has been told that page is inert.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!panel.contains(active)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return <div className="ig-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <aside className="ig-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="ig-panel-title">
      <header>
        <span className="ss-provider-mark" data-provider-mark={row.id} aria-hidden>{providerMark(row.id)}</span>
        <div><h2 id="ig-panel-title">{row.name}</h2><span>{row.kind}</span></div>
        <button ref={closeRef} type="button" className="ig-close" onClick={requestClose} aria-label={`Close ${row.name}`}><X aria-hidden size={16} /></button>
      </header>

      <div className="ig-panel-body">
        {confirmingClose && <div className="ig-confirm-close" role="alertdialog" aria-label="Discard changes">
          <p>You have unsaved details here. Close anyway?</p>
          <div className="ig-actions">
            <button type="button" className="ig-btn" data-danger onClick={onClose}>Discard them</button>
            <button type="button" className="ig-btn" onClick={() => setConfirmingClose(false)}>Keep editing</button>
          </div>
        </div>}

        <><p className="ig-lede">{row.note}</p>
              <p className="ig-note">Setting this up is not offered here yet, rather than offered and quietly not working.</p></>
      </div>

      <footer><span>No credentials or provider payloads are shown here.</span></footer>
    </aside>
  </div>;
}

/* ── Routing (owned locally; the shared hook reads two levels) ─────────────── */

type IntegrationsLeaf = "catalogue" | "automations";

function useIntegrationsLeaf(): [IntegrationsLeaf, (next: IntegrationsLeaf) => void] {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const match = pathname.match(/^(\/solo\/[^/]+\/settings\/integrations)(?:\/([^/]+))?/);
  const leaf: IntegrationsLeaf = match?.[2] === "automations" ? "automations" : "catalogue";
  // Built from the canonical prefix, never by stripping a known trailing leaf.
  // On an unknown leaf (`…/integrations/something-retired`) the latter left the
  // retired segment in place, so the Automations tab navigated to
  // `…/something-retired/automations` — still read as the catalogue, leaving the
  // tab unreachable rather than merely falling back.
  const base = match?.[1] ?? pathname;
  const setLeaf = useCallback((next: IntegrationsLeaf) => {
    navigate(next === "catalogue" ? `${base}${search}` : `${base}/automations${search}`);
  }, [base, navigate, search]);
  return [leaf, setLeaf];
}

export function SoloIntegrationsView() {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const scopeKey = `${activeUserId ?? ""}:${activeTenantId ?? ""}`;
  const [leaf, setLeaf] = useIntegrationsLeaf();
  const status = useIntegrationStatus();
  const api = useN8nConnection();
  const oauth = useN8nOAuth();
  const social = useSocialConnections();
  const stripe = useStripeMerchant();
  /** One instance, read twice: the Automation group renders these tiles and the filter bar counts
   *  them. A chip that promises a number the wall below it does not show is a lie (§13). */
  const gw = useMcpGateway();
  const [category, setCategory] = useState<CatalogueCategory>("all");
  const [open, setOpen] = useState<{ row: ProviderRow; scope: string; initialMcp?: boolean } | null>(null);
  const [socialOpen, setSocialOpen] = useState<{ platform: SocialPlatformDefinition; scope: string } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [mcpReturn, setMcpReturn] = useState<{ connectionId: string; result: "connected" | "cancelled" | "error"; scope: string } | null>(null);
  const clearMcpReturn = useCallback(() => setMcpReturn(null), []);
  useEffect(() => { setMcpReturn(null); }, [scopeKey, tenantLoading]);
  useEffect(() => {
    if (tenantLoading || !activeTenantId) return;
    const params = new URLSearchParams(location.search);
    if (!params.has("mcp")) return;
    const result = params.get("mcp");
    const connectionId = params.get("connection");
    // Remove the one-shot navigation hints; never render raw callback detail or provider text.
    for (const key of ["mcp", "mcp_detail", "connection"]) params.delete(key);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    if ((result === "connected" || result === "cancelled" || result === "error") &&
        connectionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) {
      setCategory("all");
      setMcpReturn({ connectionId: connectionId.toLowerCase(), result, scope: scopeKey });
    }
  }, [location.pathname, location.search, navigate, activeTenantId, tenantLoading, scopeKey]);
  useEffect(() => { setOpen(null); setSocialOpen(null); }, [scopeKey, tenantLoading]);
  useEffect(() => {
    if (tenantLoading || !activeTenantId) return;
    const params = new URLSearchParams(location.search);
    if (!params.has("stripe_setup")) return;
    params.delete("stripe_setup");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    const row = PROVIDERS.find(candidate => candidate.id === "stripe");
    if (row) setOpen({ row, scope: scopeKey });
    // A return URL only opens the receipt. It never changes readiness or dispatches another attempt.
  }, [location.pathname, location.search, navigate, activeTenantId, tenantLoading, scopeKey]);
  useEffect(() => {
    if (tenantLoading || !activeTenantId) return;
    const params = new URLSearchParams(location.search);
    const result = params.get("n8n_oauth");
    if (!result) return;
    params.delete("n8n_oauth");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    const n8nRow = PROVIDERS.find((row) => row.id === "n8n");
    if (n8nRow && ["success", "cancelled", "refused", "expired", "failed"].includes(result)) setOpen({ row: n8nRow, scope: scopeKey, initialMcp: true });
  }, [location.pathname, location.search, navigate, activeTenantId, tenantLoading, scopeKey]);
  /** A catalogue tile whose connect flow already ships on this surface opens THAT flow.
   *  n8n and Zapier open their live provider drawers; Social has one drawer per platform,
   *  so it reveals the shipped platform tiles instead of guessing which one was meant. */
  const openLegacy = useCallback((which: GatewayLegacyTarget) => {
    if (which === "social") { setCategory("social"); return; }
    const row = PROVIDERS.find((candidate) => candidate.id === (which === "zapier" ? "mcp" : "n8n"));
    if (row) setOpen({ row, scope: scopeKey });
  }, [scopeKey]);
  /**
   * One flat list of everything this surface can show, each entry carrying its own group. Social
   * platforms and provider rows are merged here rather than rendered as two separate walls: a
   * person looking for Instagram does not care which table it came from.
   */
  type Tile =
    | { kind: "social"; group: GroupId; id: string; name: string; platform: SocialPlatformDefinition }
    | { kind: "provider"; group: GroupId; id: string; name: string; row: ProviderRow };
  const tiles: Tile[] = [
    ...SOCIAL_PLATFORMS.map((platform): Tile => ({
      kind: "social", group: "social", id: `social-${platform.key}`, name: platform.name, platform,
    })),
    ...PROVIDERS.map((row): Tile => ({
      kind: "provider", group: GROUP_OF[row.filter] ?? "developer", id: row.id, name: row.name, row,
    })),
  ];
  /** Automation is rendered by IntegrationsGatewaySection, which owns the MCP tiles that belong
   *  beside these (owner ruling 2026-09-22) — so it is handed over rather than drawn twice. */
  const automation = GROUPS.find(g => g.id === "automation")!;
  /**
   * ONE TOOL, ONE TILE (owner ruling 2026-09-24).
   *
   * These shipped provider tiles and the gateway's connection tiles are built from two unrelated
   * sources that never compared notes, so a tenant who had connected n8n saw n8n twice — once here
   * offering to set it up, once beside it as the connection they already had. With Zapier doing the
   * same, two connections read as six tiles.
   *
   * A covered tile is DROPPED, never disabled or greyed: its drawer is still reachable from the
   * connection that covers it, so nothing here removes a path (§58). The suppression is computed
   * from this tenant's own connections through the gateway's one matcher — never a hardcoded list
   * of vendors to hide, which would be right only for the accounts it was written against.
   *
   * While the list is loading or refused, `gw.tools` is empty and NOTHING is suppressed. That is
   * the safe direction: an unread list must not make a shipped tile vanish.
   */
  const automationTiles = tiles.filter(t =>
    t.group === "automation"
    && !(t.kind === "provider" && connectionForProvider(gw.tools, { providerKey: t.name })),
  );
  /** What the Automation group actually renders: its shipped tiles, every MCP server already
   *  added, and the repeatable add tile — but none of them while the list is unread. */
  const gatewayCount = gw.loading || gw.error ? 0 : gw.tools.length + (gw.canWrite ? 1 : 0);
  const countOf = (id: GroupId) =>
    (id === "automation" ? automationTiles.length + gatewayCount : tiles.filter(t => t.group === id).length);
  const groupsShown = GROUPS
    .filter(g => g.id !== "automation")
    .map(g => ({ ...g, items: tiles.filter(t => t.group === g.id) }))
    .filter(g => g.items.length > 0 && (category === "all" || category === g.id));
  /** The headline count must agree with what is actually on screen: the suppressed duplicates
   *  are gone from the Automation group, so they are gone from the total too. */
  const totalTiles = tiles.filter(t => t.group !== "automation").length + automationTiles.length + gatewayCount;

  const tabs: ReadonlyArray<{ id: IntegrationsLeaf; label: string; Icon: typeof Workflow }> = [
    { id: "catalogue", label: "Integrations", Icon: Plug }, { id: "automations", label: "Automations", Icon: Zap },
  ];

  /** One tile. The logo is the object; the state below it is whatever the backend reported. */
  const renderTile = (t: Tile) => {
    if (t.kind === "social") {
      const platformConnections = social.connections.filter(c => c.requestedPlatform === t.platform.key);
      const connectionIds = new Set(platformConnections.map(c => c.id));
      const platformAccounts = social.accounts.filter(a => a.platform === t.platform.key && connectionIds.has(a.connectionId));
      const state = t.platform.oauthAvailable
        ? socialCardState({ loading: social.loading, statusError: social.statusError, connections: platformConnections, accounts: platformAccounts })
        : { account: "OAuth unavailable", tone: "neutral" as const };
      return (
        <li key={t.id}>
          <button type="button" className="ig-card social-platform-card" data-provider={`social-${t.platform.key}`}
            data-owner="social" onClick={() => setSocialOpen({ platform: t.platform, scope: scopeKey })} aria-haspopup="dialog">
            <IntegrationLogo id={t.platform.key} fallback={t.platform.mark} />
            <span className="ig-card-title"><strong>{t.platform.name}</strong></span>
            <span className="ig-card-foot"><N8nStateLabel value={state} /></span>
          </button>
        </li>
      );
    }
    const row = t.row;
    const live = statusPresentation(row.id === "mcp" ? status.mcp.zapier ?? null : null);
    return (
      <li key={row.id}>
        <button type="button" className="ig-card" data-provider={row.id} data-owner="integrations"
          onClick={() => setOpen({ row, scope: scopeKey })} aria-haspopup="dialog">
          <IntegrationLogo id={row.id} fallback={providerMark(row.id)} />
          <span className="ig-card-title"><strong>{row.name}</strong></span>
          <span className="ig-card-foot">
            {row.id === "n8n" ? <>
              <span className="ig-n8n-tile-state"><span>API connection</span><N8nStateLabel value={n8nApiSummary(api, api.loading, api.error)} /></span>
              <span className="ig-n8n-tile-state"><span>Paige tools (MCP)</span><N8nStateLabel value={n8nMcpSummary(oauth.readiness, oauth.loading, !!oauth.error)} /></span>
            </> : row.id === "mcp" ? <>
              <span className="ig-n8n-tile-state"><span>API connection</span><N8nStateLabel value={status.zapierApiError||!status.zapierApi?{account:"Status unavailable",tone:"neutral"}:{account:zapierApiWords(status.zapierApi.state),tone:status.zapierApi.state==="connected"?"ok":status.zapierApi.state==="not_connected"?"neutral":"warn"}}/></span>
              <span className="ig-n8n-tile-state"><span>Paige tools (MCP)</span><N8nStateLabel value={status.mcpError?{account:"Status unavailable",tone:"neutral"}:live}/></span>
            </> : row.id === "stripe" ? <span className="ig-card-state" data-tone={stripe.state === "ready" ? "ok" : "neutral"}>
              <i aria-hidden />{stripe.loading ? "Checking connection…" : stripe.error ? "Status unavailable" : stripeMerchantWords[stripe.state]}
              {stripe.environment && ` · ${stripe.environment.toUpperCase()}`}
            </span> : <span className="ig-card-state" data-tone="neutral"><i aria-hidden />Not available</span>}
          </span>
        </button>
      </li>
    );
  };

  return <div className="ss-integrations">
    <div className="ss-subtabs" role="tablist" aria-label="Integrations sections">{tabs.map(({ id, label, Icon }) => <button key={id} type="button" role="tab" className="ss-subtab" aria-selected={leaf === id} onClick={() => setLeaf(id)}><Icon aria-hidden size={14} />{label}</button>)}</div>
    {leaf === "automations" ? <SoloAutomationsView /> : <>
      <div className="ig-bar" role="group" aria-label="Filter integrations">
        <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
          <i className="ig-bar-dot" style={{ background: "var(--pg-violet)" }} aria-hidden />All
          <em>{totalTiles}</em>
        </button>
        {GROUPS.map(g => {
          const n = countOf(g.id);
          if (!n) return null;
          return <button key={g.id} type="button" aria-pressed={category === g.id}
            onClick={() => setCategory(g.id)}>
            <i className="ig-bar-dot" style={{ background: g.accent }} aria-hidden />{g.label}<em>{n}</em>
          </button>;
        })}
      </div>
      {status.loading ? <p className="ig-state" role="status"><RefreshCw className="ig-spin" aria-hidden />Resolving this account…</p> : <>
        {status.error && <div className="ig-state" role="alert"><TriangleAlert aria-hidden /><span>Some integration status could not be read. Each connection below reports only its own available state.</span><button type="button" className="ig-btn" onClick={() => void status.retry()}>Try again</button></div>}
        <IntegrationsGatewaySection onOpenLegacy={openLegacy} gw={gw} group={automation}
          oauthReturn={!tenantLoading && mcpReturn?.scope === scopeKey ? mcpReturn : null} onOAuthReturnHandled={clearMcpReturn}
          tiles={automationTiles.map(renderTile)} hidden={category !== "all" && category !== "automation"} />
        {groupsShown.map(g => <section key={g.id} className="ig-group" aria-label={g.label}>
          <div className="ig-group-head">
            <i className="ig-bar-dot" style={{ background: g.accent }} aria-hidden />
            <b>{g.label}</b><em>{g.blurb}</em><i className="ig-group-rule" aria-hidden />
          </div>
          {g.note && category === g.id && <p className="ig-category-note">{g.note}</p>}
          <ul className="ig-grid">{g.items.map(renderTile)}</ul>
        </section>)}
      </>}
    </>}
    {open && !tenantLoading && open.scope === scopeKey && (open.row.id === "stripe"
      ? <StripeMerchantDrawer key={`${scopeKey}:stripe`} merchant={stripe} onClose={() => setOpen(null)} />
      : <ProviderPanel initialMcp={open.initialMcp} m={oauth} a={api} key={`${scopeKey}:${open.row.id}`} row={open.row} onClose={() => setOpen(null)} onChanged={status.retry} />)}
    {socialOpen && !tenantLoading && socialOpen.scope === scopeKey && <SocialDrawer social={social} platform={socialOpen.platform} key={`${scopeKey}:social:${socialOpen.platform.key}`} onClose={() => setSocialOpen(null)} />}
  </div>;
}

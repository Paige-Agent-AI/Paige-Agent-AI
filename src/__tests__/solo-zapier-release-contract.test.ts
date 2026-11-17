import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// Resolved by SUFFIX rather than by a pinned version. This migration has now been renumbered
// twice as main and a sibling branch took its number in turn, and a hard-coded path turns every
// renumber into an unrelated red test that says "file not found" instead of anything useful.
// Exactly one match is asserted, so a duplicate copy of this migration is still caught here
// rather than at deploy, where a reused version is silently skipped.
const migrationMatches = readdirSync(resolve(process.cwd(), "supabase/migrations")).filter((name) =>
  name.endsWith("_solo_zapier_api_mcp_and_skool_intake.sql"),
);
const migrationPath = `supabase/migrations/${migrationMatches[0] ?? "__missing__"}`;
const readMigration = () => {
  expect(migrationMatches).toHaveLength(1);
  return read(migrationPath);
};

describe("Solo Zapier API and MCP release contract", () => {
  it("renders two independent card states and two manage tabs", () => {
    const ui = read("src/solo/settings-integrations.tsx");
    expect(ui).toContain("API connection");
    expect(ui).toContain("Paige tools (MCP)");
    expect(ui).toContain('`ig-zapier-tab-${value}`');
    expect(ui).toContain('`ig-zapier-panel-${value}`');
  });
  it("uses provider OAuth with read-only scopes", () => {
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    expect(api).toContain("https://api.zapier.com/v2/authorize");
    expect(api).toContain("https://zapier.com/oauth/token/");
    expect(api).toMatch(/profile[\s\S]*zap:account:all/);
    expect(api).not.toMatch(/scope[^\n]*(zap:write|zap:all|action:run)/);
    expect(api).toContain("current_user_tenant_id");
    expect(api).toContain("expected_tenant_id");
  });
  it("keeps local cleanup available and preserves non-rotating refresh tokens", () => {
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    const sql = readMigration();
    expect(api).toContain('["cancel", "disconnect", "oauth_refuse"]');
    expect(api).toContain("retainedRefresh");
    expect(api).toContain("String(data.refresh_token)");
    expect(api).toContain("_expected_generation: expectedGeneration");
    expect(api).toContain("null, String(data.generation)");
    expect(api).toContain('.eq("tenant_id", tenantId).in("status", ["pending", "exchanging"])');
    expect(api).toContain('admin.rpc("zapier_api_begin_oauth"');
    expect(sql).toContain("tenant_zapier_api_one_active_oauth");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("FUNCTION public.zapier_api_begin_oauth");
  });
  it("makes OAuth finalization and local disconnect transactional", () => {
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    const sql = readMigration();
    expect(api).toContain('_attempt: attemptId');
    expect(api).toContain('admin.rpc("zapier_api_disconnect"');
    expect(sql).toContain("status='exchanging' AND expires_at>clock_timestamp()");
    expect(sql).toContain("FUNCTION public.zapier_api_disconnect");
    expect(api).toContain('admin.rpc("zapier_api_record_check"');
    expect(api).toContain('_generation: result.generation');
    expect(api).toContain('error: "rail_unavailable"');
    expect(sql).toContain("FUNCTION public.zapier_api_record_check");
    expect(sql).toContain("tenant_id=_tenant AND generation=_generation");
    expect(sql).toContain("tenant_id=_tenant AND generation=_expected_generation");
    expect(sql).toContain("ZAPIER_GRANT_STALE");
    expect(sql).toContain("FUNCTION public.set_tenant_zapier_mcp_connection");
    expect(sql).toContain("auth_kind='oauth'");
    expect(sql).toContain("auth_header_name=NULL");
    expect(sql).toContain("approved_capabilities='[]'::jsonb");
    expect(sql).toContain("capability_pins='{}'::jsonb");
    expect(sql).toContain("tools_cache=NULL");
    expect(sql).toContain("'auth_kind','oauth'");
  });
  it("preserves original route isolation while retiring new route provisioning", () => {
    const intake = read("supabase/functions/zapier-skool-intake/index.ts");
    const sql = readMigration();
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    expect(intake).toContain("route_token_hash");
    expect(intake).not.toMatch(/body\.(tenant_id|tenantId)/);
    expect(intake).toContain("idempotency_key");
    expect(intake).toContain("req.body.getReader()");
    expect(intake).toContain("total > MAX_BYTES");
    expect(intake).not.toContain("await req.text()");
    expect(sql).toMatch(/UNIQUE\s*\(tenant_id,\s*route_id,\s*idempotency_key\)/i);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL");
    expect(sql).toContain("SELECT tm.user_id INTO operator_id");
    // 'import', not 'integration': the latter is outside clients_created_by_channel_type_chk
    // and every new-contact delivery failed the check. See the channel-of-origin test below.
    expect(sql).toContain("operator_id,r.tenant_id,'import'");
    expect(sql).not.toContain("contact:=public.create_contact");
    expect(sql).toContain("c.tenant_id=r.tenant_id AND lower(btrim(c.email))=email");
    expect(sql).toContain("INSERT INTO public.clients(first_name,last_name,email,phone");
    expect(sql).toContain("EXCEPTION WHEN unique_violation");
    expect(sql).toContain("FUNCTION public.zapier_intake_route_create");
    expect(sql).toContain("route_token_hash");
    expect(api).not.toContain("provision_intake_route");
    expect(api).not.toContain("zapier-skool-intake");
    const ui = read("src/solo/settings-integrations.tsx");
    expect(ui).not.toContain("route_token");
    expect(ui).not.toContain("x-paige-route-token");
  });
  it("records bounded outcomes in Rail", () => {
    const sql = readMigration();
    // A stored failure is reported rather than acknowledged as a successful duplicate, but
    // only a TERMINAL one ends there -- see the retry contract below.
    expect(sql).toContain("IF existing.status<>'failed' THEN");
    expect(sql).toContain("IF existing.failure_code IS DISTINCT FROM 'contact_write_failed' THEN");
    expect(sql).toContain("'ok',false,'outcome','failed'");
    expect(sql).toContain("zapier_api_test_succeeded");
    expect(sql).toContain("zapier_api_test_failed");
    expect(sql).toContain("zapier_api_oauth_refused");
    expect(sql).toContain("Zapier API authorization declined");
    // REPOINTED 2026-09-05. `get_zapier_rail_activity` is redefined by
    // 20261203000000 (SCR-2026-09-05), which widens the filter so the panel also shows
    // the Zapier actions PAIGE actually ran — not just connection state. Left pointing at
    // `sql`, these two assertions would keep passing against a definition that no longer
    // ships, which is the stale-fence failure this suite has already hit once.
    const readerSql = read(
      "supabase/migrations/20261212000000_paige_can_show_her_work.sql",
    );
    expect(readerSql).toContain("FUNCTION public.get_zapier_rail_activity");
    // The four connection families are still admitted, unchanged...
    expect(readerSql).toContain("w.source_kind IN ('zapier_api_oauth','zapier_api_connection','zapier_mcp_connection','zapier_skool_intake')");
    // ...and so is the Zapier capability run, which is the point of the widening. n8n runs
    // are deliberately NOT admitted here: this is the Zapier card.
    expect(readerSql).toContain("w.source_kind='capability_run' AND w.capability_key='zapier_run_action'");
    expect(readerSql).not.toContain("capability_key='n8n_run_workflow'");
    const ui = read("src/solo/settings-integrations.tsx");
    expect(ui).toContain('rpc("get_zapier_rail_activity",{p_limit:5})');
    expect(ui).not.toContain('rpc("get_solo_rail_activity",{p_limit:50})');
    expect(sql).toContain("zapier_mcp_test_succeeded");
    expect(sql).toContain("zapier_mcp_test_failed");
    expect(sql).toContain("zapier_skool_intake_received");
    expect(sql).toContain("zapier_skool_intake_duplicate");
    expect(sql).not.toMatch(/provider_payload|raw_payload/);
  });
  it("routes the PAIGE connection test through the governed existing tool", () => {
    const chat = read("supabase/functions/paige-ai-chat/index.ts");
    const wrapper = read("supabase/functions/call-zapier-action/index.ts");
    const sql = readMigration();
    expect(chat).not.toContain('name: "zapier_connection_test"');
    expect(chat).toContain("When the owner asks for a Zapier connection test, use zapier_list_actions");
    expect(wrapper).toContain('admin.rpc("record_zapier_mcp_connection_test"');
    expect(wrapper).toContain('error: "rail_unavailable"');
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.record_zapier_mcp_connection_test");
    expect(sql).toContain("TO service_role");
  });
  it("persists denied OAuth before reporting it", () => {
    const callback = read("src/pages/ZapierOAuthCallback.tsx");
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    const sql = readMigration();
    expect(callback).toContain('action:"oauth_refuse",state');
    expect(api).toContain('admin.rpc("zapier_api_refuse"');
    expect(sql).toContain("status='refused'");
    expect(sql).toContain("'zapier_api_oauth',attempt_id,0,'zapier_api_oauth_refused'");
  });
  it("distinguishes refresh rejection from transient provider failure", () => {
    const api = read("supabase/functions/tenant-zapier-api-connect/index.ts");
    expect(api).toContain('oauthError === "invalid_grant"');
    expect(api).toContain('oauthError === "invalid_client" ? "configuration"');
    expect(api).toContain('response.status === 429 || response.status >= 500');
    expect(api).toContain('next.kind === "authorization" ? "authorization_expired"');
    expect(api).toContain('next.kind === "provider" ? "provider_unavailable"');
  });
  it("clears the cross-tenant contact collision the intake insert would hit", () => {
    const sql = readMigration();
    // The creator-wide index spans tenants, so an operator who already holds this email in
    // another workspace makes every delivery fail contact_write_failed. The tenant-scoped
    // uq_clients_tenant_email (20260817010000) keeps same-tenant duplicates blocked.
    expect(sql).toContain("DROP INDEX IF EXISTS public.clients_created_by_email_unique;");
    expect(sql).toContain("WHERE c.tenant_id=r.tenant_id AND lower(btrim(c.email))=email");
  });
  it("stays inside the Solo shell and leaves the Admin dialogs alone", () => {
    // Dropping clients_created_by_email_unique is table-level and cannot be scoped to one
    // shell, and the pull was to follow it into the Admin dialogs that match that index by
    // name. They are deliberately untouched. The case their message fired on -- one operator
    // holding the same email in two workspaces -- stops erroring entirely once the index is
    // gone, so there is nothing left to report there; and the one remaining path already
    // showed the generic error before this release. Reaching into the Admin shell would have
    // widened a Solo release for no behavioural gain.
    for (const surface of [
      "src/components/dashboard/AddInternalClientDialog.tsx",
      "src/components/dashboard/ClientManagementDashboard.tsx",
    ]) {
      expect(read(surface)).not.toContain("uq_clients_tenant_email");
    }
  });
  it("pins the authority a capability was approved with, not only its input schema", () => {
    const client = read("supabase/functions/_shared/mcp-client.ts");
    const outcome = read("supabase/functions/_shared/mcp-outcome.ts");
    const connect = read("supabase/functions/tenant-mcp-connect/index.ts");
    const n8n = read("supabase/functions/_shared/n8n-oauth.ts");
    expect(client).toContain("export async function fingerprintAuthority");
    expect(client).toContain("export async function fingerprintCapability");
    // Effects are a SET the provider happens to order; reordering must not read as drift.
    expect(client).toContain("[...new Set(a.effects)].sort()");
    expect(outcome).toContain("current.pin !== pinned");
    expect(outcome).not.toContain("current.schemaHash !== pinned");
    expect(connect).toContain("[t.name, t.pin]");
    // n8n's discovery pin MUST stay schema-only: the probe RPC wipes every approved
    // workflow when it moves, so widening it would revoke n8n approvals platform-wide.
    expect(n8n).toContain("search.schemaHash");
  });
  it("creates intake contacts with a channel the clients CHECK constraint actually allows", () => {
    const sql = readMigration();
    // clients_created_by_channel_type_chk (20260729020000) bounds this column. A value outside
    // it fails the insert, the surrounding WHEN OTHERS swallows it, and every delivery for a new
    // contact is recorded contact_write_failed while the webhook answers 422.
    const allowed = ["email","sms","whatsapp","instagram","facebook","voice",
                     "manual","form","import","api","seed","signup","invite"];
    const written = sql.match(/r\.tenant_id,'([a-z_]+)'\)/)?.[1];
    expect(written).toBeDefined();
    expect(allowed).toContain(written);
    // Not 'api': CREATED_VIA_LABEL maps it to "Paige", which would credit Paige for a contact
    // that arrived from Zapier.
    expect(written).not.toBe("api");
  });
  it("does not leave a pre-release approval pinned to a contract it no longer matches", () => {
    const sql = readMigration();
    const connect = read("supabase/functions/tenant-mcp-connect/index.ts");
    // A pin written before this release covered the input schema alone. Discovery marks a tool
    // approved by NAME, so carrying those pins would show the owner's tools still ticked while
    // every run was denied for drift -- silent, and indistinguishable from a broken integration.
    expect(sql).toContain("UPDATE public.tenant_mcp_connections");
    expect(sql).toMatch(/SET approved_capabilities = '\[\]'::jsonb,\s*\n\s*capability_pins\s*= '\{\}'::jsonb/);
    expect(sql).toContain("WHERE provider = 'zapier'");
    expect(connect).toContain("approved: approved.has(t.name)");
  });
  it("shows a pin-only re-approval in the Rail", () => {
    const sql = readMigration();
    // Re-approving the same names after a tool's authority moved rewrites capability_pins and
    // leaves approved_capabilities alone, so a names-only predicate never fired.
    expect(sql).toContain("OLD.capability_pins IS DISTINCT FROM NEW.capability_pins");
    expect(sql).toContain("NEW.capability_pins IS DISTINCT FROM OLD.capability_pins");
  });
  it("refuses exactly what the server refuses, and says why", () => {
    const ui = read("src/solo/settings-integrations.tsx");
    const fn = read("supabase/functions/tenant-mcp-connect/index.ts");
    // The server's rule, in one line. If it changes, the button must change with it.
    const at = fn.indexOf('u.hostname==="mcp.zapier.com"');
    expect(at).toBeGreaterThan(-1);
    const serverRule = fn.slice(fn.lastIndexOf("\n", at) + 1, fn.indexOf("\n", at));
    for (const clause of ["u.protocol===\"https:\"", "!u.username", "!u.password", "!u.hash", 'u.pathname.startsWith("/api/v1/")', 'u.pathname.startsWith("/api/mcp/")']) {
      expect(serverRule).toContain(clause);
    }
    // A query is deliberately NOT refused: Zapier's own copy-to-clipboard address has one.
    expect(serverRule).not.toContain("!u.search");
    // ...and the button applies the same clauses rather than a raw prefix match.
    const client = ui.slice(ui.indexOf("export function zapierMcpAddressProblem"));
    const body = client.slice(0, client.indexOf("\n}"));
    for (const clause of ['u.protocol !== "https:"', "u.username || u.password", "u.hash", 'u.pathname.startsWith("/api/v1/")', 'u.pathname.startsWith("/api/mcp/")', 'u.hostname.toLowerCase()']) {
      expect(body).toContain(clause);
    }
    expect(body).not.toContain("u.search");
    // The field is trimmed before it is judged -- an address pasted with surrounding
    // whitespace used to leave the button permanently dead with no reason given.
    expect(body).toContain("raw.trim()");
    // A refusal is shown to the owner rather than expressed only as a dead button.
    expect(ui).toContain("<small>{addressProblem??");
    expect(ui).toContain("addressProblem!==null}");
    expect(ui).not.toContain('!serverUrl.startsWith("https://mcp.zapier.com/api/mcp/")');
    // Owner wording: the control names the thing being connected, not the protocol.
    expect(ui).toContain('"Reconnect to Zapier MCP":"Connect to Zapier MCP"');
    expect(ui).not.toContain("Connect PAIGE tools with OAuth");
  });

  it("states one PAIGE-tools connection state, not one per surface", () => {
    const ui = read("src/solo/settings-integrations.tsx");
    // Production carries a zapier row with status='connected' and no credential. Rendering the
    // stored status directly made the card say "Not connected" and the drawer say "Connected"
    // about that same row on the same screen. Both surfaces read one derivation now.
    expect(ui).toContain("<dt>PAIGE tools (MCP)</dt><dd>{zapierMcpSummary(m).account}</dd>");
    expect(ui).not.toContain("<dt>PAIGE tools (MCP)</dt><dd>{mcpStateWords(m.status)}</dd>");
    // ...and that derivation withholds "Connected" until a credential is actually held.
    const summary = ui.slice(ui.indexOf("function zapierMcpSummary"));
    const body = summary.slice(0, summary.indexOf("\n}"));
    expect(body).toContain('if(!value.configured)return{account:"Not connected"');
    expect(body.indexOf("!value.configured")).toBeLessThan(body.indexOf('account:"Connected"'));
  });

  it("advances the drawer refresh when approvals are saved", () => {
    const ui = read("src/solo/settings-integrations.tsx");
    expect(ui).toContain('<CapabilityApproval provider="zapier" onChanged={onChanged}/>');
    expect(ui).toContain("setChosen(null); onChanged?.();");
    // The approved-tool count is read from the drawer's own connection row, so a mutation has
    // to reload that too -- refreshing the catalogue and the Rail alone left it pre-save.
    expect(ui).toContain("setActivityEpoch(n=>n+1);void mReload();onChanged();");
  });
  it("retries an intake whose contact write failed, and only that kind of failure", () => {
    const sql = readMigration();
    // The contact-write subtransaction rolls back, so a transient database error -- or a
    // moment with no eligible tenant operator -- wrote nothing. Replaying the stored failure
    // forever would drop the lead permanently even once the condition cleared, and Zapier's
    // retry is the one thing that would otherwise have recovered it.
    expect(sql).toContain("IF existing.failure_code IS DISTINCT FROM 'contact_write_failed' THEN");
    expect(sql).toContain("e:=existing;");
    expect(sql).toContain("SET status='received',failure_code=NULL,processed_at=NULL,contact_id=NULL");
    // A payload that failed validation is bound to this key's one payload hash, so replaying
    // it cannot change the answer. It stays terminal.
    expect(sql).toContain("failure_code='payload_invalid'");
    // A delivery that succeeded is still deduplicated rather than reprocessed.
    expect(sql).toContain("IF existing.status<>'failed' THEN");
    expect(sql).toContain("'zapier_skool_intake_duplicate'");
    // And the receipt is reused, so one idempotency key still owns exactly one row.
    expect(sql).not.toMatch(/ELSE\s*\n\s*INSERT INTO public\.tenant_zapier_intake_events[\s\S]{0,200}RETURNING \* INTO e;[\s\S]{0,40}INSERT INTO public\.tenant_zapier_intake_events/);
  });
});

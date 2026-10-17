/** Actual approval consumer/row/hooks inside the SOLO shell. Only identity,
 * backend and unrelated Chat ports are synthetic. Static browser pages are not
 * hydrated, customer-authenticated, provider or production execution evidence. */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloPaigeWorkspace } from "@/solo/SoloPaigeWorkspace";
import { CommandHub } from "@/solo/CommandCenter";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";

const h = vi.hoisted(() => ({
  theme: "light" as "light" | "dark", open: false,
  tenant: "00000000-0000-4000-8000-000000000201", actor: "00000000-0000-4000-8000-000000000202",
  context: {} as Record<string, unknown>, queue: [] as ApprovalQueueRow[], response: null as unknown,
  invoke: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>>, reads: [] as string[], unexpected: [] as string[],
  authListeners: new Set<(event: string) => void>(), serverTenant: "", serverActor: "",
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: h.theme, setTheme: vi.fn() }) }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ loading: false, has: () => true }) }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: false, target: null }) }));
vi.mock("@/solo/data/useSoloToolGovernance", () => ({ useSoloToolGovernance: () => ({ loading: false, configured: true, error: null, byTool: {}, canWrite: false }) }));
vi.mock("@/components/ui/paige", () => ({ useAgentPresence: () => {
  const [railExpanded, setRailExpanded] = useState(h.open);
  return { railExpanded, expandRail: () => setRailExpanded(true), collapseRail: () => setRailExpanded(false) };
} }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => h.context, useOptionalTenantContext: () => h.context }));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => h.actor }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => null }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({ useChatDocumentUpload: () => ({
  attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
  handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
  removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
}) }));
vi.mock("@/hooks/usePaigeThreads", () => ({ usePaigeThreads: () => ({
  threads: [], isLoading: false, isFetched: true, loadTurns: vi.fn(async () => []),
  ensureThread: vi.fn(async () => "test-thread"), loadApprovalRecovery: vi.fn(async () => null),
  onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));
vi.mock("@/integrations/supabase/client", () => {
  const forbidden = (operation: string): never => { h.unexpected.push(operation); throw new Error(`Fixture prohibits ${operation}`); };
  const from = (table: string) => {
    const filters = new Map<string, unknown>(); let single = false, update: Record<string, unknown> | null = null;
    const result = () => {
      h.reads.push(table);
      if (update) {
        if (table !== "paige_pending_approvals") return forbidden(`update:${table}`);
        h.updates.push({ table, patch: update, filters: Object.fromEntries(filters) });
        return { data: { id: filters.get("id"), tenant_id: filters.get("tenant_id"), status: update.status, decision_rationale: update.decision_rationale }, error: null, count: 1 };
      }
      const rows = table === "paige_approval_queue_v" ? structuredClone(h.queue)
        : table === "tenant_members" ? [{ tenant_id: h.tenant, user_id: h.actor, role: "owner", status: "active" }] : [];
      const selected = rows.filter(row => [...filters].every(([key, value]) => !(key in row) || row[key as keyof typeof row] === value));
      return { data: single ? selected[0] ?? null : selected, error: null, count: selected.length };
    };
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { filters.set(key, value); return q; },
      is: (key: string, value: unknown) => { filters.set(key, value); return q; },
      in: () => q, not: () => q, neq: () => q, order: () => q, limit: () => q, range: () => q, gte: () => q, lte: () => q,
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      insert: () => forbidden(`insert:${table}`), delete: () => forbidden(`delete:${table}`),
      update: (patch: Record<string, unknown>) => { update = patch; return q; },
    };
    return q;
  };
  return { supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: h.serverActor, user_metadata: { full_name: "Test owner" } } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: "synthetic-render-token", user: { id: h.serverActor } } }, error: null }),
      onAuthStateChange: (cb: (event: string) => void) => { h.authListeners.add(cb); return { data: { subscription: { unsubscribe: () => h.authListeners.delete(cb) } } }; },
    }, from,
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: () => {},
    rpc: async (name: string) => {
      h.reads.push(`rpc:${name}`);
      if (name === "current_user_tenant_id") return { data: h.serverTenant, error: null };
      if (name === "get_solo_setup_context") return { data: { tenantId: h.tenant, tenantName: "Test services", accessScope: "owner_full", brief: {}, businessOwners: [] }, error: null };
      if (name === "resolve_tenant_domain_identity") return { data: { default_email_sender: null }, error: null };
      if (name === "read_tenant_knowledge") return { data: { tenant_id: h.tenant, documents: [] }, error: null };
      if (name === "list_business_missions") return { data: { resolved_tenant_id: h.tenant, missions: [] }, error: null };
      if (name === "get_campaign_briefs") return { data: { can_manage: false, archived_count: 0, briefs: [] }, error: null };
      if (["practice_dashboard_metrics", "practice_attention_queue", "systems_check_snapshot"].includes(name)) return { data: {}, error: null };
      if (["get_solo_rail_activity", "social_connection_status", "social_account_status"].includes(name)) return { data: [], error: null };
      if (name === "social_connection_access") return { data: false, error: null };
      return forbidden(`rpc:${name}`);
    },
    functions: { invoke: async (name: string, options?: Record<string, unknown>) => {
      if (name === "execute-approval") { h.invoke.push(options ?? {}); return await h.response; }
      if (name === "admin-list-users") { h.reads.push(`function:${name}`); return { data: { users: [] }, error: null }; }
      return forbidden(`function:${name}`);
    } },
  } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const output = process.env.APPROVAL_RENDER_DIR ?? "work/approval-outcomes-render";
if (output !== "work/approval-outcomes-render" && !/^work\/human-stripe-\d{8}\/after$/.test(output)) {
  throw new Error("Approval render output must use the incumbent directory or an isolated work/human-stripe-YYYYMMDD/after directory");
}
const assets = `${output}/dist/assets`;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const title = "Review the new contact, verify their preferred next step, and prepare a clear owner follow-up. "
  + "Preserve the complete request and check these long reference details: " + "contactreference".repeat(12);
const description = "Read the complete customer notes.\nPreserve ownership, exact approvals and all existing context. No message is sent by this internal task.";
const approvalId = "00000000-0000-4000-8000-000000000203";
const fixture = (): ApprovalQueueRow => ({ id: approvalId, tenant_id: h.tenant, status: "pending", source: "paige_orchestration", category: "owner.task",
  summary: "Prepare the reviewed internal task", sla_state: "unscheduled", draft_content: { capability: "owner.task", subject: "Prepare the reviewed internal task",
    body: "Approve only this held task. Its full title and description remain visible in the approval row.", args: { title, description } }, metadata: { private_fixture: "do-not-render-this" },
} as unknown as ApprovalQueueRow);
const flush = async () => { for (let n = 0; n < 180; n++) await Promise.resolve(); };
const row = (host: Element) => host.querySelector(".gp-ap-list")!;
const button = (host: Element, label: string) => [...row(host).querySelectorAll<HTMLButtonElement>("button")].find(e => e.textContent?.trim() === label)!;
async function click(host: Element, label: string) { expect(button(host, label), label).toBeTruthy(); await act(async () => { button(host, label).click(); await flush(); }); }
function reset() {
  h.serverActor = h.actor; h.serverTenant = h.tenant; h.invoke = []; h.updates = []; h.reads = []; h.unexpected = []; h.authListeners.clear();
  h.context = { activeTenantId: h.tenant, activeUserId: h.actor, activeTenant: { id: h.tenant, name: "Test services", account_number: "1234567" },
    loading: false, accountContextLoading: false, accountContextStatus: "ready", isPlatformStaff: false };
  h.queue = [fixture()]; h.response = { data: { ok: true, executed: true, approval_id: approvalId, act_outcome: "executed" }, error: null };
}
async function mount(width = 1536, height = 770, theme: "light" | "dark" = "light", open = false) {
  reset(); h.theme = theme; h.open = open;
  const previous = { width: innerWidth, height: innerHeight, matchMedia: window.matchMedia };
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true }); Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (media: string): MediaQueryList => ({ media,
    matches: media === "(max-width: 1080px)" && width <= 1080, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }) });
  window.localStorage.removeItem("paige.tenantShell.navExpanded");
  const network = vi.fn(() => { throw new Error("Rendered fixture prohibits network"); }); vi.stubGlobal("fetch", network);
  const host = document.createElement("div"); document.body.append(host); const root: Root = createRoot(host);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
  const render = async () => { await act(async () => { root.render(<QueryClientProvider client={queries}><MemoryRouter initialEntries={["/solo/1234567/command-center/business-game-plan"]}>
    <Routes><Route path="/solo/:account/*" element={<TenantCommandCenterShell accountName="Test services" accountType="standalone" userRole="admin" onSignOut={() => {}}
      soloPaigeWorkspace={<SoloPaigeWorkspace visible={open} />}>
      {/* Exact incumbent SoloApp inner frame, not a fixture-only layout patch. */}
      <div className="paige-solo" data-theme={theme} style={{ width:"100%",maxWidth:"none",height:"100%",minWidth:0,minHeight:0,alignSelf:"stretch",display:"flex",flexDirection:"column" }}>
        <div style={{ display:"flex",flex:1,minHeight:0,overflow:"hidden" }}><main data-solo-screen-host style={{ flex:1,overflow:"auto",minHeight:0,minWidth:0 }}>
          <CommandHub account="1234567" accountContext={{ accountName: "Test services", accountType: "standalone" }} />
        </main></div>
      </div>
    </TenantCommandCenterShell>} /></Routes>
  </MemoryRouter></QueryClientProvider>); await flush(); }); };
  await render();
  return { host, render, network, async cleanup() { await act(async () => root.unmount()); queries.clear(); host.remove(); vi.unstubAllGlobals();
    Object.defineProperty(window, "innerWidth", { value: previous.width, configurable: true }); Object.defineProperty(window, "innerHeight", { value: previous.height, configurable: true });
    Object.defineProperty(window, "matchMedia", { value: previous.matchMedia, configurable: true }); } };
}

describe("actual Game Plan approval outcomes inside the SOLO shell", () => {
  it("uses the real queue hook, complete held task, View/Close/Escape and decline Cancel without any effect", async () => {
    const v = await mount(); try {
      expect(v.host.querySelector('[data-tenant-shell] .paige-solo[data-theme="light"] > div > main[data-solo-screen-host] #command-panel-plan .gp-ap-list')).toBeTruthy();
      expect(row(v.host), v.host.textContent ?? "missing").toBeTruthy(); expect(row(v.host).textContent).toContain(title); expect(row(v.host).textContent).toContain(description);
      expect(row(v.host).textContent).not.toContain("do-not-render-this");
      await click(v.host, "View"); expect(document.activeElement).toBe(button(v.host, "Close details"));
      await act(async () => { button(v.host, "Close details").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(button(v.host, "Close details")).toBeUndefined(); expect(document.activeElement).toBe(button(v.host, "View"));
      await click(v.host, "View"); await click(v.host, "Close details"); expect(document.activeElement).toBe(button(v.host, "View"));
      await click(v.host, "Decline"); expect(document.activeElement).toBe(row(v.host).querySelector("textarea"));
      await click(v.host, "Cancel"); expect(document.activeElement).toBe(button(v.host, "Decline"));
      expect(h.invoke).toEqual([]); expect(h.updates).toEqual([]); expect(h.unexpected).toEqual([]); expect(v.network).not.toHaveBeenCalled();
    } finally { await v.cleanup(); }
  });
  it.each([
    ["exact native acknowledgement", { ok: true, executed: true, approval_id: approvalId, act_outcome: "executed" }, "The reviewed action completed."],
    ["null acknowledgement", null, "The outcome could not be confirmed."],
    ["wrong approval identity", { ok: true, executed: true, approval_id: "foreign", act_outcome: "executed" }, "The outcome could not be confirmed."],
    ["native acknowledgement missing act outcome", { ok: true, executed: true, approval_id: approvalId }, "The outcome could not be confirmed."],
    ["native refusal", { ok: false, executed: false, approval_id: approvalId, act_outcome: "approval_pending" }, "The request was refused"],
  ])("keeps %s truthful and latches its intent until a real queue refresh", async (_label, data, expected) => {
    const v = await mount(); try {
      h.response = { data, error: null }; await click(v.host, "Approve");
      expect(row(v.host).textContent).toContain(expected); expect(h.invoke).toEqual([{ body: { approval_id: approvalId } }]); expect(button(v.host, "Approve").disabled).toBe(true);
      await click(v.host, "Approve"); expect(h.invoke).toHaveLength(1);
      const reads = h.reads.filter(r => r === "paige_approval_queue_v").length; await click(v.host, "Refresh status");
      expect(h.invoke).toHaveLength(1); expect(h.reads.filter(r => r === "paige_approval_queue_v").length).toBeGreaterThan(reads);
      h.serverTenant = "foreign"; await click(v.host, "Approve"); expect(h.invoke).toHaveLength(1); expect(row(v.host).textContent).toContain("The request could not be started");
      expect(h.updates).toEqual([]); expect(h.unexpected).toEqual([]); expect(v.network).not.toHaveBeenCalled();
    } finally { await v.cleanup(); }
  });
  it("holds one native decision flight, ignores repeated clicks and never replays on refresh", async () => {
    const v = await mount(); try {
      let resolve!: (value: unknown) => void;
      h.response = new Promise(yes => { resolve = yes; }); const approve = button(v.host, "Approve");
      await act(async () => { approve.click(); approve.click(); await flush(); });
      expect(h.invoke).toEqual([{ body: { approval_id: approvalId } }]); expect(row(v.host).textContent).toContain("Checking the reviewed action");
      await act(async () => { resolve({ data: { ok:true,executed:true,approval_id:approvalId,act_outcome:"executed" },error:null }); await flush(); });
      expect(row(v.host).textContent).toContain("The reviewed action completed.");
      await click(v.host,"Refresh status"); expect(h.invoke).toHaveLength(1); expect(h.updates).toEqual([]);
    } finally { await v.cleanup(); }
  });
  it("auth invalidation fences a late acknowledgement until an explicit canonical read", async () => {
    const v = await mount(); try {
      let resolve!: (value: unknown) => void; h.response = new Promise(yes => { resolve = yes; });
      await click(v.host,"Approve"); expect(h.invoke).toHaveLength(1);
      await act(async () => { for(const cb of h.authListeners) cb("TOKEN_REFRESHED"); await flush(); });
      expect(row(v.host).textContent).toContain("Any previous request may already have gone through");
      await act(async () => { resolve({ data: { ok:true,executed:true,approval_id:approvalId,act_outcome:"executed" },error:null }); await flush(); });
      expect(row(v.host).textContent).not.toContain("The reviewed action completed.");
      await click(v.host,"Refresh status"); expect(h.invoke).toHaveLength(1); expect(button(v.host,"Approve")).toBeTruthy();
    } finally { await v.cleanup(); }
  });
  it("checks the original actor before dispatch and preserves zero effects on refusal", async () => {
    const v = await mount(); try {
      h.serverActor = "foreign"; await click(v.host,"Approve");
      expect(row(v.host).textContent).toContain("The request could not be started"); expect(h.invoke).toEqual([]); expect(h.updates).toEqual([]);
    } finally { await v.cleanup(); }
  });
  it("sends a deliberate decline through the same exact pending-row decision writer", async () => {
    const v = await mount(); try {
      await click(v.host,"Decline"); const field=row(v.host).querySelector("textarea")!;
      await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"Needs correction");field.dispatchEvent(new Event("input",{bubbles:true}));});
      await click(v.host,"Decline action"); expect(h.invoke).toEqual([]); expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toMatchObject({table:"paige_pending_approvals",patch:{status:"rejected",decision_rationale:"Needs correction"},filters:{id:approvalId,status:"pending",tenant_id:h.tenant}});
      expect(row(v.host).textContent).toContain("Decline confirmed. The reviewed action was rejected.");
    } finally { await v.cleanup(); }
  });
});

type Scene = "review" | "details" | "unknown" | "refused" | "decline";
function css() {
  const files = readdirSync(assets), picked = ["main-", "SoloEntry-", "PaigeAIChat-"].map(prefix => files.find(f => f.startsWith(prefix) && f.endsWith(".css")));
  if (picked.some(f => !f)) throw new Error("Missing compiled shell/chat styles");
  return (picked as string[]).map(f => readFileSync(`${assets}/${f}`, "utf8")).join("\n") + "\n"
    + ["src/components/tenant-shell/tenant-command-center-shell.css", "src/solo/solo-paige-workspace.css", "src/solo/solo-tokens.css", "src/solo/solo-game-plan-workspace.css"].map(p => readFileSync(p, "utf8")).join("\n");
}
function page(html: string, styles: string, theme: string) {
  const font = readFileSync("public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2").toString("base64");
  return `<!doctype html><html lang="en" class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'"><title>Local SOLO approval outcome proof</title><style>@font-face{font-family:'Schibsted Grotesk';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${font}) format('woff2')} ${styles} html,body{margin:0;height:100%;}</style></head><body>${html}</body></html>`;
}
async function capture(scene: Scene, width: number, height: number, theme: "light" | "dark", open: boolean) {
  const v = await mount(width, height, theme, open); try {
    expect(row(v.host), v.host.textContent ?? "missing").toBeTruthy(); expect(title.length).toBe(357);
    expect(row(v.host).closest("main[data-solo-screen-host]")).toBeTruthy();
    expect(row(v.host).closest(".paige-solo")?.getAttribute("data-theme")).toBe(theme);
    if (scene === "details") { await click(v.host, "View"); expect(document.activeElement).toBe(button(v.host,"Close details")); }
    if (scene === "decline") await click(v.host, "Decline");
    if (scene === "unknown" || scene === "refused") {
      h.response = { data: scene === "unknown" ? null : { ok: false, executed: false, approval_id: approvalId, act_outcome: "approval_pending" }, error: null };
      await click(v.host, "Approve"); expect(h.invoke).toHaveLength(1); expect(button(v.host, "Approve").disabled).toBe(true);
      expect(row(v.host).textContent).toContain(scene === "unknown" ? "The outcome could not be confirmed." : "The request was refused");
    } else expect(h.invoke).toHaveLength(0);
    expect(h.updates).toHaveLength(0); expect(h.unexpected).toEqual([]); expect(v.network).not.toHaveBeenCalled();
    const shell = v.host.querySelector("[data-tenant-shell]")!;
    return { html: shell.outerHTML, focus: document.activeElement?.textContent?.trim().slice(0,70), reads: [...h.reads], simulatedApprovals: h.invoke.length, realEffects: 0 };
  } finally { await v.cleanup(); }
}
describe("approval outcome styled full-shell fixture", () => {
  it.skipIf(!existsSync(assets))("serializes the actual consumer after real React interactions", async () => {
    mkdirSync(output, { recursive: true }); const styles = css(), records = [];
    const cases = process.env.APPROVAL_RENDER_FULL === "1"
      ? (["light", "dark"] as const).flatMap(theme => [[1536,770],[1366,768],[1024,768],[900,1000],[390,768]].flatMap(([width,height]) => [false,true].flatMap(open => (["review","unknown","refused","decline"] as const).map(scene => ({theme,width,height,open,scene})))))
      : ([{ theme:"light",width:1536,height:770,open:false,scene:"review" },{ theme:"light",width:390,height:768,open:false,scene:"unknown" },
        { theme:"dark",width:1536,height:770,open:true,scene:"details" },{ theme:"dark",width:390,height:768,open:false,scene:"decline" }] as const);
    const extraCases = process.env.APPROVAL_RENDER_FULL === "1" ? (["light","dark"] as const).flatMap(theme=>[
      {theme,width:1536,height:770,open:true,scene:"details" as const},
      {theme,width:390,height:768,open:false,scene:"details" as const},
      {theme,width:768,height:384,pixelRatio:2,open:false,scene:"details" as const},
      {theme,width:768,height:384,pixelRatio:2,open:false,scene:"unknown" as const},
    ]) : [];
    for (const item of [...cases,...extraCases]) {
      const captured = await capture(item.scene, item.width, item.height, item.theme, item.open);
      const name = `approval-${item.theme}-${item.width}x${item.height}-${item.open ? "open" : "closed"}-${item.scene}.html`, html = page(captured.html, styles, item.theme);
      writeFileSync(`${output}/${name}`, html); records.push({ ...item, name, htmlSha256:digest(html), focus:captured.focus, backendReads:captured.reads, simulatedApprovals:captured.simulatedApprovals, realEffects:0 });
    }
    const sourcePaths = ["src/components/tenant-shell/TenantCommandCenterShell.tsx","src/solo/SoloPaigeWorkspace.tsx","src/solo/CommandCenter.tsx","src/solo/SoloGamePlanWorkspace.tsx",
      "src/solo/GamePlanApprovals.tsx","src/components/paige/ApprovalRow.tsx","src/hooks/usePendingApprovals.ts","src/components/tenant-shell/tenant-command-center-shell.css",
      "src/solo/SoloApp.tsx","src/solo/solo-tokens.css","src/solo/solo-paige-workspace.css","src/solo/solo-game-plan-workspace.css","public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2"];
    expect(records).toHaveLength(process.env.APPROVAL_RENDER_FULL === "1" ? 88 : 4);
    writeFileSync(`${output}/render-manifest.json`,JSON.stringify({proofClass:"SYNTHETIC_REAL_CONSUMER_RENDER",incumbentInnerFrame:"SoloApp402-405; setup reminder and full SoloApp identity/provisioning guards are outside this fixture",components:["TenantCommandCenterShell","SoloPaigeWorkspace","CommandHub","SoloGamePlanWorkspace","GamePlanApprovals","ApprovalRow"],
      actualQueueHook:true,actualQueryClient:true,sources:sourcePaths.map(path=>({path,sha256:digest(readFileSync(path))})),cssSha256:digest(styles),authenticatedQa:"UNVERIFIED",records},null,2));
  },180_000);
});

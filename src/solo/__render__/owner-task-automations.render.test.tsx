/**
 * Local rendered proof, never production/account/provider evidence.
 * Real shell + Settings + Automations + task hook/caller; only backend, identity,
 * presence and unrelated Chat ports are synthetic. No second product store.
 * CUA owns browser geometry/screenshots; this fixture only serializes React.
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloPaigeWorkspace } from "@/solo/SoloPaigeWorkspace";
import { SoloSettings } from "@/solo/settings";

const h = vi.hoisted(() => ({
  theme: "light" as "light" | "dark", open: false,
  tenant: "00000000-0000-4000-8000-000000000101", actor: "00000000-0000-4000-8000-000000000102",
  process: {} as Record<string, unknown>, step: {} as Record<string, unknown>,
  reads: [] as string[], controls: [] as Array<Record<string, unknown>>, unexpected: [] as string[],
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
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: h.tenant, activeUserId: h.actor, loading: false, accountContextLoading: false,
  accountContextStatus: "ready", isPlatformStaff: false,
  activeTenant: { id: h.tenant, account_number: "1234567", name: "Test services" },
}) }));
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
    const filters = new Map<string, unknown>(); let single = false;
    const result = () => {
      h.reads.push(table);
      const rows = table === "paige_automations" ? [h.process]
        : table === "paige_automation_acts" ? [h.step]
          : table === "tenant_members" ? [{ tenant_id: h.tenant, user_id: h.actor, role: "owner", status: "active" }] : [];
      const selected = rows.filter(row => [...filters].every(([key, value]) => !(key in row) || row[key] === value));
      return { data: single ? selected[0] ?? null : selected, error: null };
    };
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      is: () => query, in: () => query, order: () => query, limit: () => query,
      maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      insert: () => forbidden(`insert:${table}`), update: () => forbidden(`update:${table}`), delete: () => forbidden(`delete:${table}`),
    };
    return query;
  };
  return { supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: h.actor } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: "synthetic-render-token", user: { id: h.actor } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    }, from,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "control_owner_task_automation") {
        h.controls.push(args ?? {});
        // Deliberately ambiguous acknowledgement; no synthetic canonical update
        // and no retry. This renders the real hook's unknown outcome.
        return { data: null, error: { code: "PGRST000", message: "Synthetic acknowledgement unavailable" } };
      }
      h.reads.push(`rpc:${name}`);
      if (name === "current_user_tenant_id") return { data: h.tenant, error: null };
      if (name === "is_current_user_tenant_admin") return { data: true, error: null };
      // Incumbent caller-JWT read projections, not provider effects.
      if (["social_connection_status", "social_account_status"].includes(name)) return { data: [], error: null };
      if (name === "social_connection_access") return { data: false, error: null };
      if (/^(get_|list_|read_|resolve_|is_|tenant_)/.test(name)) return { data: null, error: null };
      return forbidden(`rpc:${name}`);
    },
    functions: { invoke: async (name: string) => {
      h.reads.push(`unrelated-function:${name}`);
      return { data: null, error: { message: "Unrelated connection is synthetic and unavailable" } };
    } },
  } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const output = process.env.OWNER_TASK_RENDER_DIR || "work/owner-task-render";
const assets = `${output}/dist/assets`;
const scenes = ["draft", "review", "unknown"] as const;
const sizes = [[1536, 770], [1366, 768], [1024, 768], [900, 1000], [390, 768]] as const;
type Scene = typeof scenes[number];
const title = "Review the new contact, verify their preferred next step, and prepare a clear owner follow-up. "
  + "Preserve the complete request and check these long reference details: " + "contactreference".repeat(12);
const description = "Read the contact record and confirm the next internal task before taking any action.\n"
  + "Keep the original notes, verify ownership, and let the owner approve each occurrence. This synthetic task never sends a message.";
const flush = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
const controls = (host: Element, text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent?.trim() === text);
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function compiledCss(): string {
  const files = readdirSync(assets).filter(f => f.endsWith(".css"));
  const picked = ["main-", "SoloEntry-", "PaigeAIChat-"].map(prefix => files.find(f => f.startsWith(prefix)));
  if (picked.some(f => !f)) throw new Error("Current build is missing a required shell/chat CSS bundle");
  return (picked as string[]).map(f => readFileSync(`${assets}/${f}`, "utf8")).join("\n") + "\n"
    + ["src/components/tenant-shell/tenant-command-center-shell.css", "src/solo/solo-paige-workspace.css", "src/solo/settings.css", "src/solo/settings-integrations.css"]
      .map(path => readFileSync(path, "utf8")).join("\n");
}
function page(html: string, css: string, theme: string): string {
  // Local licensed font bytes, no remote font/provider request. No layout patch.
  const font = readFileSync("public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2").toString("base64");
  return `<!doctype html><html lang="en" class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'"><title>Local SOLO internal task proof</title><style>@font-face{font-family:'Schibsted Grotesk';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${font}) format('woff2')} ${css} html,body{margin:0;height:100%;}</style></head><body>${html}</body></html>`;
}

async function capture(scene: Scene, width: number, height: number, theme: "light" | "dark", open: boolean) {
  const oldWidth = window.innerWidth, oldHeight = window.innerHeight, oldMatchMedia = window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  // The real shell also evaluates this JS media query to protect conversation
  // width. CSS-sized screenshots alone must not serialize a wide-screen state.
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (media: string): MediaQueryList => ({
    media, matches: media === "(max-width: 1080px)" && width <= 1080, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  }) });
  window.localStorage.removeItem("paige.tenantShell.navExpanded"); h.theme = theme; h.open = open;
  h.reads = []; h.controls = []; h.unexpected = [];
  h.process = { id: "00000000-0000-4000-8000-000000000103", tenant_id: h.tenant, name: "Review every new contact",
    category: "general", trigger_key: "contact.created", trigger_config: {}, conditions: [], created_by: h.actor,
    state: "draft", granted_lane: "confirm", owner_task_armed_at: null, updated_at: "2026-10-16T12:00:00.123456Z" };
  h.step = { id: "00000000-0000-4000-8000-000000000104", automation_id: h.process.id, position: 1,
    action_kind: "owner.task", tool_key: null, config: { title, description } };
  const network = vi.fn(() => { throw new Error("No network permitted in rendered fixture"); });
  vi.stubGlobal("fetch", network);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/solo/1234567/settings/integrations/automations"]}>
        <Routes><Route path="/solo/:account/*" element={<TenantCommandCenterShell accountName="Test services" accountType="standalone" userRole="admin" onSignOut={() => {}}
          soloPaigeWorkspace={<SoloPaigeWorkspace visible={open} />}>
          <SoloSettings />
        </TenantCommandCenterShell>} /></Routes>
      </MemoryRouter>); await flush();
    });
    expect(host.querySelector(".ss-content[data-settings-tab='integrations']")).toBeTruthy();
    expect(host.querySelector(".sa-owner-tasks")).toBeTruthy();
    expect(host.querySelector(".sa-owner-task-title")?.textContent).toBe(title);
    expect(host.querySelector(".sa-owner-task-description")?.textContent).toBe(description);
    expect(controls(host, "Review to enable")).toHaveLength(1);
    expect(h.controls).toHaveLength(0);
    let focus: string | null = null;
    if (scene !== "draft") {
      await act(async () => { controls(host, "Review to enable")[0].click(); await flush(); });
      expect(controls(host, "Enable future contacts")).toHaveLength(1);
      expect(document.activeElement).toBe(controls(host, "Cancel")[0]); focus = "Cancel";
      expect(h.controls).toHaveLength(0);
    }
    if (scene === "unknown") {
      await act(async () => { controls(host, "Enable future contacts")[0].click(); await flush(); });
      expect(h.controls).toHaveLength(1);
      expect(h.controls[0]).toEqual({ _automation_id: h.process.id, _action: "arm", _expected_updated_at: h.process.updated_at,
        _expected_process: Object.fromEntries(Object.entries(h.process).filter(([key]) => key !== "updated_at")),
        _expected_acts: [{ id: h.step.id, position: 1, action_kind: "owner.task", tool_key: null, config: { title, description } }] });
      expect(host.querySelector(".sa-owner-tasks")?.textContent).toContain("The outcome could not be confirmed. The process may have changed.");
      expect(controls(host, "Review to enable")[0].disabled).toBe(true);
      expect(controls(host, "Enable future contacts")).toHaveLength(0);
      expect(document.activeElement).toBe(controls(host, "Refresh")[0]); focus = "Refresh";
    }
    const shell = host.querySelector("[data-tenant-shell]")!;
    expect(shell.getAttribute("data-paige")).toBe(open ? "open" : "closed");
    if (open && width <= 1080) expect((shell as HTMLElement).style.getPropertyValue("--tcs-paige")).toBe("0px");
    expect(host.querySelector("#tenant-shell-main")).toBeTruthy();
    expect(host.querySelector("#tenant-paige-workspace")).toBeTruthy();
    expect(network).not.toHaveBeenCalled(); expect(h.unexpected).toEqual([]);
    return { html: shell.outerHTML, focus, reads: [...h.reads], simulatedControls: h.controls.length, realEffects: 0 };
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    Object.defineProperty(window, "innerWidth", { value: oldWidth, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: oldHeight, configurable: true });
    Object.defineProperty(window, "matchMedia", { value: oldMatchMedia, configurable: true });
  }
}

describe("owner task full-shell rendered fixture", () => {
  it.skipIf(!existsSync(assets))("serializes actual draft/review/unknown trees with current styles and zero real effects", async () => {
    mkdirSync(output, { recursive: true }); const css = compiledCss(); const records = [];
    expect(title.length).toBeLessThanOrEqual(500);
    for (const theme of ["light", "dark"] as const) for (const [width, height] of sizes) for (const open of [false, true]) for (const scene of scenes) {
      appendFileSync(`${output}/render-progress.jsonl`, JSON.stringify({ theme, width, height, open, scene, phase: "start" }) + "\n");
      const captured = await capture(scene, width, height, theme, open);
      const name = `shell-${theme}-${width}x${height}-${open ? "open" : "closed"}-${scene}.html`;
      const html = page(captured.html, css, theme); writeFileSync(`${output}/${name}`, html);
      records.push({ name, theme, width, height, open, scene, focus: captured.focus, htmlSha256: digest(html),
        backendReads: captured.reads, simulatedControls: captured.simulatedControls, realEffects: captured.realEffects });
      appendFileSync(`${output}/render-progress.jsonl`, JSON.stringify({ name, phase: "written" }) + "\n");
    }
    expect(records).toHaveLength(60);
    const reflowRecords = [];
    // Native DPR2 captures later give a 1536x768 physical image with a real
    // 768x384 CSS layout. This is 200%-equivalent reflow, not a claim that a
    // real customer's browser zoom setting or mobile device was exercised.
    for (const theme of ["light", "dark"] as const) for (const scene of ["review", "unknown"] as const) {
      const captured = await capture(scene, 768, 384, theme, false);
      const name = `reflow-${theme}-768x384-closed-${scene}.html`, html = page(captured.html, css, theme);
      writeFileSync(`${output}/${name}`, html);
      reflowRecords.push({ name, theme, width: 768, height: 384, pixelRatio: 2, open: false, scene, focus: captured.focus,
        htmlSha256: digest(html), backendReads: captured.reads, simulatedControls: captured.simulatedControls, realEffects: captured.realEffects });
    }
    expect(reflowRecords).toHaveLength(4);
    writeFileSync(`${output}/render-manifest.json`, JSON.stringify({ proofClass: "SYNTHETIC_RENDERED_FULL_SHELL",
      components: ["TenantCommandCenterShell", "SoloPaigeWorkspace", "SoloSettings", "SoloIntegrationsView", "SoloAutomationsView", "OwnerTaskAutomations"],
      sources: ["src/components/tenant-shell/TenantCommandCenterShell.tsx", "src/solo/SoloPaigeWorkspace.tsx", "src/solo/settings.tsx",
        "src/solo/settings-integrations.tsx", "src/solo/settings-automations.tsx", "src/solo/owner-task-automations.tsx",
        "src/solo/data/useOwnerTaskAutomations.ts", "src/solo/data/ownerTaskAutomation.ts", "src/components/tenant-shell/tenant-command-center-shell.css",
        "src/solo/solo-paige-workspace.css", "src/solo/settings.css", "src/solo/settings-integrations.css",
        "public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2"].map(path => ({ path, sha256: digest(readFileSync(path)) })),
      realOwnerTaskHookAndCaller: true, compiledCssSha256: digest(css), actualBrowserProof: "OWED_TO_CUA", authenticatedQa: "UNVERIFIED", records, reflowRecords }, null, 2));
  }, 180_000);
});

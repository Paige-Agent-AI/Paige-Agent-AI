// @vitest-environment node
// Executes original record/claim CAS, approved-argument continuation and Studio
// generate/save/linkage AST in separate request closures. Auth, service/caller
// ports and row atomicity are captured doubles, not HTTP/RLS/transaction proof.
// An immutable Git source is a red control; production is never overwritten.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { confirmFingerprint, confirmIdentityValue, unaddressableConfirmArgs, unaddressableArgsRefusal, UUID_INPUT_SHAPE } from "../../../supabase/functions/_shared/confirm-fingerprint";
import { parseScopedToken, storedRowState } from "../../../supabase/functions/_shared/paige-turn/resume";
import { parseStudioPageSaveSource, sameStudioPageSaveSource, type StudioPageSaveSource } from "../../../supabase/functions/_shared/growth/studio-page-source";
import { createStudioPageSave } from "../../../supabase/functions/_shared/growth/studio-page-save";
import { artifactProduced, ARTIFACT_ABSENT_ERROR } from "../../../supabase/functions/_shared/artifact-receipt";

const revision = process.env.STUDIO_PAGE_CONFIRMATION_ENTRY_SOURCE;
if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid immutable source SHA");
const source = revision ? execFileSync("git", ["show", `${revision}:supabase/functions/paige-ai-chat/index.ts`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  : readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true), nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
function one<T>(matches: T[], label: string): T { if (matches.length !== 1) throw Error(`Original ${label} missing/ambiguous: ${matches.length}`); return matches[0]; }
function variable(name: string) { return one(nodes.filter(ts.isVariableDeclaration).filter(node => node.name.getText(ast) === name), name); }
function declaration(name: string) { return `const ${variable(name).getText(ast)};`; }
function branch(name: string) { return (one(nodes.filter(ts.isIfStatement).filter(node => node.expression.getText(ast) === `tc.function.name === "${name}"` && ts.isBlock(node.thenStatement)), name).thenStatement as ts.Block).statements.map(node => node.getText(ast)).join("\n"); }
const linked = variable("studioLinked").parent.parent, preview = variable("studioPreview").parent.parent;
if (!ts.isVariableStatement(linked) || !ts.isVariableStatement(preview) || !ts.isBlock(linked.parent) || linked.parent !== preview.parent) throw Error("Original Studio ownership block missing");
const siblings = linked.parent.statements;
const ownership = siblings.slice(siblings.indexOf(linked) + 1, siblings.indexOf(preview)).map(node => node.getText(ast)).join("\n");
const common = one(nodes.filter(ts.isIfStatement).filter(node => ts.isBlock(node.parent) && node.expression.getText(ast).includes("studioSessionId")
  && node.getText(ast).includes('tc.function.name === "growth_page_save"') && node.getText(ast).includes('rpc("link_session_artifact"')), "common linkage").getText(ast);
const approved = one(nodes.filter(ts.isVariableDeclaration).filter(node => node.name.getText(ast) === "approvedArgs" && node.getText(ast).includes("claimConfirmation")), "approved args").parent.parent;
if (!ts.isVariableStatement(approved) || !ts.isBlock(approved.parent)) throw Error("Original approved continuation missing");
const continuation = approved.parent.statements.slice(approved.parent.statements.indexOf(approved)).map(node => node.getText(ast)).join("\n");
const functions = ["confirmationWasConsumed", "confirmationArgs", "scopedConfirmationFingerprint", "confirmationToken", "recordConfirmation", "selectedConfirmationNonce", "claimConfirmation", "resumedRowStateNow",
  "portalRequestScope", "portalRequestCurrent", "asToolRecord", "readInvokeBody", "workspaceRefusal"].map(declaration).join("\n");
const hasClaims = nodes.filter(ts.isVariableDeclaration).some(node => node.name.getText(ast) === "studioPageClaims");

type Row = Record<string, unknown>;
type Tool = { id: string; function: { name: string; arguments: string } };
type Reply = { data: unknown; error: unknown };
type Operation = { kind: "select" | "update" | "insert"; columns: string; filters: unknown[][]; values?: Row };
const TENANT = "11111111-1111-4111-8111-111111111111", SESSION = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333", ACTOR = "44444444-4444-4444-8444-444444444444";
const THREAD = "55555555-5555-4555-8555-555555555555", OTHER = "66666666-6666-4666-8666-666666666666";
const NONCE1 = "77777777-7777-4777-8777-777777777777", NONCE2 = "88888888-8888-4888-8888-888888888888";
const PROPOSAL = "99999999-9999-4999-8999-999999999999", VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE = "2026-11-13T17:05:06.123456+00:00", PORTAL = "client_portal_request_share";
const nativeSource = (): StudioPageSaveSource => ({ ok: true, tenant_id: TENANT, session_id: SESSION, page_id: PAGE, updated_at: DATE,
  artifact_refs: [{ kind: "page", id: PAGE, title: "Original page", added_at: DATE }],
  project_context: { target: { kind: "workspace" }, values: { publicName: "Neutral studio", offers: "Editorial services", primaryColor: "" }, template_id: "nexus-editorial-landing-v1" },
  conversion: { type: "conversion", destination: { kind: "native_booking", slug: "intro-call" } } });
const input = (): Row => ({ page_id: PAGE, slug: "model-address", title: "Reviewed page", blocks: [{ type: "hero", title: "Reviewed design" }], theme: { primary_color: "#123456" }, seo: { title: "Reviewed page" } });
const tool = (name = "growth_page_save", id = "approved-call", args: Row = { title: "Model changed it" }): Tool => ({ id, function: { name, arguments: JSON.stringify(args) } });
type Runtime = {
  generate(): Promise<Row>; record(args: Row, name?: string): Promise<Row>; claim(token: string, name?: string): Promise<Row | null>;
  approve(tc: Tool, token: string): Promise<{ dispatched: boolean; result?: Row; outputs: Row[] }>;
  dispatch(tc: Tool): Promise<Row>; patch(change: Row): void;
  snapshot(): { claims: Map<string, Row>; approved: WeakMap<object, unknown>; map: Map<string, { source: StudioPageSaveSource }>; needsReview: boolean };
};
function database() {
  const rows: Row[] = [], operations: Operation[] = [];
  const controls: { lostClaim?: boolean; refuseClaim?: boolean; malformedClaim?: Row; afterClaim?: () => void; afterSelect?: () => void } = {};
  const from = (table: string) => {
    if (table !== "paige_pending_confirmations") throw Error(`Unexpected service table ${table}`);
    const op: Operation = { kind: "select", columns: "*", filters: [] }; operations.push(op);
    let cap = Infinity;
    const matches = (row: Row) => op.filters.every(([kind, key, value, fourth]) => {
      const actual = row[String(key)];
      if (kind === "eq" || kind === "is") return actual === value;
      if (kind === "neq") return actual != null && actual !== value;
      if (kind === "not") return value === "is" ? actual !== fourth : false;
      if (kind === "gt") return typeof actual === "string" && actual > String(value);
      if (kind === "lte") return typeof actual === "string" && actual <= String(value);
      if (kind === "in") return Array.isArray(value) && value.includes(actual);
      throw Error(`Uncaptured predicate ${kind}`);
    });
    const project = (row: Row) => op.columns === "*" ? structuredClone(row) : Object.fromEntries(op.columns.split(",").map(key => [key, structuredClone(row[key])]));
    let executed: Promise<Reply> | undefined;
    const run = (single: boolean): Promise<Reply> => executed ??= Promise.resolve().then(() => {
      let selected: Row[];
      if (op.kind === "insert") { const row = { id: PROPOSAL, consumed_at: null, expires_at: "2099-01-01T00:00:00.000Z", ...structuredClone(op.values) }; rows.push(row); selected = [row]; }
      else {
        selected = rows.filter(matches).slice(0, cap);
        if (op.kind === "update") {
          const claim = op.filters.some(([kind, key]) => kind === "neq" && key === "issued_in_request");
          if (claim && controls.refuseClaim) return { data: null, error: { code: "transport", message: "claim unavailable" } };
          for (const row of selected) Object.assign(row, structuredClone(op.values));
          if (claim) {
            controls.afterClaim?.();
            if (controls.lostClaim) return { data: null, error: { code: "transport", message: "lost claim acknowledgement" } };
            if (controls.malformedClaim) return { data: controls.malformedClaim, error: null };
          }
        } else controls.afterSelect?.();
      }
      const result = selected.map(project); return { data: single ? result[0] ?? null : result, error: null };
    });
    const q = { select(columns: string) { op.columns = columns; return q; },
      update(values: Row) { op.kind = "update"; op.values = values; return q; }, insert(values: Row) { op.kind = "insert"; op.values = values; return q; },
      eq(key: string, value: unknown) { op.filters.push(["eq", key, value]); return q; }, is(key: string, value: unknown) { op.filters.push(["is", key, value]); return q; },
      neq(key: string, value: unknown) { op.filters.push(["neq", key, value]); return q; }, not(key: string, operator: string, value: unknown) { op.filters.push(["not", key, operator, value]); return q; },
      gt(key: string, value: unknown) { op.filters.push(["gt", key, value]); return q; }, lte(key: string, value: unknown) { op.filters.push(["lte", key, value]); return q; },
      in(key: string, value: unknown) { op.filters.push(["in", key, value]); return q; }, limit(value: number) { cap = value; return q; },
      single: () => run(true), maybeSingle: () => run(true), then: (resolve: (value: Reply) => unknown) => run(false).then(resolve) };
    return q;
  };
  return { rows, operations, controls, from };
}
type Options = { studio?: boolean; nonce?: string; source?: StudioPageSaveSource; write?: (name: string, args: Row) => Reply | Promise<Reply>; adoption?: Row };
async function invocation(db: ReturnType<typeof database>, options: Options = {}) {
  const rpc: Array<{ name: string; args: Row }> = [], invoked: string[] = [], logs: unknown[][] = [], adoptionCalls: Row[] = [];
  const authority = { current: true };
  const stop = new AbortController(), approvedConfirmations = new Set<string>();
  const caller = { functions: { invoke: async (name: string) => { invoked.push(name); return { data: { blocks: [{ type: "hero", title: "Generated" }], studio_source: options.source ?? nativeSource() }, error: null }; } },
    rpc: async (name: string, args: Row) => {
      rpc.push({ name, args });
      if (options.write && (name === "studio_save_page" || name === "studio_page_save_state")) return options.write(name, args);
      if (name === "studio_save_page") return { data: { ok: true, page: { id: PAGE, tenant_id: TENANT, slug: "existing-address", title: "Native title", status: "draft" }, version_id: VERSION, forms: [], changed: true, reconciled: false }, error: null };
      if (name === "growth_page_upsert") return { data: { id: PAGE, slug: "existing-address", title: "Original legacy", status: "draft" }, error: null };
      if (name === "link_session_artifact" || name === "save_artifact_version") return { data: VERSION, error: null };
      throw Error(`Uncaptured caller RPC ${name}`);
    }, from: (table: string) => {
      if (table !== "growth_pages" && table !== "growth_forms") throw Error(`Unexpected caller table ${table}`);
      const q = { select: () => q, eq: () => q, like: () => q, in: () => q, maybeSingle: async () => ({ data: { slug: "existing-address" }, error: null }),
        then: (resolve: (value: Reply) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }; return q;
    } };
  const env: Row = {
    req: { signal: stop.signal }, user: { id: ACTOR }, personaCtx: { tenant_id: TENANT }, payloadThreadId: THREAD, scopedClientId: null,
    requestNonce: options.nonce ?? NONCE1, turnScopeTenantId: TENANT, proposalScopeInvalidated: false, tenantKnowledgeScopeRevoked: false,
    interactive: { superseded: false, check: async () => undefined }, interactiveRecoveryReadOnly: false, interactiveConversational: false,
    studioSessionId: options.studio === false ? null : SESSION, canvasArtifact: { kind: "page", id: PAGE }, studioLinked: [], studioPreview: null,
    requestExecutionState: { needsReview: false }, supabase: { from: db.from }, supabaseClient: caller, admin: caller,
    callerTier: "tenant", calendarBookingAccountShape: "solo", customerPortal: false, cancellationsRecorded: true, approvedConfirmations,
    requireRecoveryPermission: async () => undefined, revalidateProposalScope: async () => authority.current && !stop.signal.aborted,
    confirmationWasConsumed: undefined, confirmFingerprint, confirmIdentityValue, unaddressableConfirmArgs, unaddressableArgsRefusal, UUID_INPUT_SHAPE,
    parseStudioPageSaveSource, sameStudioPageSaveSource, createStudioPageSave, artifactProduced, ARTIFACT_ABSENT_ERROR, parseScopedToken, storedRowState,
    PORTAL_REQUEST_SHARE_TOOL: PORTAL, CURA_TEACH_PURPOSE: "curated_teach", approvedReminderClaims: new Map(), stoppedReminderClaims: new Map(), portalRequestClaims: new Map(),
    validatedData: {}, runtimeIdentity: null, adoptApprovedReminder: async (args: Row) => { adoptionCalls.push(args); return options.adoption ?? { kind: "unsupported", proposalId: PROPOSAL }; },
    resumePin: new Map(), resumeTokens: new Map(), pipelineClaimToken: new Map(), approvalRefusals: new Map(), approvalChannel: new Map(), approvalSpend: new Map(), curaApprovedAct: new WeakMap(),
    outboundDraftRefusal: async () => null, describeConfirm: async () => "Review this exact page", console: { error: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) },
    ...(!hasClaims ? { studioPageClaims: new Map(), studioPageApprovedSaves: new WeakMap() } : {}),
  };
  // Functions are production AST, not restated confirmation logic. Test-only ports
  // stand in for already admitted proposal scope, recovery permission and transport.
  const code = `${ownership}\n${functions}
    return {
      async generate() { const tc={id:'generation',function:{name:'growth_page_generate',arguments:'{}'}},args={brief:'A public landing page'};let result;for(const once of [true]){${branch("growth_page_generate")}}return result; },
      async record(args,name='growth_page_save') {return recordConfirmation(await confirmFingerprint(name,args),name,args,'Review this exact page');},
      async claim(token,name='growth_page_save') {approvedConfirmations.add(token);return claimConfirmation(token,name);},
      async approve(tc,token) {approvedConfirmations.add(token);const approvedFingerprint=token,gateArgs=JSON.parse(tc.function.arguments),fp=await confirmFingerprint(tc.function.name,gateArgs),approvedSetAmbiguous=false,approvedSetLookupFailed=false,portalRequestPreparedSummary=null,toolResults=[];
        let dispatched=false,result;for(const once of [true]){${continuation} dispatched=true;const args=JSON.parse(tc.function.arguments);if(tc.function.name==='growth_page_save'){${branch("growth_page_save")}} ${common}}
        return {dispatched,result,outputs:toolResults.map(row=>JSON.parse(row.content))};},
      async dispatch(tc){const args=JSON.parse(tc.function.arguments);let result;for(const once of [true]){${branch("growth_page_save")}}${common}return result;},
      patch(change){for(const[key,value]of Object.entries(change)){if(key==='personaCtx')personaCtx=value;else if(key==='user')user=value;else if(key==='payloadThreadId')payloadThreadId=value;else if(key==='canvasArtifact')canvasArtifact=value;else if(key==='studioSessionId')studioSessionId=value;else if(key==='proposalScopeInvalidated')proposalScopeInvalidated=value;else if(key==='tenantKnowledgeScopeRevoked')tenantKnowledgeScopeRevoked=value;else if(key==='interactive')interactive=value;}},
      snapshot:()=>({claims:studioPageClaims,approved:studioPageApprovedSaves,map:studioPageSaves,needsReview:requestExecutionState.needsReview})
    };`;
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const runtime = await new Function(...Object.keys(env), `return(async()=>{${js}})();`)(...Object.values(env)) as Runtime;
  return { runtime, rpc, invoked, logs, adoptionCalls, stop, authority };
}
async function held(options: Options = {}) {
  const db = database(), first = await invocation(db, options); if (options.studio !== false) await first.runtime.generate();
  const args = input(), proposal = await first.runtime.record(args); expect(proposal.state).toBe("created");
  return { db, first, args, token: proposal.fingerprint as string, proposal };
}
const claims = (db: ReturnType<typeof database>) => db.operations.filter(op => op.kind === "update" && op.filters.some(([kind, key]) => kind === "neq" && key === "issued_in_request"));
const writes = (w: Awaited<ReturnType<typeof invocation>>) => w.rpc.filter(call => call.name === "studio_save_page");

describe("original confirmation → fresh Studio approval → original native writer", () => {
  it("atomically stores only the generation-bound private source without changing approved args, token or visible reply", async () => {
    const { db, first, args, proposal, token } = await held();
    expect(db.rows[0].args).toEqual(args); expect(db.rows[0].studio_page_save_source).toEqual(nativeSource());
    expect(db.operations.filter(op => op.kind === "insert")).toHaveLength(1);
    expect(token).toBe(`${await confirmFingerprint("growth_page_save", { intent: await confirmFingerprint("growth_page_save", args), tenant: TENANT, thread: THREAD, client: null })}:${NONCE1}`);
    expect(JSON.stringify(proposal)).not.toContain("project_context"); expect(JSON.stringify(first.logs)).not.toContain("studio_page_save_source");
  });
  it("restores the held source in a genuinely fresh invocation and saves exactly once without regeneration or common extra writes", async () => {
    const { db, args, token } = await held(), second = await invocation(db, { nonce: NONCE2 }), tc = tool();
    expect(second.runtime.snapshot().map.size).toBe(0);
    const result = await second.runtime.approve(tc, token);
    expect(result.result).toMatchObject({ success: true, page_id: PAGE, version_id: VERSION }); expect(result.outputs).toEqual([]);
    expect(JSON.parse(tc.function.arguments)).toEqual(args); expect(second.invoked).toEqual([]); expect(writes(second)).toHaveLength(1);
    expect(second.rpc.map(call => call.name)).toEqual(["studio_save_page"]); expect(Object.keys(writes(second)[0].args)).toHaveLength(13);
    expect(writes(second)[0].args).toMatchObject({ p_expected_tenant: TENANT, p_session_id: SESSION, p_expected_project_context: nativeSource().project_context, p_expected_artifact_refs: nativeSource().artifact_refs, p_expected_updated_at: DATE, p_expected_conversion: nativeSource().conversion, p_page_id: PAGE, p_title: args.title });
    expect(JSON.stringify(result)).not.toContain("project_context"); expect(claims(db)).toHaveLength(1);
  });
  it("retains every original scoped single-claim predicate and returns the private field only for Studio", async () => {
    const { db, token } = await held(), second = await invocation(db, { nonce: NONCE2 }); await second.runtime.approve(tool(), token);
    const claim = claims(db)[0]; expect(claim.columns.split(",")).toEqual(expect.arrayContaining(["args", "id", "fingerprint", "issued_in_request", "studio_page_save_source"]));
    expect(claim.values && Object.keys(claim.values)).toEqual(["consumed_at"]);
    expect(claim.filters).toEqual(expect.arrayContaining([["eq", "user_id", ACTOR], ["eq", "tenant_id", TENANT], ["eq", "thread_id", THREAD], ["is", "scoped_client_id", null], ["eq", "fingerprint", token.split(":")[0]], ["eq", "issued_in_request", NONCE1], ["eq", "tool_name", "growth_page_save"], ["is", "consumed_at", null], ["not", "server_issued_at", "is", null], ["not", "issued_in_request", "is", null], ["neq", "issued_in_request", NONCE2]]));
    expect(claim.filters.some(([kind, key]) => kind === "gt" && key === "expires_at")).toBe(true);
  });
  it.each([null, { ...nativeSource(), tenant_id: OTHER }, { ...nativeSource(), session_id: OTHER }, { ...nativeSource(), page_id: OTHER }])("legacy or foreign private metadata safely refuses dispatch %#", async metadata => {
    const { db, token } = await held(); db.rows[0].studio_page_save_source = metadata;
    const second = await invocation(db, { nonce: NONCE2 }), result = await second.runtime.approve(tool(), token);
    expect(result.result).toMatchObject({ success: false, not_applied: true }); expect(second.rpc).toEqual([]);
  });
  it.each([null, { ...nativeSource(), tenant_id: OTHER }])("an approved legacy/invalid source is an explicit NULL binding and cannot borrow a fresh generation %#", async metadata => {
    const { db, token } = await held(); db.rows[0].studio_page_save_source = metadata;
    const next = await invocation(db, { nonce: NONCE2 }); await next.runtime.generate(); expect(next.runtime.snapshot().map.size).toBe(1);
    const tc = tool(), result = await next.runtime.approve(tc, token);
    expect(next.runtime.snapshot().approved.has(tc)).toBe(true); expect(next.runtime.snapshot().approved.get(tc)).toBeNull();
    expect(result.result).toMatchObject({ success: false, not_applied: true }); expect(next.rpc).toEqual([]);
  });
  it("same approved args cannot silently reuse a proposal with a changed frozen source", async () => {
    const { db, args } = await held(), changed = nativeSource(); changed.project_context.values!.offers = "Changed after review";
    const next = await invocation(db, { nonce: NONCE2, source: changed }); await next.runtime.generate();
    expect((await next.runtime.record(args)).state).toBe("failed"); expect(db.operations.filter(op => op.kind === "insert")).toHaveLength(1);
    expect(db.operations.filter(op => op.kind === "update")).toHaveLength(1); // Original initial expiry sweep only.
  });
  it("an identical source reuses the exact original token and never renews the row", async () => {
    const { db, args, token } = await held(), next = await invocation(db, { nonce: NONCE2 }); await next.runtime.generate();
    expect(await next.runtime.record(args)).toMatchObject({ state: "exists", fingerprint: token }); expect(db.rows).toHaveLength(1);
    expect(db.rows[0].issued_in_request).toBe(NONCE1); expect(db.operations.filter(op => op.kind === "update")).toHaveLength(1);
  });
  it("native stale-context 40001 cannot fall back to the legacy writer or add a version", async () => {
    const { db, token } = await held(), second = await invocation(db, { nonce: NONCE2, write: async () => ({ data: null, error: { code: "40001", message: "private stale detail" } }) });
    const result = await second.runtime.approve(tool(), token); expect(result.result).toMatchObject({ success: false, not_applied: true });
    expect(second.rpc.map(call => call.name)).toEqual(["studio_save_page"]); expect(JSON.stringify(result)).not.toContain("private stale detail");
  });
  it("a lost claim ACK inspects only the same original binding once and never reclaims, reproposes or saves", async () => {
    const { db, token } = await held(); db.controls.lostClaim = true;
    const second = await invocation(db, { nonce: NONCE2 }); const one = await second.runtime.approve(tool(), token), two = await second.runtime.approve(tool("growth_page_save", "duplicate"), token);
    expect(one.outputs[0]).toMatchObject({ success: false, outcome_unknown: true }); expect(two.outputs[0]).toMatchObject({ success: false, outcome_unknown: true });
    expect(second.runtime.snapshot().needsReview).toBe(true); expect(second.rpc).toEqual([]); expect(claims(db)).toHaveLength(1); expect(db.rows).toHaveLength(1);
    const lookups = db.operations.filter(op => op.kind === "select" && op.columns === "consumed_at,expires_at"); expect(lookups).toHaveLength(1);
    expect(lookups[0].filters).toEqual(expect.arrayContaining([["eq", "user_id", ACTOR], ["eq", "tenant_id", TENANT], ["eq", "thread_id", THREAD], ["is", "scoped_client_id", null], ["eq", "tool_name", "growth_page_save"], ["eq", "fingerprint", token.split(":")[0]], ["eq", "issued_in_request", NONCE1]]));
  });
  it("a consumed approval cannot be dispatched twice, even with a duplicate model call", async () => {
    const { db, token } = await held(), second = await invocation(db, { nonce: NONCE2 }); await second.runtime.approve(tool(), token);
    const next = await second.runtime.approve(tool("growth_page_save", "duplicate"), token);
    expect(next.dispatched).toBe(false); expect(next.outputs[0]).toMatchObject({ not_applied: true, already_handled: true }); expect(writes(second)).toHaveLength(1); expect(claims(db)).toHaveLength(1);
  });
  it("ordinary non-Studio approval keeps exact stored arguments and legacy writer, with no private metadata", async () => {
    const { db, args, token } = await held({ studio: false }), next = await invocation(db, { studio: false, nonce: NONCE2 }), tc = tool();
    expect(db.rows[0]).not.toHaveProperty("studio_page_save_source"); expect((await next.runtime.approve(tc, token)).result).toMatchObject({ success: true, page_id: PAGE });
    expect(JSON.parse(tc.function.arguments)).toEqual(args); expect(next.rpc.map(call => call.name)).toEqual(["growth_page_upsert"]); expect(claims(db)[0].columns).toBe("args");
  });
  it("the controller is bound to the actual approved tc object; an identical clone cannot borrow it", async () => {
    const { db, token } = await held(), next = await invocation(db, { nonce: NONCE2 }), tc = tool();
    await next.runtime.approve(tc, token); const clone = structuredClone(tc);
    expect(next.runtime.snapshot().approved.has(tc)).toBe(true); expect(next.runtime.snapshot().approved.has(clone)).toBe(false);
    expect(await next.runtime.dispatch(clone)).toMatchObject({ success: false, not_applied: true }); expect(writes(next)).toHaveLength(1);
  });
  it("an approved frozen source takes precedence over this invocation's newer generation", async () => {
    const { db, token } = await held(), changed = nativeSource(); changed.project_context.values!.offers = "Newer unapproved context";
    const next = await invocation(db, { nonce: NONCE2, source: changed }); await next.runtime.generate();
    expect(next.runtime.snapshot().map.get(PAGE)?.source.project_context).toEqual(changed.project_context);
    const result = await next.runtime.approve(tool(), token); expect(result.result).toMatchObject({ success: true });
    expect(writes(next)[0].args.p_expected_project_context).toEqual(nativeSource().project_context); expect(writes(next)).toHaveLength(1);
  });
  it("scope withdrawal while checking reusable proposals refuses insertion before any expiry update", async () => {
    const db = database(), next = await invocation(db); await next.runtime.generate();
    db.controls.afterSelect = () => next.runtime.patch({ personaCtx: { tenant_id: OTHER } });
    expect((await next.runtime.record(input())).state).toBe("failed"); expect(db.rows).toEqual([]);
    expect(db.operations.every(op => op.kind === "select")).toBe(true);
  });
  it.each(["actor", "tenant", "Stop"])("withdrawn %s authority before approval never reaches a writer", async kind => {
    const { db, token } = await held(), next = await invocation(db, { nonce: NONCE2 });
    next.authority.current = false;
    if (kind === "actor") next.runtime.patch({ user: { id: OTHER } });
    if (kind === "tenant") next.runtime.patch({ personaCtx: { tenant_id: OTHER } });
    if (kind === "Stop") next.stop.abort();
    expect((await next.runtime.approve(tool(), token)).dispatched).toBe(false);
    expect(next.rpc).toEqual([]); expect(claims(db)).toHaveLength(0); expect(db.rows).toHaveLength(1);
  });
  it.each(["tenant", "Stop"])("withdrawn %s after the claim await cannot restore a private writer", async kind => {
    const { db, token } = await held(), next = await invocation(db, { nonce: NONCE2 });
    db.controls.afterClaim = () => { if (kind === "Stop") next.stop.abort(); else next.runtime.patch({ personaCtx: { tenant_id: OTHER } }); };
    const tc = tool(); await next.runtime.approve(tc, token);
    expect(next.rpc).toEqual([]); expect(next.runtime.snapshot().approved.get(tc)).toBeNull();
    next.runtime.patch({ personaCtx: { tenant_id: TENANT } });
    expect(await next.runtime.dispatch(tc)).toMatchObject({ success: false, not_applied: true }); expect(next.rpc).toEqual([]);
  });
  it("lost native save ACK uses the original frozen read-only state request and never replays the save", async () => {
    const { db, token } = await held(), next = await invocation(db, { nonce: NONCE2, write: async name => name === "studio_save_page"
      ? { data: null, error: { message: "lost native ACK" } } : { data: { ok: false, code: "unknown" }, error: null } });
    const tc = tool(), result = await next.runtime.approve(tc, token);
    expect(result.result).toMatchObject({ success: false, outcome_unknown: true }); expect(next.runtime.snapshot().needsReview).toBe(true);
    expect(next.rpc.map(call => call.name)).toEqual(["studio_save_page", "studio_page_save_state"]); expect(next.rpc[1].args).toEqual(next.rpc[0].args);
    await next.runtime.dispatch(tc); expect(writes(next)).toHaveLength(1);
  });
  it("a refused service claim remains unknown and never creates a replacement proposal", async () => {
    const { db, token } = await held(); db.controls.refuseClaim = true;
    const next = await invocation(db, { nonce: NONCE2 }); await next.runtime.approve(tool(), token); await next.runtime.approve(tool("growth_page_save", "again"), token);
    expect(claims(db)).toHaveLength(1); expect(db.rows).toHaveLength(1); expect(db.rows[0].consumed_at).toBeNull(); expect(next.rpc).toEqual([]); expect(next.runtime.snapshot().needsReview).toBe(true);
    expect(db.operations.filter(op => op.columns === "consumed_at,expires_at")).toHaveLength(1);
  });
  it.each([{ id: "bad-id" }, { fingerprint: "0000000000000000" }, { issued_in_request: OTHER }])("unverified claim-returned identity cannot seed a controller %#", async change => {
    const { db, token, args } = await held(); db.controls.malformedClaim = { id: PROPOSAL, fingerprint: token.split(":")[0], issued_in_request: NONCE1, args, studio_page_save_source: nativeSource(), ...change };
    const next = await invocation(db, { nonce: NONCE2 }), tc = tool(); await next.runtime.approve(tc, token);
    expect(next.runtime.snapshot().approved.get(tc)).toBeNull(); expect(next.rpc).toEqual([]);
  });
  it("a model-supplied private source cannot replace an absent owning generation source", async () => {
    const db = database(), next = await invocation(db);
    const args = { ...input(), studio_page_save_source: nativeSource(), studio_source: nativeSource() };
    expect((await next.runtime.record(args)).state).toBe("failed"); expect(db.operations.filter(op => op.kind === "insert")).toEqual([]);
  });
  it("the original non-Studio reminder compatibility path keeps its exact selected proposal ID CAS", async () => {
    const db = database(), first = await invocation(db, { studio: false }), args = { title: "Follow up", remind_at: "2099-01-01T10:00:00Z" };
    const row = await first.runtime.record(args, "plan_set_reminder"), next = await invocation(db, { studio: false, nonce: NONCE2 });
    expect(await next.runtime.claim(row.fingerprint as string, "plan_set_reminder")).toEqual(args);
    expect(next.adoptionCalls).toHaveLength(1); expect(next.adoptionCalls[0]).toMatchObject({ selectedProposal: { id: PROPOSAL, issuedNonce: NONCE1, args }, confirmationRequestNonce: NONCE2 });
    expect(claims(db)[0].filters).toContainEqual(["eq", "id", PROPOSAL]); expect(claims(db)[0].columns).toBe("args"); expect(db.rows[0]).not.toHaveProperty("studio_page_save_source");
  });
  it("the original portal claim retains its scope and claimed-in-request marker without Studio metadata", async () => {
    const db = database(), first = await invocation(db, { studio: false }), args = { request_id: PAGE };
    const row = await first.runtime.record(args, PORTAL), next = await invocation(db, { studio: false, nonce: NONCE2 });
    expect(await next.runtime.claim(row.fingerprint as string, PORTAL)).toEqual(args);
    expect(claims(db)[0].columns).toBe("args,id,fingerprint,thread_id,scoped_client_id"); expect(claims(db)[0].values).toMatchObject({ claimed_in_request: NONCE2 });
    expect(db.rows[0]).not.toHaveProperty("studio_page_save_source"); expect(next.rpc).toEqual([]);
  });
});

// Deterministic data boundary for the Operations release harness (E09 Slice 4, 4B).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Morgan Lee",
// "Sam Okafor", "Jordan Rivera"); the signed-in Operations sheet against the real operations_delivery_* RPCs on a
// seeded test tenant with a second team member and a Studio text version is owed (§32/§70.1).
//
// The RPCs answer in exactly the shapes the parsers in src/solo/operations/operations-delivery-staff.ts and
// operations-delivery-source.ts accept (they refuse anything else, so a wrong shape here shows as "unavailable", not
// as a pass), from a small store the writers mutate so a drive can go picker → confirm → submitted:
//   operations_delivery_list_scoped / _client_status_scoped / _artifact_scoped (reads)
//   operations_delivery_submit_scoped / _review_scoped / _release_scoped (writes, version-checked)
//   list_studio_sessions / list_artifact_versions / current_user_tenant_id (Studio source reads)
//   is_tenant_admin, plan_item_activity_scoped (the sheet's own small reads)
//
//   ?state=single|picker|confirm|submitted|in-review|approved|release-confirm|released|accepted|client-changes|
//          people-loading|reading|unavailable
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "picker";

export const TENANT = "e4000000-0000-4000-8000-00000000aaaa";
export const ACTOR = "e0900000-0000-4000-8000-00000000f001"; // Morgan Lee, the business owner, signed in
const SAM = "e0900000-0000-4000-8000-00000000f002"; // Sam Okafor, a second member of the team
const INVITED = "e0900000-0000-4000-8000-00000000f003"; // invited, not yet active: never a reviewer
export const CLIENT = "e4000000-0000-4000-8000-0000000c0001"; // Jordan Rivera
const PLAN = "e4000000-0000-4000-8000-0000000a0001";
export const ITEM = "e4000000-0000-4000-8000-0000000b0001";
export const ITEM_TITLE = "Final brand guidelines";
const SESSION = "e4000000-0000-4000-8000-0000000d0001";
const ARTIFACT = "e4000000-0000-4000-8000-0000000e0001";
const V1 = "e4000000-0000-4000-8000-0000000f0001", V2 = "e4000000-0000-4000-8000-0000000f0002";
const DIGEST = "3f1c".repeat(16);
const ITEM_VERSION = "2026-10-14T13:05:00.000000+00:00";

const member = (user_id: string, full_name: string, status = "active", is_owner = false): TeamMemberRecord => ({
  membership_id: `m-${user_id}`, user_id, full_name, email: null, avatar_url: null, status,
  permission: (is_owner ? "owner" : "member") as TeamMemberRecord["permission"], is_owner,
  job_title: null, responsibilities: null, last_sign_in_at: null,
});
const team: TeamMemberRecord[] = state === "single"
  ? [member(ACTOR, "Morgan Lee", "active", true), member(INVITED, "Riley Park", "invited")]
  : [member(ACTOR, "Morgan Lee", "active", true), member(SAM, "Sam Okafor"), member(INVITED, "Riley Park", "invited")];

export const harness = { reads: 0, writes: [] as Array<{ name: string; args: Record<string, unknown> }>, invokes: 0 };
(window as unknown as { __harness: typeof harness }).__harness = harness;

// ── Planning: one client project with one piece of client work in it ─────────────────────────────────
const finished = ["approved", "release-confirm", "released", "accepted", "client-changes"].includes(state);
const item: PlanItem = {
  id: ITEM, tenant_id: TENANT, plan_id: PLAN, item_type: "milestone", assigned_to_user_id: SAM, contact_id: CLIENT,
  title: ITEM_TITLE, summary: "The full guidelines document for Jordan's sign-off: type, colour, logo use and voice.",
  status: finished ? "done" : "in_progress", priority: "high", due_at: "2026-10-20T15:00:00+00:00", remind_at: null,
  remind_target: null, reminded_at: null, created_by: ACTOR, linked_action_id: null, updated_at: ITEM_VERSION,
};
const plan: Plan = {
  id: PLAN, tenant_id: TENANT, title: "Rivera Design brand launch", summary: null, horizon: "quarter", scope: "team",
  status: "active", starts_on: "2026-09-01", ends_on: "2026-11-30", owner_user_id: ACTOR, created_by: ACTOR, items: [item],
  updated_at: "2026-10-01T09:00:00.000000+00:00",
};
export function usePlanList() {
  return { plans: [plan], looseItems: [], allItems: [item], loading: false, error: null, forbidden: false, userId: ACTOR, refresh: async () => undefined };
}
export function useOperationsPeople() {
  const loading = state === "people-loading";
  return { members: loading ? [] : team.filter(m => m.status === "active"), loading, error: null, partial: false, refresh: async () => undefined };
}
export function useOperationsCrmWork() {
  return { tasks: [], loading: false, error: null, forbidden: false, hasMore: false, refresh: async () => undefined, readTask: async () => null };
}
export function useTenantContext() {
  return {
    activeTenantId: TENANT, activeUserId: ACTOR, loading: false, accountContextLoading: false, accountContextStatus: "ready",
    activeTenant: { id: TENANT, name: "Northwind Studio", account_type: "standalone", parent_tenant_id: null },
    isPlatformOwner: false, isPlatformStaff: false, refresh: () => undefined,
  };
}
export const useOptionalTenantContext = useTenantContext;
export function useTierFeatures() {
  return { has: () => true, tierKey: "solo", soloStandalone: true, loading: false };
}

// ── The delivery store ──────────────────────────────────────────────────────────────────────────────
type Submission = {
  id: string; tenant_id: string; work_item_id: string; plan_id: string; client_id: string; artifact_version_id: string;
  artifact_digest: string; revision_no: number; submitted_by: string; submitted_at: string; reviewer_user_id: string;
  state: "in_review" | "revision_requested" | "approved"; review_note: string | null; reviewed_by: string | null;
  reviewed_at: string | null; updated_at: string;
};
type Release = {
  release_id: string; submission_id: string; state: "awaiting_client" | "client_revision_requested" | "accepted";
  released_by: string; released_at: string; decision_by: string | null; decision_at: string | null; client_note: string | null; updated_at: string;
};
let tick = 0;
const stamp = () => `2026-10-14T14:${String(10 + tick++).padStart(2, "0")}:00.000000+00:00`;
const submission = (o: Partial<Submission>): Submission => ({
  id: "e4000000-0000-4000-8000-000000110001", tenant_id: TENANT, work_item_id: ITEM, plan_id: PLAN, client_id: CLIENT,
  artifact_version_id: V2, artifact_digest: DIGEST, revision_no: 1, submitted_by: SAM, submitted_at: "2026-10-13T16:00:00.000000+00:00",
  reviewer_user_id: ACTOR, state: "in_review", review_note: null, reviewed_by: null, reviewed_at: null,
  updated_at: "2026-10-13T16:00:00.000000+00:00", ...o,
});
const approved = { state: "approved" as const, reviewed_by: ACTOR, reviewed_at: "2026-10-13T18:00:00.000000+00:00", updated_at: "2026-10-13T18:00:00.000000+00:00" };
const release = (o: Partial<Release>): Release => ({
  release_id: "e4000000-0000-4000-8000-000000120001", submission_id: "e4000000-0000-4000-8000-000000110001", state: "awaiting_client",
  released_by: ACTOR, released_at: "2026-10-13T19:00:00.000000+00:00", decision_by: null, decision_at: null, client_note: null,
  updated_at: "2026-10-13T19:00:00.000000+00:00", ...o,
});
const CLIENT_USER = "e0900000-0000-4000-8000-00000000c001";
const submissions: Submission[] = ["in-review"].includes(state) ? [submission({})]
  : ["approved", "release-confirm", "released", "accepted", "client-changes"].includes(state) ? [submission(approved)] : [];
const releases: Release[] = state === "released" ? [release({})]
  : state === "accepted" ? [release({ state: "accepted", decision_by: CLIENT_USER, decision_at: "2026-10-14T10:30:00.000000+00:00", updated_at: "2026-10-14T10:30:00.000000+00:00" })]
  : state === "client-changes" ? [release({ state: "client_revision_requested", decision_by: CLIENT_USER, decision_at: "2026-10-14T10:30:00.000000+00:00",
    client_note: "Could the logo clear-space section show the dark-background version too?", updated_at: "2026-10-14T10:30:00.000000+00:00" })] : [];

const BODY = `Rivera Design — brand guidelines

1. Logo
Use the full wordmark wherever it has room. Keep clear space equal to the height of the R on every side.

2. Colour
Harbour blue leads; sand and charcoal support it. Never place the wordmark on a photograph without a solid panel.

3. Type
Headlines in the display face at tight tracking; body copy in the text face at 16px or larger.

4. Voice
Plain, warm, specific. Say what the studio does for the client, not what it is.`;
const versions = [
  { id: V2, version_no: 2, title: "Brand guidelines — final", body: BODY, created_at: "2026-10-13T15:30:00.000000+00:00" },
  { id: V1, version_no: 1, title: "Brand guidelines — first draft", body: "Rivera Design — brand guidelines (first draft)\n\nLogo, colour and type, outlined for review.", created_at: "2026-10-08T11:00:00.000000+00:00" },
];

const never = () => new Promise<never>(() => undefined);
const reply = (data: unknown, error: unknown = null) => ({ data, error });
type Reply = { data: unknown; error: unknown };
const builder = (work: () => Promise<Reply>) => {
  const p = work();
  return { then: p.then.bind(p), catch: p.catch.bind(p), abortSignal() { return this; } };
};

async function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
  await new Promise(r => setTimeout(r, 30));
  switch (name) {
    case "current_user_tenant_id": return reply(TENANT);
    case "is_tenant_admin": case "is_tenant_member": return reply(true);
    case "plan_item_activity_scoped":
      return reply({ ok: true, item_id: args.p_item_id, tenant_id: TENANT, actor_id: ACTOR, events: [] });
    case "list_studio_sessions":
      if (state === "reading") return never();
      return reply([{ id: SESSION, tenant_id: TENANT, title: "Rivera Design brand launch", artifact_refs: [
        { id: ARTIFACT, kind: "content", title: "Brand guidelines" },
        { id: "e4000000-0000-4000-8000-0000000e0002", kind: "page", title: "Launch landing page" },
      ] }]);
    case "list_artifact_versions":
      return reply(versions.map(v => ({ id: v.id, tenant_id: TENANT, session_id: SESSION, lineage_id: ARTIFACT, kind: "content",
        version_no: v.version_no, created_at: v.created_at, snapshot: { kind: "text", title: v.title, body: v.body } })));
    case "operations_delivery_list_scoped": {
      harness.reads++;
      if (state === "reading") return never();
      if (state === "unavailable") return reply(null, { code: "PGRST301", message: "harness: read refused" });
      return reply({ work_item_id: ITEM, submissions: submissions.map(s => ({ ...s })) });
    }
    case "operations_delivery_client_status_scoped":
      return reply({ work_item_id: ITEM, client_releases: releases.map(r => ({ ...r })) });
    case "operations_delivery_artifact_scoped": {
      const s = submissions.find(x => x.id === args.p_submission_id);
      const v = versions.find(x => x.id === s?.artifact_version_id);
      if (!s || !v) return reply(null, { code: "P0002", message: "not found" });
      return reply({ actor_id: ACTOR, tenant_id: TENANT, submission_id: s.id, work_item_id: ITEM, plan_id: PLAN, client_id: CLIENT,
        artifact_version_id: s.artifact_version_id, artifact_digest: s.artifact_digest, revision_no: s.revision_no, submitted_by: s.submitted_by,
        title: v.title, body: v.body, state: s.state, updated_at: s.updated_at, reviewer_user_id: s.reviewer_user_id });
    }
    case "operations_delivery_submit_scoped": {
      harness.writes.push({ name, args });
      const revision = submissions.length + 1;
      if (args.p_expected_revision_no !== submissions.length || args.p_expected_work_updated_at !== ITEM_VERSION) return reply(null, { code: "40001", message: "changed" });
      const at = stamp();
      const row = submission({ id: `e4000000-0000-4000-8000-0000001100${String(10 + revision)}`, revision_no: revision, artifact_version_id: String(args.p_artifact_version_id),
        submitted_by: ACTOR, reviewer_user_id: String(args.p_reviewer_user_id), submitted_at: at, updated_at: at });
      submissions.unshift(row);
      return reply({ ok: true, submission_id: row.id, state: "in_review", revision_no: revision });
    }
    case "operations_delivery_review_scoped": {
      harness.writes.push({ name, args });
      const s = submissions.find(x => x.id === args.p_submission_id);
      if (!s || s.updated_at !== args.p_expected_updated_at) return reply(null, { code: "40001", message: "changed" });
      Object.assign(s, { state: args.p_decision, review_note: args.p_note ?? null, reviewed_by: ACTOR, reviewed_at: stamp(), updated_at: stamp() });
      return reply({ ok: true, submission_id: s.id, state: s.state });
    }
    case "operations_delivery_release_scoped": {
      harness.writes.push({ name, args });
      const s = submissions.find(x => x.id === args.p_submission_id);
      if (!s || s.updated_at !== args.p_expected_updated_at || s.state !== "approved") return reply(null, { code: "40001", message: "changed" });
      const at = stamp();
      releases.push(release({ submission_id: s.id, released_at: at, updated_at: at }));
      return reply({ ok: true, release_id: releases[releases.length - 1].release_id, state: "awaiting_client" });
    }
    default:
      return reply(null, { code: "PGRST202", message: `harness: ${name} is not stubbed` });
  }
}

const emptyQuery = () => {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const k of ["select", "eq", "neq", "in", "is", "order", "limit", "range", "gte", "lte", "lt", "gt", "or", "filter", "match", "abortSignal"]) q[k] = self;
  q.maybeSingle = async () => reply(null);
  q.single = async () => reply(null);
  q.then = (resolve: (v: Reply) => unknown) => Promise.resolve(reply([])).then(resolve);
  return q;
};

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => builder(() => rpc(name, args)),
  from: () => emptyQuery(),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: ACTOR }, access_token: "harness" } }, error: null }),
    getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
  functions: { invoke: async () => { harness.invokes++; return reply(null, { message: "harness: no functions" }); } },
  channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe: () => undefined }),
  removeChannel: () => undefined,
};

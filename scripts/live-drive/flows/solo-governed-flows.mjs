// scripts/live-drive/flows/solo-governed-flows.mjs
//
// The concrete governed-flow DEFINITIONS for the Solo test tenant, plus a runner entry.
//
// These are DATA (id/title/actor/tenantRef/steps) expressed in the proof-lane vocabulary. Each step
// names what the authenticated run must prove (`intent`), the surface `path` it drives (resolved
// against LIVE_DRIVE_URL — never a hardcoded prod host), and the `expect` the runner classifies.
// The negative flows (tenant isolation, approval, account switch) assert that a GUARD HELD, which is
// how they prove isolation rather than hide a hole.
//
// WHAT RUNNING THIS DOES (§13/§32.c). With the approved CI secrets set (LIVE_DRIVE_URL +
// LIVE_DRIVE_EMAIL + LIVE_DRIVE_PASSWORD for the least-privilege Solo test tenant), a capable
// session gets a real authenticated drive per flow and a VERIFIED/PARTIAL record. WITHOUT them — the
// headless CI/remote case — `runFlow` returns PROOF_OWED for every flow WITHOUT launching a browser,
// and this entry writes those owed records so the gap is visible and attributable, never a fake pass.
// A capable session fills each step's `assert(page, markers)` with the real marker logic when it
// first drives the provisioned tenant; the definitions and the honest owed records exist now.
//
// SCOPE FENCE (owner rule, 2026-09-12). No step sends, publishes, spends, bills, calls a paid
// provider, or mutates real-client data. Mutations are confined to clearly test-only records on the
// isolated Solo test tenant, each with a cleanup path. External comms/publication/payments/provider
// actions are OUTSIDE this automated proof scope unless separately authorized.

import { runFlow, writeProofRecord, summarize, STEP_EXPECT, ENV } from "../proof-lane.mjs";
import { liveDrive } from "../live-drive.mjs";

/**
 * The flow library. Each flow is a pure data definition. `path` is relative and resolved against
 * LIVE_DRIVE_URL by the authenticated run; `intent` is the assertion a capable session wires.
 */
// Every RENDER step below is `semantic: true` — its intent (a session actually opened, a contact
// was actually created, a capability claim is honest, a save actually succeeded) is NOT proven by
// mere navigation. A capable session must wire an assert that sets `markers.rendered=true` (and an
// `auth.successSelector`) for these to reach VERIFIED; until then they stay UNVERIFIED/PARTIAL, never
// a hollow pass (§39 Finding 1 / §13). Negative steps prove a guard held and need their own markers.
export const FLOWS = [
  {
    id: "contact-create-governed",
    title: "Governed contact create → readback → receipt/Rail (the reference vertical)",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in to the Solo surface", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login",
        intent: "the authenticated session opens for the least-privilege test owner" },
      { name: "create a test-only contact via the governed tool", expect: STEP_EXPECT.RENDER, semantic: true, path: "/command-center",
        intent: "crm_create_contact runs through the governed door; a genuine insert is reported as created (§947)" },
      { name: "fresh readback shows the contact persisted", expect: STEP_EXPECT.READBACK, path: "/clients",
        intent: "a re-read (not the toast) shows the test contact; marker persisted=true" },
      { name: "owner-visible receipt + client Rail row", expect: STEP_EXPECT.RENDER, semantic: true, path: "/clients",
        intent: "the per-client Rail row + capability-run receipt for the create are visible to the owner" },
    ],
  },
  {
    id: "tenant-isolation",
    title: "Authenticated tenant isolation — another tenant's record is denied",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in to the Solo surface", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login",
        intent: "the test owner's session opens" },
      { name: "attempt to read a record owned by a DIFFERENT tenant", expect: STEP_EXPECT.DENIED, path: "/clients",
        intent: "by-id access to a foreign tenant's contact is refused (401/403/empty) — marker refused=true; a SUCCESS is a §9 hole" },
    ],
  },
  {
    id: "capability-truth",
    title: "Capability truth — Paige reports honest availability, never a fabricated capability",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login", intent: "session opens" },
      { name: "ask what Paige can do here", expect: STEP_EXPECT.RENDER, semantic: true, path: "/",
        intent: "capability_status returns live/needs_approval/needs_setup/unavailable honestly for real tools only" },
    ],
  },
  {
    id: "approval-behavior",
    title: "Approval behavior — a high-risk act is gated, nothing executes unattended",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login", intent: "session opens" },
      { name: "ask Paige to take a high-risk governed action", expect: STEP_EXPECT.APPROVAL_REQUIRED, path: "/",
        intent: "a rendered approval card appears and the act does NOT execute until approved — marker approvalShown=true, executed=false" },
    ],
  },
  {
    id: "readback-persistence",
    title: "Readback — a saved change survives a reload, not just a toast",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login", intent: "session opens" },
      { name: "change a test-only setting and save", expect: STEP_EXPECT.RENDER, semantic: true, path: "/settings",
        intent: "a governed write on a test-only field succeeds" },
      { name: "reload and confirm the value held", expect: STEP_EXPECT.READBACK, path: "/settings",
        intent: "fresh read shows the saved value; marker persisted=true (guards the 'Saved.' that discards the write)" },
    ],
  },
  {
    id: "retry-idempotency",
    title: "Retry — a transient failure recovers with no double effect",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login", intent: "session opens" },
      { name: "retry a governed action after a simulated transient failure", expect: STEP_EXPECT.RETRY_SUCCEEDS, path: "/command-center",
        intent: "the retry succeeds and the idempotency key folds it to ONE effect — marker recovered=true, doubleEffect=false" },
    ],
  },
  {
    id: "account-switch-isolation",
    title: "Account switch — switching workspace shows no cross-tenant bleed",
    actor: "solo-test-owner",
    steps: [
      { name: "sign in", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login", intent: "session opens" },
      { name: "switch the active workspace and re-read", expect: STEP_EXPECT.ACCOUNT_SWITCH_ISOLATED, path: "/command-center",
        intent: "after the switch, no record from the prior tenant is visible — marker crossTenantBleed=false" },
    ],
  },
  {
    // Experience 04 E4-S2 owner acceptance (2026-10-13). Run on the OFFICIAL QA account — the owner's
    // existing Solo customer account (PC-1 superseded) — with ordinary customer sign-in, never Operator
    // access. The ONE mutation is that account's own business time zone, set to the owner's real zone
    // (reversible: Setup › Business profile › Business time zone). No client record, payment, message
    // or provider is touched. INT-346 stays staged: PAIGE reads and checks the zone in chat; the owner
    // saves it in Setup. Paths are relative to /solo/<account>; the runner resolves the account.
    id: "exp04-business-time-zone-acceptance",
    title: "E4-S2 — chat ready, PAIGE resolves the zone, owner confirms, saved, read back, used for due dates, survives re-entry",
    actor: "solo-qa-owner",
    steps: [
      { name: "1. sign in as the Solo owner", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login",
        intent: "ordinary customer sign-in opens the owner's Solo workspace (not Operator, not a support session)" },
      { name: "2. PAIGE Chat finishes initializing", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account",
        intent: "within 10 s 'Loading your conversations before you can write to PAIGE.' is gone and the composer accepts text — markers composerWritable=true, loadingMs recorded; if it never clears, record the paige_chat_threads request status/timing (the one dependency) and stop" },
      { name: "3. the owner asks to change the business time zone", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account",
        intent: "owner types e.g. 'My business runs on Chicago time' — PAIGE calls read_business_time_zone (step label 'Checking your business time zone') and states the current setting" },
      { name: "4. PAIGE offers the correct validated IANA zone", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account",
        intent: "PAIGE names America/Chicago (Central Time) with its local time, asks the owner to confirm, says it is NOT saved yet and points to Setup › Business profile › Business time zone — marker claimedSaved=false" },
      { name: "5. the owner confirms the change", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account/settings/setup/business-profile",
        intent: "owner picks Chicago, sees 'Save Central Time — America/Chicago?', presses Save time zone; typing 'Denver' must not highlight UTC (word matching)" },
      { name: "6. the setting persists and reads back", expect: STEP_EXPECT.READBACK, path: "/solo/:account/settings/setup/business-profile",
        intent: "'Saved and read back from your business record: America/Chicago.' appears, and a page reload still shows Central Time · Chicago — marker persisted=true" },
      { name: "7. payment due-date reporting uses the saved zone", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account",
        intent: "owner asks 'where does <a client> stand?' — the answer names the business time zone America/Chicago and judges due/overdue (no 'due dates are on hold'); with no client records it says so plainly and never invents money" },
      { name: "8. logout and re-entry keep the setting", expect: STEP_EXPECT.READBACK, path: "/solo/:account/settings/setup/business-profile",
        intent: "sign out, sign back in, open Setup — Central Time · Chicago is still shown; asking PAIGE again reports America/Chicago — marker persisted=true" },
    ],
  },
  {
    // Experience 04 E4-S3 PR beta (journey §16.4). Read-only on the official Solo QA account: looking at
    // Setup, Collections and a client record must write nothing to the Rail; PAIGE's answer writes one
    // line; Collections and the client record judge Overdue on the business calendar and agree. The
    // only mutation is the same reversible business time zone save as the flow above. No payment,
    // message, provider or client record is created or changed.
    id: "exp04-pr-beta-business-calendar-acceptance",
    title: "E4-S3 beta — no Rail line for looking, one for PAIGE's answer; Collections and the client record On hold, then Overdue on the business calendar",
    actor: "solo-qa-owner",
    steps: [
      { name: "1. sign in as the Solo owner", expect: STEP_EXPECT.RENDER, semantic: true, path: "/login",
        intent: "ordinary customer sign-in opens the owner's Solo workspace" },
      { name: "2. note the Rail", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account/command-center",
        intent: "record the newest Rail row (title, actor, time) — marker railBefore" },
      { name: "3. look, without acting", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account/settings/setup/business-profile",
        intent: "open Setup › Business profile twice, Sales › Payments › Collections once and Clients › People › a client once" },
      { name: "4. the Rail is unchanged", expect: STEP_EXPECT.READBACK, path: "/solo/:account/command-center",
        intent: "no new Rail row since railBefore — marker railRowsAdded=0" },
      { name: "5. with no business time zone, both surfaces hold", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account/sales/payments?view=collections",
        intent: "Collections Overdue and Upcoming read 'On hold' (never 0) with 'Set your business time zone'; the client record's 'Where … stands' reads 'On hold until the business time zone is set' with the setting link — skip if the zone is already set" },
      { name: "6. ask PAIGE where the client stands", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account",
        intent: "the answer shows 'Checked where that client stands' and its links; the Rail gains exactly one 'Checked where a client stands' row credited to PAIGE — marker railRowsAdded=1" },
      { name: "7. after the zone is saved, both surfaces judge on the business calendar", expect: STEP_EXPECT.RENDER, semantic: true, path: "/solo/:account/sales/payments?view=collections",
        intent: "Collections' coverage line names the saved zone and today's business date; an unbound past-due invoice reads 'Overdue · {date}' and the client record's Overdue figure agrees (a terms-bound invoice is judged on its schedule on the record — expected, not a defect)" },
      { name: "8. reload and re-entry", expect: STEP_EXPECT.READBACK, path: "/solo/:account/clients/people",
        intent: "after reload and sign-out/in the same standing and Collections judgements return; still no Rail row for looking" },
    ],
  },
];

/** Resolve each step's relative `path` against the configured base URL for the authenticated run. */
function withResolvedUrls(flow, baseUrl) {
  if (!baseUrl) return flow;
  const base = baseUrl.replace(/\/+$/, "");
  return { ...flow, steps: flow.steps.map((s) => ({ ...s, url: s.path ? base + s.path : s.url })) };
}

/** Run every flow and write its proof record. Honest: PROOF_OWED when this session cannot drive. */
export async function runAll(env = process.env) {
  const baseUrl = env[ENV.URL];
  const records = [];
  for (const def of FLOWS) {
    const rec = await runFlow(withResolvedUrls(def, baseUrl), { env, liveDrive });
    const out = writeProofRecord(rec);
    records.push({ rec, out });
    console.log(summarize(rec) + `  → ${out}`);
  }
  return records;
}

// Entry: `node scripts/live-drive/flows/solo-governed-flows.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const records = await runAll();
  const verified = records.filter((r) => r.rec.status === "VERIFIED").length;
  const owed = records.filter((r) => r.rec.status === "PROOF_OWED").length;
  console.log(`\nproof-lane: ${records.length} flows · VERIFIED ${verified} · PROOF_OWED ${owed}`);
  if (owed > 0 && verified === 0) {
    console.log(
      "↷ All flows PROOF_OWED — no authenticated run was possible in this session. This is the honest\n" +
      "  outcome (§13) when the Solo test tenant creds are not set / the surface is unreachable headless.\n" +
      "  Unblock: provision the least-privilege Solo test tenant and set LIVE_DRIVE_URL + LIVE_DRIVE_EMAIL +\n" +
      "  LIVE_DRIVE_PASSWORD in the approved CI secret mechanism, then re-run from a capable session.",
    );
  }
  // Exit 0 regardless: an owed proof is a truthful record, not a build failure. A capable session's
  // run turns PROOF_OWED into VERIFIED/PARTIAL and a real failure there exits non-zero via its own gate.
  process.exit(0);
}

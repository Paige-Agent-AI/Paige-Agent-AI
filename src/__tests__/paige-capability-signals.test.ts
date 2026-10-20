/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper, loaded through a transpile port. */
// @vitest-environment node
//
// Piece 3b — the capability SIGNAL builder + decision core, the manifest Paige answers "what can
// you do here?" from (§13/§36/§70). Two honesty directions are pinned here:
//   - ANTI-OVER-CLAIM: an action whose governed seam is NOT registered / not wired into chat (social
//     publish, SMS send, team manage, skills-in-chat, secure browser) resolves to "planned" — Paige
//     says it's not something she can do here yet, never implies she can, never claims it doesn't exist.
//   - ANTI-UNDER-CLAIM (the 2026-09-12 completion): the genuinely-governed chat capabilities that were
//     previously omitted — research, document creation, save-to-knowledge, planning, delegation — are
//     modeled now, each grounded in its real lane / provider signal.
//
// Tested on the REAL pure modules loaded through the transpile port (both import ONLY types).
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect } from "vitest";

function port(path: string) {
  const src = readFileSync(path, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: any = {};
  // Both modules import ONLY types (erased by TS). A value import here would throw.
  new Function("require", "exports", js)((k: string) => { throw new Error(`unexpected runtime import: ${k}`); }, out);
  return out;
}

const { buildCapabilitySignals } = port("supabase/functions/_shared/paige-capability-status/signals.ts");
const { resolveCapabilityStatus } = port("supabase/functions/_shared/paige-capability-status/resolver.ts");
// action-risk.ts is fully self-contained (no imports), so it ports through the same loader.
const { clampLaneByRisk } = port("supabase/functions/_shared/action-risk.ts");

// The facts a FRESH SOLO TENANT actually produces: a non-client admin tier, every mutating lane on
// the safe default (confirm), every REGISTERED read/mutate seam PARTIAL (their real registry
// maturity), every UNREGISTERED action family null (no governed seam), n8n not connected, and no
// research provider configured. The edge dispatch resolves these from the verified JWT / env; here
// they are spelled out so the assertions are about the HONEST ANSWER a fresh Solo owner is told.
const freshSolo = (over: Record<string, unknown> = {}) => ({
  callerTier: "tenant",
  contactCreateLane: "confirm",
  journeyAdvanceLane: "confirm",    // crm_advance_journey_stage — the native journey write (Layer C · C2)
  ownerTaskLane: "confirm",
  ownerTaskEligible: true,          // an explicitly verified active owner/admin tenant seat
  campaignCreateLane: "confirm",
  workflowsLane: "confirm",
  documentCreateLane: "confirm",
  knowledgeSaveLane: "confirm",
  planningCreateLane: "confirm",
  delegateLane: "confirm",          // high-risk ⇒ ceiling clamps away from auto
  integrationsListMaturity: "PARTIAL",
  pipelineEvidenceMaturity: "PARTIAL",
  commsReadMaturity: "PARTIAL",
  commsSendMaturity: null,          // comms.send — unregistered governed seam
  socialPresenceMaturity: "PARTIAL",
  socialPublishMaturity: null,      // social.publish — unregistered governed seam
  teamAuthorityMaturity: "PARTIAL",
  teamManageMaturity: null,         // team.manage — unregistered governed seam
  campaignListMaturity: "PARTIAL",
  campaignCreateMaturity: "PARTIAL",
  workflowsMaturity: "PARTIAL",     // integrations.n8n_run_workflow is registered…
  workflowsConnected: false,        // …but the tenant's n8n is not connected yet
  researchProviderConfigured: false,// no web-research provider key present
  ownerOpsEligible: true,           // the Solo owner holds admin — the tools' own role gate
  ...over,
});
const byKey = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.key, r]));
const answer = (over: Record<string, unknown> = {}) =>
  byKey(resolveCapabilityStatus(buildCapabilitySignals(freshSolo(over))));

const ALL_KEYS = [
  "agentteam.delegate",
  "browser.secure_session",
  "campaign.create",
  "campaign.list",
  "comms.messages_read",
  "comms.send",
  "crm.advance_journey_stage",
  "crm.create_contact",
  "crm.search_contacts",
  "documents.create",
  "integrations.list",
  "integrations.n8n_run_workflow",
  "knowledge.save",
  "owner.task",
  "pipeline.deal_stage_evidence",
  "planning.create",
  "planning.weekly_commitment_check",
  "research.web",
  "skills.run",
  "social.presence",
  "social.publish",
  "team.authority",
  "team.manage",
];

describe("buildCapabilitySignals — the manifest shape (§13/§947)", () => {
  it("emits every modeled family, including the previously-omitted governed chat capabilities", () => {
    const keys = buildCapabilitySignals(freshSolo()).map((r: any) => r.key).sort();
    expect(keys).toEqual(ALL_KEYS);
    // the anti-under-claim additions are present
    for (const k of ["research.web", "documents.create", "knowledge.save", "planning.create", "agentteam.delegate"]) {
      expect(keys, `${k} must be modeled`).toContain(k);
    }
  });

  it("models reads as reads, the writes as create/update, and the dangerous acts as external effects", () => {
    const m = byKey(buildCapabilitySignals(freshSolo()));
    for (const k of ["crm.search_contacts", "integrations.list", "pipeline.deal_stage_evidence", "comms.messages_read", "social.presence", "team.authority", "campaign.list", "research.web"]) {
      expect(m[k].actionKind, k).toBe("read");
    }
    for (const k of ["crm.create_contact", "campaign.create", "documents.create", "knowledge.save", "planning.create"]) {
      expect(m[k].actionKind, k).toBe("create");
    }
    for (const k of ["team.manage", "crm.advance_journey_stage"]) {
      expect(m[k].actionKind, k).toBe("update");
    }
    for (const k of ["comms.send", "social.publish", "integrations.n8n_run_workflow", "agentteam.delegate", "skills.run", "browser.secure_session"]) {
      expect(m[k].actionKind, k).toBe("external_effect");
    }
  });

  it("GROUNDING GUARD — only the documented shipped chat tools are hardcoded LIVE; every registry-backed maturity comes from the fact", () => {
    // With every passed maturity null (and no research provider), the ONLY signals that may read LIVE
    // are the documented syntheses of shipped+classified+chat-dispatched tools. Everything registry-
    // backed must degrade its null to UNAVAILABLE. This is the guard against a future edit hardcoding a
    // cheerful LIVE for a seam we cannot confirm ships.
    const allNull = byKey(buildCapabilitySignals(freshSolo({
      integrationsListMaturity: null, pipelineEvidenceMaturity: null, commsReadMaturity: null,
      socialPresenceMaturity: null, teamAuthorityMaturity: null, campaignListMaturity: null,
      campaignCreateMaturity: null, workflowsMaturity: null,
    })));
    const live = Object.values(allNull).filter((r: any) => r.maturity === "LIVE").map((r: any) => r.key).sort();
    expect(live).toEqual([
      "agentteam.delegate", "crm.advance_journey_stage", "crm.create_contact", "crm.search_contacts",
      "documents.create", "knowledge.save", "planning.create", "research.web",
    ]);
    // the registry-backed families degrade null → UNAVAILABLE (never undefined, never faked)
    for (const k of ["integrations.list", "pipeline.deal_stage_evidence", "comms.messages_read", "social.presence", "team.authority", "campaign.list", "campaign.create", "integrations.n8n_run_workflow"]) {
      expect(allNull[k].maturity, k).toBe("UNAVAILABLE");
    }
    // skills-in-chat + secure browser are hardcoded UNAVAILABLE (the SAFE direction — never over-claims)
    expect(allNull["skills.run"].maturity).toBe("UNAVAILABLE");
    expect(allNull["browser.secure_session"].maturity).toBe("UNAVAILABLE");
  });

  it("threads the ceiling-clamped lane onto each mutating write verbatim", () => {
    const m = byKey(buildCapabilitySignals(freshSolo({
      contactCreateLane: "auto", campaignCreateLane: "off", documentCreateLane: "auto", delegateLane: "off",
      journeyAdvanceLane: "auto",
    })));
    expect(m["crm.create_contact"].autonomyLane).toBe("auto");
    expect(m["campaign.create"].autonomyLane).toBe("off");
    expect(m["documents.create"].autonomyLane).toBe("auto");
    expect(m["agentteam.delegate"].autonomyLane).toBe("off");
    expect(m["crm.advance_journey_stage"].autonomyLane).toBe("auto");
  });

  it("marks n8n as the real TENANT-connection-gated family; research gates on the PLATFORM provider as evidence, never a tenant connection", () => {
    const m = byKey(buildCapabilitySignals(freshSolo()));
    // n8n is a per-tenant connection the tenant actually makes
    expect(m["integrations.n8n_run_workflow"].requiresConnection).toBe(true);
    expect(m["integrations.n8n_run_workflow"].connected).toBe(false);
    // research's provider (Firecrawl) is PLATFORM-provided — NOT a tenant connection. Absent ⇒
    // evidenceMissing (→ unavailable), so Paige never tells the tenant to "connect" a platform key.
    expect(m["research.web"].requiresConnection).toBeFalsy();
    expect(m["research.web"].evidenceMissing).toBe(true);
    expect(byKey(buildCapabilitySignals(freshSolo({ researchProviderConfigured: true })))["research.web"].evidenceMissing).toBe(false);
    for (const k of ["crm.create_contact", "campaign.create", "documents.create", "knowledge.save", "planning.create", "agentteam.delegate"]) {
      expect(m[k].requiresConnection, k).toBe(false);
    }
  });

  it("a non-client tier is eligible for everything; a sealed client seat is eligible for nothing", () => {
    for (const tier of ["tenant", "subaccount", "agency", "god"]) {
      for (const r of buildCapabilitySignals(freshSolo({ callerTier: tier }))) expect(r.tierEligible).toBe(true);
    }
    for (const r of buildCapabilitySignals(freshSolo({ callerTier: "client" }))) expect(r.tierEligible).toBe(false);
  });
});

describe("the honest answer a FRESH SOLO owner is told", () => {
  it("the native task is partial and refuses a missing active seat", () => {
    const signal = byKey(buildCapabilitySignals(freshSolo()))["owner.task"];
    expect(signal.maturity).toBe("PARTIAL");
    expect(signal.actionKind).toBe("create");
    expect(answer()["owner.task"].availability).toBe("needs_approval");
    expect(answer({ ownerTaskEligible: undefined })["owner.task"].availability).toBe("not_for_tier");
    expect(answer({ ownerTaskEligible: false })["owner.task"].availability).toBe("not_for_tier");
  });
  it("the over-claimed / un-wired ACTIONS are never live — posting, texting, team mgmt, skills-in-chat, secure browser are PLANNED", () => {
    const a = answer();
    for (const k of ["social.publish", "comms.send", "team.manage", "skills.run", "browser.secure_session"]) {
      expect(a[k].availability, k).toBe("planned");
      expect(a[k].reason, k).toBeTruthy();
      // the reason must NOT falsely assert non-existence; the honest claim is "no governed path here".
      expect(a[k].reason, k).not.toMatch(/not built/i);
      expect(a[k].reason, k).toMatch(/governed/i);
    }
  });

  it("the native journey advance (Layer C · C2) is a live in-tenant capability — needs_approval on a confirm lane, live on auto, no connection", () => {
    // confirm lane (the fresh-Solo safe default) → drafted for approval; the native engine holds it.
    expect(answer()["crm.advance_journey_stage"].availability).toBe("needs_approval");
    // an auto lane → live (no external connection to negotiate — it is an in-tenant governed write).
    const auto = answer({ journeyAdvanceLane: "auto" });
    expect(auto["crm.advance_journey_stage"].availability).toBe("live");
    expect(auto["crm.advance_journey_stage"].reason).toBeNull();
    expect(byKey(buildCapabilitySignals(freshSolo()))["crm.advance_journey_stage"].requiresConnection).toBe(false);
    // a sealed client seat can never advance a journey (tier-ineligible → not_for_tier).
    expect(answer({ callerTier: "client" })["crm.advance_journey_stage"].availability).toBe("not_for_tier");
  });

  it("n8n is NEEDS_SETUP until the tenant connects it; research is UNAVAILABLE until the PLATFORM provider is configured — neither is ever a false claim Paige can do it", () => {
    // n8n: a connection the TENANT makes ⇒ needs_setup (tell them to connect), then needs_approval.
    expect(answer()["integrations.n8n_run_workflow"].availability).toBe("needs_setup");
    expect(answer({ workflowsConnected: true })["integrations.n8n_run_workflow"].availability).toBe("needs_approval");
    // research: a PLATFORM provider key ⇒ when absent it is "unavailable" (Paige can't confirm it
    // works here), NOT needs_setup — the tenant has no connect action to take. Configured ⇒ live read.
    expect(answer()["research.web"].availability).toBe("unavailable");
    expect(answer()["research.web"].reason).toBeTruthy();
    expect(answer({ researchProviderConfigured: true })["research.web"].availability).toBe("live");
  });

  it("the reads ARE live — contacts, connections, pipeline, inbox, social accounts, team, campaigns", () => {
    const a = answer();
    for (const k of ["crm.search_contacts", "integrations.list", "pipeline.deal_stage_evidence", "comms.messages_read", "social.presence", "team.authority", "campaign.list"]) {
      expect(a[k].availability, k).toBe("live");
    }
  });

  it("the governed writes (incl. the newly-surfaced ones) are prepared for approval on a confirm lane; auto makes them live", () => {
    const a = answer();
    for (const k of ["crm.create_contact", "campaign.create", "documents.create", "knowledge.save", "planning.create", "agentteam.delegate"]) {
      expect(a[k].availability, k).toBe("needs_approval");
    }
    expect(answer({ documentCreateLane: "auto" })["documents.create"].availability).toBe("live");
    expect(answer({ knowledgeSaveLane: "auto" })["knowledge.save"].availability).toBe("live");
  });

  it("delegation to the Paige team is surfaced (not under-claimed) and governed by approval", () => {
    const d = answer()["agentteam.delegate"];
    expect(d.availability).toBe("needs_approval");
    expect(d.reason).toBeTruthy();
  });

  it("a sealed client seat is told NOT_FOR_TIER on every capability, with a reason", () => {
    const a = answer({ callerTier: "client" });
    for (const k of Object.keys(a)) {
      expect(a[k].availability, k).toBe("not_for_tier");
      expect(a[k].reason, k).toBeTruthy();
    }
  });

  it("a non-owner-ops tenant member is NOT told she can do the owner-ops capabilities — EXCEPT research, which has no owner-ops gate at runtime", () => {
    const a = answer({ ownerOpsEligible: false });
    for (const k of Object.keys(a)) {
      if (k === "research.web") continue; // research is reachable by any non-client seat (no owner-ops gate)
      expect(a[k].availability, k).toBe("not_for_tier");
    }
    // research is owner-ops-INDEPENDENT: a non-admin member is not falsely told it's not for her tier.
    // (freshSolo has no provider key ⇒ unavailable here; with the key it is a live read either way.)
    expect(a["research.web"].availability).not.toBe("not_for_tier");
    expect(answer({ ownerOpsEligible: false, researchProviderConfigured: true })["research.web"].availability).toBe("live");
  });

  it("an unregistered integrations read seam degrades to PLANNED, never a fabricated claim", () => {
    expect(answer({ integrationsListMaturity: null })["integrations.list"].availability).toBe("planned");
  });
});

describe("the effective-lane clamp keeps the manifest from over-claiming a HIGH action (§39/§13/§67)", () => {
  it("clampLaneByRisk forces a HIGH/owner_only action off `auto` to `confirm`; ordinary + non-auto pass through", () => {
    // HIGH tools — the runtime dispatch always forces the approval card even on an `auto` grant, so
    // the manifest must clamp identically or it would tell the owner they run with no approval.
    expect(clampLaneByRisk("auto", "delegate_to_subagent")).toBe("confirm");
    expect(clampLaneByRisk("auto", "n8n_run_workflow")).toBe("confirm");
    // ordinary writes keep their resolved lane
    expect(clampLaneByRisk("auto", "crm_create_contact")).toBe("auto");
    expect(clampLaneByRisk("auto", "document_generate")).toBe("auto");
    // a non-auto lane is never loosened, whatever the class
    expect(clampLaneByRisk("confirm", "delegate_to_subagent")).toBe("confirm");
    expect(clampLaneByRisk("off", "delegate_to_subagent")).toBe("off");
  });

  it("END-TO-END: a HIGH capability on an `auto` grant is NEVER rendered 'CAN DO NOW' — it resolves needs_approval", () => {
    // The gatherer clamps the lane BEFORE buildCapabilitySignals; simulate that here. Even when the
    // owner set delegation/automations to `auto` at a permissive rung, the clamped effective lane is
    // `confirm`, so the manifest says needs_approval — matching what the dispatch actually does.
    const delegateEff = clampLaneByRisk("auto", "delegate_to_subagent");
    const workflowsEff = clampLaneByRisk("auto", "n8n_run_workflow");
    expect(answer({ delegateLane: delegateEff })["agentteam.delegate"].availability).toBe("needs_approval");
    expect(answer({ workflowsConnected: true, workflowsLane: workflowsEff })["integrations.n8n_run_workflow"].availability).toBe("needs_approval");
    // control: an ORDINARY write on a genuine auto grant IS live (the clamp must not over-restrict)
    expect(answer({ documentCreateLane: clampLaneByRisk("auto", "document_generate") })["documents.create"].availability).toBe("live");
  });
});

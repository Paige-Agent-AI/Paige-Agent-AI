/**
 * The shared governed execution seam, tested as a set of PROPERTIES rather than a set of cases.
 *
 * The property that carries the slice is door-blindness: a capability must not become more
 * permitted because an automation, an agent, a skill or an MCP client asked for it instead of Chat.
 * That is asserted exhaustively — every door, every fixture, byte-identical decisions — rather than
 * by spot-checking one alternative caller, because a spot check passes against an implementation
 * that special-cases the two doors nobody happened to test.
 *
 * REAL CODE, NOT A DOUBLE. `classifyAction` and `decideToolConfirmation` are the shipped modules,
 * and the tool names below are real entries in `action-risk.ts`, so what this file asserts is what
 * production policy says. `crm_hard_delete_contact` (the governed delete; its legacy twin `crm_delete_contact` was retired by PR-A) is `high`, `crm_create_contact` is `ordinary`,
 * `automation_set_grant` is `owner_only` — asserted directly at the end, so a reclassification
 * breaks this file loudly instead of silently turning its cases into vacuous ones.
 */
import { describe, it, expect } from "vitest";
import {
  decideGovernedExecution,
  GOVERNED_REFUSAL_CODES,
  type GovernedCaller,
  type GovernedDoor,
  type GovernedDecision,
} from "../../supabase/functions/_shared/paige-spine/governedExecution.ts";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineProductMutation } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOORS: GovernedDoor[] = ["chat", "automation", "agent", "skill", "mcp", "other"];
const NON_CHAT_DOORS = DOORS.filter((d) => d !== "chat");

const caller = (over: Partial<GovernedCaller> = {}): GovernedCaller => ({
  authenticated: true,
  userId: "user-1",
  tenantId: "tenant-1",
  tenantSource: "server",
  door: "chat",
  access: { allowed: true },
  ...over,
});

const HIGH = { id: "crm_hard_delete_contact", effect: "mutate" as const, outcomeChannel: "rail" };
const ORDINARY = { id: "crm_create_contact", effect: "mutate" as const, outcomeChannel: "rail" };
const OWNER_ONLY = { id: "automation_set_grant", effect: "mutate" as const, outcomeChannel: "rail" };

const decide = (over: Parameters<typeof decideGovernedExecution>[0]) => decideGovernedExecution(over);

/** Strip the door from an audit so two decisions from different doors can be compared directly. */
function doorless(d: GovernedDecision) {
  const { audit, ...rest } = d as GovernedDecision & { audit: Record<string, unknown> };
  const { door: _door, ...auditRest } = audit as Record<string, unknown>;
  return { ...rest, audit: auditRest };
}

describe("the seam wraps the LIVE mechanism, not the superseded one", () => {
  it("does not import the unwired #711 decideToolConfirmation", () => {
    // `_shared/toolConfirmation.ts` is the obvious thing to delegate to and is the WRONG thing:
    // the Chat handler's own merge note (paige-ai-chat/index.ts:7922) records it as "in the tree
    // unwired", superseded by the inline sequence over `paige_pending_confirmations`. Importing it
    // would make a superseded design the platform's shared contract. Asserted structurally,
    // because the mistake is invisible in behaviour — the two decisions agree on these fixtures.
    const src = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/paige-spine/governedExecution.ts"), "utf8");
    expect(src).not.toMatch(/^import[^;]*decideToolConfirmation/m);
  });

  it("performs no claim of its own — it receives one", () => {
    // Claiming has exactly one home. A seam that also claimed would be a second implementation of
    // one-approval-one-execution, and two claim protocols in series is the deadlock #711's history
    // is made of.
    const src = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/paige-spine/governedExecution.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/paige_pending_confirmations|claimConfirmation|confirmFingerprint/);
    expect(code).not.toMatch(/\.from\(|\.rpc\(/);
  });
});

describe("the policy this file asserts against is the real one", () => {
  it("classifies the fixture tools as the cases below assume", () => {
    expect(classifyAction("crm_hard_delete_contact")).toBe("high");
    expect(classifyAction("crm_create_contact")).toBe("ordinary");
    expect(classifyAction("automation_set_grant")).toBe("owner_only");
    // If this ever becomes classified, the "unclassified mutation" cases below go vacuous.
    expect(classifyAction("crm_delete_everything")).toBe("unclassified");
  });
});

describe("the private product mutation uses the original governed decision", () => {
  it.each(DOORS)("keeps the planned rollback unavailable through %s even with a claim shape", (door) => {
    const binding = getSpineProductMutation("cloud.workload_rollback", "cloud.private-recovery")!;
    expect(binding.riskPolicyKey).toBe("high");
    expect(classifyAction(binding.actionId)).toBe("unclassified");
    const result = decide({
      caller: caller({ door }),
      capability: { id: binding.actionId, effect: binding.effect, availability: binding.availability,
        outcomeChannel: binding.outcomeChannel },
      approval: { autonomyLane: "auto", claimedFor: binding.actionId, claimedArgs: { version: "1" } },
      requestArgs: { version: "2" },
    });
    expect(result).toMatchObject({ kind: "refuse", code: "capability_planned" });
  });
});

describe("a non-Chat caller cannot bypass high-risk approval", () => {
  it.each(NON_CHAT_DOORS)("%s cannot execute a high action with no claim", (door) => {
    const d = decide({
      caller: caller({ door }),
      capability: HIGH,
      approval: { autonomyLane: "confirm" },
      requestArgs: { contact_id: "c1" },
    });
    expect(d.kind).toBe("propose");
  });

  it.each(NON_CHAT_DOORS)("%s cannot execute a high action on a FAILED claim", (door) => {
    const d = decide({
      caller: caller({ door }),
      capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: null },
      requestArgs: { contact_id: "c1" },
    });
    expect(d.kind).toBe("propose");
    expect(d.kind === "propose" && d.revalidate).toBe(true);
  });

  it.each(NON_CHAT_DOORS)("%s cannot reach a high action by asking for the auto lane", (door) => {
    // REGRESSION. The bypass is: request `auto`, skip approval entirely. The clamp is one-directional
    // and must fire before the gate, so this lands in `propose`, never `execute`.
    const d = decide({
      caller: caller({ door }),
      capability: HIGH,
      approval: { autonomyLane: "auto" },
      requestArgs: { contact_id: "c1" },
    });
    expect(d.kind).toBe("propose");
    expect(d.audit.clamped).toBe(true);
    expect(d.audit.laneEffective).toBe("confirm");
  });

  it("has no boolean input a caller could set — an approval is a CLAIM or it is nothing", () => {
    // The #784 shape, expressed against this seam: there is no `confirm` field to pass. The nearest
    // a caller can get is an empty claim, and an empty claim is not an ok claim.
    const d = decide({
      caller: caller({ door: "mcp" }),
      capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: null },
      requestArgs: { contact_id: "c1", confirm: true },
    });
    expect(d.kind).toBe("propose");
  });

  it("REFUSES a claim that is an object but not a PLAIN one", () => {
    // Measured, not reasoned about: before this, a class instance executed and carried its own
    // enumerable fields through as the stored arguments, and a Date and a Map executed with
    // nothing. A claim comes back from the proposal store as JSON; none of these could be one.
    class Fake { approved = true; }
    for (const exotic of [new Date(), new Fake(), new Map([["a", 1]])]) {
      const d = decide({
        caller: caller({ door: "mcp" }), capability: HIGH,
        approval: { autonomyLane: "confirm", claimedArgs: exotic as never, claimedFor: HIGH.id },
        requestArgs: {},
      });
      expect(d.kind === "refuse" && d.code).toBe("approval_claim_malformed");
    }
  });

  it("still accepts a null-prototype object, which a JSON parse can legitimately produce", () => {
    const args = Object.assign(Object.create(null), { contact_id: "APPROVED" });
    const d = decide({
      caller: caller(), capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: args, claimedFor: HIGH.id },
      requestArgs: { contact_id: "CALLER" },
    });
    expect(d.kind).toBe("execute");
    expect(d.kind === "execute" && d.args).toEqual({ contact_id: "APPROVED" });
  });

  it("REFUSES a claim that was granted for a DIFFERENT capability", () => {
    // Measured before the binding existed: stored args a human approved for an ordinary
    // `crm_create_contact` executed a `high` `crm_hard_delete_contact`. The seam sees only the claim's
    // RESULT, and the live mechanism binds tool identity in the fingerprint the caller consumed —
    // so that binding is lost here unless the caller restates it.
    const d = decide({
      caller: caller({ door: "mcp" }), capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: { first_name: "for a CREATE" },
                  claimedFor: ORDINARY.id },
      requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("approval_claim_capability_mismatch");
  });

  it("REFUSES a stored claim that names no capability at all", () => {
    // Absent is not a weaker form of matching. "I do not know what this approved" fails closed.
    const d = decide({
      caller: caller(), capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: { contact_id: "c1" } }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("approval_claim_capability_mismatch");
  });

  // ── round 5 (Codex), both reproduced against the shipped seam before being fixed ────────────
  it("REFUSES a malformed claim rather than executing it — `true` is not an approval", () => {
    for (const bad of [true, false, "approved", 42, []]) {
      const d = decide({
        caller: caller({ door: "mcp" }), capability: HIGH,
        approval: { autonomyLane: "confirm", claimedArgs: bad as never },
        requestArgs: { contact_id: "c1" },
      });
      expect(d.kind === "refuse" && d.code).toBe("approval_claim_malformed");
    }
  });

  it("refuses a bare `true` claim even on the auto lane of a HIGH capability", () => {
    // The exact canonical rule: the shared path never accepts a bare boolean as approval. This was
    // an EXECUTE before the fix — `high` clamps auto to confirm, then `true` fell past both nullish
    // checks and became the arguments.
    const d = decide({
      caller: caller({ door: "automation" }), capability: HIGH,
      approval: { autonomyLane: "auto", claimedArgs: true as never }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("approval_claim_malformed");
  });

  it("honours a stored claim on the AUTO lane instead of running the caller's arguments", () => {
    // A single-use approval must not be burned and then have DIFFERENT arguments run. Before the
    // fix the auto tail ignored the claim entirely and executed `requestArgs`.
    const d = decide({
      caller: caller({ door: "skill" }), capability: ORDINARY,
      approval: { autonomyLane: "auto", claimedArgs: { first_name: "STORED" }, claimedFor: ORDINARY.id },
      requestArgs: { first_name: "CALLER" },
    });
    expect(d.kind).toBe("execute");
    expect(d.kind === "execute" && d.args).toEqual({ first_name: "STORED" });
  });

  it("asks again rather than auto-executing after a claim that was attempted and failed", () => {
    const d = decide({
      caller: caller(), capability: ORDINARY,
      approval: { autonomyLane: "auto", claimedArgs: null }, requestArgs: { first_name: "CALLER" },
    });
    expect(d.kind).toBe("propose");
    expect(d.kind === "propose" && d.revalidate).toBe(true);
  });

  it("executes the STORED arguments on a good claim, never the caller's re-emitted ones", () => {
    const d = decide({
      caller: caller({ door: "automation" }),
      capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: { contact_id: "APPROVED" }, claimedFor: HIGH.id },
      requestArgs: { contact_id: "SWAPPED" },
    });
    expect(d.kind).toBe("execute");
    expect(d.kind === "execute" && d.args).toEqual({ contact_id: "APPROVED" });
  });

  it("cannot execute an approved action with arguments the approval did not carry", () => {
    // There is no "the claim succeeded" flag separate from the claimed arguments, so the state
    // "approved, but run something else" is unrepresentable rather than merely rejected. The
    // nearest expressible thing — a claim that came back empty — is a refusal to execute.
    const d = decide({
      caller: caller({ door: "automation" }),
      capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: null },
      requestArgs: { contact_id: "SWAPPED" },
    });
    expect(d.kind).toBe("propose");
    expect(d.kind === "propose" && d.revalidate).toBe(true);
  });
});

describe("an unclassified mutation fails closed", () => {
  it.each(DOORS)("%s is refused, with no approval path out", (door) => {
    const d = decide({
      caller: caller({ door }),
      capability: { id: "crm_delete_everything", effect: "mutate", outcomeChannel: "rail" },
      approval: { autonomyLane: "confirm", claimedArgs: {} },
      requestArgs: {},
    });
    expect(d.kind).toBe("refuse");
    expect(d.kind === "refuse" && d.code).toBe("unclassified_mutation");
  });

  it("is refused even on the auto lane with a good claim", () => {
    const d = decide({
      caller: caller({ door: "mcp" }),
      capability: { id: "crm_delete_everything", effect: "mutate", outcomeChannel: "rail" },
      approval: { autonomyLane: "auto", claimedArgs: {} },
      requestArgs: {},
    });
    expect(d.kind).toBe("refuse");
  });

  it("catches a write mis-declared as a read, using the runtime backstop", () => {
    const d = decide({
      caller: caller({ door: "mcp" }),
      capability: { id: "crm_delete_everything", effect: "read" },
      approval: { autonomyLane: "auto" },
      requestArgs: {},
    });
    expect(d.kind).toBe("refuse");
    expect(d.kind === "refuse" && d.code).toBe("unclassified_mutation");
  });

  it("catches a CLASSIFIED mutation mis-declared as a read", () => {
    const d = decide({
      caller: caller({ door: "mcp" }),
      capability: { id: "crm_hard_delete_contact", effect: "read" },
      approval: { autonomyLane: "auto" },
      requestArgs: {},
    });
    expect(d.kind).toBe("refuse");
    expect(d.kind === "refuse" && d.code).toBe("effect_mismatch");
  });
});

describe("owner_only fails closed", () => {
  it.each(DOORS)("%s is refused at every approval strength", (door) => {
    for (const approval of [
      { autonomyLane: "auto" },
      { autonomyLane: "confirm" },
      { autonomyLane: "confirm", claimedArgs: { x: 1 } },
    ]) {
      const d = decide({ caller: caller({ door }), capability: OWNER_ONLY, approval, requestArgs: {} });
      expect(d.kind).toBe("refuse");
      expect(d.kind === "refuse" && d.code).toBe("owner_only");
    }
  });
});

describe("the capability-status gate — availability blocks through EVERY door, identically", () => {
  // The dimension that closes the last inheritance gap: a capability this tenant cannot use right
  // now must not run, no matter which door asked. The four hard-blocked statuses refuse here,
  // before classification, with a status-specific code.
  const CASES = [
    ["not_for_tier", "capability_not_for_tier"],
    ["unavailable", "capability_unavailable"],
    ["planned", "capability_planned"],
    ["needs_setup", "capability_needs_setup"],
  ] as const;

  it.each(CASES)("a %s capability refuses with %s", (availability, code) => {
    const d = decide({
      caller: caller(),
      capability: { ...ORDINARY, availability: availability as never },
      approval: { autonomyLane: "auto" },
      requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe(code);
  });

  it.each(CASES)("%s refuses byte-identically through every door (no inheritance by door)", (availability) => {
    const results = DOORS.map((door) => doorless(decide({
      caller: caller({ door }),
      capability: { ...ORDINARY, availability: availability as never },
      approval: { autonomyLane: "auto" },
      requestArgs: { a: 1 },
    })));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0].kind).toBe("refuse");
  });

  it("blocks a READ too — availability is about the capability, not its effect", () => {
    // A genuine read would otherwise execute at step 6; the gate is before it, so an out-of-tier or
    // unbuilt READ refuses rather than running.
    for (const [availability, code] of CASES) {
      const d = decide({
        caller: caller(),
        capability: { id: "crm_search_contacts", effect: "read", availability: availability as never },
        approval: { autonomyLane: "confirm" },
        requestArgs: { q: "x" },
      });
      expect(d.kind === "refuse" && d.code).toBe(code);
    }
  });

  it("fires BEFORE classification — an out-of-tier unclassified mutation reports the tier reason", () => {
    // Ordering is pinned: the tenant cannot use the capability at all, so the availability reason is
    // the one returned, not `unclassified_mutation`. Either refuses safely; this locks which message.
    const d = decide({
      caller: caller(),
      capability: { id: "crm_delete_everything", effect: "mutate", outcomeChannel: "rail",
                    availability: "not_for_tier" as never },
      approval: { autonomyLane: "auto" },
      requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("capability_not_for_tier");
  });

  it("no approval, at any strength, runs a blocked capability — it is not 'approve it harder'", () => {
    for (const [availability] of CASES) {
      for (const approval of [
        { autonomyLane: "auto" as const },
        { autonomyLane: "confirm" as const },
        { autonomyLane: "confirm" as const, claimedArgs: { x: 1 }, claimedFor: ORDINARY.id },
      ]) {
        const d = decide({
          caller: caller(), capability: { ...ORDINARY, availability: availability as never },
          approval, requestArgs: {},
        });
        expect(d.kind).toBe("refuse");
      }
    }
  });

  it("live, needs_approval, explicit unknown, and ABSENT all pass the gate (no-op)", () => {
    // `live` executes on auto; `needs_approval` proposes on confirm; `unknown` and absent leave the
    // gate inert and behave exactly as before the dimension existed.
    const live = decide({ caller: caller(), capability: { ...ORDINARY, availability: "live" },
      approval: { autonomyLane: "auto" }, requestArgs: { a: 1 } });
    expect(live.kind).toBe("execute");

    const pending = decide({ caller: caller(), capability: { ...ORDINARY, availability: "needs_approval" },
      approval: { autonomyLane: "confirm" }, requestArgs: {} });
    expect(pending.kind).toBe("propose");

    const unknown = decide({ caller: caller(), capability: { ...ORDINARY, availability: "unknown" },
      approval: { autonomyLane: "auto" }, requestArgs: { a: 1 } });
    expect(unknown.kind).toBe("execute");

    const absent = decide({ caller: caller(), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: { a: 1 } });
    expect(absent.kind).toBe("execute");

    // Absent and "unknown" decide identically — the explicit marker is documentation, not behaviour.
    expect(doorless(unknown)).toEqual(doorless(absent));
  });

  it("FAILS CLOSED on an availability it does not recognise (a future 7th member)", () => {
    // Peer-gate finding: the step-5.5 switch had `break` arms with code after it, so a future
    // CapabilityAvailability member nobody mapped would have fallen through and EXECUTED. The seam
    // is the fail-closed layer, so an unrecognised status must refuse, not proceed. Simulated with a
    // value outside the union — exactly what a new member looks like before it is mapped.
    for (const door of DOORS) {
      const d = decide({
        caller: caller({ door }),
        capability: { ...ORDINARY, availability: "some_future_status" as never },
        approval: { autonomyLane: "auto" }, requestArgs: {},
      });
      expect(d.kind, `door ${door}`).toBe("refuse");
      if (d.kind === "refuse") {
        expect(d.code).toBe("capability_unavailable");
        expect(GOVERNED_REFUSAL_CODES).toContain(d.code);
      }
    }
  });

  it("every status-gate code it can emit is in the declared set", () => {
    for (const [availability] of CASES) {
      const d = decide({ caller: caller(), capability: { ...ORDINARY, availability: availability as never },
        approval: { autonomyLane: "auto" }, requestArgs: {} });
      expect(d.kind).toBe("refuse");
      if (d.kind === "refuse") expect(GOVERNED_REFUSAL_CODES).toContain(d.code);
    }
  });
});

describe("the door changes nothing", () => {
  const fixtures = [
    { label: "high, no claim", capability: HIGH, approval: { autonomyLane: "confirm" } },
    // Codex on c3947334: this fixture omitted `claimedFor`, so the "good claim" was refused
    // `approval_claim_capability_mismatch` and NEVER EXECUTED. Measured before fixing: refuse
    // without it, execute with it. A door fixture named "good claim" that cannot execute tests
    // door-blindness on a refusal path and says nothing about the approved-execute path.
    { label: "high, good claim", capability: HIGH,
      approval: { autonomyLane: "confirm", claimedArgs: { a: 1 }, claimedFor: HIGH.id } },
    { label: "high, auto requested", capability: HIGH, approval: { autonomyLane: "auto" } },
    { label: "ordinary, auto", capability: ORDINARY, approval: { autonomyLane: "auto" } },
    { label: "ordinary, confirm no claim", capability: ORDINARY, approval: { autonomyLane: "confirm" } },
    { label: "owner_only", capability: OWNER_ONLY, approval: { autonomyLane: "auto" } },
    { label: "lane off", capability: ORDINARY, approval: { autonomyLane: "off" } },
    { label: "unclassified", capability: { id: "crm_delete_everything", effect: "mutate" as const, outcomeChannel: "rail" },
      approval: { autonomyLane: "auto" } },
    { label: "read", capability: { id: "crm_search_contacts", effect: "read" as const },
      approval: { autonomyLane: "confirm" } },
  ];

  it.each(fixtures)("$label decides identically through every door", ({ capability, approval }) => {
    const results = DOORS.map((door) =>
      doorless(decide({ caller: caller({ door }), capability, approval, requestArgs: { a: 1 } })));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("records the door in the audit and nowhere else", () => {
    const d = decide({
      caller: caller({ door: "mcp" }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.audit.door).toBe("mcp");
  });
});

describe("the layers that were previously inline, and therefore unreachable", () => {
  it("refuses a tenant the caller supplied rather than the server deriving", () => {
    const d = decide({
      caller: caller({ tenantSource: "request" }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("tenant_not_server_derived");
  });

  it("refuses an unauthenticated caller", () => {
    const d = decide({
      caller: caller({ authenticated: false, userId: null }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("unauthenticated");
  });

  it("refuses when no tenant resolved", () => {
    const d = decide({
      caller: caller({ tenantId: null }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("tenant_unresolved");
  });

  it("treats a MISSING access verdict as a refusal, not as permission", () => {
    const d = decide({
      caller: caller({ access: undefined }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("access_denied");
  });

  it("refuses an unnamed capability", () => {
    const d = decide({
      caller: caller(), capability: { id: "   ", effect: "mutate", outcomeChannel: "rail" },
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("capability_unidentified");
  });

  it("refuses a mutation that declares no durable outcome", () => {
    // The Rail workstream owns what travels on that channel. This seam only requires that one
    // was named, so a change nobody could ever see does not run.
    const d = decide({
      caller: caller(), capability: { id: "crm_create_contact", effect: "mutate" },
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("outcome_channel_undeclared");
  });

  it("REGRESSION: an unrecognised autonomy lane fails CLOSED, it does not execute", () => {
    // This was a real fail-open. `""`, `"AUTO"`, `"nonsense"` and `undefined` all reached the tail
    // `execute` and ran a `high` action with no claim at all, because the clamp only rewrote
    // `auto` and only `off`/`confirm` had branches. Found by the exhaustive sweep, not by a
    // hand-written case — which is the whole argument for keeping that sweep.
    for (const lane of ["", "AUTO", "Confirm", "nonsense", undefined as unknown as string]) {
      for (const capability of [HIGH, ORDINARY]) {
        const d = decide({ caller: caller(), capability,
                           approval: { autonomyLane: lane }, requestArgs: { x: 1 } });
        expect(d.kind).toBe("refuse");
        expect(d.kind === "refuse" && d.code).toBe("autonomy_lane_unrecognized");
      }
    }
  });

  it("honours `off` as a brake at every class", () => {
    for (const capability of [ORDINARY, HIGH]) {
      const d = decide({ caller: caller(), capability, approval: { autonomyLane: "off" }, requestArgs: {} });
      expect(d.kind === "refuse" && d.code).toBe("autonomy_off");
    }
  });

  it("lets an ordinary action run on auto with the request's own arguments", () => {
    const d = decide({
      caller: caller(), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: { first_name: "A" },
    });
    expect(d.kind).toBe("execute");
    expect(d.kind === "execute" && d.args).toEqual({ first_name: "A" });
  });

  // Codex on 6ddfab4b: two documented behaviours that no test held, so the documentation was the
  // only thing standing between an adopter and a wrong assumption. Both are asserted now — a
  // documented behaviour with no test is a comment, and a comment is what drifts.
  it("a genuine READ executes on EVERY lane, including `off` and an unrecognised one", () => {
    const READ = { id: "crm_search_contacts", effect: "read" as const };
    for (const autonomyLane of ["auto", "confirm", "off", "sideways" as never]) {
      const d = decide({ caller: caller(), capability: READ, approval: { autonomyLane }, requestArgs: { q: "x" } });
      expect(d.kind, `lane ${String(autonomyLane)}`).toBe("execute");
      expect(d.kind === "execute" && d.args).toEqual({ q: "x" });
    }
  });

  it("an EXEMPT write-shaped id reaches the read branch — the second bypass shape", () => {
    // `growth_page_generate` is on action-risk.ts's NON_MUTATING_EXEMPT list, which
    // unclassifiedWriteReason clears BEFORE consulting MUTATION_VERB. So the read branch is
    // reachable by a write-shaped name, not only by a read-looking one. Asserted so the claim in
    // GovernedCapability.effect cannot quietly become false again.
    expect(classifyAction("growth_page_generate")).toBe("unclassified");
    const d = decide({
      caller: caller(), capability: { id: "growth_page_generate", effect: "read" },
      approval: { autonomyLane: "off" }, requestArgs: { brief: "x" },
    });
    expect(d.kind).toBe("execute");
    // …while a NON-exempt write-shaped name declared `read` is still refused. Without this half,
    // the test above would pass against a seam that had stopped checking write-shaped names at all.
    const w = decide({
      caller: caller(), capability: { id: "crm_delete_everything", effect: "read" },
      approval: { autonomyLane: "off" }, requestArgs: {},
    });
    expect(w.kind === "refuse" && w.code).toBe("unclassified_mutation");
  });

  /**
   * A VERIFIED MACHINE CREDENTIAL, added 2026-09-05 with the MCP door.
   *
   * Four of the six doors this seam declares — automation, agent, skill, mcp — routinely have no
   * `auth.uid()`, and the identity check demanded one, so every one of them was refused
   * `unauthenticated` before it could be adopted. `principal: "service"` says a real non-person
   * credential is behind the call. It buys exactly one thing: reaching the checks. It must never
   * buy a change.
   */
  it("lets a verified service credential with no user perform a READ", () => {
    const d = decide({
      caller: caller({ userId: null, principal: "service" }),
      capability: { id: "crm_search_contacts", effect: "read" },
      approval: { autonomyLane: "not_resolved" }, requestArgs: { q: "a" },
    });
    expect(d.kind).toBe("execute");
    expect(d.audit.principal).toBe("service");
  });

  it("still refuses a service credential with no user when nothing says it is one", () => {
    // The default is the strict reading, so an adapter that simply forgets to resolve the person
    // does not get a machine's allowance by omission.
    const d = decide({
      caller: caller({ userId: null }),
      capability: { id: "crm_search_contacts", effect: "read" },
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("unauthenticated");
  });

  it("refuses EVERY mutation for a service credential, on every lane and every class", () => {
    // The hole this closes: `ordinary` + `auto` + no claim is the seam's one auto-execute path, and
    // without this rule a platform API key would take it — a change performed for a key rather
    // than for any person. Asserted across the whole grid rather than on one fixture, because the
    // single-case version passes against a rule that only covers `high`.
    for (const cap of [HIGH, ORDINARY, { id: "crm_delete_everything", effect: "mutate" as const }]) {
      for (const lane of ["auto", "confirm", "off", "not_resolved"]) {
        const d = decide({
          caller: caller({ userId: null, principal: "service" }),
          capability: { ...cap, outcomeChannel: "rail" },
          approval: { autonomyLane: lane }, requestArgs: {},
        });
        expect(d.kind, `${cap.id} @ ${lane}`).toBe("refuse");
      }
    }
  });

  it("names the service rule for a classified mutation, and does not swallow owner_only", () => {
    const ordinary = decide({
      caller: caller({ userId: null, principal: "service" }), capability: ORDINARY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(ordinary.kind === "refuse" && ordinary.code).toBe("service_principal_may_not_mutate");

    // `owner_only` is a property of the ACT and is the more specific truth, so it must survive.
    const owner = decide({
      caller: caller({ userId: null, principal: "service" }), capability: OWNER_ONLY,
      approval: { autonomyLane: "auto" }, requestArgs: {},
    });
    expect(owner.kind === "refuse" && owner.code).toBe("owner_only");
  });

  it("cannot be reached by a stored approval — a claim is a person's, and there is no person", () => {
    const d = decide({
      caller: caller({ userId: null, principal: "service" }), capability: ORDINARY,
      approval: { autonomyLane: "confirm", claimedArgs: { name: "x" }, claimedFor: ORDINARY.id },
      requestArgs: {},
    });
    expect(d.kind === "refuse" && d.code).toBe("service_principal_may_not_mutate");
  });

  it("never emits a refusal code outside the declared set", () => {
    const seen = new Set<string>();
    for (const door of DOORS) {
      for (const cap of [HIGH, ORDINARY, OWNER_ONLY,
                         { id: "crm_delete_everything", effect: "mutate" as const },
                         { id: "crm_search_contacts", effect: "read" as const }]) {
        for (const lane of ["auto", "confirm", "off", "nonsense"]) {
          for (const c of [caller({ door }), caller({ door, access: undefined }),
                           caller({ door, tenantSource: "unknown" }), caller({ door, tenantId: null })]) {
            const d = decide({ caller: c, capability: cap, approval: { autonomyLane: lane }, requestArgs: {} });
            if (d.kind === "refuse") seen.add(d.code);
          }
        }
      }
    }
    for (const code of seen) expect(GOVERNED_REFUSAL_CODES).toContain(code);
    expect(seen.size).toBeGreaterThan(0);
  });
});

/** The sweep's own fixture axes — deliberately wider than the readable cases above. */
const SWEEP_LANES = ["auto", "confirm", "off", "", "AUTO", "Confirm", "nonsense",
                     undefined as unknown as string];
const SWEEP_CAPS = [
  { id: "crm_hard_delete_contact", effect: "mutate" as const },      // high
  { id: "crm_create_contact", effect: "mutate" as const },      // ordinary
  { id: "automation_set_grant", effect: "mutate" as const },    // owner_only
  { id: "crm_delete_everything", effect: "mutate" as const },   // unclassified write
  { id: "crm_search_contacts", effect: "read" as const },       // genuine read
  { id: "crm_hard_delete_contact", effect: "read" as const },        // mis-declared
];
const SWEEP_OUTCOMES = [undefined, "", "   ", "rail"];
/**
 * The three VALID claim states, plus the malformed shapes a real boundary can hand over.
 *
 * The first version of this list held only the valid three, and that omission is exactly why the
 * sweep — which had already caught one fail-open — sailed past two more. `claimedArgs` arrives from
 * a database row or parsed JSON, so its TypeScript annotation constrains nothing, and a sweep that
 * only feeds well-typed values is testing the author's assumptions rather than the boundary.
 */
const SWEEP_CLAIMS = [
  undefined, null, {}, { contact_id: "APPROVED" },
  true, false, "approved", 42, [],
];
const isStoredClaim = (c: unknown): c is Record<string, unknown> =>
  typeof c === "object" && c !== null && !Array.isArray(c);

/**
 * What the claim says it approved: the right capability, the wrong one, or nothing.
 *
 * Added with the binding itself, because introducing `claimedFor` WITHOUT this axis quietly cost
 * the sweep every approved-execute it had — 1908 executes fell to 1734 and it still reported zero
 * violations, since an oracle that only inspects executes says nothing about a case that stopped
 * executing. A tightening that silently empties a test is indistinguishable from one that works.
 */
const SWEEP_CLAIMED_FOR = ["MATCH", "another_capability", undefined] as const;
/** The single value used where the seam provably never reads it. */
const ONE_CLAIMED_FOR = ["MATCH"] as const;
const SWEEP_CALLER_ARGS = { contact_id: "CALLER_SUPPLIED" };

/**
 * EXHAUSTIVE SWEEP — kept because it earned its place.
 *
 * The hand-written cases above are readable and they are not sufficient. This sweep enumerates the
 * whole decision space and checks an ORACLE rather than a list of expectations, and on its first
 * run it found a real fail-OPEN that all 55 of them missed: an autonomy lane this seam does not
 * recognise (`""`, `"AUTO"`, `undefined`, a typo) fell through to the tail `execute` and ran a
 * `high` action with NO claim and NO approval. The lane is typed `... | string` precisely because
 * the caller resolves it, so those values are reachable, not theoretical.
 *
 * The lesson is the reason it stays: hand-written cases test the branches the author was thinking
 * about, and a fail-open lives in the branch nobody wrote a case for.
 */
/**
 * An exhaustive proof is not a unit test, and vitest's 5s default is a statement about unit tests.
 *
 * Grounded rather than guessed: CI timed this file's sweep out at 5s when it enumerated 1.1M
 * combinations, while the same run took under a second locally — 157 test files sharing a runner
 * make per-test wall time nothing like local. The cross-product is now half that size and the
 * headroom is explicit, so a slow runner reports a slow proof rather than a phantom failure.
 */
const SWEEP_TIMEOUT_MS = 30_000;

describe("exhaustive sweep of the whole decision space", () => {
  it("every execute is justified, and no approved mutation ever runs caller args", () => {
    let checked = 0, execs = 0; const bad: string[] = [];
    for (const door of DOORS) for (const authed of [true,false]) for (const lane of SWEEP_LANES)
    for (const cap of SWEEP_CAPS) for (const oc of SWEEP_OUTCOMES) for (const claimedArgs of SWEEP_CLAIMS)
    // `claimedFor` is consulted at exactly ONE site in the seam — inside the stored-claim branch —
    // so varying it for a claim that is absent, failed or malformed is provably redundant work, not
    // extra coverage. Enumerating it anyway tripled the sweep to 1.1M combinations and pushed the
    // test past vitest's 5s default on CI, which is a cost every future run would have paid for
    // nothing. Redundancy proven rather than assumed: with the full cross-product the mutation run
    // reports the same 96 violations this one does.
    for (const claimedForRaw of (isStoredClaim(claimedArgs) ? SWEEP_CLAIMED_FOR : ONE_CLAIMED_FOR))
    for (const access of [undefined,{allowed:false},{allowed:true}])
    for (const tenantSource of ["server","request","unknown"] as const)
    for (const tenantId of ["t", null]) {
      const claimedFor = claimedForRaw === "MATCH" ? cap.id : claimedForRaw;
      const d = decideGovernedExecution({
        caller:{ authenticated: authed, userId: authed?"u":null, tenantId, tenantSource, door, access },
        capability:{ ...cap, outcomeChannel: oc },
        approval:{ autonomyLane: lane, claimedArgs: claimedArgs as never, claimedFor },
        requestArgs: SWEEP_CALLER_ARGS,
      });
      checked++;
      if (d.kind !== "execute") continue;
      execs++;
      const ctx = JSON.stringify({door,authed,lane,cap,oc,claimedArgs,claimedFor,access,tenantSource,tenantId});

      // Gate preconditions that must hold for ANY execute.
      if (tenantSource !== "server" || !authed || !tenantId || access?.allowed !== true)
        { bad.push("EXECUTED WITHOUT GATE: "+ctx); continue; }

      const risk = classifyAction(cap.id);
      if (cap.effect === "read") {
        // A read may only execute when it is genuinely unclassified and not write-shaped.
        if (risk !== "unclassified" || cap.id !== "crm_search_contacts")
          bad.push("BAD READ EXECUTED: "+ctx);
        continue;
      }
      // Mutations.
      if (risk === "unclassified" || risk === "owner_only") { bad.push("UNGOVERNED MUTATION: "+ctx); continue; }
      if (typeof oc !== "string" || oc.trim() === "") { bad.push("NO OUTCOME CHANNEL: "+ctx); continue; }
      const laneEff = (lane === "auto" && risk === "high") ? "confirm" : lane;
      if (laneEff === "off") { bad.push("EXECUTED ON OFF: "+ctx); continue; }

      // A claim that is neither absent, nor a failed lookup, nor a stored object is MALFORMED, and
      // nothing malformed may reach a write on any lane. `true` is the case that matters: it is the
      // bare boolean the canonical rule forbids as approval, and it must never buy an execute.
      if (claimedArgs !== undefined && claimedArgs !== null && !isStoredClaim(claimedArgs))
        { bad.push("EXECUTED ON A MALFORMED CLAIM: "+ctx); continue; }

      // THE property, and it holds on EVERY lane rather than only under `confirm`: wherever a
      // stored claim exists, the executed call is that stored call. An `auto` path that burned an
      // approval and then ran the caller's own arguments satisfied the old confirm-only version of
      // this check by never being examined.
      if (isStoredClaim(claimedArgs)) {
        // An approval is for ONE capability. Executing on a claim that named a different one — or
        // named none — turns a human's yes to a create into a yes to a delete.
        if (claimedFor !== cap.id) { bad.push("EXECUTED ON A CLAIM FOR ANOTHER CAPABILITY: "+ctx); continue; }
        if (JSON.stringify(d.args) !== JSON.stringify(claimedArgs))
          bad.push("STORED CLAIM NOT HONOURED: "+ctx);
        if (JSON.stringify(d.args) === JSON.stringify(SWEEP_CALLER_ARGS) && JSON.stringify(claimedArgs) !== JSON.stringify(SWEEP_CALLER_ARGS))
          bad.push("APPROVED PATH RAN CALLER ARGS: "+ctx);
        continue;
      }

      if (laneEff === "confirm") {
        bad.push("CONFIRM WITHOUT CLAIM: "+ctx); continue;
      } else if (laneEff === "auto") {
        if (risk !== "ordinary") bad.push("AUTO EXECUTED A NON-ORDINARY: "+ctx);
        // Reaching auto with no stored claim is only legitimate when none was ATTEMPTED. A failed
        // claim must never quietly become an unapproved auto-execute.
        if (claimedArgs === null) bad.push("AUTO EXECUTED AFTER A FAILED CLAIM: "+ctx);
      } else {
        bad.push("EXECUTED ON AN UNKNOWN LANE: "+ctx);
      }
    }
    console.log(`  swept ${checked} combinations, ${execs} executes, ${bad.length} violations`);
    for (const b of bad.slice(0,8)) console.log("   ", b);
    expect(bad.length).toBe(0);
    expect(execs).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT_MS);

  it("is byte-identical across all six doors for every combination", () => {
    const mism: string[] = [];
    // The `claimedFor` axis is here for the same reason the other sweep has it: WITHOUT it every
    // stored claim is refused `approval_claim_capability_mismatch`, so this sweep compared the six
    // doors across a decision space that contained NO successful claimed mutation at all. A
    // door-dependent regression confined to the stored-claim execution path would have passed it.
    // Counts ONLY a stored-claim execution: an approved path returns `claimedArgs` itself, so
    // identity with the fixture's claim distinguishes it from a read or an auto-lane mutation,
    // which both return `requestArgs`. Counting every execute made the vacuity guard satisfiable
    // by executions that have nothing to do with the path it exists to protect — the same defect
    // as the sweep it was added to guard, one level up.
    let claimedExecutes = 0;
    for (const authed of [true,false]) for (const lane of SWEEP_LANES) for (const cap of SWEEP_CAPS)
    for (const oc of SWEEP_OUTCOMES) for (const claimedArgs of SWEEP_CLAIMS)
    for (const claimedForRaw of (isStoredClaim(claimedArgs) ? SWEEP_CLAIMED_FOR : ONE_CLAIMED_FOR))
    for (const access of [undefined,{allowed:false},{allowed:true}])
    for (const tenantSource of ["server","request","unknown"] as const) {
      const claimedFor = claimedForRaw === "MATCH" ? cap.id : claimedForRaw;
      const seen = new Set(DOORS.map((door) => {
        const d = decideGovernedExecution({
          caller:{ authenticated: authed, userId: authed?"u":null, tenantId:"t", tenantSource, door, access },
          capability:{ ...cap, outcomeChannel: oc },
          approval:{ autonomyLane: lane, claimedArgs: claimedArgs as never, claimedFor },
          requestArgs:{ a:1 },
        });
        if (d.kind === "execute" && d.args === claimedArgs) claimedExecutes++;
        const { audit, ...rest } = d as never as { audit: Record<string,unknown> };
        const { door: _d, ...auditRest } = audit;
        return JSON.stringify({ rest, auditRest });
      }));
      if (seen.size !== 1) mism.push(JSON.stringify({lane,cap,oc,claimedArgs,claimedFor,access,tenantSource}));
    }
    console.log(`  door-blindness: ${mism.length} mismatches`);
    expect(mism.length).toBe(0);
    // The oracle above only inspects DISAGREEMENT between doors, so it stays green on a decision
    // space where nothing executes — which is exactly the state this sweep was in. Assert that
    // STORED-CLAIM executes were actually present, or a future tightening can silently empty it
    // again.
    console.log(`  door sweep saw ${claimedExecutes} stored-claim executes across all doors`);
    expect(claimedExecutes).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT_MS);

  it("owner_only and unclassified never execute under ANY input", () => {
    const bad: string[] = [];
    for (const door of DOORS) for (const lane of SWEEP_LANES) for (const claimedArgs of SWEEP_CLAIMS)
    for (const oc of SWEEP_OUTCOMES) for (const eff of ["mutate","read"] as const)
    for (const id of ["automation_set_grant","automation_set_state","crm_delete_everything"]) {
      const d = decideGovernedExecution({
        caller:{ authenticated:true, userId:"u", tenantId:"t", tenantSource:"server", door, access:{allowed:true} },
        capability:{ id, effect: eff, outcomeChannel: oc },
        approval:{ autonomyLane: lane, claimedArgs: claimedArgs as never },
        requestArgs:{},
      });
      if (d.kind === "execute") bad.push(JSON.stringify({id,eff,lane,claimedArgs,oc,door}));
    }
    console.log(`  owner_only/unclassified executes: ${bad.length}`);
    expect(bad.length).toBe(0);
  }, SWEEP_TIMEOUT_MS);
});

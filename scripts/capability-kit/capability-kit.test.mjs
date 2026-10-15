import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CAPABILITY_AVAILABILITY_STATES,
  EVIDENCE_STATES,
  EXECUTION_OUTCOMES,
  defineCapability,
  isDefinedCapability,
  objectInputSchema,
  ownerGrantablePermission,
} from "../../supabase/functions/_shared/capability-kit/mod.ts";
import {
  PER_CAPABILITY_AVAILABILITY_STATES,
} from "../../supabase/functions/_shared/paige-capability-status/resolver.ts";
import { classifyAction, mutatingTools } from "../../supabase/functions/_shared/action-risk.ts";
import { parsePolicy } from "../ci/action-risk-lint.mjs";
import { scanSource } from "../ci/capability-kit-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "capability-kit");

async function readJson(name) {
  return JSON.parse(await readFile(join(FIXTURES, name), "utf8"));
}

function definitionFromFixture(fixture) {
  const effect = fixture.effect;
  return {
    identity: {
      id: fixture.id,
      version: 1,
      domain: fixture.id.split(".")[0],
      owner: "Capability Kit fixture",
      humanSurface: null,
      description: "Contract fixture only.",
    },
    input: objectInputSchema(fixture.input),
    effect,
    governance: {
      actionRiskKey: effect === "read" ? null : "crm_create_contact",
      risk: effect === "read" ? "read_only" : "ordinary",
      approval: effect === "read" ? "none" : "confirm",
      requiredPermission: ownerGrantablePermission(fixture.permission),
    },
    tenantScope: {
      source: "server",
      tenantResolver: "current_user_tenant_id",
      actorResolver: "authenticated_user",
      revalidateAt: ["before_availability", "before_execution", "before_receipt"],
    },
    availability: { resolver: "paige-capability-status", states: ["live", "unavailable"] },
    providerBinding: { kind: "internal", operation: fixture.id, connectionResolver: null },
    idempotency: effect === "read"
      ? { mode: "not_applicable" }
      : { mode: "required", key: "tenant+actor+request", readback: "canonical_record", replay: "return_recorded_result" },
    receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
    outcome: { projector: "capability-record" },
  };
}

let passed = 0;
function test(name, body) {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

const readFixture = await readJson("valid-read.json");
const mutationFixture = await readJson("valid-mutation.json");
const invalidCases = await readJson("invalid-cases.json");

// Every action the canonical policy classifies — the real RISK-derived set, not a fixture list.
// `mutatingTools()` is `RISK_BY_TOOL.keys()`, so membership here IS "a hand-curated RISK entry".
const CLASSIFIED_ACTION_KEYS = [...mutatingTools()].sort();

test("valid read and mutation declarations are branded and recursively immutable", () => {
  for (const fixture of [readFixture, mutationFixture]) {
    const capability = defineCapability(definitionFromFixture(fixture));
    assert.equal(isDefinedCapability(capability), true);
    assert.equal(Object.isFrozen(capability), true);
    assert.equal(Object.isFrozen(capability.identity), true);
    assert.equal(Object.isFrozen(capability.input.properties), true);
  }
});

test("shallow-frozen parents are snapshotted without freezing caller-owned children", () => {
  const revalidateAt = ["before_availability", "before_execution", "before_receipt"];
  const candidate = definitionFromFixture(readFixture);
  candidate.tenantScope = Object.freeze({ ...candidate.tenantScope, revalidateAt });
  const capability = defineCapability(candidate);
  assert.notStrictEqual(capability, candidate);
  assert.notStrictEqual(capability.input, candidate.input);
  assert.notStrictEqual(capability.governance.requiredPermission, candidate.governance.requiredPermission);
  assert.notStrictEqual(capability.tenantScope, candidate.tenantScope);
  assert.notStrictEqual(capability.tenantScope.revalidateAt, revalidateAt);
  assert.equal(Object.isFrozen(capability.tenantScope.revalidateAt), true);
  assert.equal(Object.isFrozen(revalidateAt), false);
  revalidateAt.push("before_execution");
  assert.equal(capability.tenantScope.revalidateAt.length, 3);

  const nestedProperties = { value: { type: "string" } };
  const frozenChild = Object.freeze({ type: "object", properties: nestedProperties, additionalProperties: false });
  const schema = objectInputSchema({ properties: { nested: frozenChild } });
  assert.notStrictEqual(schema.properties.nested, frozenChild);
  assert.notStrictEqual(schema.properties.nested.properties, nestedProperties);
  assert.equal(Object.isFrozen(schema.properties.nested), true);
  assert.equal(Object.isFrozen(nestedProperties), false);
});

test("declarations and schemas reject accessors, Proxies, functions, symbols, and non-plain prototypes", () => {
  let getterCalls = 0;
  const candidate = definitionFromFixture(readFixture);
  Object.defineProperty(candidate.identity, "owner", {
    enumerable: true,
    get() { getterCalls += 1; return "Accessor"; },
  });
  assert.throws(() => defineCapability(candidate), /accessors/);
  assert.equal(getterCalls, 0);

  const proxied = definitionFromFixture(readFixture);
  proxied.identity = new Proxy(proxied.identity, {});
  assert.throws(() => defineCapability(proxied), /Proxy/);
  assert.throws(() => objectInputSchema(new Proxy({ properties: {} }, {})), /Proxy/);

  const schemaWithGetter = { properties: {} };
  Object.defineProperty(schemaWithGetter, "description", {
    enumerable: true,
    get() { getterCalls += 1; return "Accessor"; },
  });
  assert.throws(() => objectInputSchema(schemaWithGetter), /accessors/);
  assert.equal(getterCalls, 0);

  assert.throws(() => objectInputSchema({ properties: { value: { type: "string", transform() {} } } }), /functions/);
  assert.throws(() => objectInputSchema({ properties: { value: Symbol("value") } }), /symbols/);
  assert.throws(() => defineCapability({ ...definitionFromFixture(readFixture), identity: new (class Identity {})() }), /plain prototype/);
});

test("availability states are the canonical resolver's exact per-capability set", () => {
  assert.strictEqual(CAPABILITY_AVAILABILITY_STATES, PER_CAPABILITY_AVAILABILITY_STATES);
  assert.deepEqual([...CAPABILITY_AVAILABILITY_STATES].sort(), [...PER_CAPABILITY_AVAILABILITY_STATES].sort());
});

test("every accepted schema keyword validates type and value before branding", () => {
  const nested = (value) => () => objectInputSchema({ properties: { value } });
  const cases = [
    ["description", () => objectInputSchema({ description: 42, properties: {} })],
    ["properties", () => objectInputSchema({ properties: [] })],
    ["required", () => objectInputSchema({ properties: { value: { type: "string" } }, required: ["missing"] })],
    ["required type", () => objectInputSchema({ properties: { value: { type: "string" } }, required: "value" })],
    ["required uniqueness", nested({ type: "object", properties: { child: { type: "string" } }, required: ["child", "child"], additionalProperties: false })],
    ["type", nested({ type: "date" })],
    ["nested description", nested({ type: "boolean", description: 42 })],
    ["anyOf", nested({ anyOf: [] })],
    ["enum non-empty", nested({ type: "string", enum: [] })],
    ["enum declared type", nested({ type: "string", enum: [1] })],
    ["enum uniqueness", nested({ type: "string", enum: ["same", "same"] })],
    ["minLength", nested({ type: "string", minLength: -1 })],
    ["maxLength", nested({ type: "string", maxLength: Number.POSITIVE_INFINITY })],
    ["length range", nested({ type: "string", minLength: 2, maxLength: 1 })],
    ["pattern type", nested({ type: "string", pattern: 42 })],
    ["pattern syntax", nested({ type: "string", pattern: "[" })],
    ["format type", nested({ type: "string", format: 42 })],
    ["format value", nested({ type: "string", format: "invented" })],
    ["minimum", nested({ type: "number", minimum: Number.NaN })],
    ["maximum", nested({ type: "integer", maximum: Number.POSITIVE_INFINITY })],
    ["numeric range", nested({ type: "integer", minimum: 2, maximum: 1 })],
    ["items", nested({ type: "array", items: null })],
    ["minItems", nested({ type: "array", items: { type: "string" }, minItems: -1 })],
    ["maxItems", nested({ type: "array", items: { type: "string" }, maxItems: 0.5 })],
    ["item range", nested({ type: "array", items: { type: "string" }, minItems: 2, maxItems: 1 })],
    ["nested properties", nested({ type: "object", properties: [], additionalProperties: false })],
    ["additionalProperties", nested({ type: "object", properties: {}, additionalProperties: true })],
    ["unsafe property name", nested({ type: "object", properties: { constructor: { type: "string" } }, additionalProperties: false })],
    ["unknown keyword", nested({ type: "string", minLength: 1, unvalidatedKeyword: true })],
  ];
  for (const [keyword, build] of cases) assert.throws(build, undefined, keyword);
});

test("the provider-safe subset accepts one valid instance of every keyword", () => {
  const schema = objectInputSchema({
    description: "All supported keywords.",
    properties: {
      choice: { description: "Union", anyOf: [{ type: "null" }, { type: "boolean", description: "Flag" }] },
      code: { type: "string", description: "Code", enum: ["AA", "BB"], minLength: 2, maxLength: 2, pattern: "^[A-Z]{2}$" },
      identifier: { type: "string", format: "uuid" },
      count: { type: "integer", description: "Count", minimum: 0, maximum: 10 },
      ratio: { type: "number", minimum: -1.5, maximum: 1.5 },
      values: { type: "array", description: "Values", items: { type: "string" }, minItems: 1, maxItems: 3 },
      nested: { type: "object", description: "Nested", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    },
    required: ["code"],
  });
  assert.equal(schema.type, "object");
});

test("mutations must match the canonical action-risk policy", () => {
  const candidate = definitionFromFixture(mutationFixture);
  // The class-mismatch vehicle is a genuinely wrong class for a classified key: the fixture's
  // `crm_create_contact` is `ordinary`, so declaring `high` must be refused. It used to be
  // `read_only`, which no longer reaches this check — the dedicated read_only veto fires first and
  // is asserted on its own below. That made this assertion's green depend on a phrase inside a
  // DIFFERENT error message, so retargeting it tests the property it names rather than a wording
  // coincidence. Coverage is unchanged: read_only is still asserted, by its own test.
  assert.throws(() => defineCapability({
    ...candidate,
    governance: { ...candidate.governance, risk: "high", approval: "confirm" },
  }), /canonical action-risk policy/);
  assert.throws(() => defineCapability({
    ...candidate,
    governance: { ...candidate.governance, actionRiskKey: "crm_create_unclassified_thing" },
  }), /canonical action-risk policy/);
});

// THE INVARIANT THIS PAIR EXISTS FOR. If the canonical policy says a key is an action, the kit
// must accept it; if the policy does not, the kit must refuse it. Both directions are asserted
// against the REAL policy rather than one hand-picked key, because a suite that exercised only
// `crm_create_contact` is precisely what let a second, redundant precondition ship in front of
// `classifyAction()` and veto 32 already-curated actions (INT-003 follow-up).
test("every action key the canonical policy classifies is declarable through the kit", () => {
  assert.ok(CLASSIFIED_ACTION_KEYS.length > 0, "the canonical policy classifies at least one action");
  const candidate = definitionFromFixture(mutationFixture);
  const refused = [];
  for (const actionRiskKey of CLASSIFIED_ACTION_KEYS) {
    const risk = classifyAction(actionRiskKey);
    const approval = risk === "owner_only" ? "owner_only" : "confirm";
    let capability;
    try {
      capability = defineCapability({
        ...candidate,
        governance: { ...candidate.governance, actionRiskKey, risk, approval },
      });
    } catch (error) {
      refused.push(`${actionRiskKey} — ${error.message}`);
      continue;
    }
    assert.equal(isDefinedCapability(capability), true, actionRiskKey);
    assert.equal(capability.governance.actionRiskKey, actionRiskKey);
    assert.equal(capability.governance.risk, risk);
    assert.equal(capability.governance.approval, approval);
  }
  if (refused.length > 0) {
    assert.fail(
      `the kit refused ${refused.length}/${CLASSIFIED_ACTION_KEYS.length} classified action keys:\n  ` +
      refused.join("\n  "),
    );
  }
});

test("an unclassified key is refused on policy membership, whatever its verb reads like", () => {
  const candidate = definitionFromFixture(mutationFixture);
  // `revise` and `purge` are absent from MUTATION_VERB; `create` is present. All three must be
  // refused, and refused by the POLICY branch — so acceptance is gated by curation, not by a regex.
  for (const actionRiskKey of ["crm_create_unclassified_thing", "widget_revise", "widget_purge"]) {
    assert.equal(classifyAction(actionRiskKey), "unclassified", actionRiskKey);
    assert.throws(() => defineCapability({
      ...candidate,
      governance: { ...candidate.governance, actionRiskKey },
    }), /must exist in the canonical action-risk policy/, actionRiskKey);
  }
});

// The veto that replaced the verb precondition. Removing a check obliges the remaining ones to be
// stronger, so `read_only` is refused outright for anything that writes or reaches outside the
// platform. `ActionRisk` cannot even express `read_only` and no entry classifies one, so the risk
// comparison below happens to reject it today — but that is the table's present composition doing
// the work, not a rule, and this asserts the rule.
test("mutation and external-effect capabilities cannot declare read_only risk", () => {
  const candidate = definitionFromFixture(mutationFixture);
  for (const effect of ["mutation", "external_effect"]) {
    assert.throws(() => defineCapability({
      ...candidate,
      effect,
      governance: { ...candidate.governance, risk: "read_only", approval: "none" },
    }), /read_only/, effect);
  }
});

// The premise the most-restrictive fold in `action-risk.ts` rests on: with the array deduplicated,
// folding is a no-op. `RISK` is hand-maintained and both its maps were last-wins, so a second tuple
// for an existing key silently re-classified it — `crm_update_task` carried two until the INT-003
// follow-up. The fold means a duplicate can now only RAISE a class, but a policy that quietly
// contradicts itself is still a policy nobody can read, so the array is asserted unique here.
// The tidier home for this is `action-risk-lint`, which rejects no duplicates today and already
// exports the `parsePolicy()` used below. That guard is outside this change, so the assertion sits
// here for now. NOT filed as a tracked task — the task tool was unavailable when this shipped — so
// it is recorded here and in the PR body rather than described as routed.
// SYNCHRONOUS deliberately: `test()` above calls `body()` without awaiting it, so an async body
// prints "ok" and increments the pass count before it can possibly fail, and the failure surfaces
// only as an unhandled rejection. Node exits non-zero on one today, so it would not have gone
// unnoticed — but a test whose green depends on that is the shape this whole change exists to fix.
test("the canonical action-risk policy declares each key exactly once", () => {
  const policy = readFileSync(
    join(HERE, "..", "..", "supabase", "functions", "_shared", "action-risk.ts"),
    "utf8",
  );
  // `parsePolicy()` is the policy guard's own reader and the one home for parsing this table
  // (§18). The first draft of this test hand-rolled a third parser that sliced on `RISK_RANK` —
  // a symbol this same change introduced — so renaming it would have silently emptied the test.
  const keys = parsePolicy(policy).map((entry) => entry.tool);
  assert.ok(keys.length > 0, "the RISK array parsed to at least one tuple");
  const repeated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  assert.deepEqual(repeated, [], `RISK declares these keys more than once: ${repeated.join(", ")}`);
  assert.equal(keys.length, mutatingTools().size, "every parsed tuple survives into the fold");
});

test("external effects require the canonical high-risk class", () => {
  const candidate = definitionFromFixture(mutationFixture);
  assert.throws(() => defineCapability({ ...candidate, effect: "external_effect" }), /external_effect.*high/);
  const elevated = {
    ...candidate,
    effect: "external_effect",
    governance: { ...candidate.governance, actionRiskKey: "calendar_book_meeting", risk: "high" },
  };
  assert.equal(isDefinedCapability(defineCapability(elevated)), true);
});

test("governance seam identifiers are closed to canonical implementations", () => {
  const candidate = definitionFromFixture(readFixture);
  for (const changed of [
    { ...candidate, tenantScope: { ...candidate.tenantScope, tenantResolver: "request_body_tenant" } },
    { ...candidate, tenantScope: { ...candidate.tenantScope, actorResolver: "request_body_actor" } },
    { ...candidate, availability: { ...candidate.availability, resolver: "local_status" } },
    { ...candidate, receipt: { ...candidate.receipt, recorder: "local_audit" } },
    { ...candidate, outcome: { projector: "local_outcome" } },
  ]) assert.throws(() => defineCapability(changed), /canonical/);

  assert.throws(() => defineCapability({
    ...candidate,
    providerBinding: { kind: "mcp", operation: "documents.read", connectionResolver: "request_url" },
  }), /canonical/);
  assert.equal(isDefinedCapability(defineCapability({
    ...candidate,
    providerBinding: { kind: "mcp", operation: "documents.read", connectionResolver: "mcp-gateway" },
  })), true);
});

test("execution outcomes and evidence states remain separate exact dimensions", () => {
  const capability = defineCapability(definitionFromFixture(readFixture));
  assert.deepEqual(capability.executionOutcomes, EXECUTION_OUTCOMES);
  assert.deepEqual(capability.evidenceStates, EVIDENCE_STATES);
  assert.equal(capability.executionOutcomes.includes("recorded"), false);
  assert.equal(capability.evidenceStates.includes("succeeded"), false);
});

test("a structurally similar object cannot fabricate the capability brand", () => {
  const genuine = defineCapability(definitionFromFixture(readFixture));
  const copiedDescriptors = Object.create(
    Object.getPrototypeOf(genuine),
    Object.getOwnPropertyDescriptors(genuine),
  );
  Object.freeze(copiedDescriptors);
  assert.equal(isDefinedCapability(copiedDescriptors), false);
});

test("copied private symbols cannot fabricate schema or permission authority", () => {
  const candidate = definitionFromFixture(readFixture);
  const copy = (value) => Object.freeze(Object.create(
    Object.getPrototypeOf(value),
    Object.getOwnPropertyDescriptors(value),
  ));
  assert.throws(() => defineCapability({
    ...candidate,
    governance: { ...candidate.governance, requiredPermission: copy(candidate.governance.requiredPermission) },
  }), /ownerGrantablePermission/);
  assert.throws(() => defineCapability({ ...candidate, input: copy(candidate.input) }), /objectInputSchema/);
});

test("schema roots must be plain objects", () => {
  class SchemaRoot { constructor() { this.properties = {}; } }
  assert.throws(() => objectInputSchema(new SchemaRoot()), /plain/);
});

for (const fixture of invalidCases) {
  test(`rejects ${fixture.name}`, () => {
    if (fixture.stage === "schema") {
      assert.throws(() => objectInputSchema({ properties: {}, ...fixture.rootExtra }));
      return;
    }
    if (fixture.stage === "permission") {
      assert.throws(() => ownerGrantablePermission(fixture.permission));
      return;
    }
    const candidate = definitionFromFixture(mutationFixture);
    if (fixture.omit) delete candidate[fixture.omit];
    if (fixture.extra) Object.assign(candidate, fixture.extra);
    assert.throws(() => defineCapability(candidate));
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE PAIRED INVARIANT: a declaration the LINT passes must be one the CONSTRUCTOR accepts.
 *
 * `defineCapability()` throws at MODULE LOAD, so a contradictory declaration takes the whole edge
 * function down. CI's job is to catch that in review, and for a long time it could not: the lint
 * read exactly one field out of a declaration and checked none of the constructor's risk predicates.
 * Measured before the rule below existed — seven distinct shapes were lint-green and threw on import.
 *
 * The predicates now live in two languages (a dependency-free `.mjs` scanner and a TypeScript
 * constructor) because the lint cannot import the kit. Two homes for one rule drift, so this pins
 * them together: one corpus, both readers, and a failure the moment their verdicts diverge. Add a
 * predicate to the constructor without adding it here and the bite case fails; tighten the lint too
 * far and the no-false-accusation case fails.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const RISK_POLICY = new Map(
  ["crm_create_contact", "crm_merge_contacts", "automation_set_grant"].map((key) => [key, classifyAction(key)]),
);

const lintFlags = (source) =>
  scanSource(source, "paired-invariant.ts", { strictOnly: true, riskPolicy: RISK_POLICY })
    .filter((finding) => finding.rule === "declaration-contradicts-constructor");

const constructorRejects = (build) => {
  try { defineCapability(build()); return false; } catch { return true; }
};

/** A complete, correct declaration. Every corpus case is this with one thing changed. */
const soundRead = () => ({
  identity: { id: "knowledge.documents.read", version: 1, domain: "knowledge", owner: "Knowledge", humanSurface: null, description: "Read one governed document." },
  input: objectInputSchema({ properties: { documentId: { type: "string", minLength: 1 } }, required: ["documentId"] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("knowledge.documents.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "unavailable"] },
  providerBinding: { kind: "internal", operation: "documents.read", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
const soundMutation = () => ({
  ...soundRead(),
  effect: "mutation",
  governance: { actionRiskKey: "crm_create_contact", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("crm.contacts.create") },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval"] },
  idempotency: { mode: "required", key: "tenant+actor+request", readback: "canonical_record", replay: "return_recorded_result" },
});

const SEAMS = `tenantScope:{source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_availability","before_execution","before_receipt"]}`;
const REST = `identity:{},input:{},availability:{},providerBinding:{},receipt:{},outcome:{}`;
const readSrc = (over) => `defineCapability({effect:"read",governance:{actionRiskKey:null,risk:"read_only",approval:"none"},idempotency:{mode:"not_applicable"},${SEAMS},${REST},${over ?? ""}})`;

/** Each case: the SOURCE the lint reads, and the OBJECT the constructor builds. Same declaration. */
const CORPUS = [
  { name: "a sound read", bite: false,
    source: readSrc(), build: soundRead },
  { name: "a sound mutation", bite: false,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"crm_create_contact",risk:"ordinary",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: soundMutation },
  { name: "risk contradicts the canonical policy", bite: true,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"crm_merge_contacts",risk:"ordinary",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), governance: { actionRiskKey: "crm_merge_contacts", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("crm.contacts.merge") } }) },
  { name: "approval contradicts the canonical policy", bite: true,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"crm_create_contact",risk:"ordinary",approval:"none"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), governance: { ...soundMutation().governance, approval: "none" } }) },
  { name: "owner_only declared as confirm", bite: true,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"automation_set_grant",risk:"owner_only",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), governance: { actionRiskKey: "automation_set_grant", risk: "owner_only", approval: "confirm", requiredPermission: ownerGrantablePermission("automation.grant.set") } }) },
  { name: "an external effect that is not high", bite: true,
    source: `defineCapability({effect:"external_effect",governance:{actionRiskKey:"crm_create_contact",risk:"ordinary",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), effect: "external_effect" }) },
  { name: "an action-risk key absent from the canonical policy", bite: true,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"widget_purge",risk:"high",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), governance: { actionRiskKey: "widget_purge", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("widget.purge.run") } }) },
  { name: "a read carrying an action-risk key", bite: true,
    source: `defineCapability({effect:"read",governance:{actionRiskKey:"crm_merge_contacts",risk:"high",approval:"confirm"},idempotency:{mode:"not_applicable"},${SEAMS},${REST}})`,
    build: () => ({ ...soundRead(), governance: { actionRiskKey: "crm_merge_contacts", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("knowledge.documents.read") } }) },
  { name: "revalidateAt missing two authority seams (the shape the shipped fixture had)", bite: true,
    source: `defineCapability({effect:"read",governance:{actionRiskKey:null,risk:"read_only",approval:"none"},idempotency:{mode:"not_applicable"},tenantScope:{source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_execution"]},${REST}})`,
    build: () => ({ ...soundRead(), tenantScope: { ...soundRead().tenantScope, revalidateAt: ["before_execution"] } }) },
  { name: "a mutation declaring read_only risk", bite: true,
    source: `defineCapability({effect:"mutation",governance:{actionRiskKey:"crm_create_contact",risk:"read_only",approval:"confirm"},idempotency:{mode:"required",replay:"return_recorded_result"},${SEAMS},${REST}})`,
    build: () => ({ ...soundMutation(), governance: { ...soundMutation().governance, risk: "read_only" } }) },
];

for (const entry of CORPUS) {
  test(`lint and constructor agree: ${entry.name}`, () => {
    const flagged = lintFlags(entry.source).length > 0;
    const rejected = constructorRejects(entry.build);

    // THE LOAD-BEARING DIRECTION. A guard that accuses a legitimate declaration gets switched off
    // rather than fixed, so this must never fire: if the constructor accepts it, the lint is silent.
    if (!rejected) {
      assert.equal(flagged, false,
        `the constructor ACCEPTS "${entry.name}" but the lint flags it:\n    ` +
        lintFlags(entry.source).map((f) => f.symbol).join("\n    "));
    }

    // THE BITE. Every shape this rule exists to catch must be caught by BOTH readers. A case that
    // the constructor rejects while the lint stays silent is the "lint green, throws on import"
    // failure this whole pairing exists to end.
    if (entry.bite) {
      assert.equal(rejected, true, `expected the constructor to reject "${entry.name}"`);
      assert.equal(flagged, true, `the constructor rejects "${entry.name}" but the lint passes it — the gap is back`);
    }
  });
}

test("the shipped canonical example is a declaration the constructor would accept", () => {
  // THE REGRESSION THIS EXISTS FOR. `scripts/fixtures/capability-kit/type-contract.fixture.ts` is
  // the one worked example in the repo — the file a first adopter copies — and it shipped declaring
  // `revalidateAt: ["before_execution"]`, which the constructor refuses. Nothing caught it: the type
  // permits a partial array (types.ts:59-63), the lint's SCAN_ROOTS are `supabase/functions` and
  // `src` so no rule ever read it, and nothing imports it so its own `defineCapability(valid)` call
  // was never executed. It cannot simply be imported here either — it deliberately contains three
  // `@ts-expect-error` NEGATIVE cases that throw at runtime. So the rule is run over its real source.
  const source = readFileSync(join(FIXTURES, "type-contract.fixture.ts"), "utf8");
  const findings = scanSource(source, "scripts/fixtures/capability-kit/type-contract.fixture.ts", {
    strictOnly: true,
    riskPolicy: RISK_POLICY,
  }).filter((finding) => finding.rule === "declaration-contradicts-constructor");

  // The three negatives spread `...valid` and change ONE field each, none of which this rule reads
  // statically, so a sound `valid` means zero findings for the whole file.
  assert.deepEqual(findings.map((f) => f.symbol), [],
    "the repo's canonical capability example does not construct — fix the fixture, not this test");
});

console.log(
  `\n✓ capability-kit focused tests passed — ${passed} cases; ` +
  `${CLASSIFIED_ACTION_KEYS.length} classified action keys proven declarable.`,
);

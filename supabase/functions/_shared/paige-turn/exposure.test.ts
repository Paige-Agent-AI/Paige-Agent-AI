// exposure.test.ts — R5b pins, run by the CI Deno step next to the route/round/classify suites.
// The exposure filter narrows the governed list by the route's own capability verdict; the
// escalation signal is presentation, never a write, and never reaches an act round.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { MUTATION_VERB, classifyAction, mutatingTools } from "../action-risk.ts";
import {
  PRESENTATION_KEEP,
  REQUEST_CAPABILITY_NAME,
  REQUEST_CAPABILITY_TOOL,
  exposureFor,
  requestCapabilityResult,
} from "./exposure.ts";

const def = (name: string) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });

Deno.test("act exposure passes the governed set through untouched, signal included nowhere", () => {
  const defs = [def("crm_contact_lookup"), def("crm_create_contact"), def("web_search")];
  const r = exposureFor(defs, "act");
  assertEquals(r.offered.length, defs.length);
  assertEquals(r.withheld.length, 0);
  assertEquals(r.offered.some((d) => (d as { function?: { name?: string } }).function?.name === REQUEST_CAPABILITY_NAME), false);
});

Deno.test("read exposure withholds every mutating tool and appends the signal", () => {
  // Names the real classification actually marks as mutations, and one it does not.
  const mutating = [...mutatingTools()].slice(0, 5);
  const defs = [def("crm_contact_lookup"), def("web_search"), ...mutating.map(def)];
  const r = exposureFor(defs, "read");
  const names = r.offered.map((d) => (d as { function?: { name?: string } }).function?.name);
  assertEquals(names.includes("crm_contact_lookup"), true);
  assertEquals(names.includes("web_search"), true);
  for (const m of mutating) assertEquals(names.includes(m), false);
  assertEquals(names[names.length - 1], REQUEST_CAPABILITY_NAME);
  assertEquals(new Set(r.withheld).size, mutating.length);
});

Deno.test("none exposure offers presentation plus the signal only", () => {
  const defs = [def("crm_contact_lookup"), def("crm_create_contact"), def("ask_choices")];
  const r = exposureFor(defs, "none");
  const names = r.offered.map((d) => (d as { function?: { name?: string } }).function?.name);
  assertEquals(names.includes("ask_choices"), true);
  assertEquals(names.includes(REQUEST_CAPABILITY_NAME), true);
  assertEquals(names.includes("crm_contact_lookup"), false);
  assertEquals(names.includes("crm_create_contact"), false);
  assertEquals(r.withheld.includes("crm_contact_lookup"), true);
});

Deno.test("the filter never mutates its input", () => {
  const defs = [def("crm_create_contact"), def("crm_contact_lookup")];
  const before = JSON.stringify(defs);
  exposureFor(defs, "none");
  exposureFor(defs, "read");
  assertEquals(JSON.stringify(defs), before);
});

Deno.test("the escalation signal can never read as a mutation", () => {
  // The name must stay outside the mutation verb backstop and the governed write set, so its
  // dispatch can never require a classification row or an approval of its own.
  assertEquals(MUTATION_VERB.test(REQUEST_CAPABILITY_NAME), false);
  assertEquals(mutatingTools().has(REQUEST_CAPABILITY_NAME), false);
  assertEquals(classifyAction(REQUEST_CAPABILITY_NAME), "unclassified");
  // And its definition carries no parameters — nothing to smuggle an instruction through.
  assertEquals(Object.keys((REQUEST_CAPABILITY_TOOL.function.parameters as { properties: Record<string, unknown> }).properties).length, 0);
});

Deno.test("the signal's tool result promises a re-route, not an execution", () => {
  const granted = requestCapabilityResult("granted");
  const again = requestCapabilityResult("already_granted");
  assertEquals(granted.success, true);
  assertEquals(again.success, true);
  assertEquals(granted.message.includes("gates still decide"), true);
  assertEquals(PRESENTATION_KEEP.has("ask_choices"), true);
});

// exposure.test.ts — R5b pins, run by the CI Deno step next to the route/round/classify suites.
// The exposure filter narrows the governed list by the route's own capability verdict; it never
// adds a definition, and the rescue's dispatch result promises a re-route, never an execution.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { MUTATION_VERB, classifyAction, mutatingTools } from "../action-risk.ts";
import { PRESENTATION_KEEP, exposureFor, notOfferedThisRound } from "./exposure.ts";

const def = (name: string) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });

Deno.test("act exposure passes the governed set through untouched", () => {
  const defs = [def("crm_contact_lookup"), def("crm_create_contact"), def("web_search")];
  const r = exposureFor(defs, "act");
  assertEquals(r.offered.length, defs.length);
  assertEquals(r.withheld.length, 0);
});

Deno.test("read exposure withholds every mutating tool and keeps lookups", () => {
  // Names the real classification actually marks as mutations, and one it does not.
  const mutating = [...mutatingTools()].slice(0, 5);
  const defs = [def("crm_contact_lookup"), def("web_search"), ...mutating.map(def)];
  const r = exposureFor(defs, "read");
  const names = r.offered.map((d) => (d as { function?: { name?: string } }).function?.name);
  assertEquals(names.includes("crm_contact_lookup"), true);
  assertEquals(names.includes("web_search"), true);
  for (const m of mutating) assertEquals(names.includes(m), false);
  assertEquals(new Set(r.withheld).size, mutating.length);
});

Deno.test("none exposure offers presentation alone — and an empty manifest is legitimate", () => {
  const withAsk = exposureFor([def("crm_contact_lookup"), def("crm_create_contact"), def("ask_choices")], "none");
  assertEquals(withAsk.offered.map((d) => (d as { function?: { name?: string } }).function?.name), ["ask_choices"]);
  assertEquals(withAsk.withheld.includes("crm_contact_lookup"), true);
  // A surface with no presentation tools yields an empty round manifest: no tools field is sent.
  const bare = exposureFor([def("crm_contact_lookup"), def("web_fetch")], "none");
  assertEquals(bare.offered.length, 0);
  assertEquals(bare.withheld.length, 2);
});

Deno.test("the filter never mutates its input and never adds a definition", () => {
  const defs = [def("crm_create_contact"), def("crm_contact_lookup")];
  const before = JSON.stringify(defs);
  assertEquals(exposureFor(defs, "none").offered.length, 0);
  assertEquals(exposureFor(defs, "read").offered.length <= defs.length, true);
  assertEquals(JSON.stringify(defs), before);
});

Deno.test("the rescue's result promises a re-route, not an execution", () => {
  const r = notOfferedThisRound();
  assertEquals(r.success, false);
  assertEquals(r.code, "NOT_OFFERED_THIS_ROUND");
  assertEquals(r.message.includes("gates"), true);
  assertEquals(PRESENTATION_KEEP.has("ask_choices"), true);
  // And nothing in this module declares a tool: the rescue is not a new capability to vet.
  assertEquals(MUTATION_VERB.test("request_capability"), false);
  assertEquals(classifyAction("request_capability"), "unclassified");
});

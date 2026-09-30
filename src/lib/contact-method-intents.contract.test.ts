// The contract between the two planners of a proposed address change: the browser's
// (src/lib/contact-method-intents.ts, used when an operator approves a proposal in Field Ingestion)
// and the server's (supabase/functions/_shared/paige-mcp/contact-method-edits.ts, used when Paige's
// `confirm_proposal` applies the same proposal). Both must give the same list, the same stale
// refusal and the same row-patch refusals for the same proposal, or the proposal means something
// different depending on who approves it.
//
// The fixtures' expected values were produced by running the SERVER's planner over the inputs; the
// browser is held to them here. Every planner this tree carries is held to the same fixtures: the
// server module is picked up by path, so once both lanes are in one tree, a change to either
// planner that the other does not share fails this file.
import { describe, expect, it } from "vitest";
import * as browserPlanner from "./contact-method-intents";
import fixtures from "./contact-method-intents.fixtures.json";

type Planner = Pick<
  typeof browserPlanner,
  | "planAddressWrite" | "intentResult" | "contactMethodsFingerprint" | "storedAddressIntent" | "storedMethodList"
  | "clientRowPatchProblem" | "CONTACT_METHODS_STALE" | "PROPOSABLE_CLIENT_FIELDS"
>;

const serverModules = import.meta.glob<Planner>("../../supabase/functions/_shared/paige-mcp/contact-method-edits.ts");

const planners: Array<[string, () => Promise<Planner>]> = [
  ["browser (src/lib/contact-method-intents.ts)", async () => browserPlanner],
  ...Object.entries(serverModules).map(([path, load]) => [`server (${path.replace(/^(\.\.\/)+/, "")})`, load] as [string, () => Promise<Planner>]),
];

type List = browserPlanner.ContactMethodInput[];
const list = (key: string | null): List | null => (key === null ? null : (fixtures.lists as unknown as Record<string, List>)[key]);

it("the browser planner is always held to the fixtures", () => {
  expect(planners[0][0]).toMatch(/^browser/);
  expect(fixtures.plans.length).toBeGreaterThanOrEqual(23);
  expect(fixtures.fingerprints.length).toBeGreaterThanOrEqual(16);
});

describe.each(planners)("%s", (_name, load) => {
  it.each(fixtures.plans.map((c) => [c.name, c] as const))("plans %s", async (_label, c) => {
    const planner = await load();
    const intent = c.intent as Parameters<Planner["planAddressWrite"]>[0];
    expect(planner.planAddressWrite(intent, list(c.builtOn), list(c.heldNow)!)).toEqual(c.plan);
    expect(planner.intentResult(intent, list(c.heldNow)!)).toEqual(c.result);
  });

  it("compares two lists the way the database does (public.contact_methods_fingerprint)", async () => {
    const planner = await load();
    for (const c of fixtures.fingerprints) {
      const given = ("list" in c && c.list ? list(c.list) : (c as { value: List }).value)!;
      expect(planner.contactMethodsFingerprint(given), JSON.stringify(given)).toBe(c.fingerprint);
    }
  });

  it("reads a stored intent the same way, refusing the same malformed ones", async () => {
    const planner = await load();
    for (const c of fixtures.storedIntents) expect(planner.storedAddressIntent(c.value), JSON.stringify(c.value)).toEqual(c.intent);
  });

  it("reads a stored built-on list the same way", async () => {
    const planner = await load();
    for (const c of fixtures.storedLists) expect(planner.storedMethodList(c.value), JSON.stringify(c.value)).toEqual(c.list);
  });

  it("refuses the same contact-row patches, with the same reasons", async () => {
    const planner = await load();
    for (const c of fixtures.rowPatches) expect(planner.clientRowPatchProblem(c.patch), JSON.stringify(c.patch)).toBe(c.problem);
    expect([...planner.PROPOSABLE_CLIENT_FIELDS]).toEqual(fixtures.proposableFields);
    expect(planner.CONTACT_METHODS_STALE).toBe(fixtures.staleMessage);
  });
});

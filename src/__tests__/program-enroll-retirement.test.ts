/**
 * The program_enroll / program_list retirement contract.
 *
 * Grounding (2026-09-30 production read-back): the `programs` and
 * `program_enrollments` tables have never held a row for any tenant — the
 * legacy marketplace-era program system is retired plumbing. Every
 * program_enroll invocation necessarily raised ENROLL_PROGRAM_NOT_IN_TENANT,
 * which the chat surfaced as an ambiguous "unclear result" after the
 * operator's approval had already been spent.
 *
 * Enrollment is now one governed action: a deal in the program's pipeline at
 * its Enrolled stage, created through the canonical CRM door. This suite pins
 * that retirement: the dead tools are absent everywhere a reintroduction
 * could hide, and the model-facing contract teaches the bridge. An
 * unclassified tool is refused by classifyAction by default, so removing the
 * action-risk key is the fail-closed reintroduction guard — re-adding the
 * tool without its classification fails here AND at dispatch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const CHAT = "supabase/functions/paige-ai-chat/index.ts";
const chatSrc = read(CHAT);

describe("the dead program tools are retired from chat", () => {
  it("declares no program_enroll or program_list tool", () => {
    expect(chatSrc).not.toContain('name: "program_enroll"');
    expect(chatSrc).not.toContain('name: "program_list"');
  });

  it("keeps no handler for the dead executors", () => {
    expect(chatSrc).not.toContain('tc.function.name === "program_enroll"');
    expect(chatSrc).not.toContain('tc.function.name === "program_list"');
    expect(chatSrc).not.toContain("enroll_contact_in_program");
    expect(chatSrc).not.toContain("list_tenant_programs");
  });

  it("leaves no card text, verb phrase, or list entry behind", () => {
    expect(chatSrc).not.toContain('case "program_enroll"');
    expect(chatSrc).not.toContain('case "program_list"');
    expect(chatSrc).not.toContain("program_enroll:");
    expect(chatSrc).not.toContain('"program_enroll"');
  });

  it("is not a vacuous absence check: the governed deal tools remain declared", () => {
    expect(chatSrc).toContain('name: "deal_create"');
    expect(chatSrc).toContain('case "deal_create"');
    // The governed door still fronts deal.create; enrollment rides it.
    const catalog = read("supabase/functions/_shared/crm-command/catalog.ts");
    expect(catalog).toContain('"deal.create": "deal_create"');
  });
});

describe("the action-risk and Trust Compass registrations are removed (fail-closed)", () => {
  it("removes the program_enroll classification — unclassified means refused", () => {
    const risk = read("supabase/functions/_shared/action-risk.ts");
    expect(risk).not.toContain('"program_enroll"');
  });

  it("removes the Solo capability knob fronting the retired tool", () => {
    const knobs = read("src/solo/data/capabilityTools.ts");
    expect(knobs).not.toContain("program_enroll");
  });
});

describe("the model-facing contract teaches the enrollment bridge", () => {
  it("tells the model a program enrollment is a deal at the Enrolled stage", () => {
    expect(chatSrc).toMatch(/Enrolled stage/i);
    expect(chatSrc).toMatch(/enroll.{0,80}program.{0,120}deal_create/is);
  });

  it("requires an honest refusal when pipeline names are ambiguous", () => {
    expect(chatSrc).toMatch(/same name.{0,200}(refuse|ask|ambiguous)/is);
  });
});

describe("the CI registries agree with the retirement", () => {
  it("drops program_enroll from the chat tool baseline", () => {
    expect(read("scripts/ci/chat-tool-baseline.txt")).not.toContain("program_enroll");
  });

  it("drops program_enroll from the capability declaration baseline", () => {
    expect(read("scripts/ci/capability-declaration-baseline.json")).not.toContain('"program_enroll"');
  });

  it("drops program_enroll from the receipt coverage ledger", () => {
    expect(read("scripts/ci/receipt-coverage-ledger.json")).not.toContain('"program_enroll"');
  });
});

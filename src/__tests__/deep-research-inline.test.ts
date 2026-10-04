/**
 * R2b — the inline-research contract (the owner's Perplexity-model reshape).
 *
 * The ruling's canonical interaction model: PAIGE CHAT is where Deep Research is
 * invoked and experienced (auto-selected by the canonical tool contract — no keyword
 * router); the Research tab is the saved library. This suite pins the chat-side
 * wiring at every seam:
 *  - ONE Paige turn: the research card attaches to the SAME assistant message
 *    (the crmResults pattern), never a separate research-bot message;
 *  - the paige_research frame + the run REFERENCE in bundle_ref (§12: reference +
 *    canonical reload — the client rehydrates through the M0 governed get, the SAME
 *    door the library uses, so chat and library keep one citation identity);
 *  - saved is the server's governed-readback verdict (§10);
 *  - the auto-selection contract carries the proactive classes AND the explicit
 *    override phrases (§2/§3) while keeping web_search the light path (§4);
 *  - the truthful activity label (§5) and the distinct honest states (§14).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const chat = readFileSync(join(root, "src/components/dashboard/PaigeAIChat.tsx"), "utf8");
const card = readFileSync(join(root, "src/components/paige/chat/PaigeResearchCard.tsx"), "utf8");

describe("one Paige turn — the card rides the assistant message (§7)", () => {
  it("the frame is captured and attached mid-stream like the crm cards", () => {
    expect(chat).toContain("if (Array.isArray(parsed.paige_research?.findings))");
    expect(chat).toContain("researchThisTurn.push(parsed.paige_research as PaigeResearchResult);");
    expect(chat).toContain("research: [...researchThisTurn]");
  });

  it("the render attaches to the SAME message (no research-bot message, no separate turn)", () => {
    expect(chat).toContain("{!!message.research?.length && (");
    expect(chat).toContain("<PaigeResearchCard");
    expect(chat).toContain("key={r.run_id ?? `research-${i}`}");
    expect(chat).toContain("result={r}");
    expect(core).toContain("// R2b — the inline research card's live payload (attached to the same assistant")
  });

  it("no second conversational runtime was created", () => {
    expect(core).not.toContain("research_message");
    expect(core).not.toContain("research_reply");
  });
});

describe("the frame + the run reference (§12: reference + canonical reload)", () => {
  it("the server streams the paige_research frame beside the crm frames", () => {
    expect(core).toContain("for (const r of researchTrace) emitContent");
    expect(core).toContain("{ paige_research: r }");
  });

  it("bundle_ref carries the run REFERENCE only — never the payload", () => {
    expect(core).toContain("paige_research: researchTrace.map((r) => ({");
    expect(core).toContain("run_id: r.run_id, question: r.question, saved: r.saved === true,");
    // The reference spread carries exactly three keys — no findings/sources in bundle_ref.
    const refLine = core.slice(core.indexOf("paige_research: researchTrace.map"));
    const seg = refLine.slice(0, refLine.indexOf("})", 40) + 2);
    expect(seg).not.toContain("findings");
    expect(seg).not.toContain("sources");
  });

  it("the reload rehydrates through the M0 governed get — the SAME door the library uses", () => {
    expect(chat).toContain('supabase.rpc("get_workspace_research_run"');
    expect(chat).toContain("// R2b §12 — resolve the research references through the governed get RPC");
    expect(chat).toContain("rehydrating: !!ref.run_id");
  });

  it("a null readback settles the honest reference state (never a fabricated evidence card)", () => {
    expect(chat).toContain("{ ...r, rehydrating: false }");
    expect(chat).toContain("/* the card keeps its honest reference state */");
    // and the card side claims no engine state a reference cannot support (review P3):
    expect(card).toContain("Reloading…");
    expect(card).toContain("Unavailable");
    expect(card).toContain("no longer available in this workspace");
  });
});

describe("citation identity (§11) — the canonical engine indices, never rebuilt", () => {
  it("the card's [n] chips resolve against the SAME payload's source indices", () => {
    expect(card).toContain("result.sources.find((s) => s.index === n && !s.excluded)");
    expect(card).not.toMatch(/reindex|renumber|sort.*citations/i);
  });

  it("the tool result carries the engine's indices verbatim (index/title/url/reliability/tier)", () => {
    expect(core).toMatch(/sources[\s\S]{0,200}index: s\?\.index/);
  });
});

describe("auto-selection + explicit override (§2/§3/§4)", () => {
  it("the tool contract names the proactive classes", () => {
    expect(core).toContain("CHOOSE IT PROACTIVELY");
    expect(core).toContain("competitive analysis, due diligence, acquisition or vendor evaluation");
    expect(core).toContain("source triangulation materially changes");
  });

  it("the explicit override phrases are honored", () => {
    expect(core).toContain("research this deeply");
    expect(core).toContain("do a deep dive");
    expect(core).toContain("use Deep Research");
    expect(core).toContain("investigate this before you answer");
  });

  it("web_search stays the light path — no keyword router, the contract decides", () => {
    expect(core).toContain("Do NOT reach for it on a simple fresh-fact lookup");
    expect(core).toContain("the lightest sufficient capability");
    expect(core).not.toContain("researchIntentRouter");
  });
});

describe("truthful runtime + honest states (§5/§14)", () => {
  it("ONE fixed-vocabulary activity label — never invented per-step progress", () => {
    expect(core).toContain('"Researching the live web"');
    expect(core).not.toContain("Reading source");
    expect(core).not.toContain("Comparing sources");
  });

  it("the card's states are distinct: unconfigured, no-findings, unverified, saved, not-saved", () => {
    expect(card).toContain("Live web search is not configured");
    expect(card).toContain("No findings survived validation");
    expect(card).toContain("Could not verify:");
    expect(card).toContain("Saved to this workspace's research library");
    expect(card).toContain("Not saved — the run could not be confirmed in this workspace");
  });

  it("sources collapse by default and open without leaving the conversation (§6)", () => {
    expect(card).toContain("dr-sources-toggle");
    expect(card).toContain('aria-expanded={sourcesOpen}');
  });
});

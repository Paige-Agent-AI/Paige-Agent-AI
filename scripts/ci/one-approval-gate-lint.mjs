#!/usr/bin/env node
/**
 * one-approval-gate-lint — there is ONE way to prove the operator said yes.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT A STYLE RULE. Paige can delete a contact, grant a role,
 * buy a number, publish a page. Before any of those run, the handler requires evidence that the
 * operator approved THAT call. The evidence is a fingerprint the server computed and the Approve
 * button echoed back in the request BODY — a place a model cannot write to.
 *
 * Between 2026-08-31 and 2026-09-01, three separate slices independently built a SECOND way to
 * prove the same thing (#709, #711, #718). Each was competent. That is exactly what makes the
 * pattern dangerous: a door with three locks is only as strong as the weakest one, and nobody
 * inspects the weak lock because each looks correct on its own. Two of the three accepted
 * evidence a model can manufacture — a token echoed back through a tool result, and a comparison
 * of the operator's last message against the exact words "Approved — run it."
 *
 * So this guard does not forbid gated actions. It forbids a SECOND CHANNEL. A new action that
 * needs approval gets it for free from the existing gate; what it must not do is invent its own
 * way to say yes.
 *
 * HOW TO ADD A GATED ACTION — the whole contract, so nobody has to reverse-engineer it:
 *   1. Classify the tool in `_shared/action-risk.ts` (ordinary | high | owner_only). The gate
 *      reads that file and nothing else, and an unclassified write refuses to run.
 *   2. Stop. Approval is already handled. Do not add a request field, do not read the operator's
 *      prose, do not echo a token back from a tool result.
 *   3. If — and only if — the action needs the operator to have SEEN a specific consequence
 *      first (an archive that destroys a folder's contents, say), mint a preview binding row and
 *      require it as a PRECONDITION: single-use, expiring, scoped to this tenant and this
 *      requester, and created BEFORE the current turn. That is a different claim from "they said
 *      yes", which is why it is allowed to coexist. `pipeline_archive_preview` is the worked
 *      example.
 *
 * Full contract: docs/doctrine/one-approval-gate.md
 *
 *   node scripts/ci/one-approval-gate-lint.mjs
 *   node scripts/ci/one-approval-gate-lint.mjs --self-test
 */
import fs from "node:fs";

const HANDLER = "supabase/functions/paige-ai-chat/index.ts";
// ADDED 2026-09-05 with the governed MCP door. This guard exists because three slices
// independently built a second approval channel, and the slice that makes an MCP mutation
// executable again will be written in these two files — which the guard did not open. It costs
// nothing today: the door invents no channel, constructs no claim, and maps no OAuth scope to
// consent. Adding them now means a false positive surfaces here rather than in the slice where it
// would be inconvenient to hear.
const SURFACES = [
  "src/components/dashboard/PaigeAIChat.tsx",
  "src/solo/data/useSoloChat.ts",
  "supabase/functions/paige-mcp/index.ts",
  "supabase/functions/_shared/paige-mcp/governed-adapter.ts",
  "supabase/functions/sales-invoice-command/index.ts",
  "supabase/functions/_shared/sales-invoice-chat.ts",
  "supabase/functions/_shared/sales-invoice-delivery/adapter.ts",
];
const ESCAPE = "approval-channel-exempt:";

/**
 * Each rule names a shape that has actually shipped and been removed. They are deliberately
 * narrow: a false positive here blocks another agent's work, and a guard people route around is
 * worse than none. Comments are stripped first, so the explanations above cannot satisfy them.
 */
const RULES = [
  {
    id: "prose-approval",
    // The specific failure: `lastUserMessage === "Approved — run it."`. Anything that can write
    // a message can write that sentence, so this is the model approving its own call.
    // Must compare the message's CONTENT. The first version matched any line mentioning the
    // variable near a `===` and fired on `messages.filter((m) => m.role === "user").pop()` —
    // a declaration, not an approval. A guard that cries wolf on another agent's correct code
    // is worse than no guard, because it teaches people to route around it.
    re: /(lastUserMessage|last_user_message)[^\n;]{0,80}\.content[^\n;]{0,80}===\s*["'`]/,
    why: 'compares the operator\'s message text to decide approval. A model can write any sentence, including that one. Classify the tool in _shared/action-risk.ts and let the fingerprint gate carry the approval.',
  },
  {
    id: "second-approval-field",
    // A new request-body field whose job is "the operator approved". The two that exist are
    // approvedConfirmations / declinedConfirmations; a third name means a second channel.
    re: /^\s*(confirmedActions|approvedActions|confirmedApprovals|ownerApprovals|approvalTokens)\s*:/m,
    why: 'adds a second approval field to the request body. `approvedConfirmations` already carries the operator\'s click for every gated action — one channel, or the weakest one becomes the way in.',
  },
  {
    id: "token-from-tool-result",
    // The #675 near-miss, recorded because it was the worst one: returning the approval token in
    // a TOOL RESULT hands it to the model, which the agentic loop feeds straight back.
    re: /toolResults\.push\([^)]*confirm_token/,
    why: 'returns an approval token in a tool result. The agentic loop feeds tool results back to the model, so it can replay its own token and approve itself one round later.',
  },
];

// Comments are BLANKED, not deleted, so reported line numbers still match the real file.
// The first version deleted them and pointed a reader 59 lines off the construct.
const strip = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/^(\s*)\/\/.*$/gm, (_m, indent) => indent);

export function scan(files) {
  const problems = [];
  for (const [path, raw] of files) {
    const lines = strip(raw).split("\n");
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        if (!rule.re.test(line)) return;
        if (line.includes(ESCAPE)) return; // a deliberate, explained exception
        problems.push(`${path}:${i + 1} — ${rule.why}`);
      });
    }
  }
  return problems;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["catches the prose comparison", [["f.ts", 'const ok = lastUserMessage?.content === "Approved — run it.";']], 1],
    ["catches a second approval field", [["f.ts", "  confirmedActions: z.array(x).optional(),"]], 1],
    ["catches a token in a tool result", [["f.ts", "toolResults.push({ content: JSON.stringify({ confirm_token: t }) });"]], 1],
    ["ignores its own explanatory comments", [["f.ts", '// never compare to "Approved — run it." here\n// confirmedActions: retired']], 0],
    ["allows an explained exemption", [["f.ts", 'x = lastUserMessage === "y"; // approval-channel-exempt: not an approval, a language check']], 0],
    ["leaves the real approval fields alone", [["f.ts", "  approvedConfirmations: z.array(z.string()).optional(),"]], 0],
    ["leaves a preview PRECONDITION alone", [["f.ts", "if (!previewPredatesTurn) { refuse(); }"]], 0],
    // Both of these are defects this guard shipped with and had caught in review.
    ["does not fire on the lastUserMessage declaration", [["f.ts", 'const lastUserMessage = messages.filter((m) => m.role === "user").pop();']], 0],
    // `want` may be a COUNT or a substring the finding must contain. The first version of this
    // case wrote the expected LINE NUMBER against a harness that compared counts, so it failed
    // for the wrong reason — a vacuous test in the guard built to stop vacuous approvals.
    ["reports the REAL line number, not a comment-stripped one", [["f.ts", '// pad\n/* pad\n   pad */\nconst ok = lastUserMessage.content === "Approved — run it.";']], "f.ts:4"],
  ];
  let bad = 0;
  for (const [name, files, want] of cases) {
    const found = scan(files);
    const ok = typeof want === "string"
      ? found.some((p) => p.includes(want))
      : found.length === want;
    if (ok) console.log(`  ok   ${name}`);
    else { console.log(`  FAIL ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(found)}`); bad++; }
  }
  console.log(bad ? `\n✗ one-approval-gate-lint self-test: ${bad} failure(s).` : "\n✓ one-approval-gate-lint self-test passed.");
  process.exit(bad ? 1 : 0);
}

const files = [HANDLER, ...SURFACES].filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f, "utf8")]);
if (!files.length) {
  console.log("✗ one-approval-gate-lint: found none of the files it guards — that is a resolver failure, not a pass.");
  process.exit(1);
}
const problems = scan(files);
if (problems.length) {
  console.log(`✗ one-approval-gate-lint: ${problems.length} second approval channel(s).\n`);
  for (const p of problems) console.log(`  • ${p}`);
  console.log("\n  Adding a gated action does NOT need a new approval path — see docs/doctrine/one-approval-gate.md.");
  console.log("  Classify the tool in supabase/functions/_shared/action-risk.ts and the existing gate covers it.");
  process.exit(1);
}
console.log(`✓ one-approval-gate-lint: ${files.length} file(s) checked, one approval channel.`);

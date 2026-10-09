const fs = require("fs");

// Fix the rail test: segment-wise gate assertions + per-file provider seams so the
// four shared-transport rails are actually pinned (not import-foolable).
const p = "supabase/functions/_shared/inbox-intelligence/provider-boundary.test.ts";
let s = fs.readFileSync(p, "utf8");

// 1. Make the transactional test SEGMENT-WISE: each provider site needs a gate in
// (previousSite, site) — deleting the general gate fails even with the welcome gate alive.
const oldTx = `Deno.test("boundary: send-transactional-email enforces the block before EVERY Resend call", async () => {
  const source = await readSource("supabase/functions/send-transactional-email/index.ts");
  assert(source.includes("providerExecutionBlocked"), "send-transactional-email must call the boundary");
  assert(source.includes("QA_NO_PROVIDER_EXECUTION"), "the truthful refusal code must be present");
  // NON-VACUOUS: every provider call site must be preceded by a gate on the general
  // path, not merely the first (the import line also matches a bare indexOf — so the
  // gate search starts AFTER the import, and the provider search walks ALL sites).
  const importEnd = source.indexOf("provider-boundary.ts");
  const providerSites = [...source.matchAll(/api\\.resend\\.com/g)].map((m) => m.index);
  assert(providerSites.length >= 2, "both Resend call sites must exist (welcome branch + general path)");
  for (const site of providerSites) {
    const gates = [...source.slice(importEnd, site).matchAll(/providerExecutionBlocked\\(/g)];
    assert(gates.length >= 1, \`a Resend call at offset \${site} has no boundary gate before it\`);
  }
});`;
if (!s.includes(oldTx)) throw new Error("transactional test block not found");
const newTx = `Deno.test("boundary: send-transactional-email gates BOTH Resend sites segment-wise", async () => {
  const source = await readSource("supabase/functions/send-transactional-email/index.ts");
  const importEnd = source.indexOf("provider-boundary.ts");
  const providerSites = [...source.matchAll(/api\\.resend\\.com/g)].map((m) => m.index);
  assert(providerSites.length >= 2, "both Resend call sites must exist (welcome branch + general path)");
  let previous = importEnd;
  for (const site of providerSites) {
    // SEGMENT-WISE: a gate must exist BETWEEN the previous site and this one, so
    // deleting any single gate fails exactly its own site.
    const gates = [...source.slice(previous, site).matchAll(/providerExecutionBlocked\\(/g)];
    assert(gates.length >= 1, \`the Resend call at offset \${site} has no boundary gate since the previous site (\${previous})\`);
    previous = site;
  }
});`;
s = s.replace(oldTx, newTx, 1);

// 2. Per-file seams for the carrier rails (their provider hosts live in shared modules).
const oldRail = s.slice(s.indexOf('Deno.test("boundary: the tenant-branded and carrier rails'), s.indexOf('Deno.test("boundary: the SQL helper'));
const newRail = `Deno.test("boundary: the tenant-branded and carrier rails gate before their provider seams", async () => {
  // Per file: an in-file provider literal (if any) AND the seam where the provider
  // round begins (direct fetch or the shared-transport entry call).
  const seams: Array<{ file: string; literal?: RegExp; seam: RegExp }> = [
    { file: "supabase/functions/send-portal-invite/index.ts", literal: /api\\.resend\\.com/g, seam: /fetch\\("https:\\/\\/api\\.resend\\.com/g },
    { file: "supabase/functions/comms-purchase-number/index.ts", seam: /purchaseNumber\\(/g },
    { file: "supabase/functions/comms-setup-calling/index.ts", seam: /provisionTenantTwilio\\(/g },
    { file: "supabase/functions/comms-a2p-register/index.ts", seam: /twilioJsonRequest\\(|twilioRequest\\(/g },
    { file: "supabase/functions/comms-a2p-submit/index.ts", seam: /QA_NO_PROVIDER_EXECUTION_CODE/g }, // no provider call today; the refusal presence is the pin
  ];
  for (const { file, literal, seam } of seams) {
    const source = await readSource(file);
    const importEnd = source.indexOf("provider-boundary.ts");
    assert(importEnd !== -1, file + " must import the boundary");
    const gates = [...source.matchAll(/providerExecutionBlocked\\(/g)].map((m) => m.index).filter((i) => i > importEnd);
    assert(gates.length >= 1, file + " must CALL the boundary (not merely import it)");
    const seamsFound = [...source.matchAll(seam)].map((m) => m.index).filter((i) => i > importEnd);
    assert(seamsFound.length >= 1, file + " lost its provider seam marker: " + seam.source);
    for (const site of seamsFound) {
      assert(gates.some((g) => g < site), file + ": provider seam at offset " + site + " has no gate before it");
    }
    if (literal) {
      for (const site of [...source.matchAll(literal)].map((m) => m.index)) {
        assert(gates.some((g) => g < site), file + ": provider literal at offset " + site + " has no gate before it");
      }
    }
  }
});

`;
s = s.replace(oldRail, newRail, 1);

// 3. P3-2: the parse-error text no longer advertises the disabled kind.
let c = "supabase/functions/_shared/inbox-intelligence/chat.ts";
let x = fs.readFileSync(c, "utf8");
x = x.replace(
  "kind is one of label, unlabel, archive, unarchive, trash, untrash, unsubscribe_propose, unsubscribe_send; message_id is a message id from inbox_list; label is a slug.",
  "kind is one of label, unlabel, archive, unarchive, trash, untrash, unsubscribe_propose (automatic unsubscribe SENDING is disabled — never offer it); message_id is a message id from inbox_list; label is a slug."
);
fs.writeFileSync(c, x);

fs.writeFileSync(p, s);
console.log("segment-wise tests + seams + truthful parse text");

// Owner addendum 6088460092 — discriminating boundary tests for the disabled
// automatic unsubscribe execution. Source-level assertions (the repo's n5
// extraction pattern): they read the REAL door source and prove (a) no fetch of
// an email-supplied URL exists anywhere in it (the only outbound fetches are
// Google API hosts), (b) the fail-closed refusal for unsubscribe_send exists and
// runs before any approval read, (c) the preview's reversibility is computed
// from organizeIsReversible, never a hardcoded true, (d) no undo_kind mapping
// points an unsubscribe kind at another command.
//   deno test --allow-import --node-modules-dir=none supabase/functions/_shared/inbox-intelligence/door-boundary.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const DOOR = "supabase/functions/comms-mailbox-command/index.ts";

async function doorSource(): Promise<string> {
  // The test runs from the repo root in CI; resolve relative to this file so it
  // also works from the module's own directory.
  const candidates = [Deno.cwd() + "/" + DOOR, new URL("../../../../" + DOOR, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")];
  for (const path of candidates) {
    try { return await Deno.readTextFile(path); } catch { /* next candidate */ }
  }
  throw new Error("door source not found");
}

Deno.test("boundary: the door NEVER fetches an email-supplied URL (no SSRF surface)", async () => {
  const source = await doorSource();
  // Every outbound fetch must target a Google API host literal.
  const fetches = [...source.matchAll(/await fetch\(([^)]{0,120})/g)].map((m) => m[1]);
  assert(fetches.length > 0, "the door must still perform its Gmail rounds");
  for (const target of fetches) {
    const isGoogle = target.includes("https://gmail.googleapis.com") || target.includes("https://oauth2.googleapis.com");
    assert(isGoogle, `non-Google fetch target found: ${target.trim()}`);
  }
  assert(!source.includes("fetch(httpsTarget"), "the email-supplied one-click URL must never be fetched");
});

Deno.test("boundary: automatic unsubscribe sending is fail-closed before any approval is read", async () => {
  const source = await doorSource();
  const refusalIndex = source.indexOf('UNSUBSCRIBE_AUTO_SEND_DISABLED');
  assert(refusalIndex !== -1, "the refusal code must exist");
  const claimIndex = source.indexOf("paige_pending_confirmations");
  assert(refusalIndex < claimIndex, "the refusal must precede the approval-store access");
  assert(source.includes('command.kind === "unsubscribe_send"'), "the refusal is keyed on the send kind");
});

Deno.test("boundary: preview reversibility is computed per kind, never hardcoded true", async () => {
  const source = await doorSource();
  assert(source.includes("reversible: organizeIsReversible(command.kind)"), "preview must derive reversibility from the contract");
  assert(!source.includes("reversible: true"), "no hardcoded reversible:true may remain");
});

Deno.test("boundary: no undo_kind maps an unsubscribe kind to another command", async () => {
  const source = await doorSource();
  const undoMap = source.match(/const undo: Record<string, string> = \{[^}]*\}/);
  assert(undoMap, "the undo map must exist");
  assertEquals(undoMap[0].includes("unsubscribe"), false);
});

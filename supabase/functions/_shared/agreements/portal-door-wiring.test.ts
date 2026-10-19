// deno test --allow-read --allow-import --node-modules-dir=none --deny-net --deny-env --deny-write supabase/functions/_shared/agreements/portal-door-wiring.test.ts
//
// Source-level wiring pins for agreement-document's third door (E09 Slice A). The door's behaviour
// is driven in portal-door.test.ts; these pin HOW it is mounted, because the two existing doors serve
// a legal retention obligation and must not move while a third is added beside them.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../../agreement-document/index.ts", import.meta.url));

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("doors one and two are byte-identical to main (dbb8a8842)", async () => {
  // From the DOOR ONE banner to the shared storage read: both existing door bodies, whole. The pin
  // was computed from the same region of the file on main before door three was added.
  const start = source.indexOf("    // ── DOOR ONE");
  const end = source.indexOf("  const file = await db.storage");
  assert(start > 0 && end > start, "both door bodies are present");
  assertEquals(await sha256(source.slice(start, end)), "7148c40a6ab73a948ee6a7df0aed28460e0a66e1fd82f9eb1f0e48501a126eb3");
});

Deno.test("door three is checked before door one and door two", () => {
  const three = source.indexOf("if (isPortalDoorRequest(url.searchParams)) {");
  const one = source.indexOf("} else if (token) {");
  const two = source.indexOf("// ── DOOR TWO");
  assert(three > 0 && three < one && one < two, "portal, then token, then workspace session");
});

Deno.test("door three refuses with the one shared refusal and never hands out a URL", () => {
  const block = source.slice(source.indexOf("if (isPortalDoorRequest(url.searchParams)) {"), source.indexOf("} else if (token) {"));
  assert(block.includes("if (!door) return refuse();"));
  assert(block.includes('Deno.env.get("SUPABASE_ANON_KEY")'), "the scope is asked with the caller's own JWT, not the service role");
  assert(!/createSignedUrl|getPublicUrl/.test(source), "no signed or public URL anywhere in the function");
});

Deno.test("only door three can change the disposition; the default stays inline", () => {
  assert(source.includes('let disposition: "inline" | "attachment" = "inline";'));
  assertEquals(source.split("disposition = door.disposition;").length - 1, 1);
  assert(source.includes('"Content-Disposition": `${disposition}; filename="${filename}"`,'));
});

Deno.test("no door records a downloaded event (parity, D-A6)", () => {
  assert(!source.includes("paige_agreement_events"));
});

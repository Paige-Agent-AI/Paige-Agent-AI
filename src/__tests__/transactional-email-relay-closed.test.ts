// The platform's email sender is not an open relay. send-transactional-email used to trust the
// gateway's verify_jwt, which the publishable key (shipped in the public site) passes, so anyone could
// send any template to any address. The decision itself is proved in
// supabase/functions/_shared/email/send-authority.test.ts; this pins where it is enforced, closes the
// side doors that forwarded to it with the service key, and keeps browser callers inside the policy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

const SENDER = "supabase/functions/send-transactional-email/index.ts";

describe("send-transactional-email decides authority before it does anything", () => {
  const src = code(SENDER);
  it("runs decideSendAuthority before the solo-welcome branch, the render, the log and the provider call", () => {
    const gate = src.indexOf("await decideSendAuthority(");
    expect(gate).toBeGreaterThan(-1);
    for (const later of [
      "if (templateName === 'solo-beta-welcome')",
      "renderAsync(",
      "from('email_send_log')",
      "https://api.resend.com/emails",
    ]) {
      expect(src.indexOf(later), later).toBeGreaterThan(gate);
    }
    expect(src).toMatch(/if \(!authority\.ok\) \{\s*return new Response/);
  });

  it("a person's send cannot choose the sender identity, reply-to or tenant", () => {
    expect(src).toMatch(
      /if \(authority\.kind === 'user'\) \{[\s\S]*?fromOverride = null[\s\S]*?replyToOverride = null[\s\S]*?tenantId = null/,
    );
  });

  it("no longer claims the gateway check is enough", () => {
    expect(read(SENDER)).not.toMatch(/No in-function auth check is needed/);
  });
});

describe("the side doors that forwarded with the service key are internal-only", () => {
  for (const fn of ["send-notification", "notify-approval-event"]) {
    it(`${fn} refuses anything that is not an internal caller before reading the body`, () => {
      const src = code(`supabase/functions/${fn}/index.ts`);
      const gate = src.indexOf("await isAuthorizedInternalCaller(req, adminClient())");
      expect(gate).toBeGreaterThan(-1);
      expect(src.indexOf("await req.json()")).toBeGreaterThan(gate);
    });
  }

  it("agreement-send calls the sender as an internal caller, not with the end user's token", () => {
    const src = code("supabase/functions/agreement-send/index.ts");
    expect(src).not.toMatch(/headers: \{ Authorization: authHeader, "Content-Type"/);
    expect(src).toMatch(/Authorization: `Bearer \$\{Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\}`/);
  });
});

describe("browser code asks the sender only for what a person may send", () => {
  const policy = read("supabase/functions/_shared/email/send-authority.ts");
  const allowed = new Set(
    [...policy.matchAll(/^\s*"([a-z0-9-]+)": \{ kind: "(self|operator|broker_relationship)" \},$/gm)].map((m) => m[1]),
  );

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name);
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(rel);
    }
  };
  walk("src");

  const calls = files.flatMap((f) => {
    const src = read(f);
    return [...src.matchAll(/functions\.invoke\(\s*["']send-transactional-email["'][\s\S]{0,400}?templateName:\s*["']([a-z0-9-]+)["'][^}]*\}?/g)]
      .map((m) => ({ file: f, template: m[1], body: m[0] }));
  });

  it("finds the browser callers (non-vacuous)", () => {
    expect(allowed.size).toBeGreaterThanOrEqual(7);
    expect(calls.length).toBeGreaterThanOrEqual(8);
  });

  it("every browser call names a user-sendable template", () => {
    for (const c of calls) expect(allowed.has(c.template), `${c.file}: ${c.template}`).toBe(true);
  });

  it("broker invites name the relationship, not an address", () => {
    for (const c of calls.filter((c) => c.template === "broker-client-invite")) {
      expect(c.body, c.file).toMatch(/relationshipId:/);
      expect(c.body, c.file).not.toMatch(/recipientEmail:/);
    }
  });

  it("the anonymous affiliate confirmation goes through its bounded function, never the sender", () => {
    const src = code("src/lib/affiliates/applications.ts");
    expect(src).toMatch(/functions\.invoke\("affiliate-application-confirm"/);
    expect(src).not.toMatch(/"affiliate-application-received"/);
  });
});

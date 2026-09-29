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

  it("send-beta-launch-email (mails every user) is platform-operator only, not the global admin role", () => {
    const src = code("supabase/functions/send-beta-launch-email/index.ts");
    expect(src).toMatch(/if \(\(await operatorUserId\(req\)\) !== callerId\)/);
    expect(src).not.toMatch(/r\.role === 'admin'/);
  });

  it("send-admin-invitation always sends the role invitation, with a bounded note, capped per inviter", () => {
    const src = code("supabase/functions/send-admin-invitation/index.ts");
    expect(src).toMatch(/templateName: INVITE_TEMPLATE,/);
    expect(src).toMatch(/const INVITE_TEMPLATE = "role-invitation"/);
    expect(src).not.toMatch(/body\.templateName|templateName \|\||\{ email, role, templateName/);
    expect(src).toMatch(/message\.length > MAX_MESSAGE_CHARS/);
    const cap = src.indexOf("await overRateLimit(limiter, `invite:${user.id}`");
    expect(cap).toBeGreaterThan(-1);
    expect(src.indexOf('from("invitations")')).toBeGreaterThan(cap);
    expect(src.indexOf("auth.admin.createUser(")).toBeGreaterThan(cap);
  });

  it("agreement-send calls the sender as an internal caller, not with the end user's token", () => {
    const src = code("supabase/functions/agreement-send/index.ts");
    expect(src).not.toMatch(/headers: \{ Authorization: authHeader, "Content-Type"/);
    expect(src).toMatch(/Authorization: `Bearer \$\{Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\}`/);
  });
});

describe("browser code asks the sender only for what a person may send", () => {
  const policy = read("supabase/functions/_shared/email/send-authority.ts");
  const allowed = new Set(
    [...policy.matchAll(/^\s*"([a-z0-9-]+)": \{ kind: "(own_ticket|operator)" \},$/gm)].map((m) => m[1]),
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

  // Each whole invoke call, from `functions.invoke("send-transactional-email", {` to its closing `})`.
  const calls = files.flatMap((f) => {
    const src = read(f);
    return [...src.matchAll(/functions\.invoke\(\s*["']send-transactional-email["'],\s*\{[\s\S]*?\n\s*\}\s*\)/g)].map((m) => ({
      file: f,
      template: /templateName:\s*["']([a-z0-9-]+)["']/.exec(m[0])?.[1] ?? "(none)",
      body: m[0],
    }));
  });

  it("no browser code calls the sender over raw fetch, around the invoke path", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/functions\/v1\/send-transactional-email/);
  });

  it("finds the browser callers (non-vacuous)", () => {
    expect(allowed.size).toBeGreaterThanOrEqual(6);
    expect(calls.length).toBeGreaterThanOrEqual(6);
  });

  it("every browser call names a user-sendable template", () => {
    for (const c of calls) expect(allowed.has(c.template), `${c.file}: ${c.template}`).toBe(true);
  });

  it("the support confirmation names the caller's ticket and nothing that reaches the email", () => {
    const own = calls.filter((c) => c.template === "support-ticket-created");
    expect(own.length).toBeGreaterThan(0);
    for (const c of own) {
      expect(c.body, c.file).toMatch(/ticketId:/);
      expect(c.body, c.file).not.toMatch(/recipientEmail:|templateData:/);
    }
  });

  it("no browser code asks the platform to email a broker's client (a broker profile is self-serve)", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/["']broker-client-invite["']/);
  });

  it("the anonymous affiliate confirmation goes through its bounded function, never the sender", () => {
    const src = code("src/lib/affiliates/applications.ts");
    expect(src).toMatch(/functions\.invoke\("affiliate-application-confirm"/);
    expect(src).not.toMatch(/"affiliate-application-received"/);
  });
});

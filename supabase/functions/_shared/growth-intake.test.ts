import { test } from "node:test";
import assert from "node:assert/strict";

import { isAllowedOrigin, isEmailAddress, looksLikeBot, sanitizeAnswers, sanitizeUtm } from "./growth-intake.ts";

const SCHEMA = {
  sections: [
    {
      fields: [
        { key: "name", type: "text", label: "Name", required: true },
        { key: "email", type: "email", label: "Email", required: true },
        { key: "phone", type: "tel", label: "Phone" },
        { key: "budget", type: "currency", label: "Budget" },
        { key: "plan", type: "radio", label: "Plan", options: ["solo", { label: "Team", value: "team" }] },
        { key: "tools", type: "checkbox", label: "Tools", options: ["crm", "scheduler"] },
        { key: "consent", type: "checkbox", label: "I agree" },
        { key: "notes", type: "textarea", label: "Notes" },
      ],
    },
    { visible_when: { all: [{ field: "plan", op: "eq", value: "team" }] }, fields: [{ key: "team_size", type: "number", required: true }] },
  ],
};

test("only the platform's own origins may submit", () => {
  assert.equal(isAllowedOrigin("https://paigeagent.ai"), true);
  assert.equal(isAllowedOrigin("https://www.paigeagent.ai"), true);
  assert.equal(isAllowedOrigin("https://northline.paigeagent.ai"), true);
  assert.equal(isAllowedOrigin("https://paige-agent-ai-git-main-paige-agent-ai.vercel.app"), false, "a *.vercel.app name anyone can register is refused");
  assert.equal(isAllowedOrigin("https://evil-paige-agent-ai.vercel.app"), false);
  assert.equal(isAllowedOrigin("http://paigeagent.ai"), false, "plain http is refused");
  assert.equal(isAllowedOrigin("https://paigeagent.ai.evil.example"), false, "a lookalike suffix is refused");
  assert.equal(isAllowedOrigin("https://evilpaigeagent.ai"), false, "a lookalike prefix is refused");
  assert.equal(isAllowedOrigin("https://other-app.vercel.app"), false, "another Vercel project is refused");
  assert.equal(isAllowedOrigin(null), false, "a request with no origin is refused");
  assert.equal(isAllowedOrigin("not a url"), false);
});

test("a filled or missing trap, missing timing, or an instant submission is a bot; a person is not", () => {
  assert.equal(looksLikeBot("https://spam.example", 5000), true);
  assert.equal(looksLikeBot({ x: 1 }, 5000), true);
  assert.equal(looksLikeBot("", 400), true);
  assert.equal(looksLikeBot("", 4000), false);
  assert.equal(looksLikeBot(undefined, undefined), true, "a script that leaves the trap out is not let through");
  assert.equal(looksLikeBot("", undefined), true, "timing is required");
  assert.equal(looksLikeBot(undefined, 4000), true, "the trap is required");
  assert.equal(looksLikeBot("", Number.NaN), true);
});

test("only a single well-formed address can become an email header", () => {
  assert.equal(isEmailAddress("dana@example.com"), true);
  assert.equal(isEmailAddress("dana@example.com\r\nBcc: x@evil.test"), false);
  assert.equal(isEmailAddress("a@example.com, b@example.com"), false);
  assert.equal(isEmailAddress("not an address"), false);
  assert.equal(isEmailAddress('"Dana"<dana@example.com>'), false, "a display-name form is not a bare address");
  assert.equal(isEmailAddress("a@example.com;b@example.com"), false, "a list is not one address");
  assert.equal(isEmailAddress(42), false);
});

test("only the form's own fields are kept, each in its type's shape", () => {
  const r = sanitizeAnswers(SCHEMA, {
    name: "  Dana Reyes ",
    email: "Dana@Example.COM",
    phone: "+1 (555) 010-2000 ext. 12",
    budget: "1200",
    plan: "solo",
    tools: ["crm", "scheduler", "crm"],
    consent: true,
    notes: "Hello",
    contact_id: "00000000-0000-0000-0000-000000000000",
    deal_id: "x",
    tenant_id: "y",
  });
  assert.deepEqual(r.answers, {
    name: "Dana Reyes",
    email: "dana@example.com",
    phone: "+1 (555) 010-2000 ext. 12",
    budget: 1200,
    plan: "solo",
    tools: ["crm", "scheduler"],
    consent: true,
    notes: "Hello",
  });
  assert.deepEqual(r.unknownKeys.sort(), ["contact_id", "deal_id", "tenant_id"], "fields the form does not have are dropped and reported");
  assert.deepEqual(r.invalidKeys, []);
  assert.deepEqual(r.missingRequired, [], "a branch-only required field is not enforced");
});

test("a value its field type does not allow is refused, and required fields are enforced", () => {
  const r = sanitizeAnswers(SCHEMA, { name: "", email: "not-an-email", plan: "enterprise", tools: ["crm", "hacking"], budget: "lots" });
  assert.deepEqual(r.invalidKeys.sort(), ["budget", "email", "plan", "tools"]);
  assert.deepEqual(r.missingRequired.sort(), ["email", "name"]);
  assert.deepEqual(r.answers, {});
});

test("long text is capped and odd input shapes are handled", () => {
  const r = sanitizeAnswers(SCHEMA, { name: "x".repeat(900), email: "a@b.co", notes: "y".repeat(9000) });
  assert.equal((r.answers.name as string).length, 500);
  assert.equal((r.answers.notes as string).length, 5000);
  assert.deepEqual(sanitizeAnswers(null, { a: 1 }).unknownKeys, ["a"]);
  assert.deepEqual(sanitizeAnswers(SCHEMA, "not an object").answers, {});
});

test("campaign tags only", () => {
  assert.deepEqual(
    sanitizeUtm({ utm_source: "ad", utm_medium: " cpc ", ref: "x", gclid: "g1", fbclid: "f1", utm_campaign: 5, contact_id: "y" }),
    { utm_source: "ad", utm_medium: "cpc", ref: "x", gclid: "g1", fbclid: "f1" });
});

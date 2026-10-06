#!/usr/bin/env node
// INT-332 — authenticated production drive of action continuity, as a real Solo owner (SHELL: SOLO).
//
// The strand it reproduces: PAIGE closes a finished answer on ONE offer; the person replies with a plain
// acceptance in their own words ("Yes we may as well for sure"); the turn must reach a tool and an
// approval card — never prose that narrates a card. Run on a LONG thread (40 earlier turns) and a fresh
// one, plus a decline control ("Ok I'll do it myself") that must create nothing. Controlled data only:
// the synthetic Solo owner's own workspace and its synthetic "Proof Recipient" contact.
//
// AUTH (the established controlled-proof pattern, see scripts/research-quality/q0-run.mjs and
// scripts/proof/comms-email-production-drive.mjs): the dedicated synthetic Solo owner of the synthetic
// test workspace; a fresh random password is set before the drive and rotated after. Env only, never
// logged: PROOF_EMAIL, PROOF_PASSWORD, PROOF_ANON_KEY, [PROOF_SUPABASE_URL].
// Output: one JSON line per step on stdout. Nothing is approved by this script.
const URL_ = process.env.PROOF_SUPABASE_URL || "https://xygzykjyynhzqytbqnzu.supabase.co";
const ANON = process.env.PROOF_ANON_KEY;
const RUN = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const out = (o) => console.log(JSON.stringify(o));

async function login() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.PROOF_EMAIL, password: process.env.PROOF_PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`session mint failed (${r.status})`);
  return { token: j.access_token, userId: j.user?.id };
}
const rest = (tok) => async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};

// One chat request, read as the client reads it: the SSE frames, the streamed text, the cards, the terminal.
async function chat(tok, { threadId, messages }) {
  const r = await fetch(`${URL_}/functions/v1/paige-ai-chat`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, threadId, requestIntentId: crypto.randomUUID(), userTimezone: "UTC" }),
  });
  const raw = await r.text();
  const frames = raw.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
  const text = frames.map((f) => f.choices?.[0]?.delta?.content ?? "").join("");
  const cards = frames.flatMap((f) => (f.paige_confirm ? [].concat(f.paige_confirm) : []));
  const turn = frames.map((f) => f.paige_turn).filter(Boolean);
  const terminal = turn.find((t) => t.event === "completed" || t.event === "waiting") ?? null;
  return { status: r.status, text, cards: cards.map((c) => ({ tool: c.tool, summary: String(c.summary ?? "").slice(0, 160), fingerprint: c.fingerprint })), terminal };
}

async function lastAssistant(R, threadId) {
  const q = await R(`paige_chat_turns?select=id,role,content,created_at,bundle_ref&thread_id=eq.${threadId}&role=eq.assistant&order=seq.desc&limit=1`);
  const row = Array.isArray(q.json) ? q.json[0] : null;
  return row ? { id: row.id, state: row.bundle_ref?.turn_state ?? null, cards: (row.bundle_ref?.paige_confirm ?? []).map((c) => c.tool), content: String(row.content).slice(0, 240) } : null;
}

const OFFER_PROMPT = (tag) => `Look up my contact Proof Recipient and tell me in two sentences what you see. Don't change anything yet. End your reply by offering one thing, as a question: to add a follow-up task for Proof Recipient titled "INT-332 follow-up ${tag}" due Friday.`;

async function scenario(tok, R, { name, history, reply }) {
  const created = await R("rpc/paige_chat_thread_create", { method: "POST", body: JSON.stringify({ p_contact_id: null, p_lens: "coach", p_title: `INT-332 proof ${RUN} ${name}`, p_consent_snapshot: null }) });
  const threadId = typeof created.json === "string" ? created.json : created.json?.id;
  if (!threadId) throw new Error(`thread create failed ${created.status}`);
  const messages = [];
  for (let i = 0; i < history; i++) {
    const role = i % 2 ? "assistant" : "user";
    const content = role === "user" ? `Earlier question ${i + 1} about this week's pipeline (${RUN}).` : `Earlier answer ${i + 1}: noted — nothing to change there.`;
    await R("rpc/paige_chat_turn_append", { method: "POST", body: JSON.stringify({ p_thread_id: threadId, p_role: role, p_content: content, p_surfaces_used: null, p_load_id: null, p_model: null, p_tokens_used: null, p_latency_ms: null, p_bundle_ref: null, p_tool_calls: null }) });
    messages.push({ role, content });
  }
  const tag = `${RUN}-${name}`;
  messages.push({ role: "user", content: OFFER_PROMPT(tag) });
  const offer = await chat(tok, { threadId, messages });
  const offerSaved = await lastAssistant(R, threadId);
  out({ scenario: name, step: "offer", threadId, history, status: offer.status, terminal: offer.terminal, cards: offer.cards, saved: offerSaved });
  messages.push({ role: "assistant", content: offer.text });
  messages.push({ role: "user", content: reply });
  const acc = await chat(tok, { threadId, messages });
  const accSaved = await lastAssistant(R, threadId);
  out({ scenario: name, step: "reply", reply, status: acc.status, terminal: acc.terminal, cards: acc.cards, text: acc.text.slice(0, 300), saved: accSaved });
  return { threadId, offer, acc };
}

async function main() {
  const { token, userId } = await login();
  const R = rest(token);
  const tenant = (await R("rpc/current_user_tenant_id", { method: "POST", body: "{}" })).json;
  out({ shell: "SOLO", run: RUN, actor: userId, tenant });
  await scenario(token, R, { name: "long", history: 40, reply: "Yes we may as well for sure" });
  await scenario(token, R, { name: "fresh", history: 0, reply: "Yes we may as well for sure" });
  await scenario(token, R, { name: "decline", history: 0, reply: "Ok I'll do it myself" });
}
main().catch((e) => { out({ error: String(e?.message ?? e) }); process.exit(1); });

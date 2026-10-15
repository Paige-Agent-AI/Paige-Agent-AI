#!/usr/bin/env node
// INT-328 comms.email_send — authenticated production drive of the governed door, as a real Solo
// owner (SHELL: SOLO). Controlled recipients only (Resend's delivered@/suppressed@ test addresses).
//
// AUTH (the established controlled-proof pattern, see scripts/research-quality/q0-run.mjs): the
// dedicated synthetic Solo owner of the synthetic test workspace; a fresh random password is set
// by the operator before the drive and rotated after. Env only, never logged:
//   PROOF_EMAIL, PROOF_PASSWORD, PROOF_ANON_KEY, [PROOF_SUPABASE_URL]
//   PROOF_FOREIGN_CONTACT_ID  a contact in ANOTHER tenant (cross-tenant negative)
//   PROOF_FOREIGN_TENANT_ID   another tenant id (workspace-mismatch negative)
// Phases: `main` (everything but expiry) and `expire <operation_id> <fingerprint> <subject> <body>`
// (approve a proposal minted > 10 minutes earlier). Output: one JSON line per case on stdout.
const URL_ = process.env.PROOF_SUPABASE_URL || "https://xygzykjyynhzqytbqnzu.supabase.co";
const ANON = process.env.PROOF_ANON_KEY;
const RUN = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const results = [];
const log = (c, pass, detail) => { const r = { case: c, pass, ...detail }; results.push(r); console.log(JSON.stringify(r)); };

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
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};
const door = (tok) => async (body, { auth = true } = {}) => {
  const r = await fetch(`${URL_}/functions/v1/comms-email-command`, { method: "POST", headers: { apikey: ANON, ...(auth ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
};

async function ensureContact(R, tenant, userId, first, last, email) {
  const found = await R(`client_contact_methods?select=client_id&tenant_id=eq.${tenant}&kind=eq.email&value=eq.${encodeURIComponent(email)}`);
  if (Array.isArray(found.json) && found.json[0]?.client_id) return found.json[0].client_id;
  const made = await R("rpc/create_contact_v2", { method: "POST", body: JSON.stringify({ p_first_name: first, p_last_name: last, p_email: email, p_phone: null, p_entity_name: null, p_title: null, p_lifecycle_stage: "new_lead", p_source: "int328_proof", p_tags: ["int328-proof"], p_primary_offer: null, p_notes: "INT-328 controlled proof contact (test recipient)", p_assigned_coach_user_id: null, p_tenant_id: tenant, p_created_by: userId, p_channel: "email" }) });
  const id = typeof made.json === "string" ? made.json : made.json?.id ?? made.json?.client_id ?? made.json?.contact_id ?? (Array.isArray(made.json) ? (made.json[0]?.contact_id ?? made.json[0]?.id) : null);
  if (!id) throw new Error(`contact create failed ${made.status} ${JSON.stringify(made.json).slice(0, 200)}`);
  return id;
}

async function main() {
  const { token, userId } = await login();
  const R = rest(token), D = door(token);
  const tenant = (await R("rpc/current_user_tenant_id", { method: "POST", body: "{}" })).json;
  console.log(JSON.stringify({ shell: "SOLO", run: RUN, actor: userId, tenant }));
  const A = await ensureContact(R, tenant, userId, "Proof", "Recipient", "delivered@resend.dev");
  const B = await ensureContact(R, tenant, userId, "Proof", "Suppressed", "suppressed@resend.dev");
  const C = await ensureContact(R, tenant, userId, "Proof", "Quiet", "delivered+dnd@resend.dev");
  const sup = await R("rpc/set_contact_channel_suppression", { method: "POST", body: JSON.stringify({ _contact_id: B, _channel: "email", _suppressed: true, _reason: "INT-328 proof: suppression must hold" }) });
  const dnd = await R(`clients?id=eq.${C}&tenant_id=eq.${tenant}`, { method: "PATCH", body: JSON.stringify({ dnd_active: true, dnd_reason: "INT-328 proof hold" }) });
  console.log(JSON.stringify({ fixtures: { A, B, C, suppression_status: sup.status, dnd_status: dnd.status } }));
  const cmd = (contact, n, extra = "") => ({ action: "comms.email_send", contact_id: contact, subject: `INT-328 proof ${RUN}-${n}`, body: `Controlled production proof ${RUN}-${n}.${extra}` });
  const op = () => crypto.randomUUID();

  // F3/F4 — proposal: nothing sent, the card carries To/From/Subject/Body.
  const op1 = op(); const c1 = cmd(A, 1);
  const p1 = await D({ expected_tenant_id: tenant, operation_id: op1, command: c1 });
  const pv = p1.json.preview || {};
  log("F3-F4 propose", p1.status === 202 && p1.json.outcome === "approval_required" && pv.to_address === "delivered@resend.dev" && /@mail\.paigeagent\.ai$/.test(pv.from_address || "") && pv.subject === c1.subject && pv.body_text === c1.body, { status: p1.status, outcome: p1.json.outcome, preview: pv, has_fingerprint: !!p1.json.fingerprint });
  // F6/F7 — approve: executes once, truthful result (accepted, never "delivered").
  const e1 = await D({ expected_tenant_id: tenant, operation_id: op1, command: c1, approved_fingerprint: p1.json.fingerprint });
  log("F6-F7 approve executes", e1.status === 200 && e1.json.outcome === "provider_accepted" && e1.json.delivery_confirmed === false, { status: e1.status, json: e1.json });
  // F9 — replay the same operation (with and without the spent fingerprint): recorded result, no second send.
  const r1 = await D({ expected_tenant_id: tenant, operation_id: op1, command: c1, approved_fingerprint: p1.json.fingerprint });
  log("F9 replay with spent approval", r1.json.replayed === true && r1.json.outcome === "provider_accepted" && r1.json.message_id === e1.json.message_id, { status: r1.status, json: r1.json });
  const r1b = await D({ expected_tenant_id: tenant, operation_id: op1, command: c1 });
  log("F9 replay without approval", r1b.json.replayed === true && r1b.json.outcome === "provider_accepted", { status: r1b.status, json: r1b.json });

  // F5 — a changed body under an approval minted for the original: refused; the approval is spent (F12).
  const op2 = op(); const c2 = cmd(A, 2);
  const p2 = await D({ expected_tenant_id: tenant, operation_id: op2, command: c2 });
  const m2 = await D({ expected_tenant_id: tenant, operation_id: op2, command: { ...c2, body: c2.body + " CHANGED AFTER APPROVAL" }, approved_fingerprint: p2.json.fingerprint });
  log("F5 mutated body refused", m2.json.ok === false && m2.json.outcome === "refused", { status: m2.status, json: m2.json });
  const m2b = await D({ expected_tenant_id: tenant, operation_id: op2, command: c2, approved_fingerprint: p2.json.fingerprint });
  log("F12 approval spent by refused mutation stays spent", m2b.json.ok === false && m2b.json.outcome !== "provider_accepted", { status: m2b.status, json: m2b.json });

  // F6/F9 — two concurrent approvals of one proposal: exactly one send.
  const op3 = op(); const c3 = cmd(A, 3);
  const p3 = await D({ expected_tenant_id: tenant, operation_id: op3, command: c3 });
  const [x, y] = await Promise.all([0, 1].map(() => D({ expected_tenant_id: tenant, operation_id: op3, command: c3, approved_fingerprint: p3.json.fingerprint })));
  const accepted = [x, y].filter(r => r.json.outcome === "provider_accepted");
  const ids = new Set(accepted.map(r => r.json.message_id));
  log("F6 concurrent approval sends once", accepted.length >= 1 && ids.size === 1, { a: { status: x.status, json: x.json }, b: { status: y.status, json: y.json } });

  // F15 — suppression and do-not-disturb are honoured: no card is raised, nothing is sent.
  const s = await D({ expected_tenant_id: tenant, operation_id: op(), command: cmd(B, 4) });
  log("F15 suppressed refused before any card", s.json.ok === false && !s.json.fingerprint && s.json.reason === "BLOCKED_SUPPRESSED", { status: s.status, json: s.json });
  const q = await D({ expected_tenant_id: tenant, operation_id: op(), command: cmd(C, 5) });
  log("F15 contact DND refused before any card", q.json.ok === false && !q.json.fingerprint && q.json.reason === "BLOCKED_CLIENT_DND", { status: q.status, json: q.json });

  // F13 — tenant safety: another workspace's contact, and a stale/foreign expected workspace.
  if (process.env.PROOF_FOREIGN_CONTACT_ID) {
    const f = await D({ expected_tenant_id: tenant, operation_id: op(), command: cmd(process.env.PROOF_FOREIGN_CONTACT_ID, 6) });
    log("F13 foreign contact refused", f.json.ok === false && f.json.reason === "CONTACT_NOT_IN_WORKSPACE" && !f.json.fingerprint, { status: f.status, json: f.json });
  }
  if (process.env.PROOF_FOREIGN_TENANT_ID) {
    const w = await D({ expected_tenant_id: process.env.PROOF_FOREIGN_TENANT_ID, operation_id: op(), command: cmd(A, 7) });
    log("F13 workspace mismatch refused", w.status === 409 && w.json.code === "WORKSPACE_CHANGED", { status: w.status, json: w.json });
  }
  const u = await D({ expected_tenant_id: tenant, operation_id: op(), command: cmd(A, 8) }, { auth: false });
  log("unauthenticated refused", u.status === 401, { status: u.status, json: u.json });

  // F11 — expiry: mint a proposal now; `expire` approves it after the 10-minute window.
  const op9 = op(); const c9 = cmd(A, 9);
  const p9 = await D({ expected_tenant_id: tenant, operation_id: op9, command: c9 });
  console.log(JSON.stringify({ expiry_pending: { operation_id: op9, fingerprint: p9.json.fingerprint, expires_at: p9.json.expires_at, subject: c9.subject, body: c9.body, contact: A } }));
  console.log(JSON.stringify({ summary: { passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).map(r => r.case) } }));
}

async function expire([operationId, fingerprint, subject, body, contact]) {
  const { token } = await login();
  const R = rest(token), D = door(token);
  const tenant = (await R("rpc/current_user_tenant_id", { method: "POST", body: "{}" })).json;
  const e = await D({ expected_tenant_id: tenant, operation_id: operationId, command: { action: "comms.email_send", contact_id: contact, subject, body }, approved_fingerprint: fingerprint });
  log("F11 expired approval cannot send", e.json.ok === false && e.json.outcome !== "provider_accepted", { status: e.status, json: e.json });
}

const [phase, ...rest_] = process.argv.slice(2);
(phase === "expire" ? expire(rest_) : main()).catch((err) => { console.error(`drive stopped: ${err.message}`); process.exit(1); });

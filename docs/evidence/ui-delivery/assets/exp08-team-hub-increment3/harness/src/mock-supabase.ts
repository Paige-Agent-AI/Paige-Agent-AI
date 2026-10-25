// Harness-only in-memory double shaped like the EXP08 increment-1 contract (amended A1–A7), the
// increment-2 work contract (team_hub_request_task, team_hub_list_work, work_ref on messages, and the
// caller-RLS read of plan_items by id) and the increment-3 attachments contract (team_hub_begin_file,
// the storage upload to the server-built path, functions.invoke("team-hub-file") finish/discard,
// team_hub_post_message with p_file_ids, files[] on messages, createSignedUrl for thumbnails and
// downloads). It is NOT the database, NOT Storage and NOT the edge function; it lets the real
// workspace render each documented answer. HIDDEN is a link whose plan_items row the caller's RLS
// does not return. Every name, file and figure here is synthetic.
const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "populated";
const ME = "u-me";
const meRole = params.get("me") ?? "owner";
const noWork = scenario === "nowork" || scenario === "firstuse";
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission });
const people = [person(ME, "Morgan Hale", "Founder", meRole), person("u-dana", "Dana Reyes", "Client lead", "admin"),
  person("u-sam-d", "Sam Lee", "Designer"), person("u-sam-s", "Sam Lee", "Sales"), person("u-priya", "Priya Natarajan", "Operations"),
  person("u-leo", "Leo Martins", null)];
const conv = (o: Record<string, unknown>) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: ago(3), ...o });
const msg = (o: Record<string, unknown>) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], work_ref: null, files: [], ...o });
const TENANT = "t-harness";
const MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv",
};
const posted = (id: string, name: string, mime: string, size: number) => ({ id, name, mime, size, path: `${TENANT}/team-hub/${id}` });
const F_PDF = "3d1f0a6e-8c42-4b7a-9e15-0a2b4c6d8e01"; const F_PNG = "3d1f0a6e-8c42-4b7a-9e15-0a2b4c6d8e02";
const F_DOCX = "3d1f0a6e-8c42-4b7a-9e15-0a2b4c6d8e03"; const F_XLSX = "3d1f0a6e-8c42-4b7a-9e15-0a2b4c6d8e04";
const TASK = "/PAIGE draft a task";
const T1 = "7f3c2a91-5b0e-4c1d-9a2f-1e6b8d4c0a11"; const T2 = "c41d9e07-2a6f-4b83-8e15-93a0f5b7d222"; const T3 = "0b8e5f34-d917-4a2c-b6e0-5c3f7a9e1333";
const HIDDEN = "e9a04c2d-7f18-4b6e-a3d5-2c8f1b0e9444";

const db = {
  people: scenario === "firstuse" ? [people[0], people[1]] : people,
  conversations: scenario === "firstuse" ? [] : [
    conv({ id: "c-general", name: "general" }),
    conv({ id: "c-onboard", name: "client-onboarding", unread: 2 }),
    conv({ id: "c-design", name: "design-reviews", joined: false }),
    conv({ id: "c-lead", name: "leadership", visibility: "private", member_count: 3, member_ids: [ME, "u-dana", "u-priya"] }),
    conv({ id: "c-dm-dana", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-dana"], dm_user_id: "u-dana", unread: 1 }),
    conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-priya"], dm_user_id: "u-priya" }),
  ],
  messages: {
    "c-general": [
      msg({ id: "m1", author_user_id: "u-priya", body: "Morning all. The Q4 kickoff deck is in the shared drive; I moved the agenda to Thursday at 10.", created_at: ago(60 * 26) }),
      msg({ id: "m2", author_user_id: "u-dana", body: "Thanks Priya. @Sam Lee (Designer) can you take a pass on the cover slide before then?", mentions: ["u-sam-d"], created_at: ago(60 * 25), reply_count: 3, last_reply_at: ago(60 * 24) }),
      msg({ id: "m3", author_user_id: "u-sam-d", body: "On it. I'll post two options by end of day.", created_at: ago(42) }),
      msg({ id: "m4", author_user_id: ME, body: "Great. Let's keep decisions for the kickoff in this channel so everyone can find them.", created_at: ago(30) }),
      msg({ id: "m5", author_user_id: "u-leo", body: "Calendar invite is out for Thursday. Reply here if the time doesn't work.", created_at: ago(8) }),
      ...(noWork ? [] : [
        msg({ id: "m6", author_user_id: "u-dana", body: TASK, work_ref: { source: "planning", id: HIDDEN }, created_at: ago(6) }),
        msg({ id: "m7", author_user_id: ME, body: TASK, work_ref: { source: "planning", id: T1 }, created_at: ago(4) }),
      ]),
      msg({ id: "m8", author_user_id: "u-sam-d", body: "Two cover options for Thursday, plus the brief they answer.", created_at: ago(3),
        files: [posted(F_PDF, "Kickoff-cover-brief.pdf", MIME.pdf, 1_843_200), posted(F_PNG, "cover-option-a.png", MIME.png, 412_672)] }),
      msg({ id: "m9", author_user_id: "u-dana", body: "", created_at: ago(2),
        files: [posted(F_DOCX, "Brightline-welcome-packet-v3.docx", MIME.docx, 96_256), posted(F_XLSX, "Q4-kickoff-budget.xlsx", MIME.xlsx, 23_552)] }),
    ],
    "c-onboard": [
      msg({ id: "o1", author_user_id: "u-dana", body: "Welcome packet for the Brightline account is drafted. Priya, can you check the intake questions?", created_at: ago(60 * 27) }),
      msg({ id: "o2", author_user_id: "u-priya", body: "Checked. I added two questions about their reporting cadence.", created_at: ago(60 * 26) }),
      msg({ id: "o3", author_user_id: ME, body: "Thanks both. I'll send it Monday morning.", created_at: ago(60 * 25) }),
      msg({ id: "o4", author_user_id: "u-dana", body: "Their ops lead asked to move the kickoff call to 2pm. I said yes pending your OK.", created_at: ago(35) }),
      msg({ id: "o5", author_user_id: "u-leo", body: "Booked the 2pm slot and sent the updated invite.", created_at: ago(12) }),
      ...(noWork ? [] : [
        msg({ id: "o6", author_user_id: "u-dana", body: TASK, work_ref: { source: "planning", id: T2 }, created_at: ago(60 * 3) }),
        msg({ id: "o7", author_user_id: "u-priya", body: TASK, work_ref: { source: "planning", id: T3 }, created_at: ago(60 * 2) }),
      ]),
    ],
  } as Record<string, ReturnType<typeof msg>[]>,
  replies: {
    m2: [
      msg({ id: "r1", author_user_id: "u-sam-d", parent_message_id: "m2", body: "Yes, I'll have it by Wednesday noon.", created_at: ago(60 * 24 + 40) }),
      msg({ id: "r2", author_user_id: "u-dana", parent_message_id: "m2", body: "Perfect. Keep the client logo off the cover for now.", created_at: ago(60 * 24 + 20) }),
      msg({ id: "r3", author_user_id: "u-priya", parent_message_id: "m2", body: "Agreed. I'll add the final version to the deck.", created_at: ago(60 * 24) }),
    ],
  } as Record<string, ReturnType<typeof msg>[]>,
};

// What Operations holds, as the caller's RLS returns it. HIDDEN is deliberately absent.
const dueIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(23, 59, 0, 0); return d.toISOString(); };
const planItems: Record<string, Record<string, unknown>> = {
  [T1]: { id: T1, title: "Send the Brightline welcome packet", status: "in_progress", assigned_to_user_id: ME, due_at: dueIn(3), updated_at: ago(2) },
  [T2]: { id: T2, title: "Confirm Brightline kickoff agenda with their ops lead", status: "open", assigned_to_user_id: "u-priya", due_at: dueIn(1), updated_at: ago(60 * 3) },
  [T3]: { id: T3, title: "Add reporting-cadence questions to the intake form", status: "done", assigned_to_user_id: "u-priya", due_at: null, updated_at: ago(50) },
};
const workRefs = noWork ? [] : [
  { message_id: "m7", channel_id: "c-general", parent_message_id: null, source: "planning", work_id: T1, created_by: ME, created_at: ago(4) },
  { message_id: "m6", channel_id: "c-general", parent_message_id: null, source: "planning", work_id: HIDDEN, created_by: "u-dana", created_at: ago(6) },
  { message_id: "o7", channel_id: "c-onboard", parent_message_id: null, source: "planning", work_id: T3, created_by: "u-priya", created_at: ago(60 * 2) },
  { message_id: "o6", channel_id: "c-onboard", parent_message_id: null, source: "planning", work_id: T2, created_by: "u-dana", created_at: ago(60 * 3) },
];

// ── Increment 3: the file records the server would hold, and how each synthetic file name behaves. ──
// A chip's fate is chosen by its (synthetic) file name, so each documented answer can be rendered:
//   hold-upload  → the storage upload never answers (chip stays "Uploading…")
//   hold-check   → team-hub-file finish never answers ("Checking…")
//   fail-upload  → the first upload fails with a network error ("Upload didn't finish" + Retry); a Retry succeeds
//   reject:<code> → finish answers {ok:false, code:"rejected", reason:<code>} (each sniff/verdict reason code)
//   begin:<code>  → team_hub_begin_file refuses with that code (too_large, limit_reached, invalid, rejected, not_found)
//   finish:<code> → finish refuses with a refusal code (invalid, not_found, …)
type Rec = { id: string; path: string; name: string; mime: string; size: number; state: string; channel: string; requestId: string; message: string | null };
const files: Record<string, Rec> = {};
const byRequest: Record<string, string> = {};
const fate = (name: string) => {
  const rule = (window as unknown as { __thFates?: Record<string, string> }).__thFates?.[name];
  return rule ?? "ready";
};
const log = (entry: unknown) => { ((window as unknown as { __thFileLog?: unknown[] }).__thFileLog ??= []).push(entry); };
const uploadAttempts: Record<string, number> = {};
let fileSeq = 0;
const never = <T,>() => new Promise<T>(() => undefined);

let seq = 0;
function backend(name: string, p: Record<string, unknown>) {
  if (scenario === "unavailable") return { ok: false, code: "unavailable" };
  if (name === "team_hub_list_conversations") return { ok: true, tenant_id: "t-harness", me: { user_id: ME }, people: db.people, conversations: db.conversations };
  if (name === "team_hub_mark_read") { ((window as unknown as { __thMarks?: unknown[] }).__thMarks ??= []).push(p.p_through_message_id); return { ok: true }; }
  if (name === "team_hub_list_messages") {
    const c = db.conversations.find((item) => item.id === p.p_channel_id);
    if (!c) return { ok: false, code: "not_found" };
    const channel = { id: c.id, kind: c.kind, name: c.name, visibility: c.visibility, joined: c.joined };
    const newest = (rows: ReturnType<typeof msg>[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (p.p_thread_root) {
      const root = (db.messages[c.id as string] ?? []).find((item) => item.id === p.p_thread_root);
      return root ? { ok: true, channel, root, messages: newest(db.replies[root.id as string] ?? []), has_more: false } : { ok: false, code: "not_found" };
    }
    return { ok: true, channel, messages: newest(db.messages[c.id as string] ?? []), has_more: c.id === "c-general" };
  }
  if (name === "team_hub_begin_file") {
    log({ rpc: name, name: p.p_name, mime: p.p_mime, size: p.p_size });
    const rule = fate(String(p.p_name));
    if (rule.startsWith("begin:")) return { ok: false, code: rule.slice(6) };
    const existing = byRequest[String(p.p_client_request_id)];
    if (existing) { const r = files[existing]; return { ok: true, file: { id: r.id, path: r.path, name: r.name, mime: r.mime, size: r.size, state: r.state } }; }
    fileSeq += 1;
    const id = `9c7e2b10-4d3a-4f6e-8a1b-${String(fileSeq).padStart(12, "0")}`;
    const rec: Rec = { id, path: `${TENANT}/team-hub/${id}`, name: String(p.p_name), mime: String(p.p_mime), size: Number(p.p_size), state: "pending", channel: String(p.p_channel_id), requestId: String(p.p_client_request_id), message: null };
    files[id] = rec; byRequest[rec.requestId] = id;
    return { ok: true, file: { id, path: rec.path, name: rec.name, mime: rec.mime, size: rec.size, state: rec.state } };
  }
  if (name === "team_hub_post_message") {
    seq += 1;
    const ids = (p.p_file_ids as string[] | undefined) ?? [];
    log({ rpc: name, body: p.p_body, p_file_ids: ids });
    const recs = ids.map((id) => files[id]);
    if (recs.some((r) => !r || r.state !== "ready" || r.message || r.channel !== p.p_channel_id)) return { ok: false, code: "invalid" };
    const id = `p${seq}`;
    for (const r of recs) r.message = id;
    return { ok: true, message: msg({ id, author_user_id: ME, body: String(p.p_body), created_at: new Date().toISOString(), mentions: p.p_mention_ids ?? [],
      parent_message_id: p.p_parent_message_id ?? null, files: recs.map((r) => posted(r.id, r.name, r.mime, r.size)) }) };
  }
  if (name === "team_hub_list_work") return { ok: true, items: workRefs };
  if (name === "team_hub_request_task") {
    seq += 1;
    const id = `5a${String(seq).padStart(6, "0")}-0000-4000-8000-00000000${String(seq).padStart(4, "0")}`;
    planItems[id] = { id, title: String(p.p_title), status: "open", assigned_to_user_id: p.p_assignee ?? ME, due_at: p.p_due_at ?? null, updated_at: new Date().toISOString() };
    const message = msg({ id: `pt${seq}`, author_user_id: ME, body: TASK, work_ref: { source: "planning", id }, created_at: new Date().toISOString() });
    workRefs.unshift({ message_id: message.id as string, channel_id: String(p.p_channel_id), parent_message_id: null, source: "planning", work_id: id, created_by: ME, created_at: message.created_at as string });
    return { ok: true, message, duplicate: false };
  }
  return { ok: false, code: "invalid" };
}

// supabase.from("plan_items").select(cols).eq("tenant_id", t).in("id", ids): the caller-RLS read.
function planItemsQuery() {
  const filters: { tenant?: unknown } = {};
  const builder = {
    select: (_cols: string) => builder,
    eq: (column: string, value: unknown) => { if (column === "tenant_id") filters.tenant = value; return builder; },
    in: async (_column: string, ids: string[]) => {
      ((window as unknown as { __thReads?: unknown[] }).__thReads ??= []).push(ids);
      if (scenario === "readfail") return { data: null, error: { message: "harness: read failed" } };
      if (filters.tenant !== "t-harness") return { data: [], error: null };
      return { data: ids.map((id) => planItems[id]).filter(Boolean), error: null };
    },
  };
  return builder;
}

// functions.invoke("team-hub-file", {body:{action, expected_tenant, file_id}}): the edge function's answers.
async function invokeFile(fn: string, body: { action: string; expected_tenant: string; file_id: string }) {
  log({ fn, ...body });
  if (fn !== "team-hub-file" || body.expected_tenant !== TENANT) return { data: null, error: { message: "harness: unexpected function" } };
  const rec = files[body.file_id];
  if (body.action === "discard") { if (rec && !rec.message) rec.state = "discarded"; return { data: rec ? { ok: true, path: rec.path } : { ok: false, code: "not_found" }, error: null }; }
  if (!rec) return { data: { ok: false, code: "not_found" }, error: null };
  const rule = fate(rec.name);
  if (rule === "hold-check") return never<{ data: unknown; error: unknown }>();
  if (rule.startsWith("reject:")) { rec.state = "rejected"; return { data: { ok: false, code: "rejected", reason: rule.slice(7) }, error: null }; }
  if (rule.startsWith("finish:")) return { data: { ok: false, code: rule.slice(7) }, error: null };
  rec.state = "ready";
  return { data: { ok: true, file: { id: rec.id, path: rec.path, mime: rec.mime, size: rec.size, state: "ready" } }, error: null };
}

// A synthetic thumbnail (drawn shapes, no photo of anyone), served as an SVG data URL.
const thumb = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b3f6e"/><stop offset="1" stop-color="#9aa3c9"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><circle cx="58" cy="24" r="10" fill="#f1e9d8"/><path d="M0 64 L26 40 L44 56 L58 46 L80 62 L80 80 L0 80Z" fill="#20223b"/></svg>')}`;
const dlFail = params.get("dl") === "fail";
const storage = {
  from: (bucket: string) => ({
    upload: async (path: string, body: File, options: { upsert?: boolean; contentType?: string }) => {
      log({ storage: "upload", bucket, path, type: body.type, size: body.size, upsert: options?.upsert });
      const rec = Object.values(files).find((r) => r.path === path);
      if (bucket !== "comms-attachments" || !rec || rec.state !== "pending") return { data: null, error: { message: "harness: refused by the insert policy", statusCode: "403" } };
      const rule = fate(rec.name);
      if (rule === "hold-upload") return never<{ data: unknown; error: unknown }>();
      uploadAttempts[path] = (uploadAttempts[path] ?? 0) + 1;
      if (rule === "fail-upload" && uploadAttempts[path] === 1) throw new TypeError("harness: network down");
      return { data: { path }, error: null };
    },
    createSignedUrl: async (path: string, seconds: number, options?: { download?: string }) => {
      log({ storage: "createSignedUrl", bucket, path, seconds, download: options?.download ?? null });
      if (bucket !== "comms-attachments" || !path.startsWith(`${TENANT}/team-hub/`)) return { data: null, error: { message: "harness: not found" } };
      if (options?.download) return dlFail ? { data: null, error: { message: "harness: object not found" } } : { data: { signedUrl: `https://storage.harness.invalid/${path}?token=t&download=${encodeURIComponent(options.download)}` }, error: null };
      return { data: { signedUrl: thumb }, error: null };
    },
  }),
};

export const supabase = {
  storage,
  functions: { invoke: (fn: string, options: { body: { action: string; expected_tenant: string; file_id: string } }) => invokeFile(fn, options.body) },
  from: (table: string) => {
    if (table !== "plan_items") throw new Error(`harness: unexpected table ${table}`);
    return planItemsQuery();
  },
  rpc: async (name: string, p: Record<string, unknown>) => {
    if (scenario === "failed" && name === "team_hub_post_message") return { data: null, error: { message: "harness: network down" } };
    return { data: backend(name, p), error: null };
  },
};

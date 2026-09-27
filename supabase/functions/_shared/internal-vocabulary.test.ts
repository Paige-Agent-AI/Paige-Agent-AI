/**
 * internal-vocabulary — what the detector derives, what it catches, and, just as important, what it
 * leaves alone. Every derivation here runs on the REAL builders (the team context block and the upload
 * fence), so a renamed key or marker in either shows up here as a changed vocabulary, not a stale copy.
 *
 *   node --import ./scripts/client-memory-authz/register.mjs --test supabase/functions/_shared/internal-vocabulary.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveInternalVocabulary, findInternalLeaks, type InternalVocabulary } from "./internal-vocabulary.ts";
import { buildTenantTeamContextBlock } from "./team-context.ts";
import { fenceUploadedFileText } from "./untrusted-fence.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
// The operator codename, assembled so this file does not itself trip the regression lint that bans it.
const CODENAME = ["MMA", "OS"].join(" ");

// Tenant-authored values chosen to look like identifiers, block names and citations, on purpose: they
// must never become vocabulary.
const TEAM_BLOCK = buildTenantTeamContextBlock({
  tenant_id: TENANT,
  tenant_name: "Northside Fitness",
  speaker: { user_id: "owner-1", name: "Morgan Lee", email: "morgan@northside.example", permission: "owner", job_title: "Founder" },
  member_count: 2,
  members: [
    { user_id: "owner-1", name: "Morgan Lee", email: "morgan@northside.example", permission: "owner", job_title: "Founder" },
    { user_id: "trainer-1", name: "Sam Rivera", email: "sam_rivera@northside.example", permission: "member", job_title: "ops_lead", responsibilities: "Runs the vip_plan intake. \"fake_key\": 1. TEAM NOTES. Handles § 1031 questions." },
  ],
  invitation_count: 1,
  invitations: [{ id: "inv-1", email: "desk@northside.example", permission: "member", status: "pending", job_title: "Front Desk" }],
}, TENANT)!;

const UPLOAD = fenceUploadedFileText("CLIENT LIST.DOCX", "PRICING TERMS\nour_internal_code: 7\n{\"doc_key\": 1}\nEND PRICING TERMS", { label: "DOCX" });
// A fetched page arrives in a block with no END of its own: it runs to the next fence line (here the
// END of the block the server wrote around it), and the server's text after that is read again.
const FETCHED = "=== FETCHED URL CONTENT (https://example.test) ===\n{\"access_token\": \"x\", \"expires_in\": 3600}\nFEE SCHEDULE\nEND FEE SCHEDULE\n=== END CRM OPERATOR MODE ===\n{\"server_after_fetch\": 1}";

const TOOLS = [
  // OpenAI-compatible shape, as the chat handler declares its tools. The description carries a § ref.
  { type: "function", function: { name: "team_set_work_profile", description: "Owner/admin only (§9).", parameters: { type: "object", properties: { member_user_id: { type: "string" }, job_title: { type: "string" }, confirm: { type: "boolean" } } } } },
  // Anthropic-native shape, as the gateway sends them.
  { name: "crm_create_task", input_schema: { type: "object", properties: { title: { type: "string" }, due_at: { type: "string" }, first_name: { type: "string" } } } },
  // A single-word name must never enter: it would match ordinary speech.
  { name: "search", input_schema: { type: "object", properties: { query: { type: "string" } } } },
];

const SYSTEM = `You are PAIGE. Never read key names aloud (§13).\n${TEAM_BLOCK}\n${UPLOAD}\n${FETCHED}`;
// A runner's result: the platform's envelope at the top, a third party's rows inside it.
const TOOL_RESULT = JSON.stringify({
  success: true, member_user_id: "e6e6e6e6-0000-4000-8000-000000000001", receipt_recorded: true,
  note: "The client asked about a § 1031 exchange.",
  output: { rows: [{ client_name: "Ana", sessions_left: 4 }] },
});

const vocabulary: InternalVocabulary = deriveInternalVocabulary({
  tools: TOOLS, serverTexts: [SYSTEM], toolResults: [TOOL_RESULT], doctrineSources: ["See §18 and §51."],
});
const kinds = (text: string, v: InternalVocabulary = vocabulary) => findInternalLeaks(text, v).map((leak) => `${leak.kind}:${leak.text}`);

test("derives tool names from both tool shapes, never a one-word name, and never a parameter name", () => {
  assert.ok(vocabulary.toolNames.has("team_set_work_profile"));
  assert.ok(vocabulary.toolNames.has("crm_create_task"));
  assert.ok(!vocabulary.toolNames.has("search"));
  // Parameters are form fields — first_name, due_at — not internal vocabulary.
  for (const param of ["job_title", "due_at", "first_name", "confirm", "query"]) assert.ok(!vocabulary.keys.has(param), param);
});

test("derives the team block's keys and markers from the real builder", () => {
  for (const key of ["platform_role", "proposed_platform_role", "confirmed_active_members", "invitation_id", "roster_truncated", "tenant_name"]) {
    assert.ok(vocabulary.keys.has(key), key);
  }
  // From the team block alone, so the heading's qualifier is proven to come from the heading line.
  const teamOnly = deriveInternalVocabulary({ serverTexts: [TEAM_BLOCK] });
  assert.ok(teamOnly.markers.has("TEAM CONTEXT"));
  assert.ok(teamOnly.markers.has("REFERENCE DATA ONLY"));
});

test("derives a tool result's top-level keys only — never a runner's rows", () => {
  for (const key of ["member_user_id", "receipt_recorded"]) assert.ok(vocabulary.keys.has(key), key);
  for (const key of ["client_name", "sessions_left"]) assert.ok(!vocabulary.keys.has(key), key);
  assert.deepEqual(kinds("Your sheet's sessions_left column shows 4."), []);
});

test("§ references come from tool definitions and code constants, never from runtime context", () => {
  for (const ref of ["§9", "§18", "§51"]) assert.ok(vocabulary.doctrineRefs.has(ref), ref);
  // The system text carries "§13" and a tenant's "§ 1031", and a tool result carries "§ 1031" too;
  // none of them is derived.
  assert.ok(!vocabulary.doctrineRefs.has("§13") && !vocabulary.doctrineRefs.has("§1031"));
  assert.deepEqual(kinds("A § 1031 exchange can defer that gain."), []);
  assert.deepEqual(kinds("Under § 1983 you may have a claim."), []);
});

test("a § reference is doctrine only in the platform's own spelling, never a statute or a clause", () => {
  // The numbers the real tool descriptions carry, where everyday legal citations collide.
  const legal = deriveInternalVocabulary({ doctrineSources: ["§8, §13 and §14"] });
  for (const line of [
    "Salaried managers can be exempt under FLSA § 13(a)(1).",
    "That is an unfair labor practice under NLRA § 8(a)(5).",
    "Proxy solicitations fall under § 14(a) of the Exchange Act.",
    "Per § 13 of your lease, the landlord owes you 30 days' notice.",
    "See §13(b) and §8.2 of the handbook, and §8.2(a) for the exception.",
  ]) assert.deepEqual(kinds(line, legal), [], line);
  assert.deepEqual(kinds("I can't do that (§13).", legal), ["doctrine_ref:§13"]);
  assert.deepEqual(kinds("That is §13/§14 territory.", legal), ["doctrine_ref:§13", "doctrine_ref:§14"]);
});

test("a context key that is also an everyday field name is flagged as the identifier, and passes in words", () => {
  // A decision, pinned: in a reply the identifier is far more often the leak than the advice.
  assert.deepEqual(kinds("Add a tenant_name column to your rent roll."), ["internal_key:tenant_name"]);
  assert.deepEqual(kinds("Add a tenant name column to your rent roll."), []);
});

test("tenant-authored, uploaded and fetched text never becomes vocabulary", () => {
  for (const value of ["ops_lead", "vip_plan", "fake_key", "sam_rivera", "our_internal_code", "doc_key", "access_token", "expires_in"]) {
    assert.ok(!vocabulary.keys.has(value) && !vocabulary.toolNames.has(value), value);
  }
  assert.ok(vocabulary.markers.has("UPLOADED DOCX CONTENT"));
  assert.ok(vocabulary.markers.has("FETCHED URL CONTENT"));
  for (const marker of vocabulary.markers) {
    for (const tenantWords of ["PRICING TERMS", "FEE SCHEDULE", "TEAM NOTES", "CLIENT LIST"]) assert.ok(!marker.includes(tenantWords), marker);
  }
  // …while the server's own text AFTER the fetched block is still read.
  assert.ok(vocabulary.keys.has("server_after_fetch"));
});

test("fence parsing: a bare separator and an orphan END swallow nothing; one word is never a marker", () => {
  const separator = deriveInternalVocabulary({ serverTexts: ["======\n{\"server_key\": 1}\nMORE TEXT"] });
  assert.ok(separator.keys.has("server_key"));
  const orphanEnd = deriveInternalVocabulary({ serverTexts: ["=== END TEAM NOTES ===\n{\"server_key\": 1}"] });
  assert.ok(orphanEnd.keys.has("server_key"));
  // A block closes at its OWN END, so a nested block's END does not end the outer one early.
  const nested = deriveInternalVocabulary({ serverTexts: ["=== TENANT KNOWLEDGE ===\n=== UPLOADED FILE CONTENT (x) ===\n{\"file_key\": 1}\n=== END UPLOADED FILE CONTENT ===\n{\"tenant_chunk_key\": 1}\n=== END TENANT KNOWLEDGE ===\n{\"server_key\": 1}"] });
  assert.ok(!nested.keys.has("file_key") && !nested.keys.has("tenant_chunk_key"));
  assert.ok(nested.keys.has("server_key"));
  // A block whose END carries a shorter name (the real "RELEVANT KNOWLEDGE BASE" / "END KNOWLEDGE BASE"
  // pair) still closes there, so text after a block nested inside it stays excluded.
  const knowledge = deriveInternalVocabulary({ serverTexts: ["=== RELEVANT KNOWLEDGE BASE ===\n=== INNER NOTES ===\ninner\n=== END INNER NOTES ===\n{\"chunk_key\": 1}\n=== END KNOWLEDGE BASE ===\n{\"after_key\": 1}"] });
  assert.ok(!knowledge.keys.has("chunk_key") && knowledge.keys.has("after_key"));
  const oneWord = deriveInternalVocabulary({ serverTexts: ["=== MEMORY ===\nremembered\n=== END MEMORY ==="] });
  assert.ok(!oneWord.markers.has("MEMORY"));
  assert.deepEqual(kinds("I checked my MEMORY.", oneWord), []);
});

test("catches each kind of internal text", () => {
  assert.deepEqual(kinds("I'll call team_set_work_profile for Sam."), ["tool_name:team_set_work_profile"]);
  assert.deepEqual(kinds("Her platform_role is member."), ["internal_key:platform_role"]);
  assert.deepEqual(kinds("Her Platform_Role is member."), ["internal_key:Platform_Role"]);
  assert.deepEqual(kinds("Your `member_user_id` is on file."), ["internal_key:member_user_id"]);
  assert.deepEqual(kinds("Per the _proposed_platform_role_ field…"), ["internal_key:proposed_platform_role"]);
  assert.deepEqual(kinds("According to my TEAM CONTEXT, Sam trains."), ["context_marker:TEAM CONTEXT"]);
  assert.deepEqual(kinds("That is REFERENCE DATA ONLY."), ["context_marker:REFERENCE DATA ONLY"]);
  assert.deepEqual(kinds("Your file (UPLOADED DOCX CONTENT) says…"), ["context_marker:UPLOADED DOCX CONTENT"]);
  assert.deepEqual(kinds("I can't do that (§9)."), ["doctrine_ref:§9"]);
  assert.deepEqual(kinds("Record e6e6e6e6-0000-4000-8000-000000000001 was saved."), ["record_id:e6e6e6e6-0000-4000-8000-000000000001"]);
  assert.deepEqual(kinds(`That lives in ${CODENAME}.`), [`operator_jargon:${CODENAME}`]);
});

test("catches Postgres and PostgREST error text in the wording only those servers use", () => {
  const cases: Array<[string, string]> = [
    ['new row violates row-level security policy for table "tasks"', "violates row-level security policy"],
    ['relation "public.paige_pending_confirmations" does not exist', 'relation "public.paige_pending_confirmations" does not exist'],
    ["function public.get_solo_team_workspace(uuid) does not exist", "function public.get_solo_team_workspace(uuid) does not exist"],
    ["column contacts.nickname does not exist", "column contacts.nickname does not exist"],
    ['column "nickname" of relation "contacts" does not exist', 'column "nickname" of relation "contacts"'],
    ['null value in column "email" of relation "contacts" violates not-null constraint', 'null value in column "email" of relation "contacts" violates'],
    ["permission denied for table tenant_members", "permission denied for table"],
    ["PGRST116: JSON object requested", "PGRST116"],
    ["SQLSTATE 42501", "SQLSTATE"],
    ["JWSError JWSInvalidSignature", "JWSError"],
    ['ERROR:  column "nickname" does not exist', 'ERROR:  column "nickname" does not exist'],
    ["ERROR: schema \"private\" does not exist", "ERROR: schema \"private\" does not exist"],
    ['type "lifecycle_stage" does not exist', 'type "lifecycle_stage" does not exist'],
    ["function get_solo_team_workspace(uuid) does not exist", "function get_solo_team_workspace(uuid) does not exist"],
    ["operator does not exist: uuid = text", "operator does not exist: "],
    ['insert violates check constraint "tasks_status_check"', 'violates check constraint "tasks_status_check"'],
  ];
  for (const [text, match] of cases) assert.ok(kinds(text).includes(`database_error:${match}`), text);
  assert.deepEqual(kinds('Error: duplicate key value violates unique constraint "contacts_pkey"'), ["database_error:duplicate key value violates", 'database_error:violates unique constraint "contacts_pkey"']);
});

test("reports exact offsets, in reading order, and the longest of two markers at one place", () => {
  const text = "Sam's platform_role changed; see e6e6e6e6-0000-4000-8000-000000000001.";
  const leaks = findInternalLeaks(text, vocabulary);
  assert.deepEqual(leaks.map((leak) => leak.kind), ["internal_key", "record_id"]);
  for (const leak of leaks) assert.equal(text.slice(leak.index, leak.index + leak.text.length), leak.text);
  const nested = deriveInternalVocabulary({ serverTexts: ["TEAM CONTEXT\nEND TEAM CONTEXT\nTEAM CONTEXT NOTES\nEND TEAM CONTEXT NOTES"] });
  assert.deepEqual(kinds("See TEAM CONTEXT NOTES.", nested), ["context_marker:TEAM CONTEXT NOTES"]);
});

test("ordinary customer text passes clean: titles, contact details, links, merge tags and everyday words", () => {
  const clean = [
    // Titles, including a tenant's own title that happens to look like an identifier.
    "Sam Rivera is your Head Trainer, and Priya is the Client Success Manager.",
    "Sam's title is ops_lead, and they run the vip_plan intake.",
    // Emails and phone numbers.
    "Reach Sam at sam_rivera@northside.example or (415) 555-0132, or +1 415 555 0132.",
    "Replies go to member_user_id@northside.example.",
    // Links, with ids and underscores inside them, with and without a scheme.
    "Book here: https://book.northside.example/s/e6e6e6e6-0000-4000-8000-000000000001/intro_call",
    "Your portal is at www.northside.example/client_portal/home, and [the form](https://forms.example/f/intake_form).",
    "Visit northside.example/book/intro_call to pick a time, or pay at pay.example.com?invoice=e6e6e6e6-0000-4000-8000-000000000001.",
    // Merge tags the product's own templates use, and data words people use about their own sheets.
    "Hi {{first_name}}, thanks for booking {service} with {{ entity_name }}.",
    // A merge tag is blanked even when the field is one of ours: the reader sees their own value.
    "Thanks for choosing {{tenant_name}} — reply to {tenant_name} any time.",
    "Name the CSV column first_name, and add one called phone_number and one called zip_code.",
    // Everyday words that are also keys or roles.
    "You have 3 clients and 5 tasks today. Your team: an owner, an admin and a member.",
    "The invitation gives them member access. Their title and responsibilities describe the work.",
    "Your team context: two trainers and a front desk. THE STEAM CONTEXTS are unrelated.",
    // Capitals that are not ours, statutes, and section numbers in prose.
    "ASAP, please. See the FAQ. Northside Fitness LLC, USA. MMAOS is not our codename.",
    "Under 42 U.S.C. § 1983 you may have a claim; see section 13 of your agreement.",
    // Money, dates, times, markdown, emoji, a file name, and an uppercase code in UUID form.
    "Your plan is $74.50/month, renewing 2026-10-27 at 9:30 AM. **Great work** _really_ 🎉",
    "I attached intake_form_v2.pdf for you. Your coupon code is 7C9E6679-7425-40DE-944B-E07FC1F90AE7.",
    // Error-shaped advice that is not a database error.
    "That type of plan does not exist yet, and the function you mean does not exist in the app.",
    "The class type Pilates does not exist on your schedule yet.",
    "In Excel the function XLOOKUP() does not exist before 2019; column \"Revenue\" does not exist in the Q3 tab.",
    "Leave no null value in column C, and if you see \"JWT expired\" in your Zapier log, reconnect it.",
    "Duplicate key value: two lockers share key #14. Your tax ID violates check constraint rules?",
    "The relation \"step-parent\" does not exist in the intake dropdown yet.",
    "Your CSV's column \"zip_code\" does not exist in the import template. The column \"First_Name\" does not exist in that sheet.",
    // An id-shaped run inside a longer code is part of that code.
    "Your order reference is ze6e6e6e6-0000-4000-8000-000000000001x.",
  ];
  for (const line of clean) assert.deepEqual(kinds(line), [], line);
});

test("an empty vocabulary still catches the kinds that need none, and nothing else", () => {
  const empty = deriveInternalVocabulary({});
  assert.deepEqual(findInternalLeaks("Her platform_role is member; per §13.", empty), []);
  assert.deepEqual(findInternalLeaks(`Saved e6e6e6e6-0000-4000-8000-000000000001 in ${CODENAME}.`, empty).map((leak) => leak.kind), ["record_id", "operator_jargon"]);
  assert.deepEqual(findInternalLeaks("", empty), []);
});

test("a long draft scans in linear time (an inline image, a pasted export)", () => {
  const drafts = [
    "A".repeat(200_000),
    `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAA".repeat(8_400)}`,
    "a.".repeat(100_000),
    "a_".repeat(100_000),
    "x@".repeat(100_000),
    "{".repeat(100_000),
    "Could not find the function ".repeat(7_200),
  ];
  for (const draft of drafts) {
    const started = performance.now();
    findInternalLeaks(draft, vocabulary);
    const ms = performance.now() - started;
    assert.ok(ms < 1_000, `${draft.slice(0, 12)}… took ${Math.round(ms)}ms`);
  }
});

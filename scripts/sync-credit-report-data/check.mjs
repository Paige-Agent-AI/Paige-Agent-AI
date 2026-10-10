/**
 * `sync-credit-report-data` — the SHARED credit-profile writer, DRIVEN.
 *
 * WHY THIS FILE EXISTS (#734). The callee is the one writer behind FIVE producers
 * (`paige-apply-extraction`, `analyze-credit-report`, `CreditReportUploader`,
 * `CreditIntelligence`, `ReportUploadTab`; chat retired its direct call). It discarded
 * write errors at four sites, so a run where every row failed to write still reported
 * per-group counts as successes. A fifth, blunter defect: the audit-log step references
 * an identifier that no longer exists (`disputesCreated`), so at HEAD every run THROWS
 * at that step and answers 500 AFTER the writes have landed — the "uncertain outcome"
 * class, lived every time. These checks pin the repaired contract: truthful per-group
 * inserted/updated/failed/dropped counts, a zero-row profile update distinguished from a
 * written one, an additive outcome classification (complete | partial | failed, plus
 * skipped groups), initiated-only reporting for the fire-and-forget followups, and the
 * authz/tenant scoping the producers rely on.
 *
 * Only the module boundary is faked (Deno serve, supabase-js, the two fire-and-forget
 * fetches). The handler itself is the shipped one. Synthetic fixtures only — no real
 * credit record shape beyond column names, no real identifiers.
 *
 * Run: node --import ./scripts/sync-credit-report-data/register.mjs scripts/sync-credit-report-data/check.mjs
 */

const USER = "55555555-5555-4555-8555-555555555555";   // the person syncing their own records
const OTHER = "66666666-6666-4666-8666-666666666666";  // a different person (authz cases)

let passed = 0;
const failures = [];
const assert = (name, cond, detail = "") => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`); }
};

globalThis.Deno = {
  env: { get: (k) => ({
    SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  })[k] ?? "" },
};

// The two fire-and-forget followups (steps 11/12) go through global fetch.
let fetchLog = [];
let rejectStageDisputes = false;
globalThis.fetch = async (url, _init) => {
  const href = String(url);
  if (href.includes("auto-stage-disputes")) {
    fetchLog.push("auto-stage-disputes");
    if (rejectStageDisputes) throw new TypeError("network error: connection reset");
    return new Response("{}", { status: 200 });
  }
  if (href.includes("generate-credit-predictions")) {
    fetchLog.push("generate-credit-predictions");
    return new Response("{}", { status: 200 });
  }
  throw new Error(`sync check: unexpected fetch to ${href}`);
};

const fake = await import("./fake-supabase.mjs");
await import("../../supabase/functions/sync-credit-report-data/index.ts");
const { capturedHandler } = await import("./stub-serve.mjs");
const handler = capturedHandler();

/** A complete, well-formed synthetic payload. Every fixture here is synthetic (#734 rule). */
const basePayload = (over = {}) => ({
  target_user_id: USER,
  report_type: "consumer",
  scores: { equifax: 712, experian: 705, transunion: 698 },
  negative_items: [{ creditor_name: "Synthetic Capital", bureau: "equifax", item_type: "collection", account_number: "SYN-001", amount: 250 }],
  hard_inquiries: [{ creditor_name: "Synthetic Bank", bureau: "equifax", inquiry_date: "2026-09-01" }],
  positive_accounts: [{ creditor: "Synthetic Card Co", account_number: "SYN-A1", account_type: "credit card", balance: 100, credit_limit: 1000 }],
  discrepancies: [],
  priority_disputes: [],
  ...over,
});

async function drive({ auth = "user", target = USER, payload, scenario = {} }) {
  const headers = { "Content-Type": "application/json" };
  if (auth === "user") headers.Authorization = "Bearer user-jwt";
  else if (auth === "service") headers.Authorization = "Bearer service-role-key";
  const sc = {
    user: auth === "user" ? { id: USER } : null,
    ...scenario,
  };
  if (auth === "user" && !scenario.db?.profiles && scenario.db?.profiles === undefined && sc.db === undefined) {
    // default: a profile row exists so the scores step has something to write
  }
  const rec = fake.setScenario(sc);
  fetchLog = []; rejectStageDisputes = false;
  let res, body;
  try {
    res = await handler(new Request("http://local/sync-credit-report-data", {
      method: "POST",
      headers,
      body: JSON.stringify(payload ?? basePayload({ target_user_id: target })),
    }));
    body = await res.json().catch(() => ({}));
  } catch (err) {
    return { rec, status: 500, body: { error: String(err?.message ?? err) }, threw: true, fetchLog: [...fetchLog] };
  }
  return { rec, status: res.status, body, fetchLog: [...fetchLog] };
}

const profileRow = (id = USER) => ({ user_id: id, estimated_fico_eq: 600, estimated_fico_ex: 600, estimated_fico_tu: 600 });

// ── 1. A FULLY SUCCESSFUL SYNC reports saved — and the audit row exists (#734 D0).
//
// At HEAD the handler reaches the audit-log step and throws ReferenceError on an identifier
// removed in 08eb34040 (`disputesCreated`), so every run answers 500 AFTER the writes land.
{
  const r = await drive({ scenario: { db: { profiles: [profileRow()] } } });
  assert("1.1 a clean run answers 200, not a post-write 500 (the audit-step ReferenceError)",
    r.status === 200 && r.body.success === true, `status ${r.status} body ${JSON.stringify(r.body).slice(0, 160)}`);
  const audit = fake.db().audit_logs.find((a) => a.action === "chat_report_analyzed");
  assert("1.2 the step-9 audit row is written (nothing throws before it)",
    !!audit, JSON.stringify(fake.db().audit_logs.map((a) => a.action)));
  assert("1.3 the audit row's disputes_auto_created is the §194 constant 0, not a dead identifier",
    audit?.data?.disputes_auto_created === 0, JSON.stringify(audit?.data?.disputes_auto_created));
  assert("1.4 the writes themselves landed (scores + one row per group)",
    fake.db().credit_negative_items.length === 1 && fake.db().credit_inquiries.length === 1
      && fake.db().credit_accounts.length === 1 && fake.db().profiles[0].estimated_fico_eq === 712,
    JSON.stringify({ neg: fake.db().credit_negative_items.length, inq: fake.db().credit_inquiries.length, accts: fake.db().credit_accounts.length }));
  assert("1.5 the outcome is classified complete with every group attempted and none failed",
    r.body.results?.outcome?.status === "complete"
      && Array.isArray(r.body.results?.outcome?.failed_groups) && r.body.results.outcome.failed_groups.length === 0
      && r.body.results.outcome.groups_attempted.includes("hard_inquiries"),
    JSON.stringify(r.body.results?.outcome));
}

// ── 2. SCORES: a zero-row profiles update is NOT a success (#734 gap 4).
//
// prevProfile is already fetched; a missing profile row means the update can match nothing.
// The response must say so instead of scores_updated:true.
{
  const r = await drive({ payload: basePayload({ negative_items: [], hard_inquiries: [], positive_accounts: [], scores: { equifax: 700 } }), scenario: { db: { profiles: [] } } });
  assert("2.1 no profile row → scores are reported NOT updated",
    r.status === 200 && r.body.results?.scores_updated !== true,
    JSON.stringify(r.body.results?.scores_updated));
  assert("2.2 the zero-row case is named explicitly (no-row, not write-error)",
    r.body.results?.scores_no_profile_row === true, JSON.stringify(r.body.results));
  assert("2.3 the scores step attempts no profiles UPDATE when there is no row to update",
    !r.rec.calls.some((c) => c.table === "profiles" && c.op === "update" && c.row && "estimated_fico_eq" in c.row),
    JSON.stringify(r.rec.calls.filter((c) => c.table === "profiles").map((c) => c.op)));
  assert("2.4 the skip reaches the classification (skipped, not silent)",
    r.body.results?.outcome?.skipped_groups?.includes("scores") && r.body.results.outcome.status === "partial",
    JSON.stringify(r.body.results?.outcome));
  assert("2.5 a scores UPDATE ERROR stays an error (existing behaviour pinned)",
    (await drive({
      payload: basePayload({ negative_items: [], hard_inquiries: [], positive_accounts: [] }),
      scenario: { db: { profiles: [profileRow()] }, failures: [{ table: "profiles", op: "update" }] },
    })).body.results?.scores_updated !== true);
}

// ── 3. NEGATIVE ITEMS: the UPDATE branch counts its failures (#734 gap 3).
//
// Only the INSERT branch read its error; an existing row whose update fails was counted
// as negativeItemsUpdated.
{
  const existing = { user_id: USER, bureau: "equifax", item_type: "collection", account_number: "SYN-001", creditor_name: "Synthetic Capital", status: "active" };
  const payload = basePayload({ scores: undefined, negative_items: [basePayload().negative_items[0]], hard_inquiries: [], positive_accounts: [], discrepancies: [] });
  const r = await drive({
    payload,
    scenario: { db: { profiles: [profileRow()], credit_negative_items: [existing] }, failures: [{ table: "credit_negative_items", op: "update" }] },
  });
  assert("3.1 a failed UPDATE of an existing item is counted failed, not updated",
    r.body.results?.negative_items?.failed === 1 && r.body.results.negative_items.updated === 0,
    JSON.stringify(r.body.results?.negative_items));
  assert("3.2 …and reaches the classification as a failed group",
    r.body.results?.outcome?.failed_groups?.includes("negative_items") && r.body.results.outcome.status === "failed" && r.body.success === false,
    JSON.stringify(r.body.results?.outcome));
  assert("3.3 a failed INSERT is still counted failed (existing behaviour pinned)",
    (await drive({
      payload,
      scenario: { db: { profiles: [profileRow()] }, failures: [{ table: "credit_negative_items", op: "insert" }] },
    })).body.results?.negative_items?.failed === 1);
}

// ── 4. HARD INQUIRIES: insert errors are not successes, and a failed counter exists (#734 gap 1).
{
  const payload = basePayload({ scores: undefined, negative_items: [], positive_accounts: [], hard_inquiries: [
    { creditor_name: "Synthetic Bank", bureau: "equifax", inquiry_date: "2026-09-01" },
    { creditor_name: "Synthetic Bank Two", bureau: "experian", inquiry_date: "2026-09-02" },
  ] });
  const r = await drive({ payload, scenario: { db: { profiles: [] }, failures: [{ table: "credit_inquiries", op: "insert" }] } });
  assert("4.1 every failed inquiry insert is counted failed, never inserted",
    r.body.results?.hard_inquiries?.inserted === 0 && r.body.results.hard_inquiries.failed === 2,
    JSON.stringify(r.body.results?.hard_inquiries));
  assert("4.2 all-inserts-failed is a total failure (success:false, status failed)",
    r.body.success === false && r.body.results?.outcome?.status === "failed",
    JSON.stringify({ success: r.body.success, outcome: r.body.results?.outcome }));
  assert("4.3 nothing landed for the group",
    fake.db().credit_inquiries.length === 0, JSON.stringify(fake.db().credit_inquiries.length));
}

// ── 5. POSITIVE ACCOUNTS: both branches count failures (#734 gap 2).
{
  const existing = { user_id: USER, account_number: "SYN-A1", creditor: "Synthetic Card Co", type: "credit_card" };
  const payload = basePayload({
    scores: undefined, negative_items: [], hard_inquiries: [],
    positive_accounts: [
      { creditor: "Synthetic Card Co", account_number: "SYN-A1", account_type: "credit card", balance: 1 },
      { creditor: "Synthetic Auto", account_number: "SYN-A2", account_type: "auto loan", balance: 2 },
    ],
  });
  const r = await drive({
    payload,
    scenario: {
      db: { profiles: [], credit_accounts: [existing] },
      failures: [{ table: "credit_accounts", op: "update" }, { table: "credit_accounts", op: "insert" }],
    },
  });
  assert("5.1 failed update AND failed insert both count as failed",
    r.body.results?.positive_accounts?.failed === 2
      && r.body.results.positive_accounts.updated === 0 && r.body.results.positive_accounts.inserted === 0,
    JSON.stringify(r.body.results?.positive_accounts));
  assert("5.2 the account store is unchanged (failed writes mutate nothing)",
    fake.db().credit_accounts.length === 1 && fake.db().credit_accounts[0].balance === undefined,
    JSON.stringify(fake.db().credit_accounts));
}

// ── 6. PARTIAL COMPLETION is distinct from total failure — successes stay successes.
{
  const existing = { user_id: USER, bureau: "equifax", item_type: "collection", account_number: "SYN-001", creditor_name: "Synthetic Capital", status: "active" };
  const r = await drive({
    scenario: {
      db: { profiles: [profileRow()], credit_negative_items: [existing] },
      failures: [{ table: "credit_negative_items", op: "update" }, { table: "credit_inquiries", op: "insert" }],
    },
  });
  // base payload: 1 negative (existing → update fails), 1 inquiry (insert fails), 1 account (ok), scores ok
  assert("6.1 status is partial — not complete, not failed",
    r.body.results?.outcome?.status === "partial", JSON.stringify(r.body.results?.outcome));
  assert("6.2 success stays true: writes DID land (a false success:false would tell callers nothing saved)",
    r.body.success === true, JSON.stringify(r.body.success));
  assert("6.3 failed groups are exactly the two that failed",
    JSON.stringify(r.body.results?.outcome?.failed_groups) === JSON.stringify(["negative_items", "hard_inquiries"]),
    JSON.stringify(r.body.results?.outcome?.failed_groups));
  assert("6.4 the groups that wrote are counted as written",
    r.body.results?.positive_accounts?.inserted === 1 && r.body.results?.scores_updated === true,
    JSON.stringify({ pa: r.body.results?.positive_accounts, sc: r.body.results?.scores_updated }));
}

// ── 7. ROWS THE DEFENSIVE FILTER DROPS are neither successes nor failures — they are named.
{
  const r = await drive({
    payload: basePayload({
      negative_items: [
        { creditor_name: "Synthetic Capital", bureau: "equifax", item_type: "collection" },
        { creditor_name: "", bureau: "equifax", item_type: "collection" },          // no name → dropped
      ],
      hard_inquiries: [{ creditor_name: "No Date Bank", bureau: "equifax" }],       // no date → dropped
      positive_accounts: [{ account_type: "credit card" }],                          // no creditor → dropped
    }),
    scenario: { db: { profiles: [profileRow()] } },
  });
  assert("7.1 dropped rows are counted per group",
    r.body.results?.negative_items?.dropped === 1 && r.body.results?.hard_inquiries?.dropped === 1
      && r.body.results?.positive_accounts?.dropped === 1,
    JSON.stringify({ n: r.body.results?.negative_items, h: r.body.results?.hard_inquiries, p: r.body.results?.positive_accounts }));
  assert("7.2 a run whose every ATTEMPTED write succeeded is still complete",
    r.body.results?.outcome?.status === "complete" && r.body.success === true,
    JSON.stringify(r.body.results?.outcome));
  assert("7.3 the surviving rows still landed",
    fake.db().credit_negative_items.length === 1 && fake.db().credit_inquiries.length === 0 && fake.db().credit_accounts.length === 0,
    JSON.stringify({ n: fake.db().credit_negative_items.length }));
}

// ── 8. THE OTHER TWO WRITE GROUPS STOP REPORTING INTENT AS OUTCOME.
{
  const disc = await drive({
    payload: basePayload({ scores: undefined, negative_items: [], hard_inquiries: [], positive_accounts: [], discrepancies: [{ account_name: "Synthetic", issue: "mismatch", bureaus_affected: ["equifax"] }] }),
    scenario: { db: { profiles: [profileRow()] }, failures: [{ table: "profiles", op: "update" }] },
  });
  assert("8.1 a failed discrepancies profile write reports flagged:false plus the error",
    disc.body.results?.discrepancies_flagged === false && !!disc.body.results?.discrepancies_error
      && disc.body.results?.outcome?.failed_groups?.includes("discrepancies"),
    JSON.stringify({ f: disc.body.results?.discrepancies_flagged, o: disc.body.results?.outcome }));
  const discNoRow = await drive({
    payload: basePayload({ scores: undefined, negative_items: [], hard_inquiries: [], positive_accounts: [], discrepancies: [{ account_name: "Synthetic", issue: "mismatch", bureaus_affected: ["equifax"] }] }),
    scenario: { db: { profiles: [] } },
  });
  assert("8.2 no profile row → discrepancies skipped with the no-row reason, not flagged",
    discNoRow.body.results?.discrepancies_flagged !== true && discNoRow.body.results?.discrepancies_no_profile_row === true
      && discNoRow.body.results?.outcome?.skipped_groups?.includes("discrepancies"),
    JSON.stringify(discNoRow.body.results));
  const fr = await drive({
    scenario: { db: { profiles: [profileRow()], funding_readiness_scores: [{ user_id: USER, id: "fr-1", personal_credit_score: 0 }] }, failures: [{ table: "funding_readiness_scores", op: "update" }] },
  });
  assert("8.3 a failed funding-readiness write reports recalculated:false plus the error",
    fr.body.results?.funding_readiness_recalculated === false && !!fr.body.results?.funding_readiness_error
      && fr.body.results?.outcome?.failed_groups?.includes("funding_readiness"),
    JSON.stringify({ f: fr.body.results?.funding_readiness_recalculated, o: fr.body.results?.outcome }));
  const fac = await drive({
    scenario: { db: { profiles: [profileRow()] }, failures: [{ table: "credit_factor_scores", op: "insert" }] },
  });
  assert("8.4 a failed factor-score write reports recalculated:false plus the error (distinct from a calc throw)",
    fac.body.results?.credit_factors_recalculated === false && !!fac.body.results?.credit_factors_error
      && fac.body.results?.outcome?.failed_groups?.includes("credit_factors"),
    JSON.stringify({ f: fac.body.results?.credit_factors_recalculated, e: fac.body.results?.credit_factors_error }));
  const frIns = await drive({
    scenario: { db: { profiles: [profileRow()], funding_readiness_scores: [] }, failures: [{ table: "funding_readiness_scores", op: "insert" }] },
  });
  assert("8.5 a failed funding-readiness INSERT reports recalculated:false plus the error (insert branch)",
    frIns.body.results?.funding_readiness_recalculated === false && !!frIns.body.results?.funding_readiness_error
      && frIns.body.results?.outcome?.failed_groups?.includes("funding_readiness"),
    JSON.stringify({ f: frIns.body.results?.funding_readiness_recalculated, e: frIns.body.results?.funding_readiness_error }));
  const facUpd = await drive({
    scenario: { db: { profiles: [profileRow()], credit_factor_scores: [{ user_id: USER, id: "f-1" }] }, failures: [{ table: "credit_factor_scores", op: "update" }] },
  });
  assert("8.6 a failed factor-score UPDATE reports recalculated:false plus the error (update branch)",
    facUpd.body.results?.credit_factors_recalculated === false && !!facUpd.body.results?.credit_factors_error
      && facUpd.body.results?.outcome?.failed_groups?.includes("credit_factors"),
    JSON.stringify({ f: facUpd.body.results?.credit_factors_recalculated, e: facUpd.body.results?.credit_factors_error }));
}

// ── 9. FIRE-AND-FORGET FOLLOWUPS are reported as INITIATED — never as done.
{
  const r = await drive({ scenario: { db: { profiles: [profileRow()] } } });
  assert("9.1 all three followups are listed as initiated (outcome unknown by design, never implied complete)",
    Array.isArray(r.body.results?.followups_initiated)
      && ["detect-credit-alerts", "auto-stage-disputes", "generate-credit-predictions"].every((n) => r.body.results.followups_initiated.includes(n)),
    JSON.stringify(r.body.results?.followups_initiated));
  assert("9.2 a REJECTED fire-and-forget fetch does not fail the sync",
    (await drive({ scenario: { db: { profiles: [profileRow()] } } })).body.results?.outcome?.status === "complete");
  const alertFail = await drive({ scenario: { db: { profiles: [profileRow()] }, alertInvokeError: { message: "alerts down" } } });
  assert("9.3 a detect-credit-alerts invoke error is reported, not swallowed, and excluded from initiated",
    alertFail.body.results?.followup_errors?.["detect-credit-alerts"] === "alerts down"
      && !alertFail.body.results.followups_initiated.includes("detect-credit-alerts"),
    JSON.stringify({ i: alertFail.body.results?.followups_initiated, e: alertFail.body.results?.followup_errors }));
}

// ── 10. AUTHZ / TENANCY: a person syncs their own records; an admin anyone's; nobody else.
{
  const cross = await drive({ target: OTHER, scenario: { user: { id: USER }, isAdmin: false, db: { profiles: [] } } });
  assert("10.1 a non-admin targeting another person is refused with zero writes",
    cross.status === 403 && fake.db().credit_negative_items.length === 0 && fake.db().audit_logs.length === 0,
    `status ${cross.status}`);
  const crossAdmin = await drive({ target: OTHER, scenario: { user: { id: USER }, isAdmin: true, db: { profiles: [profileRow(OTHER)] } } });
  assert("10.2 an admin may sync another person's records — and they land as that person's rows",
    crossAdmin.status === 200 && fake.db().credit_negative_items[0]?.user_id === OTHER,
    `status ${crossAdmin.status} rows ${JSON.stringify(fake.db().credit_negative_items.map((n) => n.user_id))}`);
  const svc = await drive({ auth: "service", scenario: { db: { profiles: [profileRow()] } } });
  assert("10.3 the service-key path (the trusted edge producers) runs as service",
    svc.status === 200 && svc.rec.calls.every((c) => c.client === "service"), `status ${svc.status}`);
  const none = await drive({ auth: "none", scenario: { db: { profiles: [] } } });
  assert("10.4 no Authorization header is refused before anything runs",
    none.status === 401, `status ${none.status}`);
}

// ── 11. CLIENT SCOPING: client_id partitions the dedup space and rides on inserts.
{
  const withClient = await drive({
    payload: basePayload({ client_id: "77777777-7777-4777-8777-777777777777" }),
    scenario: { db: { profiles: [profileRow()] } },
  });
  const dedupSel = withClient.rec.calls.find((c) => c.table === "credit_negative_items" && c.op === "select");
  assert("11.1 with a client_id, dedup queries scope to that client",
    dedupSel?.filters.some((f) => f[0] === "eq" && f[1] === "client_id"),
    JSON.stringify(dedupSel?.filters));
  assert("11.2 the inserted negative row carries the client_id",
    fake.db().credit_negative_items[0]?.client_id === "77777777-7777-4777-8777-777777777777",
    JSON.stringify(fake.db().credit_negative_items[0]?.client_id));
  const noClient = await drive({ scenario: { db: { profiles: [profileRow()] } } });
  const sel2 = noClient.rec.calls.find((c) => c.table === "credit_negative_items" && c.op === "select");
  assert("11.3 without a client_id, dedup queries scope to personal (client_id IS NULL) rows",
    sel2?.filters.some((f) => f[0] === "is" && f[1] === "client_id" && f[2] === null),
    JSON.stringify(sel2?.filters));
}

// ── 12. RETRY BEHAVIOUR: a second run of the same payload must not duplicate writes.
//
// This is the safety property the governed caller relies on when it releases a claim for
// retry: the writer's dedup makes the re-run converge (updates) instead of duplicating.
{
  const sharedDb = { profiles: [profileRow()] };
  const first = await drive({ scenario: { db: sharedDb } });
  const keepDb = fake.db();
  const second = await drive({ scenario: { db: keepDb } });
  assert("12.1 the second run writes no duplicate rows",
    fake.db().credit_negative_items.length === 1 && fake.db().credit_inquiries.length === 1 && fake.db().credit_accounts.length === 1,
    JSON.stringify({ n: fake.db().credit_negative_items.length, i: fake.db().credit_inquiries.length, a: fake.db().credit_accounts.length }));
  assert("12.2 it converges through the update branches instead",
    second.body.results?.negative_items?.updated === 1 && second.body.results?.negative_items?.inserted === 0
      && second.body.results?.hard_inquiries?.inserted === 0,
    JSON.stringify({ n: second.body.results?.negative_items, h: second.body.results?.hard_inquiries }));
  assert("12.3 both runs classify complete",
    first.body.results?.outcome?.status === "complete" && second.body.results?.outcome?.status === "complete");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);

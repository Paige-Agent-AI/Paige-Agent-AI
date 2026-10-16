# Native Chat publication context

Source candidate based on frozen `cabf5b7ea224d17e0b15f2c62c60a192c2623bbe` in
`work/chat-publication-context`, branch `fix/ant21-chat-publication-context`.
Only the additive database reader, its native regression fixture, two existing CI-step lines and
this evidence record change. Chat, UI, recovery helper, native writers, settlement, retirement,
global pins and prior migrations remain unchanged. The integration lead owns caller composition,
distinct review, exact-head CI and any eventual release.

## Intended outcome and authority

The existing P0 publication path and canonical approval recovery need one coherent native authority
read. Separate workspace and latest-state RPCs can combine different database epochs. The additive
`paige_chat_interactive_publication_context_v2(p_thread uuid,p_intent uuid)` returns only a boolean.
It is SQL, STABLE, SECURITY DEFINER with an empty fixed search path and qualified objects. PUBLIC,
anon and service_role execution is revoked; only authenticated receives EXECUTE. `auth.uid()` is
required and must own the exact thread. There is no actor argument or returned actor/tenant data.

The same calling-query snapshot requires the requested latest intent, a NULL executor and native
server-issued canonical evidence with terminal=true and stopped=false, bound to caller/thread tenant/
intent. JSON history cannot establish that evidence. The function writes no application state and
cannot approve, execute, claim, settle, clear, release or reconcile anything.

The October 16 coordinator clarification preserves native admission semantics:

- For non-null thread tenants, an explicit profile active_tenant_id must match the original thread
  tenant, and the incumbent current_user_tenant_id() must resolve to that tenant. Its authorized
  agency and operator standing remains intact. First-membership fallback cannot supply the explicit
  profile selection.
- Tenantless threads retain the exact is_platform_owner() contract regardless of active profile,
  including an owner who entered a tenant or has no profile row. An ordinary caller cannot acquire
  that exception.
- There is no new is_tenant_member() conjunction. Native admission does not require that conjunction;
  adding it would reject legitimate agency standing. The fixture proves that these agency/operator
  publication contexts do not grant a direct membership seat or native CRM write authority.

The reader is a common canonical context predicate. A true result for an INTERRUPTED or other native
terminal is not an outcome, approval or safe-retry certificate. Consumers must retain their existing
terminal-kind, effect-accounting, protected-content and native confirmation checks. The original
held request without a canonical terminal remains excluded. No production request was touched.

PostgreSQL STABLE functions use the calling query's snapshot, as documented in
[PostgreSQL 16 function volatility](https://www.postgresql.org/docs/16/xfunc-volatility.html).
This closes mixed reads within that snapshot; it is not a lease against changes after the snapshot
or a substitute for native execution authorization. Supabase function/ACL guidance and the changelog
were checked; no SDK, HTTP API or provider feature is introduced.

## Source and migration preservation

The fixture loads exact existing native bodies through the incumbent INT-336 emitter, then the
server-issued receipt, conversational admission and database executor-isolation migrations. Current
tenant/agency/operator/platform-owner helper definitions are extracted unchanged from their existing
migrations. No old applied SQL is reconstructed or edited. The native helper definitions are STABLE.

Installed CLI 2.109.1 generated an empty migration with `supabase migration new
int336_publication_context_v2`. Only that new file was renamed to the reserved version
`20271108122000_int336_publication_context_v2.sql`: after Task `20271108121000`, before the reserved
Planning `20271108130000` and Research `20271108140000` slices. It adds one function and its ACL/comment,
with no table, data, role, retirement or native-executor changes. Replaying it preserves every existing
public native/helper definition and ACL byte-for-byte in the fixture.

Migration SHA256: `2225612cf230fd44a949856b459379ef096f7753bbe75417401bdd1017753056`.

October 16 release-order correction: Customer Portal PR #2249 reached main at
`c9ace17ffa7e14eb0035629c67313eef68a15a8d` and production recorded its distinct
`20271108122000_e09_customer_action_scope.sql` before this candidate was merged. The unpublished
publication migration is therefore renamed to `20271108123000_int336_publication_context_v2.sql`;
its SQL bytes and the SHA256 above are unchanged. The native fixture follows only that new path.
The existing Portal migration and all applied history remain untouched. Required exact-head CI
must run again on this composition; the earlier candidate's CI is not its release evidence.

## Native proof

`scripts/int336-publication-context-db-check.mjs` reuses the existing canonical database fixture and
actual native admission, acquire, settlement, evidence, release and Stop routines. It accepts only a
fresh disposable loopback `int336_test*` database. Fixture identity GUCs and activation state are
synthetic; this does not prove JWT cryptography, production activation or a full hosted schema.

Before implementation, the real canonical terminal and native release succeeded, then the first
positive read failed because the publication function did not exist. The failing-first transcript is
preserved privately in `work/native-red.log`. One intermediate fixture run used invalid `SET ...=null`
syntax; it was corrected to the existing empty-GUC identity convention without changing runtime SQL.

Final result: **52 native assertions PASS**, covering:

- exact SQL/STABLE/definer/boolean signature and search path; authenticated-only ACL, actual anon and
  service-role refusal, no PUBLIC grant;
- native canonical terminal plus release; held executor, missing terminal, JSON-only finish with both
  held and NULL executor, wrong actor in the same legitimate tenant, foreign/missing/null bindings;
- two ordinary SOLO workspaces, explicit profile selection, missing profile and first-membership
  fallback refusal, revoked membership, ordinary supersession and native Stop;
- preserved active-member, agency-owner/manager child standing, agency revocation, entered-workspace
  operator standing, and tenantless owner before/after workspace entry and profile removal, plus
  owner-role revocation;
- all existing canonical terminal kinds as context only; read-only data fingerprint and unchanged
  existing function definitions/ACLs after replay;
- a coordinated real two-connection snapshot race. A writer uses native admission/settlement/release
  and switches the synthetic profile in one transaction. A blocked observer invokes the real reader
  after that commit while retaining its earlier calling-query snapshot. The reader refuses; the
  counterfactual old scope read plus later native latest-state read would accept. A fresh reader
  also refuses the switched workspace.

Run with the existing installed PostgreSQL client:

```text
PSQL_BIN=<trusted psql binary>
INT336_DATABASE_URL=postgresql://postgres@127.0.0.1:65453/int336_test_publication_final
node scripts/int336-publication-context-db-check.mjs
```

CI adds only a fresh `int336_test_publication` database and this command to the existing required
`INT-336 — real PostgreSQL canonical thread fence` step. It reuses that step's owned server and cleanup;
there is no new CI job, test framework or QA engine.

Node syntax, definer grant lint and signature-level ACL validation pass. Migration collision checking
against the exact candidate base passes for all 1,314 migrations; its self-test also passes. The
default origin/main comparison in
this older isolated ancestry reported two unchanged Portal migrations through an ambiguous merge
base; those applied files were not edited or renumbered. The lead owns final composed-main checking.

## Forward-only release ordering correction — 2026-10-16

Production now records Portal migration `20271108150000` from main
`5dfb5156785681ebb8fbad7237793a0bf0f9c92e`. The publication migration remains unpublished and is
therefore forward-named `20271108170000_int336_publication_context_v2.sql`; its SQL bytes are unchanged.
The native fixture reads that exact path. Earlier names above are retained as historical evidence.
Research is reserved at `20271108180000` and Planning at `20271108190000`. No applied migration,
authorization contract, source fingerprint, or runtime code changes in this ordering correction.
Normal exact-head CI, Independent Review, deployment and production readback remain required;
`--include-all` and migration-history repair are not used.

## Runtime bounds and handoff

Native proof used a new task-owned PostgreSQL 16 cluster on checked loopback-only port 65453. Initial
sandboxed initdb stalled before a server started and was interrupted; a separate checked directory
initialized successfully under the authorized local runner. No existing server, production endpoint,
credentials or customer data was used. Initialization, failing-first, final native and server-stop
receipts remain private under `work/`. The task's server is stopped before handoff; its evidence/data
directories are preserved. The stop receipt records PostgreSQL 16.14, loopback-only 127.0.0.1:65453,
the exact owned data directory, successful fast shutdown, no server running, and a fresh listener bind
proving that port 65453 is free.

This is **AUTHOR-REVIEW / LOWER ASSURANCE**, not distinct non-author clearance. Full hosted-schema
execution, caller integration and race tests, exact-head CI, migration application, Edge readback,
authenticated customer recovery and release remain UNVERIFIED. The lead will bind the shared caller
to this RPC and refuse missing, malformed or failed proof. No source-pin renewal, push, PR, deployment,
provider call, forced settlement or existing-orphan recovery was performed here.

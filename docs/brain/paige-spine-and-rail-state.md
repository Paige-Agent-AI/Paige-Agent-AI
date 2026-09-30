# PAIGE Spine & Rail — verified current state

**Read this before claiming any department is "connected to PAIGE," before adding a Spine capability,
and before reading anything into an empty Solo activity feed.**

Grounded 2026-09-02 against `origin/main` `ed22066e71294099e48f0b52c742e3f379faf23c`, with the code
and schema claims established at `76bb3bbca` (#728) and re-checked unchanged at `05735f26b` and
`ed22066e7` — the commits between them are documentation only.

**Re-grounded 2026-09-02 at `1fb7928862b312245dc16927eb4a52c9463206ca`** after the Rail resolver
foundation merged and deployed (#785, then the #794 remediation in #795). The consumer-side claims
below were re-checked at that commit and are **unchanged** — which is the point of the new section
that follows: a safe server read now exists, and *nothing calls it yet*.

## UPDATE 2026-09-05 — the workspace Rail can now carry PAIGE's own acts (SCR-2026-09-05)

**Read this before concluding from an empty feed that PAIGE has done nothing.**

Measured on production 2026-09-05 (ref `xygzykjyynhzqytbqnzu`), BEFORE this change:

| Fact | Value |
|---|---|
| `paige_audit_log` rows | 142 |
| `paige_workspace_events` rows | **10** |
| their distinct `source_kind` | `mcp_connection`, `oauth_attempt`, `zapier_mcp_connection` — connections only |
| `has_table_privilege('authenticated','paige_client_events','SELECT')` | **false** — #746 still open |
| `get_solo_rail_activity` unions workspace events | **true** |
| `authenticated` holds EXECUTE on it | **true** |

**The correction this file most needs to carry:** the read path was never the missing piece. A
tenant-scoped reader that unions `paige_client_events` with `paige_workspace_events` through
`_workspace_event_display` was already live and already granted. What did not exist was any row
shape for *"PAIGE did a thing to this workspace"* — so nothing ever wrote one, and the feed was
empty for a reason that looked like absence and was actually vocabulary.

`20261212000000_paige_can_show_her_work.sql` adds that shape: `source_kind='capability_run'`,
a `capability_key` column, five outcomes (`capability_succeeded` · `_failed` · `_refused` ·
`_unreachable` · `_outcome_unknown`), and `record_capability_run(...)` for service-role callers.
**That lock covers the 6-argument signature only.** The 10-argument overload at `20270107000000:94`
is a separate `pg_proc` entry, was given no GRANT and no REVOKE, and so defaults to `EXECUTE TO
PUBLIC`; its body never calls `auth.uid()`. `20270416000000` revokes it and re-asserts the 6-arg
posture — in the repo; a `pg_proc.proacl` readback on prod is still owed.

> MEASURED ON PROD 2026-09-24 (pg_proc.proacl): both signatures already read `{postgres=X/postgres,service_role=X/postgres}`, so the hole is NOT live. The migration is not applied and 20270107000000 carries no GRANT/REVOKE, so an out-of-band action set that ACL -- the migration's real job is making the lock REPRODUCIBLE from the repo.

`20261220000000_an_act_that_landed_but_was_not_recorded.sql` adds a **sixth**,
`capability_completed_unrecorded`, and the four Communications capability keys. The sixth exists
because `comms_buy_number` has two exits where Twilio has **charged the tenant** and the
`tenant_phone_numbers` row did not write. None of the original five can say that: `failed`
promises "nothing was left half-done", `succeeded` claims a row exists, `outcome_unknown` says no
result came back when one came back and said the charge landed. It is deliberately NOT
money-specific — "the act took effect and its record did not" is a state every later wave with
external effects will reach.

**What is and is NOT wired — do not read this as "PAIGE's work is now visible":**

- **Wired:** the six n8n write tools, `zapier_run_action`, and the four Communications write acts
  (`comms_buy_number` · `comms_name_number` · `comms_set_primary_number` ·
  `comms_draft_registration`). Eleven capabilities.
- **Not wired:** the other ~43 classified actions. They still write only `paige_audit_log`, which
  no Solo surface reads. Each migration wave adds its own `capability_key` copy.
- **Zero rows exist in production as of 2026-09-05.** Measured, not assumed:
  `select count(*) from paige_workspace_events where source_kind='capability_run'` returns **0**.
  The mechanism is live; nothing has exercised it yet, because no n8n or Zapier write has been run
  through chat since it shipped. An empty feed here is not evidence the seam is broken.
- **Never recorded:** reads. Six of the twelve n8n tools are reads and none of them writes a row.
- **Never recorded:** anything refused before the tenant/session fence — unknown tool, approval
  missing, bad arguments. That preserves the "no outbound call at all" property those refusals
  already had.
- **Still true:** `paige_client_events` remains unreadable by `authenticated` in production
  (#746). This change does not touch that and does not depend on it.

**`capability_outcome_unknown` is not a nicety.** `runN8nManagement` can dispatch a write and never
learn the result. That state is recorded as itself. If you see it, the automation MAY have run —
check the service before retrying, and do not report it as a failure.

**Live-drive still owed (§32.c).** That a capability row RENDERS on the owner's Command Center is
unverified — no session so far has signed in to look. What HAS been proven, in a rolled-back
transaction on prod (2026-09-05): reading as the authenticated member through
`get_solo_rail_activity(50)` — the same RPC the Command Center calls — returns all four
Communications acts with their intended copy. That is one class short of a browser drive: it proves
the data reaches the reader, not that the component paints it.

**The chip needed a case, and did not have one.** `PaigeRailFeed.kindChip()` switches on the
`event_kind` namespace (`owner` · `client` · `automation` · `comms` · `mcp`). `capability_run.*`
fell to the default, which derives the label from the namespace and would have put the literal
backend source kind — "Capability run" — in front of an owner (§11 forbids backend names in visible
copy). It now returns `{ label: "Paige", tone: "paige" }`, agreeing with the row's own
`actor_type: 'paige_agent'`. `ClientActivityFeed` needs no case: `get_client_rail` reads
`paige_client_events` only, so a workspace-scoped capability row cannot reach it.

## The rule this file exists to enforce: existence ≠ reachability

Three different things get called "verified," and collapsing them is how this repository has twice
recorded something as working that a person could not use:

| Class | What it proves | What it does NOT prove |
|---|---|---|
| **Production catalog / schema** | an object is DEPLOYED — a function exists, a grant is present or absent, a migration is applied | that any code path calls it, or what it returns |
| **Automated test** | the assertions written down pass | that the assertions cover the failure |
| **Authenticated runtime** | a real person completed the flow on the real platform | — |

Everything below states which class it belongs to. **Nothing here was driven in a browser.**

## The Spine is PARTIAL — two capabilities, not a connected platform

**Do not read the Spine's existence as departments being wired to PAIGE.** Measured by running the
repo's own guards on 2026-09-02, with the capability count re-measured 2026-09-03:

| Measure | Value | How |
|---|---|---|
| Registered Spine capabilities | ~~**2**~~ → **17** (2026-09-05) | `node --experimental-strip-types scripts/ci/paige-spine-registry-lint.mjs` → `PASS (17 capability)`. The count moved with the n8n management family and, on 2026-09-05, `social.presence` |
| Inline Chat tools | **105** | `node scripts/ci/chat-tool-registry-lint.mjs` → `105 tool(s) inline, none added (baseline 105)` |
| Classified actions | **62** — 32 `ordinary`, 28 `high`, 2 `owner_only`, 5 exempt, 0 unclassified writes | `npm run lint:action-risk` |

The first capability is `pipeline.deal_stage_evidence` — read-only, `chatBinding: PARTIAL`,
`mindBinding: PARTIAL` (raised from `UNAVAILABLE` by PR **#747** on 2026-09-02 — a `PARTIAL` binding,
not a `LIVE` one). **PAIGE reaches departments today
through the 105 hand-wired tools, not
through the Spine.** The Spine is the governed path with two capabilities crossed over.

The second is **`business_context.readiness`** (2026-09-03) — read-only status + provenance over four
Setup fields (`website`, `business_phone`, `industry`, `primary_business_email`), never a raw value.
Adapter `public.get_business_context_readiness(uuid)`. It is the **first WORKSPACE-level Spine
capability**, and it reached that without the shared-primitive change the section below says a
workspace-level capability needs — because **it does not use the Rail resolver at all.** Read the next
section with that distinction in mind: those four constraints govern *Rail-signal-backed* capabilities.
A capability whose evidence is a live read over a tenant's own current record has no signal to resolve,
no `contact_id` to be null, and no client-scoped Chat gate to sit behind — so it sidesteps all four.
That is not a loophole in the constraints; it is a different evidence class, and it buys none of the
Rail's properties (no history, no citation, no attribution, no freshness boundary — the row is simply
current as of the call). Its `chatBinding`/`mindBinding` are `PARTIAL`: `paige-ai-chat` injects the
block into every tenant turn's system context, unit-tested, with no authenticated UI drive yet.

**Updated 2026-09-05 (PR #958, migration `20261221000000`).** Every fact this capability returns is
now derived from **`public.business_identity_readiness`**, one internal resolver that
`tenant_comms_readiness` also reads — because the two were contradicting each other about the same
two real workspaces, one reporting `needs_confirmation` while the other reported the value as on
file. The resolver is deliberately **not** a registered capability and is **unreachable by any
caller**: it takes a tenant parameter, so `EXECUTE` is revoked from `PUBLIC`, `anon`, `authenticated`
and `service_role`, leaving only the already-gated `SECURITY DEFINER` parents able to invoke it. The
two readers keep their **different** caller gates on purpose (this one tenant-scoped, comms on the
§59 global predicate), which is why the fix is a shared resolver rather than one reader calling the
other. The status vocabulary gains `legacy_sourced` / source `legacy_brand` — present only in the
legacy `tenants.brand` record, never confirmed — and every row gains `next_action`. Nothing here is
ever reported `stale`: no source in this domain declares a TTL, and the registry's required
`staleAfterDays` is satisfied trivially rather than enforced. Contract:
`docs/delivery/canonical-readiness-contract.md`.

The third is **`team.authority`** (2026-09-03, PR **#876**, migration `20261150000000`) — exactly two
Team-owned facts about the CALLER: `viewer_permission` (the raw `tenant_members.role`) and
`viewer_is_legal_owner` (`is_tenant_owner(caller, tenant)`, **both arguments**). Same evidence class as
`business_context.readiness`: a live stateless read, no Rail signal, `chatBinding`/`mindBinding`
`PARTIAL`.

**Why only two facts.** PAIGE already receives member_count and the invitation list from Team's own
hydration block, so projecting either again would be a second, separately-computed answer to a settled
question — and a WRONG one: `get_paige_team_context()`'s `invitation_count` has no status filter, so on
production tenant `d8a0a880` it reports 2 for a workspace whose two team tokens are one accepted and
one revoked. That is Team's to fix; this capability declines to shadow it.

**Why two facts and not one.** `get_paige_team_context()` computes permission as
`is_owner OR role = 'owner' -> 'owner'`, which is wider than the canonical ownership predicate — so a
single string would mean membership and ownership at once. Measured on production: all 13 active members
have the two agreeing (7 owner/is_owner=true, 6 admin/is_owner=false, zero divergent rows), so this
changes no answer today and stops a future divergence from becoming a wrong one.

The fourth is **`social.presence`** (2026-09-05, migration `20261210000000`) — for each of six
networks, whether the workspace has RECORDED an account it posts from, and the declared handle if so.
Adapter `public.get_social_presence_evidence(uuid)`. Same evidence class as the two above: a live
stateless read over the workspace's own current record, no Rail signal, `chatBinding`/`mindBinding`
`PARTIAL` (a per-turn block in `paige-ai-chat`, unit-tested, no authenticated drive yet).

**Two things about it are worth reading before adding a fifth.** It returns the raw handle where
`business_context.readiness` withholds its raw values — a difference in kind, not a relaxation: a
social handle is a PUBLIC identifier the business publishes on purpose and PAIGE cannot reference an
account in a draft without it, whereas a business phone is not that. And its role gate is guarded on
`auth.uid() IS NOT NULL`, because `is_tenant_admin()` keys on `auth.uid()` and an unguarded gate
refuses the service-role callers the function exists to serve — PAIGE's own MCP agent and the Systems
Check runner. A `BEGIN..ROLLBACK` proof caught that; static review had not. The same guard, for the
same reason, is at `get_business_context_readiness` (20261170000000).

**It also has a WRITE half, which the other three do not.** `public.record_social_handles` — reached
by the surface with the caller's JWT and by PAIGE through `paige-mcp` (`record_social_accounts`,
`crm.write`), never as an inline Chat tool, since that baseline may only descend. The Spine entry
declares the READ only; the write is a §10 callable seam with its own in-body gate.

**Billing-notice eligibility is deliberately NOT in it.** That is a Platform Billing fact about a team
member, and Billing publishes its own Spine read (`get_billing_spine_evidence`, live via
`20261140000000`). A capability drawing from `tenant_members` AND `platform_billing_contacts` would blur
the ownership line inside the registry entry itself.

### Both readiness reads name the workspace they resolved (2026-09-03, PR #876)

A cross-workspace defect found by an independent review, latent on production and structurally certain
to fire. `get_paige_persona_context()` resolves the conversation's tenant **client-link first**
(`clients.linked_user_id`), falling back to `current_user_tenant_id()`. So a user who is a linked CLIENT
of workspace B and a TEAM MEMBER of workspace A holds a conversation scoped to B while both readiness
reads resolve A — and both Chat call sites gated only on "the persona has SOME tenant".

The Team hydration path never had this hole, because `get_paige_team_context()` RETURNS its tenant and
`buildTenantTeamContextBlock` in `_shared/team-context.ts` refuses on mismatch. The two readiness reads did not, so **the binding was
impossible rather than omitted** — which is why a call-site guard alone could not have fixed it.

Both reads now return the workspace they resolved (`tenant_id` on every row, including refusals), and
both Chat adapters render nothing when it is not the conversation's. A genuine read FAILURE still
renders the honest "I can't check" block — the error paths return before the binding — so a failure and
a mis-scoped answer stay distinct. `get_business_context_readiness` needed a drop-and-recreate to add
the column; its body was reproduced byte-exactly from the deployed definition (md5
`676d4c4f7c2096fd866e264f836d1d4f`).

**Severity, measured before fixing:** production carries ZERO rows with `clients.linked_user_id` set, so
the client-link branch never fires and no user could trigger it. It stops being latent the moment a
client portal user is linked, which is the product's core purpose (§7).

**RELEASED AND PROVEN ON PRODUCTION 2026-09-03** — PR #864, merge commit `7ad98cff`, migration
`20261112000000`. This is the class of evidence the table at the top of this file calls
*production catalog / schema* PLUS a real execution, and it is worth being exact about which
claims it does and does not support:

| Claim | Evidence | Class |
|---|---|---|
| The migration persisted | `schema_migrations` row for `20261112000000` went **0 → 1**; the function object went **0 → 1**. Baseline captured on prod BEFORE the merge, so this proves the deploy acted rather than confirming what was already there | production catalog |
| The shipped gate is the tenant-scoped one | `pg_get_functiondef` on prod, comment lines stripped: executable code contains `is_tenant_admin` and does NOT contain `has_any_role`. The literal gate line is `and not (public.is_tenant_admin(v_tenant) or public.is_platform_owner())` | production catalog |
| The grant surface is right | on prod: `anon` cannot execute; `authenticated` and `service_role` can; `SECURITY DEFINER` with `search_path` pinned | production catalog |
| **The defect was real and is fixed** | tenant `d8a0a880` holds website, phone AND industry in `tenant_legal_profile` while `tenants.brand` held **none** of them — it was being told all three were missing. Executing the deployed function as that workspace's real owner returns `website: owner_confirmed`, `business_phone: owner_confirmed`, `industry: owner_confirmed` (source `setup`, with freshness), and `primary_business_email: connection_sourced` (source `connections`) — **corrected 2026-09-05 (PR #958): that email row now reads `legacy_sourced` / `legacy_brand`. Its `connections` provenance was invented — no connection ever wrote it, and no `primary_email_provenance.source` was recorded for any of the three workspaces holding a support_email** | **authenticated runtime, server-side** |
| The role gate refuses a non-staff caller | **NOT provable on prod today** — there are currently **zero** active `tenant_members` whose role is not owner/admin, so no such caller exists to test with. Proven instead by the CI pgTAP file (18 assertions, mutation-tested: reverting to the global predicate turns 3 of them red). On production it is a forward-looking guard protecting the first member or client ever added | automated test |
| The consumer path is live | `deploy-edge-functions` shipped `paige-ai-chat`, `systems-check-run-change`, `systems-check-run-onboarding`, `systems-check-run-scheduled`; `edge-live..main` drift is zero | production catalog |
| The owner's own UI flow | **STILL OWED.** Not "no browser" — see the correction below | UNVERIFIED |

**§13 correction, recorded because the wrong reason was quoted repeatedly.** Through this slice I
claimed the live drive was owed because the session had *no browser capability*, and that production
was unreachable. Both were false, and `lessons-learned` **0h** is written about exactly this move.
`npm run harness:selftest` launches real Chromium via Playwright and passes every falsifiability arm;
`https://paigeagent.ai` returns 200 from the sandbox. The true limit is narrow and checkable:
**`LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` are unset**, so the *authenticated* UI drive cannot run.
Contract-level production verification needs no browser at all, which is why the table above exists.

**One consequence worth an owner decision, not a defect.** Setup is now the source, so two tenants
(`7eaf8859`, `e7f1b157`) whose values live only in the legacy `tenants.brand` — written by the older
`update_business_profile` path, never confirmed in Setup — now read `needs_confirmation` where the
old reader said "present". Neither has a published growth page, so `website_connected` flips
pass → fail for both, and `comms_configured`'s phone half flips for `7eaf8859`. That is literally
true ("the owner has not saved this in Setup") and is the direction the source-of-truth rule points,
but it IS a visible change for those workspaces (§58: flagged, not silent).

**Superseded 2026-09-05 (PR #958) — and the "owner decision" turned out not to be one.**
`needs_confirmation` was itself lossy: it says "no value anywhere" about a value that demonstrably
exists. It contradicted `tenant_comms_readiness`, which reported the same fields as on file, and
picking between those two answers would have kept erasing one true fact. Those two tenants now read
**`legacy_sourced`** / source `legacy_brand` — the value exists, in the legacy record, unconfirmed —
and both readers derive it from one resolver. **The Systems Check verdicts described above do not
change**: `isConfirmed()` is true only for `owner_confirmed`, so `website_connected` and the
`comms_configured` phone half flip exactly as stated. See
`docs/delivery/canonical-readiness-contract.md`.

**No department other than Pipeline and Setup's business context is declared in the registry.** The
Team and Setup surface cards (`../doctrine/surface-cards/`) each say the same of themselves,
independently.

### Why most departments cannot simply be added

Four properties of the shipped code decide eligibility. They are constraints, not preferences:

> ### ⚠ SUPERSEDED IN PART BY PR #925 — read this before the three claims below (§BRAIN.3)
>
> PR #925 (`20261201000800_the_rail_says_which_agent_acted.sql`) changes three things this section
> states as current. It is **not yet applied to production**; until `deploy-migrations.yml` runs on
> merge and `db-live` moves, everything below is still true of the live database. After it applies:
>
> 1. **"A workspace-level outcome has nowhere to go" ceases to be true.** `paige_workspace_events`
>    gains four families — `game_plan`, `system_check`, `agent_config`, `agent_run` — and
>    `get_solo_rail_activity` unions them alongside contact events. `contact_id` on
>    `paige_client_events` is unchanged and still `NOT NULL`; the repair is the distinct
>    workspace-level projection this section itself predicted, not a relaxation of that column.
> 2. **The projection is 11 fields, not 12.** It gains `actor_agent` — the acting agent's
>    tenant-safe display name, snapshot at write time. The "no tenant, client, actor or source-record
>    identifier" claim SURVIVES: the name is not an identifier, the internal slug is never returned,
>    and a name is withheld entirely when the agent has none fit for a business owner to read or
>    belongs to another workspace.
> 3. **`actor_type` no longer collapses every agent to `paige_agent`.** That column is unchanged and
>    still carries five values; `actor_agent` answers *which* specialist beside it.
>
> **What has NOT changed, and is the honest state:** nothing writes an acting agent yet, and no
> producer emits a workspace-level event. The capacity ships; the behaviour does not. Do not read
> these rows as evidence that Rail history can attribute work today — it cannot.

1. **The Rail is per-client, at three independent layers** — `paige_client_events.contact_id` is
   `NOT NULL REFERENCES clients(id)`; `record_rail_event` raises `contact not in tenant`; and the Chat
   emitter returns early at `if (!contactId) return`. A workspace-level outcome has nowhere to go.
2. **The resolver accepts `subject_type = "client"` and nothing else** (`resolveEvidence.ts`).
3. **Spine evidence loads only inside a client-scoped Chat turn** (`paige-ai-chat/index.ts`,
   `if (scopedClientId)`), so there is no Spine evidence in a general business question.
4. **The safe summary is a CONSTANT** — the adapter returns a fixed sentence plus enumerated scalars.
   A department whose value lives in free text cannot express it under this contract.

Consequence: **Team · Settings · Connections · Marketplace · Billing · Analytics · Social are
workspace-level and cannot reach `LIVE` AS RAIL-BACKED CAPABILITIES without a shared-primitive
change.** The owner ruled 2026-09-02 (Team card, decision 2) that a Rail event may not carry a null
`contact_id`; the repair is a distinct tenant/workspace-level outcome projection, and it is a
**Spine Change Request**, unstarted.

**Corrected 2026-09-03 (§13):** as written above, that consequence read as "no workspace-level
capability at all until the Rail is changed." `business_context.readiness` disproves the broader
reading — a workspace-level capability CAN be declared and consumed today when its evidence is a
**live read** rather than a Rail signal. What still stands, unchanged, is the narrower claim: a
workspace-level capability cannot carry Rail HISTORY (an attributable, cited, dated record of an
outcome that happened) until that Change Request lands. Choose the class deliberately: "what is true
right now" is a live read and available; "what happened, and who did it" is Rail-backed and blocked.

### The reference implementation any new capability must copy

`public.get_pipeline_spine_evidence(text,integer)` — `SECURITY DEFINER` with pinned `search_path`,
requires `auth.uid()`, resolves the tenant server-side via `current_user_tenant_id()` (the caller may
not pass one), gates on a staff role, addresses the subject by the public-safe `clients.account_number`
rather than an internal UUID, and returns a fixed 19-column contract with no title, summary, payload,
user id, deal id or stage text.

**Production-verified grants (catalog class):** `authenticated` may EXECUTE it; `anon` may not.

## A safe server-side Rail reader EXISTS and is deployed — and as of 2026-09-03 the four owner-facing consumers CALL it

> **SUPERSEDED HEADING, corrected 2026-09-03 (§58 — the dated finding below is kept, not deleted).**
> This section was written on 2026-09-02 under the heading *"and no consumer calls it"*, which was
> true then and is false now. **Slice B moved all four owner-facing Rail consumers onto the deployed
> resolvers**; everything the 2026-09-02 text says about the resolver itself still stands, and
> everything it says about *no consumer using it* is superseded by the correction section below.

**Deployed 2026-09-02. Read this next to the section below, never instead of it.** The two facts are
not in tension: the server can now answer safely, and (as of the date this paragraph was written) no
owner-facing screen asked it.

`public.get_solo_rail_activity(p_limit integer)` — `SECURITY DEFINER`, `stable`,
`set search_path to 'public'` — returns tenant-scoped Rail history **without granting the browser any
access to `paige_client_events`**. Production catalog class, read 2026-09-02 at project
`xygzykjyynhzqytbqnzu`:

| Property | Verified value |
|---|---|
| Migrations applied | `20261042000000` (#785) and `20261043000000` (#795), both present in `supabase_migrations.schema_migrations` |
| Overloads | exactly **1** — no stale signature left behind |
| Signature | takes `p_limit` only; **no tenant parameter** — the workspace is server-resolved, never caller-supplied |
| Projection | 11 reviewed display fields (`id, event_kind, surface, actor_type, audience, visibility, from_department, to_department, title, summary, occurred_at`). **Omits** `tenant_id`, `payload`, `ref_table`, `ref_id`, `actor_user_id`, `contact_id`. It **does** return `e.id`, the event row's own UUID primary key — so "no internal identifiers" would be false; the accurate claim is that it exposes no tenant, client, actor or source-record identifier, and no producer payload |
| On refusal | **raises `42501 RAIL_FORBIDDEN`** — it does not `RETURN;` an empty set |
| EXECUTE | `authenticated` ✔ · `service_role` ✔ (inert — `auth.uid()` is NULL there, so it raises) · `anon` ✘ |
| `paige_client_events` SELECT | still **denied** to `authenticated` and `anon` |

**Two properties are load-bearing and must survive any future change.**

1. **It refuses rather than returning empty.** A reader that answers a denied caller with zero rows
   reproduces, one layer down, the exact lie this whole file exists to name. `42501` is the contract.
2. **The direct-table revoke is the containment, and it stays.** `pce_staff_read` — the RLS policy on
   `paige_client_events` — carries the same tenant-agnostic role flaw described in #794 below. It is
   harmless *only* because the table privilege refuses before RLS is ever consulted. **Re-granting
   browser SELECT would make that defective policy reachable.** Do not "fix" the Rail by adding a
   grant. The resolver is the path.

### #794 — the defect this foundation shipped with, and the lesson that outlives it

Slice A (#785) reproduced `pce_staff_read` faithfully, **and reproducing it was the defect.** The
function gated on two clauses that answer questions about *different* tenants:

```sql
row filter :  WHERE e.tenant_id = v_tenant,  v_tenant := public.current_user_tenant_id()
role gate  :  public.has_any_role(v_uid, ARRAY['admin','super_admin','coach'])
```

`current_user_tenant_id()` honours `profiles.active_tenant_id` for **any** active `tenant_members`
row, at **any** role — a plain `member` qualifies. `has_any_role()` reads `public.user_roles`, whose
columns are `(id, user_id, role, created_at)`: **no `tenant_id`.** It is a global question — §59's
global-role trap. So a global `coach`/`admin`/`super_admin` role earned in tenant A, held by someone
who is merely a member of tenant B, satisfied the gate **on the role from A** and returned all of
tenant B's Rail, including the `audience='owner'` / `visibility='owner_internal'` rows.

**Be precise about who those rows are actually for — an earlier draft of this section stated the
boundary wrongly, in a security postmortem, which is the worst place to state one wrongly.**
`owner_internal` does **not** mean "the tenant owner alone". The resolver filters on
`where e.tenant_id = v_tenant` and applies **no `audience` or `visibility` predicate**
(`20261043000000:79–98`), and `pce_staff_read` likewise admits admins and coaches. So these rows are
**withheld from clients and from plain members, and visible to authorized tenant staff** — `owner`,
`admin`, `coach`. That is the real boundary, and it is exactly why #794 mattered: the defect handed a
**plain member's seat** the staff view, not merely a non-owner's.

Remediated by `20261043000000` (#795): the role is read from an active `tenant_members` row for the
**same** `v_tenant` the rows come from, so the two clauses now agree about which workspace they mean.
Verified on production — the deployed body no longer contains `has_any_role`.

**Scope that claim to the READER it was written about. It is not a Rail-wide all-clear, and reading
it as one is how this record would start asserting something the platform has not earned.** Verified
against the deployed bodies on 2026-09-03:

| Rail function | Kind | Carries `has_any_role`? | Refuses explicitly? |
|---|---|---|---|
| `get_solo_rail_activity` | reader | no | yes — `42501`, since `20261042000000` |
| `get_client_rail` | reader | no — removed by `20261044000000` | yes — `42501` |
| `get_client_rail_for_chat` | reader | no — added correct in `20261044000000` | yes — `42501` |
| `get_platform_rail` | reader | **never did** — it gates on `is_platform_owner()` | yes — `42501`, since `20261049000000` |
| `record_rail_event` | **writer** | **YES, still** | yes, but see below |

So the accurate statement, and the one to quote instead of line 134 alone: **no Rail READER carries
`has_any_role`, and no Rail reader answers a denial with an empty set.** The WRITER is the exception
on the first count, and it is tracked as **#824** — parked, unassigned.

**`get_platform_rail` was a different defect from #794 and must not be filed under it.** It never had
the global-role trap; its gate was always correct and no unauthorized caller ever received a row from
it. What it did wrong was answer a denial with `RETURN;`, so a refused caller could not tell *"you may
not see this"* from *"the platform Rail is empty."* Repaired by `20261049000000` (#834), which changed
only the shape of the refusal — the authority stays `is_platform_owner()` (super_admin only, §53) and
was deliberately **not** widened to `is_platform_operator()`.

**The writer's severity is NOT the reader's, and copying it across would overstate #824.**
`record_rail_event` confines every write with `PERFORM 1 FROM public.clients c WHERE c.id =
p_contact_id AND c.tenant_id = v_tenant`, raising `contact not in tenant`, so the **cross-tenant**
version is blocked. What survives is the **member→staff escalation inside one workspace** — the same
shape as #794, on the write path, and an integrity/attribution exposure rather than a disclosure one.
Its sharpest form is `p_narrow_to_owner = true`, which yields `audience='owner'` /
`visibility='owner_internal'`: a plain member could file into the owner's private feed.

### The Rail PRODUCER inventory — every write call site, by execution context

Measured against `main`. **Corrected twice in review; the corrections are recorded because the
method that produced them is the thing worth remembering.**

**TypeScript producers — eight call sites, seven service-role:**

| # | Call site | Client | `auth.uid()` | Reaches the `has_any_role` branch? |
|---|---|---|---|---|
| 1 | `_shared/mcp-outcome.ts:842` | service role | NULL | no |
| 2 | `_shared/railAutomation.ts:103` | service role | NULL | no |
| 3 | `growth-process-submission:519` | service role | NULL | no |
| 4 | `handle-inbound-sms:434` | service role | NULL | no |
| 5 | `paige-mcp:5282` | service role | NULL | no |
| 6 | `send-message:1374` | service role | NULL | no |
| 7 | `paige-ai-chat:889` | **service role** (`supabase`, built with `SUPABASE_SERVICE_ROLE_KEY` at `:587`) | NULL | **no** |
| 8 | **`paige-ai-chat:11267`** | **caller JWT** (`supabaseClient`, anon key + `Authorization` at `:575`) | **set** | **YES** |

**SQL producers — three live, and they were missing entirely from the first version of this table:**

| # | Producer | Kind | Actor filed | Reaches the gate? |
|---|---|---|---|---|
| 9 | `customer_respond_to_action` (`20260712240000:282`) | `SECURITY DEFINER` fn | `'client'` | **depends on the subject** — a client caller lands in the `ELSIF` branch; a staff caller is admitted by `has_any_role` |
| 10 | `emit_booking_rail` (`20260712260000:125`) | `SECURITY DEFINER` trigger on `internal_bookings` (`AFTER INSERT OR UPDATE`, every row) | `'client'` | **depends on the subject** — and staff booking on a client's behalf is an ordinary path, so this reaches the gate routinely |
| 11 | **`configure_tenant_pipeline` (`20260831224500:251`)** | `SECURITY DEFINER` fn | `'owner_staff'` / `'paige_agent'`, with `p_narrow_to_owner = true` | **YES, always** |

**`SECURITY DEFINER` does not null `auth.uid()`** — it changes the executing role, not the JWT claim —
so an authenticated caller reaching any of these carries their subject into `record_rail_event`.

### Which branch admits a write depends on the SUBJECT, not the actor_type filed

This is the correction that matters most, and it is not a detail: `record_rail_event` tests
`has_any_role(v_uid, …)` **first**, and only falls to the client branch when that fails. So the
declared `p_actor_type` does not decide which branch runs — **who is holding the session does.**

**Always gate-exercising:** `paige-ai-chat:11267` (mirrors every successful CRM or action tool result
as `owner_staff` through the caller's JWT) and `configure_tenant_pipeline` (files a deal move as
`owner_staff`/`paige_agent` with `p_narrow_to_owner = true`, the `owner_internal` shape).

**Conditionally gate-exercising, whenever a staff subject triggers them:** `emit_booking_rail` and
`customer_respond_to_action`.

**The booking trigger is the one that matters, and the path into it is specific.** It fires on
**every** insert or update of `internal_bookings`, but which writers carry a JWT subject decides
whether the gate runs:

**Do not try to enumerate the writers. The set is OPEN, and that is the finding.** Verified on
production: `authenticated` holds **INSERT and UPDATE directly on `internal_bookings`**
(`has_table_privilege` both true, 5 RLS policies), and **all four** booking RPCs are
authenticated-executable — `create_internal_booking`, `admin_set_booking_status`,
`cancel_internal_booking`, `reschedule_internal_booking`.

So any authenticated caller RLS permits — through an RPC, or by writing the table directly through
the Data API — fires this trigger with their own subject. There is no closed list of callers to
enumerate, and three successive attempts to write one here were each incomplete.

**The rule that replaces the list:**

> **Every authenticated *event-eligible* write to `internal_bookings` reaches the `has_any_role`
> gate.** Only service-role writers (`booking-manage`, `public-booking`, and the `service_role`-only
> `create_class_booking` / `reschedule_class_booking`) skip it, because `auth.uid()` is NULL there.

**"Event-eligible" is load-bearing, because the trigger returns early on most writes.** It files
nothing for a contactless or tenantless row, for an INSERT that is already `cancelled`, for an UPDATE
that neither cancels nor moves `start_at`, or for a non-representative collective-booking row
(`20260712260000_booking_rail_emit.sql:58-60, 68-90, 107-120`). A trigger proof using any of those
transitions **passes without ever reaching `record_rail_event`** — green, and vacuous.

**What that means for a #824 fix, and it is the load-bearing consequence:** the proof belongs at the
**trigger**, not at a list of call sites. A proof that walks named callers can always be defeated by
the caller nobody listed — including a direct table write that no TypeScript in this repository
performs today but the grant permits. Prove that `emit_booking_rail` still records under a staff
subject after the gate changes — using a transition that actually reaches the Rail call — and the
caller set stops mattering.

**And this path files a mismatched attribution, which is worth knowing before anyone "fixes" it.**
`v_actor := CASE WHEN p_actor_type IN ('owner_staff','client') THEN v_uid ELSE NULL END`, and the
trigger files `p_actor_type = 'client'`. So a staff-triggered booking writes a row that *declares* a
client action while recording the **staff** UID as `actor_user_id`. That is pre-existing behaviour,
not something #824's fix introduces — but it means the row's actor field and its actor_type already
disagree on this path, and a fix should not be blamed for it or accidentally "correct" it without a
separate decision.

`customer_respond_to_action` is a customer action by design, so a staff subject there is unusual but
not structurally prevented.

**#824's severity is still unchanged** — member→staff inside one workspace, integrity rather than
disclosure, escalation population zero. What changed is the fix-impact surface: a two-direction proof
is owed at **two paths always and two more conditionally** — not at the Chat site alone. Tightening
the gate touches live write paths in three different languages of caller (edge TypeScript, a SQL
function, a table trigger), and breaking any of them stops the Rail recording silently.

### The method error, recorded because it repeated

The first version of this table said "all eight" and named one gate-exercising site. It was wrong
twice: `paige-ai-chat:889` was called caller-JWT when it is service-role (the two clients differ by
one identifier twelve lines apart at `:575`/`:587`), and the SQL producers were absent because the
inventory grep was scoped to `supabase/functions/**` and `src/**` — **migrations were excluded, so a
producer written in SQL could not appear.**

That is the **third** narrow-scope search error in this line of work: `src/`-only missed Chat's
resolver consumer (#836), and this one missed an entire producer language. The rule that would have
caught all three: **when a claim is about "everywhere", the search must be repository-wide first and
narrowed only to explain results — never scoped first and generalised after.**

**Measured exposure, stated honestly:** 3 users hold a global staff role across multiple tenants;
**0** currently sit at a non-staff seat. Structurally live, never reached. **Re-measured 2026-09-03
for the writer's population** — 9 users hold a global staff role *at all*, and **0** of them sit at a
non-staff seat in any workspace, so the escalation population is empty on both paths. The 9 and the 3
answer different questions (held-at-all vs. held-across-multiple-tenants) and are not in conflict; the
figure that governs is the zero, which agrees. That was not a reason to
downgrade the repair — the path opens the moment any global-role holder is invited as a plain member
elsewhere, which is ordinary.

**Three lessons, recorded here because `docs/brain/lessons-learned.md` has three open PRs contending
for its tail (#729, #731, #754 all append at 1276–1279) and a fourth append would conflict with all
of them.** They belong in that file when the contention clears.

1. **Fidelity to a defective policy resurrects the defect.** Slice A's tests asserted the function
   *matched* `pce_staff_read`. Matching it was the bug, so those assertions could not see it. A test
   that encodes "behaves like the thing we are replacing" is not a safety net.
2. **A revoked grant can be the only thing containing a flaw — so re-exposing the semantics through a
   different object type re-opens it.** The policy was unreachable; an EXECUTE-granted `SECURITY
   DEFINER` function with the same body is very reachable. Object type changed, guard did not.
3. **The review-timing gap is preserved as fact, not tidied away.** Slice A merged ~12 seconds after a
   Codex review began; that review never completed before production deployment, and this remediation
   is the direct consequence. #795 did receive a completed Codex review on its exact final head. Every
   Rail PR now requires one before Gate B. **Do not rewrite the #785 history as though it had one.**

## Owner-visible Solo Rail activity is UNAVAILABLE — not empty, not healthy

**This is the single most consequential current-state fact in this file, and it must not be read as
"there is no activity."**

`src/solo/data/useSoloActivityFeed.ts` reads `paige_client_events` directly over PostgREST as
`authenticated`, relying on the RLS policy `pce_staff_read`.

**Production says `authenticated` has NO SELECT privilege on that table** (catalog class, verified
2026-09-02). The grant was revoked by `20260712200000_paige_context_rail_step2_realtime.sql:25` and
never re-granted — four grant/revoke statements exist across 910 migrations and the revoke sorts last.
**RLS never gets consulted; the table grant is checked first.**

**Truthful status — use this wording, not a paraphrase:**

> `UNAVAILABLE — production Rail history cannot be read, and the current owner-facing consumer
> treatment is not reliable enough to distinguish denied history from empty history.`

**Do not call this healthy, empty, honest, repaired, or production-executable.**

**CORRECTED 2026-09-02 (§13 — this file's first version overstated the failure mode).** It said the
hook "honestly renders an error rather than an empty feed" and called this "a dead capability, not a
lying one." That generalised from ONE hook's internal branch to the platform's behaviour, and the
consumers were never checked. Issue **#746** established the rest, and it was re-verified here rather
than relayed:

| Path | Consumer | Distinguishes denied from empty? |
|---|---|---|
| `useRailEvents` (Context Rail) | `src/components/paige/PaigeRailFeed.tsx:108` · `src/components/app/ClientActivityFeed.tsx:144` — both destructure only `{ events, connected }` | **NO.** `grep` for `historyError\|historyLoaded` outside the hook and its tests returns **no matches**, so a refused read renders exactly like an empty feed |
| `useSoloActivityFeed` (Solo Trust Compass **and** Team activity) | **Both** consumers distinguish. `src/solo/compass.tsx:377` and `src/solo/team.tsx:235` each compute `loading ? … : error ? 'error' : …` and render `role="alert"` — *"Recent activity could not be loaded, so this is not a record of nothing happening"* and *"This timeline could not be loaded, so it is not a record of nothing happening"*. **Retry is a separate question and is not universal** — see the measured exception below | **Yes for failure visibility; partly for recovery.** **Corrected 2026-09-02, twice:** an earlier version named only `compass.tsx` (`team.tsx` had the same treatment and was uncredited), and the row then claimed both render "with a retry", which is false for Compass at ≤1020px |

So the platform-level statement is *not reliable enough*: **two shipped consumers cannot distinguish
and two can.** (**Corrected 2026-09-02** — this sentence read "two cannot distinguish, one can" while
the row above it already named both `compass.tsx` and `team.tsx`; the count was left behind when Team
gained the treatment.) **An operator who opens the Command Center a minute after PAIGE acts can be told
she has done nothing** (#746) — through `PaigeRailFeed` or `ClientActivityFeed`, which are the two that
collapse it. That is the failure mode — not a visible error.

Two things follow:

- **Leg 7 of the platform goal chain — *owner can see the result* — is broken for every department
  that emits to the Rail**, not only for the ones that emit nothing.
- `paige_audit_log`, the other durable attribution store, **has no Solo reader at all**. Both paths to
  "what did PAIGE just do" are closed.

**Never record this as an empty feed or a healthy one.** If a future session sees no activity in Solo,
the first hypothesis is this grant, not an idle workspace.

### THE TENANT-WIDE RAIL WAS DARK FOR EVERY SOLO TENANT — measured and repaired 2026-09-03

**The finding.** Slice B repaired all four owner-facing Rail consumers, and two of them were still
unreachable by a Solo tenant. `PaigeRailFeed` ("Across your clients — live") ships inside
`PaigeWorkspace`, which `TenantCommandCenterShell` renders **only when the Solo workspace is
absent** (`TenantCommandCenterShell.tsx:606`) — and the Solo shell always supplies it
(`SoloApp.tsx:272`). Confirmed by search: **no `PaigeRailFeed` or `PaigeSidebar` reference exists
anywhere under `src/solo/` or `src/components/tenant-shell/`**, and the mobile `PaigeRailSheet` is
mounted inside the same `PaigeWorkspace` (`PaigeWorkspace.tsx:283`). So the tenant-wide strip is an
Agency / sub-account / admin-shell surface, and a Solo tenant had **no** surface showing the
tenant-wide rail at all.

> **§13 CORRECTION, 2026-09-03, same day — the claim above is WRONG and is kept, marked, rather
> than rewritten (§58).** "A Solo tenant had no tenant-wide rail surface at all" is false, and it
> contradicts the table in this same edit. `TrustCompass` IS mounted on Solo (`SoloApp.tsx:253`)
> and its panel calls `useSoloActivityFeed` (`compass.tsx:469`); so does Team → Activity
> (`team.tsx:233`). Both read `get_solo_rail_activity`, which is the TENANT-WIDE reader. So Solo
> already had two tenant-wide rail surfaces before this slice.
>
> **What was actually true, stated precisely:** `PaigeRailFeed` — the specific strip Slice B
> repaired — is unreachable on Solo, and the Command Center, Solo's DEFAULT LANDING route, carried
> no Rail surface. The panel's real value is putting the rail on the surface a Solo owner lands on,
> not making a previously-invisible capability visible.
>
> Caught by an independent review on #877 (P2), after merge. The overstatement had been repeated
> into the master reference, this record, the tier matrix, the PR body, the commit message, and the
> report to the owner — one unchecked claim propagated to six places because it was written once and
> then copied rather than re-derived. Corrected in all of them.


**Why this was invisible until now.** Slice B's proof was automated, static and deployed-bundle —
all of which pass for a component that renders correctly on a surface nobody can reach. It surfaced
only when the owner test map was written against the *actual* account topology rather than against
the component list. **A repaired consumer on an unreachable surface is not a repaired capability.**

**The repair (this slice).** A compact `Recent activity` panel in the Solo Command Center's Systems
Check side stack (`SoloSystemsCheckWorkspace.tsx`), reading the SAME already-deployed
`useSoloActivityFeed` → `get_solo_rail_activity` the Trust Compass and Team Activity panels use.
**Not a second Rail source**: `useSoloActivityFeed.ts` is byte-unchanged by this slice, and no event
is duplicated or re-derived. No CSS was added — the panel reuses the surface's own `sc-side-panel` /
`sc-section-heading` / `sc-approval` / `sc-muted` / `sc-proof` vocabulary.

**Safe fields hold by CONSTRUCTION, not by filtering at the surface.** `get_solo_rail_activity`
returns eleven display columns; `toActivityItem` narrows those to
`{id,title,summary,byPaige,departmentSlug,occurredAt}`. There is no `payload`, `ref_table`,
`ref_id`, `actor_user_id`, `tenant_id` or `contact_id` in the shape at all, so none can reach the
markup. `id` is a React key and is never rendered, and the feed's `error` string is deliberately
NOT rendered — `status` alone drives the copy — so no SQLSTATE, server text or function name can
surface on a tenant screen. Both properties are asserted, and both assertions were falsified.

**Workspace switch has TWO layers, and the first one already existed.** `CommandHub` keys the mount
on `activeTenantId` (`CommandCenter.tsx:104`), so a switch **unmounts and remounts** the subtree —
no row, filter, pending read or loading state can survive it. The panel additionally forwards
`workspaceId` into the feed's render-time guard and request counter. The remount is the primary
mechanism; the guard is the second layer, and saying it the other way round would overstate what
the new code does.

**METHOD, carried forward from Slice B.** Every mechanism was deliberately falsified before the
slice was called done: the five states collapsed to `items.length` (5 failures), the row's UUID
rendered (1), the raw server error printed (1), the workspace reset moved from render into an
effect (1), the request-sequence guard removed (1). An `act()`-based assertion structurally cannot
observe a painted stale frame — the switch test records every committed frame from a
`useLayoutEffect` instead.

### CORRECTED 2026-09-03 — the four owner-facing consumers now call the resolvers (Slice B)

**What changed, and the one measurement that makes it matter.** `authenticated` has **no `SELECT`
privilege on `paige_client_events`** — re-verified on production `xygzykjyynhzqytbqnzu` on
2026-09-03: `has_table_privilege('authenticated','public.paige_client_events','SELECT')` = `false`.
So every direct-table read in `useRailEvents.ts` and `useSoloActivityFeed.ts` was **refused in
production, always, for every owner**. The two `useRailEvents` consumers then rendered that refusal
as *"Nothing across your clients yet"* and *"Nothing yet"*. **The Rail feeds were not sparse; they
were denied, and they said the opposite.**

Slice B changes the seam, not the schema — no migration, and no grant was widened:

| Consumer | Was | Now |
|---|---|---|
| `src/hooks/useRailEvents.ts` (tenant scope) | `.from("paige_client_events").eq("tenant_id", …)` | `rpc("get_solo_rail_activity", { p_limit })` — **no tenant argument exists to pass** |
| `src/hooks/useRailEvents.ts` (client scope) | `.from("paige_client_events").eq("contact_id", …)` | `rpc("get_client_rail", { p_contact_id, p_limit, p_lens: "client" })` — the narrower lens |
| `src/solo/data/useSoloActivityFeed.ts` | `.from("paige_client_events")` | `rpc("get_solo_rail_activity", { p_limit })` |
| `src/components/paige/PaigeRailFeed.tsx` · `src/components/app/ClientActivityFeed.tsx` | destructured `{ events, connected }`, discarding the error | consume `historyStatus` — four states, kept apart |

Verified on production the same day: both resolvers are `EXECUTE`-granted to `authenticated` and
**not** to `anon` (`get_solo_rail_activity(integer)`, `get_client_rail(uuid,integer,text)`).

**This is a §9 TIGHTENING, and naming the mechanism matters more than the fact.** The direct read
was governed by `pce_staff_read`:

```
is_platform_owner() OR (tenant_id = current_user_tenant_id()
                        AND has_any_role(auth.uid(), ARRAY['admin','super_admin','coach']))
```

That is the **§59 global-role trap**: `user_roles` carries no `tenant_id`, so `has_any_role` asks a
*global* question, while `current_user_tenant_id()` honours `active_tenant_id` for an active
`tenant_members` row at **any** role — plain `member` included. A user who is a plain member of
workspace B and holds a global `coach`/`admin` role earned in workspace A could therefore read
**B's entire tenant Rail** by switching workspace. `get_solo_rail_activity` closes that: it requires
an active `tenant_members` row **of the resolved workspace** at `owner`/`admin`/`coach`.

**§58 — the capability delta, stated rather than buried.** The only access removed is that
escalation path, which is the defect. No legitimate owner loses anything: the table read was
returning nothing to everyone. **`pce_staff_read` itself is UNCHANGED and still carries the trap** —
it is simply unreachable from these four consumers now. Any *other* direct reader still goes through
it; the two Analytics readers (`useClientEngagement.ts`, `CohortRetentionTable.tsx`) are exactly
that, and remain tracked as **#802**, routed to Analytics. Fixing the policy is not this slice's,
and the four consumers no longer depend on it either way.

**Removed export (§58, deliberate):** `railHistoryFilter` — it chose *which column* to filter, a
decision the server now owns outright. Its unit tests were replaced, not deleted, by tests of
`railHistoryRequest` (which resolver answers which scope) and `classifyRailReadError` (42501 is a
refusal, anything else is an outage). No user-facing capability rode on it.

**Request safety (the §51 shape this also closes).** A slow answer for one workspace could
previously land after a switch and paint under the next workspace's heading — both reads
individually authorized, so no policy could catch it. Both hooks now carry a monotonic request
counter, bumped **during render** on a scope change and again per read; a response is honoured only
while the counter still matches.

**METHOD NOTE, recorded because it nearly shipped as a false green.** The first version of the
switch tests asserted the DOM *after* `act()`, which flushes passive effects — so a reset moved from
render into a `useEffect` still passed 11/11. That test could not fail on the defect it named. The
tests now record every committed frame from a `useLayoutEffect` (which runs after the commit's DOM
mutations and before passive effects) and assert the previous scope appears in **none** of them.
Each mechanism was then falsified deliberately — guard removed, guard moved into an effect, the four
states collapsed back to `events.length === 0` — and each falsification produced the expected
failure. **An `act()`-based assertion structurally cannot observe a painted stale frame; if a future
session writes one, it is testing nothing.**

**Still owed (§13):** authenticated owner runtime proof. Everything above is automated, static and
production-catalog evidence. No browser drove the deployed surface as a signed-in owner in this
session.

**This verdict SURVIVED the resolver shipping, and the reason matters (2026-09-02).** A safe server
reader is now deployed — see the section above — but `useRailEvents.ts:198` and
`useSoloActivityFeed.ts:171` still read `paige_client_events` **directly**, and the browser still has
no SELECT on it. Re-measured on production at `1fb79288`, after both migrations:
`has_table_privilege('authenticated','public.paige_client_events','SELECT')` is **still `false`** — by
design, since that revoke is what keeps the defective `pce_staff_read` policy unreachable. So the
owner-facing behaviour is **byte-for-byte what it was**, and that means exactly what the consumer
matrix above says — no more:

- **The two `useRailEvents` consumers still collapse a refusal into an empty feed.** `PaigeRailFeed.tsx`
  and `ClientActivityFeed.tsx` destructure only `{ events, connected }`, so a denied read still renders
  as "nothing yet". **This is the remaining failure mode among the four Rail-feed consumers** — and it
  is deliberately scoped to those four, because they are the ones this record audits. **Two Analytics
  surfaces do the same thing to the same denied table** and are tracked separately as **#802**:
  `useClientEngagement.ts:48` and `CohortRetentionTable.tsx:74` each destructure only `{ data }`,
  discard the error, and fall through to `[]` — so a refusal is rendered as *"Insufficient data"* or
  as retention that never accumulated. **They are out of Slice B's scope, not out of the problem.**
- **The two `useSoloActivityFeed` consumers do NOT.** Both `compass.tsx:377` and `team.tsx:235` compute
  `activity.loading ? 'loading' : activity.error ? 'error' : …` and render an explicit `role="alert"`
  message — *"Recent activity could not be loaded, so this is not a record of nothing happening"* and
  *"This timeline could not be loaded, so it is not a record of nothing happening"*. **Do not describe
  these as showing "nothing yet".** They are the model treatment Slice B extends rather than replaces.
  - **Retry is NOT universal, and the exception is measured.** `team.tsx` offers *Try again* in every
    layout, and `compass.tsx` offers it in the wide layout (`compass.tsx:421`). But
    `solo-tokens.css:173` — `@media(max-width:1020px){ .paige-solo .tc-rail{display:none};
    .paige-solo .tc-railbtn{display:flex} }` — hides the branch that holds Compass's retry at
    **≤1020px**, and the foldout branch that replaces it (`compass.tsx:440`) carries `role="alert"`
    **with no retry control**. So at narrow widths a Compass user is told the read failed and has no
    **manual** way to re-attempt it.
  - **Recovery is NOT absent, though — and this correction matters more than the gap.**
    `useSoloActivityFeed.ts:193–198` re-reads on a `setInterval` of `POLL_INTERVAL_MS = 15_000` while
    the tab is visible, **and** on every `window` `focus` event. So an error state clears itself
    within ~15 seconds of the cause going away, in every layout, with no user action. The accurate
    statement is **"no visible manual retry control at ≤1020px"**, not "no retry" and not "no
    recovery" — those would be false.
  - **That gap is a Slice B input, not a documentation problem.** Slice B's state contract explicitly
    includes *failed with a truthful retry path*, so the compact Compass branch is inside its scope
    and must not be lost. §00: whether a recovery control **exists** is correctness and therefore
    ours; what it should **look like** is Claude Design's.

That split is why the platform status is *not reliable enough* rather than *never* — and why the
verdict is about the platform, not about every consumer equally.

The status line is therefore unchanged, and the honest shape of the remaining gap has changed:

> **Before:** no safe path existed.
> **Then (2026-09-02):** a safe path exists and no owner-facing consumer uses it.
> **Now (2026-09-03, Slice B):** all four owner-facing consumers use it, and each distinguishes
> loading, refusal, unavailable, empty and populated. What remains owed is authenticated owner
> runtime proof — not a code path.

Do not read "the resolver is deployed" as "the Rail is readable by the owner." Those are the two
classes this file's opening table exists to keep apart — **production catalog** proves the object is
deployed; it proves nothing about whether any code path calls it.

**Rail Recovery is tracked as issue #746 (RELEASE-BLOCKING), and #729 is BLOCKED from Gate 2 by it.**
#746 is the required separate Rail Recovery prerequisite for #729's first owner flow to become
production-executable. It is not assigned to #729, and not to this documentation record. **The
resolver landing did not lift that block** — #729's repair #1 operates on the direct-table read, which
is still refused. What changed is that the unblock is now a consumer change rather than a missing
capability.

**Existing work, not authorized as a release path:** PR **#644** (`codex/mind-safe-rail-contract`) adds
`public.get_solo_mind_rail_events()`, a guarded `SECURITY DEFINER` resolver over the same table that
returns structural fields and no producer content, and which *re-asserts* the browser revoke. It
exists because the direct read does not work. The owner ruled 2026-09-02 that it must be freshly
grounded on current `main`, checked against the canonical Spine contract, reviewed for
internal-identifier exposure (it returns `contact_id`, where the Spine lens deliberately uses the
public-safe `account_number`), and proven mergeable **before** it becomes a recovery recommendation.
Two review notes recorded so they are not re-derived: it resolves the workspace from
`profiles.active_tenant_id` **raw** rather than coalescing through `current_user_tenant_id()` — the
pattern behind the §51 #588 anchoring bug and the known Team invitation defect — though it does
correctly key on `profiles.user_id`. #746 adds a third: #644's resolver returns eight structural
fields and **no `title`/`summary`**, which the rail renders — so it is not a drop-in, and the
grant-versus-RPC seam decision must be made *with* #644 rather than around it.

## Pipeline governance — three findings, recorded as follow-up, NOT as capability

**Tracked as issue #755** (grouped, owner priority 3 — required before any Chat Pipeline write bridge).
The issue carries the owner decision, dependencies and sequencing; this file records only the state.
Governed follow-up work, not shipped behaviour:

1. **The Spine's Pipeline evidence is a silent subset.** It reads only Rail rows written by
   `configure_tenant_pipeline` with `policy_result='allowed'`. `deal_move_stage` (PAIGE's own Chat
   tool) writes `public.deals` directly with the service-role client and emits **no** Rail event;
   `pipeline_attach` in `growth-process-submission` does the same. **PAIGE can move a deal and not see
   her own move in her own evidence.**
2. **`deal_move_stage` never consults `move_policy`**, so an approval-required stage stops the board
   and `pipeline_configure`, and does not stop PAIGE's tool.
3. **`pipeline_move_approvals` is write-only.** The table appears in exactly one file — the migration
   that creates and inserts into it. Its `status` enum permits `approved|rejected|cancelled` and a
   `resolved_at` column exists; **no code path anywhere sets them.** A held request is unresolvable,
   and each one permanently increments the dependency count blocking archive of that stage or pipeline.

## What decides whether PAIGE may act (Trust Compass precision)

**The authoritative statement, and it does not change with the catalog finding above:**

> The server action-risk policy plus the canonical confirmation/approval gate decide whether PAIGE
> may act. The Solo Compass dial remains a non-authoritative UI control. Runtime reachability of the
> deployed Trust functions remains `UNVERIFIED`.

The production catalog proves only that `trust_effective_rung()` and `resolve_tool_autonomy(uuid,text)`
**exist**. It does **not** prove — and nothing here should be read to imply — that the Solo browser
Compass dial is authoritative, that the Compass currently governs action execution, that runtime calls
into those functions occur, or that effective autonomy enforcement is proven. `20261019001000:41-48`
separately records that the compass clamps **at render only**.

## The owner-approved priority order (2026-09-02)

Later items do not start ahead of earlier ones. Implementation is assigned by the owner, never
inferred from this file.

**Updated 2026-09-02** after the Rail resolver foundation merged and deployed. Prior states are
corrected in place rather than deleted; what each row *was* is recoverable from this file's history.
The Attention Register standard (`docs/doctrine/paige-attention-register.md` §8) names this exact
table as a live list that obliges an edit when #746 or #755 resolves — that is a known, accepted
overlap, not an oversight, and it is why the register exists.

| # | Work | State |
|---|---|---|
| 1 | PR **#729** — cross-account Rail/Compass hotfix on #728 | **still BLOCKED from Gate 2 by #746.** Its repair #1 reads the direct table, which remains refused. Its `useRailEvents` scope guard is a real dependency for Rail Slice B, not an inconvenience |
| 2 | **Rail recovery + owner-visible outcome reading** — issue **#746**, RELEASE-BLOCKING | **OPEN — foundation only.** The safe resolver is deployed (#785 + the #794 remediation in #795); **no consumer has been moved onto it**, so no owner-facing screen is repaired. Closing #746 additionally requires authenticated owner runtime proof |
| 3 | **Pipeline governance repair** — issue **#755** — before any Pipeline Chat write bridge | parked, owner decision required |
| 4 | Stale doctrine correction | done for the Trust Compass claims (PR #743) |
| 5 | Calendar as the next bounded read-only Spine capability | not started, not authorized |

> **RESOLVED 2026-09-03 by owner decision (§58 — the 2026-09-02 measurement below is kept, not
> deleted).** No documented abandoned-work/transfer procedure exists in this repository, so the
> ownership condition below was structurally unmeetable. The owner ruled directly: *"take ownership
> of the Rail consumer repair now. Do not wait any longer for #776 or #729 ownership replies."*
> **Slice B therefore adopted NOTHING from either branch.** All four consumer files were read from
> current `origin/main` and edited in place, so no unreviewed work was imported and neither PR's
> diff was duplicated. #729's unrelated hotfixes were deliberately not absorbed. The scope-guard
> IDEA credited to #729 below was implemented independently and differently — and the measured
> reason is recorded above: an effect-based reset only *shortens* the stale frame, so the guard runs
> during render. The transfer record lives in task #29.

**Two open PRs already hold Rail consumer work and must not be duplicated (measured 2026-09-02).**
PR **#776** (`318f1dbd`) carries the now-merged `20261042000000` migration **plus** consumer changes to
`ClientActivityFeed.tsx`, `PaigeRailFeed.tsx`, `useRailEvents.ts` and `useSoloActivityFeed.ts` — that
is Slice B's surface. PR **#729** (`5fd08d2c`) owns the `useRailEvents.ts` scope guard covering a
painted-frame leak that a request-token approach alone does not catch: React commits a frame of the
previous scope's data before any passive effect can clear it. **Slice B adopts both rather than
rewriting them.** Neither may be merged except under its own owner's exact-head authority.

**#746 is not assigned to #729, and not to this record.** It is a separate Rail Recovery workstream.

**This file is a state record, not a backlog.** Every distinct finding lives as a linked GitHub issue
— #739, #740, #741, #742, #746, #755 — and is added to the PAIGE Attention Register when that project
becomes available. Do not grow a parallel list here.

## Where the truth for each question lives

| Question | Answer from |
|---|---|
| Is department X connected to PAIGE? | the registry — `supabase/functions/_shared/paige-spine/registry.ts`. It fails closed at import and in CI, and it is the authority a surface card must agree with |
| What may PAIGE perform, and how is it approved? | `supabase/functions/_shared/action-risk.ts` (the one classifier) + `../doctrine/one-approval-gate.md` |
| What does a department actually do today? | its card in `../doctrine/surface-cards/` |
| Can the owner see what PAIGE did? | this file — today, in Solo, largely **no** |

## UPDATE 2026-09-07 — Campaign Brief verified planning-record evidence

The Campaign Brief create/revise Spine capabilities now reach the existing workspace Rail only after a fresh canonical `get_campaign_briefs` read matches the mutation result's exact brief id and version, the current lifecycle, and every intended field. The recorded capability keys are `campaign_brief_create` and `campaign_brief_revise`.

Their owner-visible copy says only that a Campaign Brief planning record was verified created/revised and explicitly denies campaign launch, publication, spend, performance and completion. Refusal, ambiguous selection, stale version, tenant/authority loss, unknown write, readback failure or mismatch never writes a success outcome.

Mind and durable Memory remain `UNAVAILABLE`; authenticated owner/card/Rail production proof remains `PROOF OWED`.

Production closeout: PR #1047 referenced production merge `ae0a16a0`; migration run 34150733491 persisted the owner-safe Rail projection, Edge run 34150733561 deployed the affected graph, both live tags equal the merge, and merge-time CI/Spine/Security/UI gates passed. The post-readback Campaign Brief Rail producer is `LIVE`; authenticated owner/card/Rail browser proof remains `PROOF OWED`, so the owner-visible lane remains `PARTIAL` and Mind/Memory remain `UNAVAILABLE`.

## UPDATE 2026-09-13 — governed CRM/Pipeline release candidate (not shipped)

The contact and pipeline Spine domains now source 32 CRM action bindings from one shared catalogue. Chat adopts those definitions and dispatches only through the authenticated `crm-command` door. The server re-resolves active tenant membership, applies the shared risk/autonomy decision and existing single-use confirmation, then calls one service-only canonical executor. Success requires canonical record/absence readback and `record_capability_run`; the same result is persisted as a Chat card with only server-owned route locators.

This is source state, not a shipped or production-LIVE claim. Database/RLS pgTAP, authenticated same-/cross-tenant and account-switch drives, deployed Edge/migration identity, and owner-visible Rail proof remain PROOF OWED. Task record deep-links remain unavailable because no dedicated router owns one; activity logging remains internal-only with no external effect.
# Systems Check — Truthful Operating-Readiness Console

**Status:** SPEC — owner-directed 2026-09-04. Signal grounding in flight; production wiring gated on
owner approval of the interactive prototype (§69 Gate 1).
**Workstream:** AI orchestration / Command Center. **Tier:** Solo + sub-account (NOT operator/God).
**Supersedes:** the radial "Evidence moving through the business" treatment on
`src/solo/SoloSystemsCheckWorkspace.tsx`.

---

## 0. Why this document exists

The owner's brief is long, precise, and load-bearing. A brief that lives only in a chat transcript
evaporates on the next context reset — which is the exact failure §BRAIN and §0 exist to end. This
file is the durable home for it. Where a requirement below is the owner's own words, it is quoted.

## 1. The problem being fixed

> "The current page is visually polished, but it is not yet a useful operating surface for a
> business owner." — owner, 2026-09-04

The shipped surface renders a radial diagram of four nodes around a PAIGE hub, a "10 persisted
findings" count, a 6-confirmed / 3-needs-attention / 1-unavailable tally, and a single
`Last result <timestamp>`. None of it answers the questions the surface exists to answer.

### The five questions Systems Check MUST answer

1. What is genuinely working right now?
2. What is blocked, disconnected, misconfigured, or unavailable?
3. What data is current, stale, missing, or awaiting proof?
4. What can PAIGE and the connected agent team actually do today?
5. What is the most important next action, who owns it, and where does the owner go to complete it?

### Named defects in the shipped surface

| Shipped | Why it fails |
| --- | --- |
| "Data Product", "Payments Ops" | "too internal and unclear for a Solo owner" |
| "10 persisted findings" | "does not tell the owner what matters" |
| "The picture is incomplete" | "honest but too generic; the page should identify exactly which sources are incomplete and what that prevents" |
| "Last result 9/4/2026, 5:00:05 AM" | "should identify the source and freshness, not imply the entire business was checked at one timestamp" |
| "Open PAIGE for the fuller rundown" as the only exit | a generic exit is not a next action |

### The radial is reassigned, not deleted

> "Do not preserve the radial visual merely because it already exists. Reassign that design
> language to Trust Compass, where it can later represent real agent authority, grounding,
> readiness, impact, and accountability."

## 2. The four sub-tabs, and what each one answers

| Sub-tab | Answers |
| --- | --- |
| Business Game Plan *(default landing)* | what should we do? |
| Systems Check | is the operating environment ready? |
| Mind | what does PAIGE know? |
| Trust Compass | can this agent be trusted to act, within this scope, right now? |

All four derive from the shared layers — Spine, Rail, Mind. None of them holds its own data store.
Mind itself is not yet live; bringing it live is tracked separately.

## 3. Required structure

### 3.1 What needs attention now
A short prioritized list of **real** blockers, failed checks, missing setup, expired or stale
evidence, or owner decisions. Every item carries four things, without exception:

- an **owner** — the business owner, a named agent, or an external provider;
- a **source** — the actual record backing the claim;
- a **freshness date** — what was verified, and when;
- a **direct next action** — deep-linked into the real owning surface (Setup, Integrations, Sales,
  Campaigns, Clients, Billing, Command Center). *Not* a generic "open PAIGE for more".

> **A wrong link here does not 404 — it silently lies.** `/solo/*` is a splat with no catch-all. An
> unknown branch slug resolves to `branchBySlug(...) ?? "home"` and renders **Command Center** while the
> wrong URL stays in the address bar; an unknown third or fourth segment falls back to the branch's
> default. So a mistyped destination *looks like it worked*. Every link this surface emits is built
> through `subtabPath("solo", account, branch, subtab)` or `setupSubtabPath(account, tab)`, never a
> hand-written string.
>
> Four destinations a check would want **do not exist**, and an item that needs one says so rather than
> pointing at something that merely resolves: there is **no forms home** (`forms` is an alias of
> Campaigns → Catalog, and form authoring has no URL at all — the Studio opens on a window event);
> **no social-account connect action** (the route resolves to a declared-unavailable panel); **no
> working `automations` branch** (declared with three sub-tabs, all unreachable — use
> `settings/integrations/automations`); and **no roles destination under Security** (`security-data` has
> no controls; permissions live in `settings/team`). Sending identity, carrier registration and calendar
> connection are `?segment=` **queries**, not paths — written as a path they land on Communications.

### 3.2 What is ready to operate
Only capabilities with source-backed evidence. Stated plainly, in the owner's own register:

- "Email sending is ready."
- "n8n connection is available but a tenant-safe orchestration round trip is still awaiting proof."
- "Zapier API connection is not yet verified."
- "A2P registration is pending provider integration."

> "Do not claim aggregate health where the underlying picture is incomplete."

### 3.3 Operating areas
Plain business language — **not** abstract department labels. Each area carries: current status ·
what we know · source and last verified time · what PAIGE can do now · what is blocked · owner or
responsible agent · exact next action.

The initial nine areas:

1. Business setup and identity
2. People and CRM
3. Sales and commercial operations
4. Email, phone, and SMS readiness
5. Campaigns, social, and advertising
6. Integrations and automations
7. PAIGE agent team and delegated work
8. Business knowledge and data readiness
9. Security, permissions, and governance

### 3.4 Recent real verification
Only actual source-backed checks, provider outcomes, or attributable completed actions — with
success, failure, retry and freshness where those records exist.

> "Do not use fixtures, stale persisted counts, or fabricated 'confirmed' states."

This section reads the Rail. It is the direct consumer of the agent-attribution uplift: without
per-agent attribution the Rail can only say "PAIGE", which cannot answer "who owns it".

### 3.5 Owner decisions and next actions
Make obvious what the owner must do, what PAIGE can complete autonomously, and what is awaiting an
external provider or platform response.

### 3.2 No redundant surface title — OWNER RULING 2026-09-05 (applies to all four sub-tabs)

> *"When people are inside of Systems Check, they already understand that they're in there. I don't
> think we need a banner-sized word saying 'Systems Check'."* … *"Keep that same consistency with the
> two new tabs as well. We don't need redundant words if we have a word right at the top inside of
> the menu bar and it says it. They know exactly where they are."* — Antonio

The Command Center sub-tab strip already names the active surface. A page heading repeating that word
tells the reader nothing they cannot already see and spends vertical space, which on these surfaces is
the scarce resource (§11).

**The rule, binding on all four Command Center sub-tabs:** Systems Check · Mind · and Game Plan and
Trust Compass when they land. No visible surface-title heading. The descriptive line under it stays.

**How it is implemented, and why not by deletion.** The `h1` remains in the DOM and is moved out of
the layout (`.sc-sr-only` / `.mind-sr-only`). Deleting it would take the document's only `h1` with it,
and on Mind it would break `aria-labelledby="mind-title"` on the whole section. A sighted reader loses
a redundant word; a screen-reader user loses nothing.

Pinned by assertion on both surfaces so a later pass cannot quietly restore it:
`SoloMindWorkspace.test.tsx` asserts the exact hidden-heading markup and the CSS rule behind it.

*This is a cross-surface ruling recorded here because this is the doc that exists today. It belongs in
the four-surfaces architecture contract (task #9) and should move there when that lands.*

## 4. Status vocabulary — CLOSED SET

Nothing outside this list may render, ever:

`LIVE` · `PARTIAL` · `NOT CONNECTED` · `NEEDS ATTENTION` · `PENDING PROVIDER` · `UNAVAILABLE` ·
`PROOF OWED` · `PAUSED` · `NOT CHECKED`

`NOT CHECKED` is the ninth, **owner-ratified 2026-09-05** — see §4.4a for what it means and what it
obliges. The other eight are the original set.

> "Do not use an unexplained health percentage or trust score."

No percentage. No score. No aggregate roll-up over an incomplete picture.

### 4.1 The store cannot express two of the eight words

`paige_systems_check_finding.status` is CHECK-constrained to `pass | fail | skip | error`
(`_shared/systems-check-runner.ts:48`, and `:319` rewrites anything else to `error`). So **no signal
sourced from a persisted finding can ever render `PENDING PROVIDER` or `PAUSED`.** Those two words
have to be derived from the live source that actually holds the state — `tenant_email_domains.status`,
`tenant_a2p_registrations.*`, `paige_automations.state`, `tenant_tool_autonomy.mode` — or the runner's
four-value vocabulary has to widen.

This is a real architectural constraint on the port and it is invisible from the §8 tables. Whoever
wires a `PENDING PROVIDER` or `PAUSED` signal is reading a different table from the one every other
signal reads, and the surface must not pretend otherwise.

### 4.2 The genuine hole: switched off by someone who is not the owner — OWNER RULING NEEDED

`suspended` is a live CHECK value on six tables and is written by real shipped code: Twilio maps its
own subaccount status straight through (`provision-tenant-twilio/index.ts:73-76`); a platform operator
can freeze a tenant (`paige-mcp/index.ts:3897-3900`); an agency admin can suspend a seat
(`AgencyTeamPanel.tsx:175-180`); a carrier can suspend a registration.

**None of the eight words fits.**

- `PAUSED` is actively wrong — it tells the owner *you* switched this off, when Twilio or the platform did.
- `NOT CONNECTED` is wrong — it *was* connected, and it was taken away.
- `UNAVAILABLE` means, by this document's own gloss, that there is no source at all. Here there is a
  source and it is saying something definite and severe.
- `NEEDS ATTENTION` is the least wrong, and it fails §3.1's "direct next action" requirement whenever
  the answer is *there is nothing you can do inside Paige*.

**Honest scope.** Zero rows sit in any `suspended` state on production today, so this is
reachable-but-unoccupied — a hole, not a defect anyone can see right now. It becomes visible the first
time a carrier suspends a workspace's messaging account.

**The decision is the owner's**: either a ninth word, or a ruling that `NEEDS ATTENTION` absorbs it
with the owner-facing sentence carrying the *who switched it off* fact. The prototype renders it the
second way and annotates the compromise, so the cost is visible rather than argued.

### 4.3 A live `PROOF OWED` that is firing right now

The platform's own §68 clamp is in the capped state as this is written: `ceiling 3`,
`attested_at 2026-08-24`, and rung 3 requires both `operator_cross_tenant_canary` and
`operator_rls_coverage` to pass. The canary passed at 2026-09-04 23:00:03; `operator_rls_coverage`
**failed** in the same run. So `requested = 3`, `effective = 2`, `capped_by = 'proof'`.

That is an unfabricated `PROOF OWED`. It is also **platform state, and a Solo workspace must never
learn it** (§9) — the tenant surface may say only that something is further limited by platform
policy, without disclosing the platform's posture, ceiling, attestation or the reason.

### 4.4a `NOT CHECKED` — the ninth word, OWNER-RATIFIED 2026-09-05

**Shipped code renders a word this section says may never render.** The `areaStatus` memo in
`SoloSystemsCheckWorkspace.tsx` (`area.coveredBy.length === 0 ? "notchecked" : …`, rendered via the
area `StatusPill`) falls back to **`Not checked`** for any operating area whose `coveredBy` list is empty — today that is
*Paige's team and delegated work*, *Business knowledge — the Mind*, and *Security, permissions and
governance*, all three visible on the live Solo surface.

That is a direct contradiction of this section's own "nothing outside this list may render, ever", and
it is recorded here rather than left for someone to discover, because a spec that disagrees with the
code it governs is worse than no spec (§13 · §66).

**Why none of the eight was used.** The closed set has no term for *no check exists for this area at
all*, which is a different fact from every word it does carry:

- `UNAVAILABLE` is the near miss and is still wrong. By §4.2's own gloss it means a source was
  consulted and could not answer. Here nothing was consulted, because nothing is wired to consult.
- `NOT CONNECTED` asserts a connection that is absent. These areas are not connections.
- `PROOF OWED` implies a proof is pending. Nothing is pending; no check has been written.
- `NEEDS ATTENTION` is a claim that something is wrong. Nothing is known to be wrong, and saying so
  would be the exact fabrication §13 forbids — an absent check is never evidence of a fault.

**The distinction is load-bearing, not pedantic.** "We looked and could not tell" and "we have never
looked" are different promises to the owner, and only one of them implies a defect somewhere. Collapsing
them would make the surface less truthful, which is why the ninth word was used.

**RULED.** The owner ratified it: *"as far as the 'not checked' that you haven't checked yet, that's
fine… I don't mind having it."* The closed set is nine words.

**And it carries an obligation, which is the owner's actual instruction:** *"Just write something on
the backend for other agents to be able to refer to, so they know that when they're wiring into those
areas, they can directly point them to the 'not checked' areas. Once they start wiring into those
areas, they know that they need to address those first."*

So `NOT CHECKED` is not a resting state — it is a **marker of unfinished backend work**, and the
obligation lives where an engineer will actually meet it: a header block in
`src/solo/systems-check-areas.ts` naming the four steps that finish an area (registry row →
tenant-scoped runner → destination map → move the id into `coveredBy` and delete the `uncovered`
string), plus a pointer comment on each of the three affected rows.

The failure it exists to prevent is specific and quiet: someone builds the Mind, ships it, and the
console keeps saying NOT CHECKED about a thing that now works — because nothing fails and no test
complains. The header also names the service-role trap that broke the revenue check, since a new
runner is the step most likely to hit it.

Carrying it today: **Paige's team and delegated work · Business knowledge — the Mind · Security,
permissions and governance.**

### 4.4 Two data defects found while grounding the vocabulary

**`automation_wired` is filed under `domain = 'payments_ops'`** (`20260816000000_systems_check_layer1.sql:270`,
live-verified). An automation check therefore renders under the **Payments Ops** node. The L2 §38
correction fixed its sibling's `runner_key` and never touched the domain. This is a mis-file, not a
naming preference.

**Eight of the ten tenant check names are engineering vocabulary**, and "configured" appears in four of
them: `Comms configured across the board` · `Website connected or detected` · `External automation
solution wired` · `Company info populated` · `Customers present in CRM` · `Sales pipeline scoped and
configured` · `Sales revenue tracking configured` · `Payment method options configured`. The four
node labels an owner sees are the raw `domain` enum title-cased by `label()`
(`SoloSystemsCheckWorkspace.tsx:27-28`) — which is why "Data Product" and "Payments Ops" read internal.
Both are registry-content fixes, not surface fixes.

## 5. The Refresh contract

Refresh must be real. It either:

- performs the supported current checks and displays updated source and freshness evidence; **or**
- says plainly that a source cannot currently be checked.

> "It must never refresh a static fixture and represent it as live operating evidence."

A signal that cannot be re-checked on demand says so, and says why. Every re-runnable check must
name its callable seam, and the seam must be invocable by a Solo owner/admin/coach under RLS.

### 5.1 What the seam actually supports — grounded, not assumed

**A genuine on-demand re-check exists today and needs no backend change.** Invoking
`systems-check-run-onboarding` from the browser with the workspace's own session runs the full
ten-check catalog and returns a real summary. `verify_jwt` is false at the gateway, but the function
falls through to `resolveTenantFromJwt`, which verifies the JWT and derives the tenant **server-side**;
a browser holds neither the service-role key nor the cron token, so it can never reach the trusted
branch, and `body.tenant_id` is honoured only for a platform owner. A workspace cannot re-check
another workspace.

**Today's `refresh()` is not that.** It calls `qc.invalidateQueries` and re-reads the same persisted
run (`useSystemsCheck.ts:151-153`). That is a legitimate action with a legitimate label — *"Re-read
the last recorded run. Nothing was re-checked."* — and it is the exact thing that must never be
labelled a re-check. **The two are different buttons and always will be.**

**Three costs of the real re-check, which the surface says out loud rather than hiding:**

1. `paige_systems_check_run.scan_flavor` is CHECK-constrained to
   `('onboarding','scheduled','change_triggered')`, so a human-requested run is recorded as an
   *onboarding* scan. The audit trail will not say a person asked for it until a migration widens it.
2. Both browser-reachable flavors use `actionFiling: "all"`, and `file_action` has no dedupe. Pressing
   twice against eight failures files sixteen remediation actions and burns sixteen model calls.
3. It is one blocking POST — every check and every drafted fix completes before the response returns.
   There is no progress stream.

### 5.2 An honest in-flight state is available, and our own comment denies it

The run row is inserted **before** the first check runs (`systems-check-runner.ts:277-291`) and
`completed_at` is patched at the end (`:469-477`). So a run in progress is readable right now as the
latest run with `completed_at IS NULL`, and the snapshot RPC already returns that column. The surface
can say *"A check is running now — started 08:41"* from real state rather than from a timer.

`useSystemsCheck.ts:64` asserts the opposite — *"the scan writes its run only on completion"*. That
comment is false, and it is why the honest in-flight state looks impossible. Correcting it is part of
the wiring work.

### 5.3 The structural fix that unblocks the rest

> **Partially shipped 2026-09-05 (PR #935). This section is corrected in place rather than deleted,
> because the reasoning still stands and one of its three consequences is now closed.** The section
> previously described the partial-scan collapse as *"live behaviour today"*. It is not, and leaving
> that sentence would have had the spec assert a fixed defect as current — the §13 drift §66 exists
> to prevent, committed here by the same session that shipped the fix.

`systems_check_snapshot` no longer returns the latest RUN's findings. Since migration
`20261203000000` it returns the findings of the latest **full sweep** — the newest run with
`selected_runner_keys IS NULL AND scan_flavor <> 'change_triggered'` — and
`approve_systems_check_finding` resolves "latest" the same way, so the two cannot disagree (§57).

- **A partial scan erases the whole picture — CLOSED.** `rescanBusinessContext.ts` still fires
  `change`-triggered scans after a Setup save, each writing a run with a `check_count` of one or
  two, but such a run can no longer become *the* run this surface reads. Proven on prod before the
  fix by injecting a simulated Setup-save run: the pick moved from a 1-check run to the 10-check
  sweep on the affected tenant and was unchanged for the other thirteen. Note what this was: a
  loaded trigger, not an observed failure — production carried zero `change_triggered` runs at the
  time, and the wiring had shipped two days earlier.
- **Remediation filed against an older run is invisible — STILL OPEN.** Unchanged by the above: the
  read is still run-scoped, just to a better-chosen run.
- **Per-check re-run can never be made safe** while a single run replaces the view — STILL OPEN.

**The durable fix is still latest-per-check** (`DISTINCT ON (f.check_id) … ORDER BY f.check_id,
f.created_at DESC`), and the guard above is explicitly the cheaper interim: it trades a loud,
flattering lie for a quieter stale one. The sweep it now reads is the scheduled daily one, so what
the console shows is **anything up to 24 hours old** — a tenant can make a check *worse* inside that
window without the surface saying so. (Do not read a single measurement as the steady state. The
scheduled tenant sweep is `cron.job` 10, `0 9 * * *` — 09:00 UTC — so the age cycles from zero to a
full day. A reading taken at 2026-09-05 05:31 UTC put all 14 tenants at 1.4h, which looks reassuring
and is not the steady state: that sweep was a **manual fire** of the same job made earlier in that
session, and the last genuine cron run was 09:00 UTC the previous day.)

That change is larger than the one-line replacement this section originally implied, and the
grounding pass established why: latest-per-check **deletes the run-level incompleteness signals and
falsifies the survivor**. Under a registry-driven read the finding count is always the registry
count, so "recorded N but only M readable" stops detecting incompleteness and becomes a
registry-drift detector that fires permanently the moment any check is disabled. Incompleteness has
to move to **per-row freshness before the read changes**, the age-out threshold cannot be one
constant across both lenses (tenant median gap 24h; operator median 1h, p95 1h), and the approve
gate has to move with the read or a recovered older finding can never be approved.

**Sequence: this first, then the on-demand scan flavor and caller-supplied `actionFiling` together,
then per-check re-run.**

### 5.4 The exact labels

| What the button does | Label | Result line |
|---|---|---|
| Re-reads the persisted run | **Refresh current data** | *"Re-read the last recorded run. Nothing was re-checked."* |
| Runs the full catalog and awaits the summary | **Re-run the checks** | From the returned summary only: *"Re-ran 10 checks — 3 passed, 6 need attention, 1 could not be evaluated."* |
| A run is in flight | — | *"A check is running now — started 08:41."* Everything shown is labelled last-recorded. |
| The run failed | — | *"The re-check did not run: {error}. The result below is still the last recorded run from {time}."* |

A count that no run produced never appears. A check that did not execute is `UNAVAILABLE` — not
passed, not failed, and never quietly omitted.

## 6. Scope boundaries

**In scope.** Grounding every signal; the truthful status contract; the Refresh contract; the
prototype; wiring only the proven signals; labelling every unproven source `UNAVAILABLE` or
`PROOF OWED`.

**Out of scope — explicitly.** A2P/Twilio provider functionality and Zapier API/MCP
implementation. Those are separate active workstreams.

> "Instead, create reusable truthful result contracts so those separate workstreams can feed
> Systems Check when their real state is available."

So this workstream defines the **result contract** those workstreams must satisfy, and consumes it
when they publish. It does not implement them.

**Design jurisdiction (§00).** The owner set this direction himself and it is ported as given.
Visual treatment beyond that direction is Claude Design's. Claude Code owns whether each value is
wired to a real backend or an honest absence, whether the next action actually resolves, and
whether the surface renders at all.

**Viewport.** Keep the Command Center form-fitting at the required Solo viewports.

> "Do not make the page a dense monitoring dashboard or introduce broad scrolling as an escape hatch."

## 7. Required sequence

1. Ground every proposed signal in a real source, owner, freshness rule and safe status vocabulary.
2. Produce the interactive prototype across **empty, partial, ready, blocked, provider-pending,
   failure, retry, and workspace-switch** states.
3. Keep the radial/dial concept for the separate Trust Compass sub-tab.
4. Wire only proven signals into the production page.
5. Label every remaining source unavailable or proof owed rather than creating decorative status.

Step 2 is the §69 Gate 1 approval point. No production UI ships before it.

## 8. Grounded signal inventory

*Produced by an eleven-agent grounding pass against live production (ref `xygzykjyynhzqytbqnzu`), 2026-09-04. Every row names the source that backs it. A signal with no source is not in this table — it is in that area's **unavailable** list below it, with the searches that prove the absence.*

**101 grounded signals across nine areas. 57 things an owner would expect that have no source today.**

| Status today | Signals |
|---|---|
| `LIVE` | 28 |
| `NOT_CONNECTED` | 26 |
| `PENDING PROVIDER` | 1 |
| `PARTIAL` | 27 |
| `PROOF_OWED` | 9 |
| `NEEDS_ATTENTION` | 7 |
| `UNAVAILABLE` | 3 |

> **Read the status column before the signal.** `LIVE` means a real source answers it now. `PARTIAL` means the source exists but does not cover the whole claim. `PROOF_OWED` means something asserts it and nothing has verified it. `UNAVAILABLE` means there is no source at all. Only `LIVE` may render without a qualifier.

> **And read it as a snapshot, not as the signal's nature.** Each status below is the value **one
> workspace held on 2026-09-04**, not the set of states that signal can occupy. That distinction
> caused a real error: the sending-domain row was recorded `NOT_CONNECTED` because no tenant was
> mid-verification when the first pass ran. A second pass found the only `tenant_email_domains` row
> on production sitting at `status='verifying'` — created 2026-09-04 20:51, updated 22:43, carrying a
> real provider id and three DNS records. That workspace had done its part and the provider had not
> answered. The row is corrected to `PENDING PROVIDER` above. Anyone wiring a signal must read its
> **state space** from the source's own CHECK constraint or enum, never from whatever value happened
> to be there the day it was catalogued.


### 8.1 Business setup and identity

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Your business profile is missing the details Paige needs: website, business phone, and industry. Your business name is on file. | `LIVE` | Persisted finding `paige_systems_check_finding` where `check_id='company_info_populated'`, columns `status` + `evidence` (`{has_name, has_website, has_business_… | The business owner (or a workspace admin). A coach can see t… | /solo/{account}/settings/setup/business-profile — built by `setupSubtabPath(account, 'business-profile')` at s… | Nothing blocks the signal. Two accuracy defects must be carried honestly: (a) `has_name` i… |
| Website: no site connected and no page published yet. | `LIVE` | Persisted finding `paige_systems_check_finding` where `check_id='website_connected'`, `evidence = {has_published_growth_page, has_declared_website}`, read via `… | The business owner (or admin). Coach is read-only per `solo_… | Two real routes, and the signal should name the one that matches which half is false. Declare an existing site… | Half the next action is unproven: the publish-a-page route was not traced. Linking a route… |
| Your registered legal business name — the name that appears on agreements and message-sending registrations. | `NOT_CONNECTED` | `tenant_legal_profile.legal_business_name` (NOT NULL on the row, so the row's existence IS the signal). Table created/extended by migration `20261020020000_setu… | The business owner. `solo_setup_access_scope()` returns `own… | /solo/{account}/settings/setup/business-profile (src/solo/setup-subtab-route.ts:27, tab `business-profile` fro… | Nothing blocks the signal. Note for whoever wires it: do not read this column through a di… |
| When you last confirmed each business detail — website, phone, industry, legal name, address, entity type, registration ID, and authorized r… | `LIVE` | `tenant_legal_profile.setup_provenance` (jsonb, NOT NULL), one entry per field shaped `{source, confidence, confirmedAt}`. Reachable two ways: `get_solo_setup_c… | The business owner (or admin) confirms the facts; the timest… | /solo/{account}/settings/setup/business-profile — re-confirming a field there re-stamps `confirmedAt`. | Nothing. One trap to avoid: `tenant_setup_business_context_meta`, `tenant_setup_private_co… |
| The email address Paige sends from on your behalf, and whether it is verified, ready to send, or only reserved. | `LIVE` | RPC `resolve_tenant_domain_identity()` — live body verified on prod — returning `default_email_sender`, `default_email_reply_to`, `default_email_kind`, `default… | Split. The reserved/shared identity is provisioned by the pl… | /solo/{account}/settings/setup/people-email (tab `people-email` from `SOLO_SETUP_TABS`, src/solo/settings-busi… | Nothing blocks the signal. The missing verification DATE is a real gap in the contract's r… |
| No social accounts are on record for your business. | `NOT_CONNECTED` | Persisted finding `paige_systems_check_finding` where `check_id='social_accounts_connected'`, `evidence = {social_handle_count, declared_capture_only}`, read vi… | Nobody today. There is no surface where a business owner can… | NONE EXISTS. Verified: no route writes `tenants.features.social_handles`. This item must render its next actio… | A missing write path. The check ships enabled, MVP-locked and priority 3 in the registry,… |
| Your workspace has chosen what your business does — the playbook that shapes your pipeline, calendar and Paige's brief. | `LIVE` | `tenants.features->>'playbook'` (non-empty) OR presence of the key `tenants.features->'playbook_config'`. This is the platform's own shipped definition of setup… | The business owner. The gate itself only applies to Solo and… | /admin/marketplace (the constant `SETUP_CHOOSER_PATH`, src/components/auth/RequireSetupComplete.tsx:35) or the… | Nothing blocks the signal. Two honest constraints on how it is worded: no choice date exis… |
| Registered business address and the authorized representative on file for message-sending registration. | `NOT_CONNECTED` | `tenant_legal_profile` columns `registered_street, registered_street_secondary, registered_city, registered_region, registered_postal_code, registered_iso_count… | The business owner — `owner_full` is required for the legal… | /solo/{account}/settings/setup/business-profile (src/solo/setup-subtab-route.ts:27). | Nothing blocks the signal itself. What these fields FEED — carrier/message-sending registr… |

**No source today (7) —** BUSINESS TIMEZONE AND OPERATING HOURS. No tenant-level or business-level timezone column exists anywhere in the schema. PROOF: queried prod `informati… · ONBOARDING COMPLETION OR PROGRESS. `tenants.onboarding_state` (jsonb NOT NULL, added by migration `20260714123722_owner_onboarding_state.sql`) cannot… · A SETUP COMPLETENESS PERCENTAGE OR SCORE. Deliberately not proposed, and there is no source that would make one honest even if it were wanted: the fou… · CARRIER / MESSAGE-SENDING REGISTRATION STATUS FOR THE BUSINESS'S LEGAL IDENTITY. `tenant_a2p_registrations` exists (extended by migration `20261020020… · AUTOMATION-PROVIDER CONNECTION STATE (the Zapier-class workstream, excluded). Same contract as above applies to `external_automation_detected`, whose… · PER-FIELD CONFIRMATION DATES INSIDE THE SYSTEMS CHECK FINDING ITSELF. The dates exist (see the provenance signal) but they do not travel into the pers… · A PAIGE-DRAFTED FIX FOR MOST OF THESE ITEMS. `paige_systems_check_finding.paige_drafted_fix` is populated on only a small minority of rows. MEASURED o…

> METHOD AND SCOPE. Every claim below is either a repo citation at file:line / migration filename, or a query run against prod project `xygzykjyynhzqytbqnzu` on 2026-09-04. Where I could not verify something I said UNVERIFIED rather than inferring it. I made no code changes and expressed no view on how anything should look.  THE ONE THING THE OWNER SHOULD KNOW FIRST. This area is in better shape than the current tile suggests, because the underlying sources are real and were repointed recently. The daily scan is genuinely running — cron job `systems-check-scheduled`, jobid 10, `0 9 * * *`, active=true, most recent run completed 2026-09-04 09:02:01Z. The problem is not missing data; it is that…


### 8.2 People and CRM

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| You have N people on file in this workspace. | `LIVE` | RPC public.practice_dashboard_metrics(p_window_days int) → key active_clients. Body: SELECT count(*) FROM public.clients WHERE tenant_id = t AND status = 'activ… | Business owner | /solo/{account_number}/clients/people — the Solo People list (src/lib/routing/tierBranches.ts:150-155, root '/… | Nothing blocks the read. Two accuracy items: (a) the 'Active clients' label must be correc… |
| N people were added in the last 30 days. | `LIVE` | RPC public.practice_dashboard_metrics(p_window_days) → key new_clients. Body: SELECT count(*) FROM public.clients WHERE tenant_id = t AND created_at >= win_star… | Business owner | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155). | Nothing. The surface must print the window ('last 30 days') because the RPC will happily c… |
| N people have had nothing recorded against them in 21 days. | `LIVE` | RPC public.practice_attention_queue() → key at_risk_clients. Body: count of clients WHERE tenant_id = t AND status='active' AND NOT COALESCE(do_not_contact,fals… | Business owner, with PAIGE able to draft the outreach | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155). The count is a scalar — the R… | practice_attention_queue() returns a scalar only. Naming WHICH people are silent needs a n… |
| N people started onboarding and no completion has been recorded. | `LIVE` | RPC public.practice_attention_queue() → key onboarding_in_progress. Body: count of clients WHERE tenant_id = t AND onboarding_stage IS NOT NULL AND onboarding_s… | Business owner | /solo/{account_number}/clients/portal — the Solo Portal sub-tab (src/lib/routing/tierBranches.ts:157). For an… | Scalar-only RPC (no ids). No Paige seam for the onboarding ladder. A contact parked at 'in… |
| Your relationship stages are the platform starter set, not stages you wrote. | `LIVE` | RPC public.get_tenant_journey_stages(_tenant uuid DEFAULT NULL) — returns one row per stage with a boolean is_tenant: true for rows from public.tenant_journey_s… | Business owner | NONE EXISTS for a Solo owner. Searched src/ for get_tenant_journey_stages and tenant_journey_stages: the only… | No Solo surface to author or edit the stage ladder, even though the write model and its RL… |
| Where each person sits on your ladder has not been set by anyone — it was filled in automatically. | `PROOF_OWED` | clients.journey_stage_slug (the current source of truth, indexed on (tenant_id, journey_stage_slug) — supabase/migrations/20260802160000_blueprints_slice2_tenan… | Business owner | NONE EXISTS as a ladder-management surface — see the previous signal. Per-contact, the legacy /admin/contacts/… | No join between clients.journey_stage_slug and paige_journey_stage_transitions is computed… |
| Your workspace has N seats. | `LIVE` | RPC public.get_solo_team_workspace(_search,_permission,_limit,_offset) → key total_members, counted from public.tenant_members joined to profiles and auth.users… | Business owner | /solo/{account_number}/settings/team (src/lib/routing/tierBranches.ts:219). | Nothing for the read. The count conflates active and suspended seats unless the console sp… |
| An invitation you sent has not been accepted, and here is how far the email actually got. | `LIVE` | RPC public.get_solo_team_workspace → key invitations: public.tenant_invite_tokens WHERE tenant_id = _tenant AND kind='team' AND archived_at IS NULL, LEFT JOIN L… | Business owner | /solo/{account_number}/settings/team (src/lib/routing/tierBranches.ts:219) — the surface that already renders… | Only owner/admin can see it (by design). Paige cannot chase an unaccepted invitation. |
| N people have no email address and N have no phone number, so nothing can reach them. | `PARTIAL` | public.clients.email and public.clients.phone (both nullable — supabase/migrations/20260411060930_493f10d7-393a-45f8-ac22-b4497c5e716b.sql:7-8). Countable today… | Business owner | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155) — the list already renders ema… | Role-dependent RLS narrowing makes a client-side count untruthful for a coach. Also note a… |
| N people are marked do-not-contact and must be left alone. | `PARTIAL` | public.clients.do_not_contact — boolean NOT NULL, present in the Solo People select list (src/components/tenant-relationships/useTenantRelationshipsData.ts:147)… | Business owner | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155) and open the record. | Role-narrowed count (same fix as reachability). No record of when or why the flag was set. |
| N of your clients can sign in to your portal; the rest cannot. | `PARTIAL` | public.clients.linked_user_id — nullable, with a partial UNIQUE index clients_linked_user_id_unique enforcing one client record per auth user (supabase/migratio… | Business owner | /solo/{account_number}/clients/portal (src/lib/routing/tierBranches.ts:157). Per-person, /solo/{account_number… | No read joins consumer invites to their delivery status the way the team read does, so 'in… |
| N people have nobody on the team responsible for them. | `PARTIAL` | public.clients.assigned_coach_user_id (also lead_owner_user_id and cs_primary_user_id — three distinct seats). assigned_coach_user_id is selected by the Solo Pe… | Business owner | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155). Seats are managed at /solo/{a… | Meaningless at a roster of one, so it needs the total_members guard. Coach-narrowed. No as… |
| Your last setup check ran on <date>. | `NEEDS_ATTENTION` | public.paige_systems_check_run — columns started_at, completed_at, check_count, pass_count, fail_count (supabase/migrations/20260816000000_systems_check_layer1.… | PAIGE (the scan is hers to run); the business owner only see… | NONE EXISTS as an owner-triggerable control. Searched src/ for every invocation of the three runners: the only… | No owner-facing rescan control, and a scheduled sweep that structurally never reaches most… |
| The setup check last recorded N customers on <run date> — this is not today's number. | `PROOF_OWED` | public.paige_systems_check_finding WHERE check_id = 'crm_has_customers', columns status, evidence, created_at (supabase/migrations/20260816000000_systems_check_… | PAIGE (the scan) — the finding is not the owner's to fix | /solo/{account_number}/clients/people (src/lib/routing/tierBranches.ts:150-155) to see the real book. There is… | The crm/contacts rescan trigger exists on the server and has no caller. Wiring the existin… |

**No source today (6) —** DUPLICATE PEOPLE ACROSS THE BOOK — no tenant-readable source. Searched for 'duplicate', 'dedup', 'merge_contact', 'similar_contact', 'data_quality' an… · ENGAGEMENT TEMPERATURE (hot / warm / cool / cold) — the column exists and is frozen. public.clients.temperature was added and backfilled ONCE, on 2026… · LEAD SCORE / LEAD QUALITY RANKING — never computed. public.clients.lead_score exists and is NOT NULL, but searching supabase/functions/ and src/ for e… · A RELIABLE 'LAST CONTACTED' DATE PER PERSON, ON THE SOLO TIER — the column is not written from anywhere a Solo owner can reach. public.clients.last_co… · WHO CHANGED A PERSON'S OWNER, AND WHEN — no audit trail exists for assignment. Searched migrations and src for an assignment or ownership history tabl… · WHICH SPECIFIC PEOPLE ARE BEHIND ANY OF THE LIVE COUNTS — the RPCs return scalars only. public.practice_attention_queue() returns a flat jsonb of five…

> SCOPE. People and CRM only. Deals, pipelines and pipeline stages belong to the Sales area and are excluded even where the same RPC returns them (practice_dashboard_metrics also carries won_value_cents, pipeline_value_cents and deals_by_stage). public.communications_consents is real and tenant-scoped but is messaging consent and belongs to the comms area; I have neither claimed it nor listed it as unavailable. follow_ups_due and tasks_due from practice_attention_queue read paige_actions and tasks and are ops, not People.  THE ONE ENTITY. There is no contacts table. The CRM person is public.clients, and contact_deal_rollup / contact_readiness_rollup are VIEWS over it — stated explicitly in the…


### 8.3 Sales and commercial operations (Solo / sub-account tier)

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Your sales pipeline is set up and its stages are in place, so work can be tracked from first contact through to won or lost. | `NOT_CONNECTED` | paige_systems_check_finding.status for check_id='sales_pipeline_configured' on the tenant's latest paige_systems_check_run. Runner: supabase/functions/_shared/s… | Business owner | /solo/{account}/growth/pipeline — the 'Create pipeline' button in the empty state (src/solo/growth2.tsx:273),… | Nothing. Source, tenant scope, freshness stamp, owner control and Paige re-verify all exis… |
| You have told Paige how your clients pay you. | `NOT_CONNECTED` | tenants.payment_processor_declared — column and CHECK added by supabase/migrations/20260816140000_systems_check_l2_capture_and_action_kind.sql:39-51 (allowed: s… | Business owner | /solo/{account}/growth/sales — the 'Payment handling' band, 'Record it' (or 'Change') button at src/solo/sales… | Nothing blocks the owner. Paige is blocked from acting by the absent service_role EXECUTE… |
| The ways you accept payment are written down — cards, bank transfer, cash, cheque, and so on. | `NOT_CONNECTED` | tenants.payment_methods_declared (text[] with a CHECK, same migration: supabase/migrations/20260816140000_systems_check_l2_capture_and_action_kind.sql:39-58; al… | Business owner | /solo/{account}/growth/sales — the same 'Payment handling' band and PaymentEditor as the processor (src/solo/s… | Nothing blocks the owner; Paige cannot write it by design. |
| What you sell is written down — the offers a client can actually be signed up to, and what each one costs. | `NOT_CONNECTED` | public.tenant_products and public.tenant_prices, read at src/solo/useCatalogOffers.ts:325 and :374-376, both filtered .eq('tenant_id', activeTenantId). The offe… | Business owner | /solo/{account}/growth/catalog — the 'New offer' button at src/solo/catalog-offers.tsx:750, and the first-use… | No Paige-callable offer seam (CLAUDE.md 10) — the owner must use the Catalog UI. Adding on… |
| The live work you are chasing — which deals are open, what stage each sits in, and when each last moved. | `PARTIAL` | get_pipeline_workspace(_tenant_id) → deals[], consumed at src/solo/useSoloCampaigns.ts:172 and mapped at :245; the projected shape is declared at :107 (id, titl… | Business owner | /solo/{account}/growth/pipeline — the board itself (src/solo/growth2.tsx:390). The same RPC-backed component i… | Deal value and expected close date are not exposed by the tenant-safe RPC. Widening get_pi… |
| Money your clients have actually paid you. | `UNAVAILABLE` | public.tenant_orders — table created in supabase/migrations/20260629182422_3b39bc81-a6f3-4aad-af8a-3d94dc89fa56.sql:145-179 (amount_total, currency, status pend… | External provider plus platform — the tenant's own processor… | NONE EXISTS. There is no control anywhere in the Solo app that can cause a payment to be recorded. The row mus… | The only INSERT path is undeployed and, per CLAUDE.md 38, is the wrong shape (destination… |
| What each client has actually agreed to — the terms, the payment schedule, and whether that commitment is still running. | `NOT_CONNECTED` | public.tenant_client_agreements, read at src/solo/useSoloCommercialTerms.ts:365 (six-column projection holding a contact_id POINTER, never a copied client name or em… | Business owner | /solo/{account}/growth/sales — the agreement editor at src/solo/sales-ops.tsx:499-624, opened from the Sales s… | No Paige-callable agreement seam (CLAUDE.md 10). The owner is not blocked. |
| Whether Paige can confirm your revenue tracking is set up. | `PROOF_OWED` | Registry check revenue_tracking_configured — verified live in paige_systems_check_registry: check_name 'Sales revenue tracking configured', domain payments_ops,… | PAIGE / platform — this is a backend change, not something t… | NONE EXISTS. There is no control anywhere in the Solo app that can move this check off 'skip'. Offering the ow… | The runner's only seam is owner-gated and structurally unanswerable from the service-role… |

**No source today (5) —** REVENUE, MRR OR FORECAST FOR THE TENANT'S OWN BUSINESS. There is no source, and the closest thing to one is a fixture. Searched: (a) grep -rniE '\b(mr… · INVOICES AS AN OWNER-VISIBLE RECORD. The table and the write path exist; the surface does not. Searched: grep -rn 'paige_invoices' across src/ --inclu… · WHICH CAMPAIGN OR SOURCE PRODUCED A SALE (attribution). No join exists. Searched: grep -rn 'utm_campaign\|utm_source' across supabase/migrations/*.sql… · WHETHER THE DECLARED PROCESSOR IS ACTUALLY WORKING. The platform records a tenant's stated processor and deliberately verifies nothing about it. The r… · MONEY OUTSTANDING, OVERDUE OR AT RISK. Nothing can compute it. There is no receipt record (tenant_orders is unreachable — see that signal), no owner-v…

> METHOD. Every claim below is grounded against live production (Supabase project xygzykjyynhzqytbqnzu) on 2026-09-04, not inferred from migration files. Where I state an absence I name the searches. Where I state a count I ran the query. Per CLAUDE.md 00 I have made no judgement about how any of this should look; the status vocabulary, the freshness rules and the absences are correctness findings, which is my lane.  HOW TO READ status_today. Each signal's status is the answer that row would truthfully carry for a Solo workspace TODAY given measured production, not a rating of the source's quality. Where the answer varies per tenant I give the measured distribution in status_reasoning. The con…


### 8.4 Email, phone, and SMS readiness (Solo / sub-account tier)

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Your emails go out from a Paige-hosted address, not from your own business domain. | `PARTIAL` | RPC public.resolve_tenant_domain_identity(p_tenant_id uuid) -> default_email_sender / default_email_domain / default_email_kind / default_email_status. Defined… | Business owner (must own the DNS for their domain). Provider… | /solo/{account}/settings/connections?segment=communications — the sending-domain panel. Segment is a validated… | Nothing technical. Requires the owner to add a domain and publish DNS records. |
| When someone replies to an email you sent, the reply lands back in this workspace. | `PARTIAL` | Same RPC public.resolve_tenant_domain_identity() -> default_email_status: 'outbound_ready' is emitted only when an ACTIVE email connector exists on the resolved… | PAIGE / platform. The managed connector is provisioned serve… | /solo/{account}/settings/connections?segment=communications. HONEST CAVEAT: there is no owner-operable control… | For a 'reserved' sub-account: no in-app control exists to provision the managed email conn… |
| Your own business domain has not been verified for sending. | `PENDING PROVIDER` | public.tenant_email_domains — columns status ('pending'\|'verifying'\|'verified'\|'failed'), verified_at, dns_records, is_default, resend_domain_id. Created sup… | Business owner (publishes DNS records) then external provide… | /solo/{account}/settings/connections?segment=communications — add / refresh / set-default, all reusing the man… | Owner action (DNS) plus provider verification. Nothing in the platform is blocking. |
| Emails this workspace has actually sent, and when the last one went out. | `PARTIAL` | public.messages WHERE channel_type='email' AND direction='outbound' — status, sent_at, provider_message_id. Table created supabase/migrations/20260726190000_com… | Business owner (nothing to fix — this is activity, not confi… | /solo/{account}/clients/conversations — the inbox that reads these same rows (src/pages/admin/ClientsConversat… | Nothing. |
| We cannot yet confirm whether the emails you sent were delivered, bounced, or opened. | `PROOF_OWED` | The absence is measurable, and the measurement is the source. public.messages.status for email never advances past 'sent': the only writers to messages are supa… | PAIGE / platform engineering — the Resend receipt path exist… | NONE EXISTS for the business owner. There is no in-app control that turns on delivery confirmation. This is a… | Nothing writes a delivery/bounce receipt against messages sent by send-message. Whether th… |
| People who have asked you to stop emailing them, and whether that is being honoured. | `PARTIAL` | public.paige_suppressions WHERE channel='email'. Table created supabase/migrations/20260726210000_comms_c2_twilio_a2p_suppression_foundation.sql:157+. Writer: s… | PAIGE / platform for the bounce-to-suppression gap; nobody f… | NONE EXISTS as a dedicated surface. Suppressions are enforced server-side and have no owner-facing management… | No owner-facing suppression surface, and no bounce/complaint -> suppression writer. |
| Text messaging is not switched on for this business, and here is the one thing standing in the way. | `NOT_CONNECTED` | RPC public.tenant_comms_readiness() -> can_send_sms (boolean) + blocked_reason (one of messaging_account_missing \| messaging_account_inactive \| no_sms_number… | Business owner drives every step; PAIGE cannot. The final ap… | /solo/{account}/settings/connections?segment=registration — the Registration segment owns number acquisition a… | No carrier registration exists for any workspace. Upstream of that, most workspaces have n… |
| Your business does not yet have its own messaging account. | `NOT_CONNECTED` | public.tenant_comms_readiness() -> subaccount ('connected' \| 'inactive' \| 'absent'). Computed at supabase/migrations/20261160000000_comms_readiness_reads_setu… | PAIGE / platform — provisioning runs server-side with the se… | /solo/{account}/settings/connections?segment=registration is where the state is shown (messagingAccountStep, s… | Provisioning is operator-run; no tenant-initiated path exists. |
| The phone number your messages and calls would come from. | `NOT_CONNECTED` | public.tenant_phone_numbers — phone_number, status ('pending'\|'active'\|'released'\|'suspended'), is_primary, capabilities jsonb {sms,mms,voice,fax}, purchased… | Business owner — number search and purchase is a self-servic… | /solo/{account}/settings/connections?segment=registration — PhoneSetupPanel (src/solo/settings.tsx:585-588, 97… | Requires an active messaging account first (comms-purchase-number resolves the tenant's su… |
| Carrier registration for business texting — nothing has been filed for your business. | `NOT_CONNECTED` | Two tenant-safe reads, both SECURITY DEFINER. (a) public.tenant_comms_readiness() -> a2p ('approved'\|'submitted'\|'prepared'\|'absent'), supabase/migrations/20… | Business owner completes the filing; the external carrier/pr… | /solo/{account}/settings/connections?segment=registration — the RegistrationPanel plus the Twilio compliance e… | Requires, in order: a messaging account, an active SMS-capable number with a real PN SID (… |
| The business details carriers require before they will let you text. | `NOT_CONNECTED` | Two sources, and they answer different questions. (a) public.tenant_comms_readiness() -> business {has_name, has_website, has_phone} — PRESENCE booleans only, r… | Business owner — every one of these fields is theirs to supp… | /solo/{account}/settings/setup/business-profile (route builder src/solo/setup-subtab-route.ts:28-30; tab keys… | Nothing technical — owner data entry. |
| Who has agreed to receive texts from you, and who has told you to stop. | `NOT_CONNECTED` | public.tenant_comms_readiness() -> consent {granted_count, suppressed_count, state}. granted_count is computed as the LATEST event per recipient, not a raw coun… | Recipients — consent is only ever created by an inbound repl… | NONE EXISTS as a management surface, and none should be invented. Consent becomes reachable only after texting… | Nothing can be recorded until a number can receive inbound messages, which requires the wh… |
| Whether the texts you have sent actually arrived. | `NOT_CONNECTED` | public.tenant_comms_readiness() -> delivery {state ('no_activity'\|'awaiting_receipts'\|'delivering'\|'mixed'\|'failing'), sent_30d, delivered_30d, failed_30d},… | Business owner (nothing to fix); external provider once mess… | /solo/{account}/settings/connections?segment=health once texting is live. Today the meaningful action is the o… | Nothing has ever been sent, because texting is not switched on for any workspace. |
| A phone number on this business that can take and make calls. | `NOT_CONNECTED` | public.tenant_phone_numbers WHERE status='active' AND capabilities->>'voice' = 'true'. Same table as the SMS number signal (supabase/migrations/20260726210000_c… | Business owner (self-service purchase). | /solo/{account}/settings/connections?segment=registration — the same PhoneSetupPanel that buys the number (src… | Requires an active messaging account, as with SMS numbers. |
| Calls made or received from this business, and whether we recorded how each one ended. | `NEEDS_ATTENTION` | public.messages WHERE channel_type='voice' — status, direction, call_duration_seconds, sent_at, meta.dlr. The call row is written by supabase/functions/voice-tw… | PAIGE / platform engineering — a missing status callback is… | NONE EXISTS for the owner. Calls are visible in the conversation history (src/pages/admin/ClientsConversations… | No reconciliation job re-polls the provider for calls whose status callback never landed (… |
| When we last ran a full check on your email, phone and texting setup. | `LIVE` | RPC public.systems_check_snapshot(p_scope text) -> {run, findings, tenant_created_at}, read by src/hooks/useSystemsCheck.ts:96-140. Tables public.paige_systems_… | PAIGE / platform runs the scan; the business owner acts on w… | A re-scan is browser-callable today: supabase.functions.invoke('systems-check-run-change', { body: { changed_s… | Nothing for the timestamp. But the finding itself MUST NOT be used as the texting answer —… |

**No source today (5) —** WHETHER REPLIES TO YOUR TEXTS ARE ARRIVING. The canonical resolver hardcodes delivery.inbound_reporting='unavailable' and explains why in its own body… · WHETHER BROWSER CALLING IS ACTUALLY SWITCHED ON FOR THIS WORKSPACE. The gate is tenant_twilio_subaccounts.twiml_app_sid, minted by ensureTwimlApp (sup… · WHETHER EMAIL SENDING IS WORKING RIGHT NOW, BEFORE YOU SEND ONE. The Resend path depends on the platform secret RESEND_API_KEY (supabase/functions/sen… · WHETHER THE MESSAGING PROVIDER OR CARRIER IS CURRENTLY HEALTHY OR IN AN OUTAGE. Searches run: grepped supabase/migrations/ and supabase/functions/ for… · A SINGLE COMBINED 'COMMUNICATIONS HEALTH' NUMBER. There is deliberately no source for one and one must not be synthesised. Email, voice and SMS fail i…

> VERIFICATION METHOD. Code claims are cited file:line against the working tree at HEAD ed30a653 (branch claude/rail-agent-attribution-uplift). Deployment drift was checked, not assumed: `git log --oneline edge-live..HEAD -- supabase/functions` returns 0 commits and `git diff --name-only db-live..HEAD -- 'supabase/migrations/**'` returns nothing, so every edge function and migration cited here is live. Runtime facts were then measured directly against prod (Supabase ref xygzykjyynhzqytbqnzu) on 2026-09-04 via read-only SQL: pg_proc for RPC existence and prosecdef, information_schema.role_table_grants for table privileges, pg_policies for RLS, cron.job for schedules, and row counts. Every numbe…


### 8.5 Campaigns, social, and advertising — Solo tier (and sub-account, which is Solo with a parent)

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| What you have live right now: published pages, active funnels, and active intake forms, each with the date it was last changed. | `LIVE` | public.growth_pages (status='published', slug, title, updated_at, published_at) · public.growth_funnels (status='active') · public.growth_forms (status='active'… | The business owner — publishing is their act. | Open the Vibe Studio from the in-app Studio action on Campaigns (dispatches the 'paige-studio' window event, s… | Nothing. This is the strongest source in the area. |
| When your last enquiry came in, and how many your forms have captured recently. | `PARTIAL` | public.growth_form_submissions (id, form_id, source, created_at, contact_id, deal_id, processing_state) — read at src/solo/useSoloCampaigns.ts:170 with .order("… | The business owner (their forms, their traffic). | /solo/{account}/growth/catalog lists each active form with its recent submission count (useSoloCampaigns.ts:22… | The undisclosed 200-row cap. Any count shown must either name the window or be replaced by… |
| How many of the enquiries you captured actually became a person in your client list. | `LIVE` | public.growth_form_submissions.contact_id (non-null = the enquiry was resolved or created as a contact). Already selected at src/solo/useSoloCampaigns.ts:170 an… | PAIGE performs the contact creation; the business owner owns… | /solo/{account}/clients/people is where the resulting person appears. The form that captured them is at /solo/… | Nothing for the signal itself. The 200-row cap bounds the ratio. |
| Enquiries that were captured but never finished processing — someone filled in your form and nothing happened. | `NEEDS_ATTENTION` | public.growth_form_submissions.processing_state ('pending'\|'claimed'\|'done'\|'error'), .attempts, .claimed_at, .last_error — added by supabase/migrations/2026… | PAIGE owns the processing; the business owner owns the recov… | NONE EXISTS as a repair control. The failing enquiry is visible only as a state string on /solo/{account}/grow… | No tenant-callable retry seam, and no surface that shows a failed enquiry as a failure. Bo… |
| Outside sources that post enquiries into this workspace — and when each one last delivered. | `NOT_CONNECTED` | public.growth_external_sources (provider, label, active, last_seen_at, target_form_id) — DDL supabase/migrations/20260630004505_2d4c8266-bc55-475f-896a-1701e1e6… | The business owner declares the source; the external provide… | NONE EXISTS at Solo tier. There is no /solo/{account}/... route that creates or manages an external lead sourc… | No Solo-tier create/manage surface and no callable seam. Adding one is the single highest-… |
| Campaign and paid-ad tags arriving with your enquiries — which link or ad the person clicked before they filled in your form. | `PARTIAL` | public.growth_form_submissions.utm_json (DDL 20260630004505_...sql:139) and .referrer (:140). Populated by readUtm() at src/lib/growth.ts:336-346, which capture… | The business owner (they tag their own links); the external… | /solo/{account}/growth/performance is the surface that owns source coverage today (src/solo/growth2.tsx:286).… | Nothing on the read side — this is available and unsurfaced. CAVEAT on the draft seam: con… |
| Marketing copy and images you have saved to your own library, by kind. | `LIVE` | public.marketing_content (kind 'text'\|'image', channel, title, status 'draft'\|'archived', created_at, updated_at) — DDL supabase/migrations/20260711120000_mar… | PAIGE drafts; the business owner keeps or archives. | Open the Vibe Studio from the Campaigns Studio action (src/solo/growth2.tsx:40 → src/solo/SoloApp.tsx:202), wh… | Nothing for the read. It simply is not wired into any Solo surface yet. |
| Whether this business has a web presence Paige can point people to — a page you published here, or a website you told us about. | `PARTIAL` | The persisted systems-check finding for check_id 'social'-adjacent 'website_connected'. Runner: supabase/functions/_shared/systems-check-runners/website_connect… | The business owner. | /solo/{account}/settings/setup to record an existing website (that save triggers the rescan), or the Studio ac… | No rescan is fired on page publish. One call to the already-deployed, already-tenant-safe… |
| Social accounts on file — there is currently no way to record them, so this cannot be reported as a fact about your business. | `UNAVAILABLE` | tenants.features->'social_handles', read by supabase/functions/_shared/systems-check-runners/social_handles_captured.ts:29-46, which emits evidence {social_hand… | Nobody today. It would be the business owner, once a field e… | NONE EXISTS. Searched src/solo/settings-business-context-contract.ts (the Solo Setup field contract — its fiel… | No storage write path and no capture control. Until one exists, this must render as an hon… |
| What is set up to happen automatically after someone fills in one of your forms. | `PROOF_OWED` | public.growth_form_automations (form_id, target_slug, enabled, autonomy_lane, order_index) joined to growth_automation_targets, returned by the SECURITY DEFINER… | PAIGE performs the routing; the business owner decides what… | NONE EXISTS. There is no Solo control that configures what happens after a submission — searched src/ for grow… | A missing write RPC for growth_form_automations, and a Studio save path that writes legacy… |
| Whether the automatic follow-up on a captured enquiry actually ran, or errored. | `PARTIAL` | public.growth_submission_dispatches (status 'done'\|'error'\|'skipped', target_slug, created_at, error) — DDL supabase/migrations/20260714092000_growth_submissi… | PAIGE performs the follow-up; the business owner owns the fa… | /solo/{account}/growth/catalog is where each form's routing state and dispatch counts render today (useSoloCam… | The status-bucket mismatch at src/solo/useSoloCampaigns.ts:230-232 (a one-line correctness… |

**No source today (7) —** ACTIVE CAMPAIGNS / CAMPAIGN RUNS — there is no tenant-authorized campaign record a Solo owner may read. Searched for a campaigns table, tenant_campaig… · AD ACCOUNT CONNECTIONS, AD SPEND, AND AD PERFORMANCE — no tenant-scoped ad connection exists anywhere. Searched meta_ads, google_ads, ad_account, adAc… · SOCIAL PUBLISHING, SCHEDULED POSTS, FOLLOWERS AND ENGAGEMENT — no tenant-safe source, and the one table that exists must never be surfaced. public.pai… · CAMPAIGN-ATTRIBUTED REVENUE — no join runs from a send, to a click, to an order. Independently re-verified here: public.analytics_events has NO tenant… · FUNNEL STEP-THROUGH AND COMPLETION RATE — the table exists, is correctly scoped, and has zero writers. public.growth_funnel_sessions (session_token, c… · HOW MANY PEOPLE SAW YOUR PAGE, AND YOUR CONVERSION RATE — there is no view tracking on the public growth renderers at all. Searched supabase/migration… · A MANUAL 'CHECK MY CAMPAIGNS AGAIN' CONTROL FOR THIS CONSOLE — the Refresh control on the Systems Check surface re-READS persisted findings, it does n…

> EVIDENCE CLASS. Everything above is static source, migration and policy reading in this repo at commit ed30a653. No authenticated runtime drive, no live query against prod, no browser — this session holds no browser tool and no prod credentials, so per §32.c the live confirmation of every reading is OWED to a capable session. Two facts I could verify mechanically: `git diff --name-only edge-live..HEAD -- supabase/functions/**` is EMPTY, so every edge function cited (growth-process-submission, growth-inbound, content-draft, the systems-check runners, tenant-campaigns, meta-schedule-post) is live on prod exactly as written here; `git diff --stat db-live..HEAD -- supabase/migrations/**` returns…


### 8.6 Integrations and automations (Solo / sub-account tier)

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Your n8n workspace is connected to Paige — or it is not, or the sign-in is part-way through. | `PARTIAL` | RPC public.get_n8n_spine_readiness() -> mcp.state / mcp.oauth_readiness / mcp.action_needed. Defined in supabase/migrations/20261201000100_n8n_spine_readiness.s… | Business owner. get_n8n_connection_readiness returns can_man… | /solo/{account_number}/settings/integrations -> the n8n card -> the 'Paige tools (MCP)' tab. The tab strip is… | Nothing blocks the read. For 13 of 14 workspaces the answer is simply 'not connected', whi… |
| Paige has permission to run 0 of your n8n workflows — nothing there can fire until you name which ones she may touch. | `NEEDS_ATTENTION` | RPC public.get_n8n_spine_readiness() -> mcp.approved_workflow_count and mcp.approved_tool_count, computed at supabase/migrations/20261201000000_n8n_oauth_owner_… | Business owner — only the workspace owner can approve (is_te… | /solo/{account_number}/settings/integrations -> n8n card -> 'Paige tools (MCP)' tab -> Discover, then approve… | Nothing technical. The owner has not yet chosen which workflows Paige may read/run. |
| Your n8n API key is saved but has never been checked, so we cannot say your workflow list is real. | `PROOF_OWED` | RPC public.get_tenant_n8n_api_readiness() -> health / failure_code / workflow_count / checked_at / last_success_at, supabase/migrations/20261200000400_n8n_api_c… | Business owner (write requires is_tenant_admin_as; a coach c… | /solo/{account_number}/settings/integrations -> n8n card -> 'API connection' tab (src/solo/settings-integratio… | Nothing — the owner simply has not run the check. Note the check writes api_workflow_count… |
| Zapier is not connected to this workspace — nothing has been saved for it yet. | `NOT_CONNECTED` | RPC public.get_tenant_mcp_connections(_tenant_id uuid DEFAULT NULL), final definition supabase/migrations/20261008000000_mcp_capability_pins.sql:165-203; it ret… | Business owner. Both save paths require admin: _mcp_resolve_… | /solo/{account_number}/settings/integrations -> the Zapier card (catalogue row id 'mcp', src/solo/settings-int… | The owner has not connected Zapier. Per the brief, do NOT build Zapier provider functional… |
| No connected automation has actually been used yet — we have no record of Paige running anything through n8n or Zapier. | `PROOF_OWED` | TWO independent sources, both empty on prod. (a) public.tenant_mcp_call_evidence — one row per governed MCP call, created in supabase/migrations/20261006000000_… | Shared: the business owner owes the approval that would let… | There is no 'run a test' control anywhere in the Solo surfaces — I searched src/solo/ for an n8n execute/test-… | Zero approved n8n workflows, and no Zapier connection at all. Both are owner decisions, no… |
| What has actually happened with your connections lately — each sign-in, each check, each change to what Paige may touch. | `LIVE` | RPC public.get_solo_rail_activity(p_limit integer), redefined in supabase/migrations/20261201000200_n8n_workspace_rail_events.sql (final function in the file).… | Nobody — it is a history, not a task. But a newest event of… | When the newest integration event is a failure outcome ('n8n authorization did not complete' / 'n8n MCP needs… | SCOPE LIMIT, must be stated on the surface: the outcome vocabulary is n8n-shaped ONLY. The… |
| Repeatable jobs you have handed to Paige: none set up yet. | `NOT_CONNECTED` | Tables public.paige_automations and public.paige_automation_acts, supabase/migrations/20261022000000_automations_the_process_record.sql:67-97 and :103-121. Effe… | Business owner (tenant admin) to author; Paige can compose o… | NONE EXISTS as an in-app surface. I verified this: `grep -rn "paige_automations" src/` returns ZERO hits — inc… | No owner-facing surface exists for this record type. That is a build gap, not a data gap. |
| Which kinds of events can actually start a job today: 2 of the 4 we offer. The other 2 cannot fire yet, and each says why. | `PARTIAL` | Table public.paige_automation_triggers, supabase/migrations/20261022000000_automations_the_process_record.sql:41-56. It carries is_live boolean and dark_reason… | Platform (us). A dark trigger is our build work, not the bus… | None for the owner — and the surface should say so rather than inventing one. The dark_reason text is already… | Nothing for the read. The two dark triggers are blocked on platform seams that do not emit… |
| Messages that fire when a deal moves stage: no rules set up, and nothing has ever been sent. | `NOT_CONNECTED` | Tables public.stage_automation_rules and public.stage_automation_events, supabase/migrations/20260701144912_324f9be7-bac9-4eee-b1cb-724cb74d451d.sql:148-155 (ru… | Business owner (tenant admin writes rules). | /solo/{account_number}/settings/integrations/automations — a real, shipped route (redirect from the retired st… | Whether a saved rule could actually reach a client is UNKNOWN to every tenant-facing seam… |
| The list of n8n workflows Paige can see was last refreshed on 11 July — the counts on it are two months old and cannot be trusted as current… | `NEEDS_ATTENTION` | Table public.tenant_workflows, supabase/migrations/20260711173029_tenant_workflows_registry.sql:23-45. Read path RPC public.list_tenant_workflows(_tenant_id uui… | Business owner in principle — but see next_action: they curr… | NONE EXISTS for a Solo owner. I traced every caller of the sync: supabase/functions/paige-n8n/index.ts:186 is… | No Solo-tier refresh control, and no writer for last_run_at. Until a refresh exists, the h… |
| Paige's own setup check on automation: what it concluded about this workspace, and when it last looked. | `LIVE` | RPC public.systems_check_snapshot(p_scope text) (supabase/migrations/20260822000000_systems_check_snapshot_rpc.sql), consumed by src/hooks/useSystemsCheck.ts:88… | Paige produces it; the business owner acts on it. The findin… | When the verdict is fail, the honest exit is /solo/{account_number}/settings/integrations (connect n8n or Zapi… | TWO honest caveats that must travel with this verdict. (1) A 'pass' can be produced entire… |

**No source today (7) —** A verified 'Zapier API connection' as something distinct from the Zapier MCP server. There is no Zapier REST/API integration in this repo. Searched: `… · Per-workflow or per-automation run history, run counts, success rates, or a 'last fired' time — for ANY provider. Searched four ways: (a) `grep -rn "l… · Whether a saved automation can actually deliver a message to a client. src/solo/data/useSoloAutomations.ts:120-131 states the delivery route is resolv… · Any third-party automation the owner runs outside Paige — a Zapier account we do not hold, Make, Retool, a private cron. The runner states this itself… · A tenant-facing count or list of Zapier tools Paige may run. The approval set exists (tenant_mcp_connections.approved_capabilities plus capability_pin… · An honest 'your connection expires soon' warning for n8n. The data exists — tenant_mcp_connections.access_token_expires_at is returned as expires_at b… · A2P messaging registration as an integration signal. Out of scope by instruction, and it is a comms-area source in any case (supabase/functions/comms-…

> EVIDENCE BASIS. Static reads of the repo at HEAD (commit 62b95486), plus live read-only aggregate queries against prod (Supabase project xygzykjyynhzqytbqnzu) via the Supabase MCP. Every prod query was an AGGREGATE or a platform-catalogue read — no workspace was named, and no owner-operated business account was used as an example (CLAUDE.md 63). Drift check: `git diff --name-only db-live..HEAD -- 'supabase/migrations/**'` returns exactly one unapplied file (20261201000700_the_rail_says_which_agent_acted.sql); `git diff --name-only edge-live..HEAD -- 'supabase/functions/**'` is empty. I additionally confirmed on prod via pg_proc that all ten functions cited above actually exist, rather than t…


### 8.7 PAIGE agent team and delegated work (Solo tier)

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Work Paige has handed to a desk that is still open, and which desk it went to. | `LIVE` | public.paige_actions, read directly (no RPC) at src/hooks/usePaigeDeptStatus.ts:172-178 — select to_department,status,filed_at filtered to the 8 non-terminal st… | Business owner (the Solo owner/admin/coach reading the surfa… | /solo/{account}/compass — the Trust Compass screen, route key 'compass' in the Solo nav at src/solo/SoloApp.ts… | Nothing for the count itself. Note the honest limit: 'open at this desk' is not 'in progre… |
| Every open item Paige is holding in this workspace is a setup fix from the daily check — and most of them can no longer be accepted. | `NEEDS_ATTENTION` | public.paige_actions where action_kind='systems.remediate' and status='filed', joined to the newest public.paige_systems_check_run per tenant. The acceptance ga… | Business owner accepts; the fix belongs to whichever desk th… | The 'Approve fix' control on the Systems Check surface at /solo/{account}/command-center/systems-check (route… | The acceptance gate binds to the LATEST run. Every daily run (cron job 'systems-check-sche… |
| Paige's background drafting runs every two minutes and has never produced a draft in this workspace. | `PARTIAL` | cron job 'paige-action-worker', schedule '*/2 * * * *', active=true (verified live in cron.job; scheduled by supabase/migrations/20260720212838_paige_action_wor… | PAIGE (the drainer is hers). The gap — that no draftable wor… | NONE EXISTS for a Solo owner. There is no in-app control that assigns a drafting specialist to an action kind:… | A single point of concentration: one specialist ('email-composer') backs all 7 draftable k… |
| The specialists this workspace has, and which of them it authored itself. | `PARTIAL` | public.paige_subagents. The registry read the tenant surface actually uses is useTenantSpecialists at src/hooks/usePaigeOrchestrator.ts:104-110, which filters .… | PAIGE / the platform (the registry is platform-authored). Th… | /solo/{account}/paige/helpers — the 'Helpers' tab of the Solo Paige workspace (tab list at src/solo/SoloPaigeW… | Nothing marks a registry row tenant-safe to display on prod, so a roster rendered from the… |
| How much each desk is allowed to do on its own — draft and ask, act and log, or never act. | `PARTIAL` | public.paige_action_kinds.default_autonomy_lane, grouped by default_to_department. Read by src/solo/data/useSoloTrust.ts (which filters to tenant_id IS NULL del… | The platform sets it. The business owner cannot change it —… | /solo/{account}/compass — Trust Compass, read-only. It shows the real kinds and lanes per desk; there is no co… | No per-workspace authoring path for action kinds exists. The catalogue is seeded by migrat… |
| Whether this workspace can set how much Paige does on her own. | `NOT_CONNECTED` | public.paige_resolve_autonomy(p_tenant uuid, p_kind text, p_default text) — the resolver every filing and advancing path calls. Defined at supabase/migrations/2… | Platform operator only. set_platform_trust_compass(...) is t… | NONE EXISTS. There is no in-app route or control on any Solo surface that sets an autonomy level. src/solo/dat… | The per-tenant policy store paige_resolve_autonomy was written to consult was never built.… |
| How often Paige's own work has failed in this workspace. | `PARTIAL` | public.paige_llm_trace — one row per model call, carrying tenant_id, agent_id, status, error_class, created_at, cost_estimate_usd. The existing tenant-scoped re… | PAIGE. A high failure rate here is a platform fault, not a b… | NONE EXISTS in the Solo shell today. The read is available and the seam (usePaigeContribution) already exists;… | No specialist attribution (agent_id is a service name), no tenant-safe display vocabulary… |
| Which specialist did a specific piece of work, shown on the workspace activity feed. | `PROOF_OWED` | supabase/migrations/20261201000700_the_rail_says_which_agent_acted.sql — adds paige_subagents.rail_display_name (lines 67-84), paige_workspace_events.actor_agen… | Platform engineering. Nothing here is a business-owner task. | NONE EXISTS as a user action. The recovery is a re-versioned migration (the current version number can never a… | A migration version-number collision: prod already records 20261201000700 for an unrelated… |
| The per-run record of a specific job Paige handed to a specialist — what went in, what came back, how long it took, and whether it failed. | `UNAVAILABLE` | public.paige_subagent_invocations, created at supabase/migrations/20260629235541_ab204cfa-bf8c-427f-b801-ac4aefd2020b.sql:34-66. Written by supabase/functions/p… | Platform engineering. The absent tenant_id is a schema fact,… | NONE EXISTS. No route, control or RPC lets a Solo owner read a run record for work Paige's team performed auto… | No tenant_id column on paige_subagent_invocations, plus a writer that leaves invoked_by an… |

**No source today (7) —** "Delegated work finished / did not finish / is waiting on you" entries in the activity feed. The copy is written (supabase/migrations/20261201000700_.… · A per-specialist success rate or run count for this workspace ("Follow-Up Drafter: 12 runs, 92% clean"). No column, table or RPC supplies it at tenant… · When a given specialist last did anything for this workspace. The only timestamp on the registry is paige_subagents.updated_at, which records a regist… · A control that switches a specialist on or off for this workspace. RLS would permit it for a workspace's OWN forged agents (policy 'Admins manage suba… · The cost or spend of work Paige delegated, attributed to a specialist. paige_llm_trace.cost_estimate_usd exists and is tenant-scoped, but verified liv… · An expected completion time for work currently in flight. Searched src/solo/ and supabase/functions/paige-action-worker/ for eta, estimated_completion… · A per-workspace autonomy setting the owner chose. Distinct from the NOT_CONNECTED signal above, which reports that the resolver is a stub: this is the…

> METHOD. Every claim below was checked twice — once against the migration/source in the repo, once against live prod (project xygzykjyynhzqytbqnzu) via SQL. Where the two disagreed I report the schema, because the schema is what runs. All tenant figures are aggregated by tenants.account_type; no real workspace is named.  THE TWO DEFECTS I WAS ASKED TO PROVE OR REFUTE — BOTH CONFIRMED. (a) paige_subagent_invocations has NO tenant_id column. Repo: supabase/migrations/20260629235541_...sql:34-47 creates it without one, and grep across all of supabase/migrations/*.sql finds no later ADD COLUMN. Live: information_schema returns 0 columns named tenant_id; the complete live column list is id, subage…


### 8.8 Business knowledge and data readiness (the Mind layer) — Solo tier

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| The business facts Paige is allowed to state as true — your website, business phone, industry, and business email — each one either confirme… | `LIVE` | public.get_business_context_readiness(uuid) — supabase/migrations/20261112000000_business_context_readiness.sql. Underlying facts: public.tenant_legal_profile.w… | The business owner (Setup is the sole writer of these facts)… | /solo/{account}/settings/setup -> 'Business profile' tab. Tabs: src/solo/settings-business-context-contract.ts… | Nothing. This is the strongest live source in this area. |
| What Paige knows about what you sell, who you serve, where you are going, and how you sound — the thirteen questions Setup asks beyond the b… | `PARTIAL` | public.tenants.brand -> 'business_brief', read by public.get_solo_business_brief() (verified live). The thirteen keys are defined at src/solo/settings-setup-con… | The business owner (owner_full or admin_operational may edit… | /solo/{account}/settings/setup -> 'Direction' and 'Paige brief' tabs. | Nothing structural. The answers simply have not been written by anyone yet. |
| A suggestion Paige has staged about your business facts, waiting for you to accept or dismiss. | `LIVE` | public.tenants.brand -> 'business_brief_proposal', written by public.stage_solo_business_brief_proposal(uuid,uuid,jsonb,text) (verified live on prod, migration… | The business owner accepts or dismisses; Paige proposes. | /solo/{account}/settings/setup (the proposal surfaces in the Setup context and is accepted on save via the _pr… | Nothing. |
| Documents Paige can actually search when she answers you. | `LIVE` | public.tenant_knowledge_docs (supabase/migrations/20260630181352_78c97192-a83f-49ae-9a76-e95cc410c066.sql:4). Frontend read already shipped: src/solo/data/useSo… | The business owner supplies them; Paige retrieves them. | Read: /solo/{account}/paige/knowledge (src/lib/routing/tierBranches.ts:127-135). Adding one has no control the… | Nothing for reading. |
| Where each of your documents came from — something you pasted, a link you gave her, or something an installed pack brought with it. | `LIVE` | public.tenant_knowledge_docs.source (enum: upload\|url\|paste\|sync\|scan) and .tags. Writers: supabase/functions/kb-ingest-doc/index.ts (paste), kb-ingest-url,… | The business owner (for their own additions); the Marketplac… | /solo/{account}/paige/knowledge lists the documents; to remove an installed pack's knowledge the route is /sol… | No delete/edit seam reachable from the Solo tier. |
| Whether every document you gave her is fully searchable, or only partly indexed. | `LIVE` | Compare public.tenant_knowledge_docs.chunk_count — written at insert time as the number of sections the chunker produced, BEFORE any embedding (supabase/functio… | PAIGE / the ingest pipeline owns indexing; the business owne… | Re-add the document by asking Paige at /solo/{account}/paige/chat. There is NO in-app re-index control on any… | No re-index seam for an existing document. |
| Adding, replacing, or removing a document from this workspace. | `NOT_CONNECTED` | The Solo knowledge surface is read-only by construction: src/solo/SoloPaigeWorkspace.tsx:75 renders 'Add, connect, install, and removal flows are not activated… | The business owner is blocked; the missing control is ours t… | NONE EXISTS as a Solo UI control. The only reachable path today is /solo/{account}/paige/chat — ask Paige to s… | No Solo-tier ingest control on src/solo/SoloPaigeWorkspace.tsx. |
| How often Paige has actually leaned on your documents to answer you. | `PARTIAL` | public.kb_query_telemetry (supabase/migrations/20260630181352_78c97192-a83f-49ae-9a76-e95cc410c066.sql:99). The row is built at supabase/functions/paige-ai-chat… | Nobody — this is a report, not a task. | No action item. If the count is zero and documents exist, the honest next step is to add more coverage: /solo/… | There is no record of a search that returned no match, so 'she looked and found nothing' c… |
| Whether any of your knowledge has been shared beyond this workspace. | `LIVE` | public.tenant_knowledge_docs.share_to_network and .network_review_status (+ network_reviewed_at), migration 20260630181352 lines 14-20. Every automatic writer p… | The business owner decides; the platform operator reviews an… | NONE EXISTS on the Solo tier. The sharing toggle lives only in src/components/paige/KnowledgePanel.tsx:83, whi… | No Solo-tier sharing control. This is safe as a read-only reassurance today. |
| The links, documents, references, and notes you registered in Setup as sources for your business — and the fact that Paige does not read the… | `NOT_CONNECTED` | public.tenant_setup_knowledge_sources (supabase/migrations/20261103000000_solo_setup_business_context.sql), surfaced as the knowledgeSources array of public.get… | The business owner. Writing knowledge sources requires solo_… | /solo/{account}/settings/setup -> 'Knowledge bucket' tab (src/solo/settings-business-context-contract.ts:9). | No adapter from Setup-registered sources into anything Paige reads, and the contract refus… |
| The voice examples and the way-you-work profile you wrote in Setup — and the fact that they do not yet reach Paige. | `NOT_CONNECTED` | public.tenant_setup_paige_profiles (a profile object with exactly seven allowed keys: voiceCharacter, audienceRelationship, messageStructure, useMoreOften, avoi… | The business owner (owner_full only). | /solo/{account}/settings/setup -> 'Paige brief' tab (src/solo/settings-business-context-contract.ts:11). | The 'separately governed adapter' named in the table comment does not exist. Until it does… |
| The brand details Paige writes with when she builds something for you — and the ones she does not have. | `PARTIAL` | public.tenants.brand (product_name, primary_color, accent_color, font, logo_url, logo_dark_url, tagline, website, address, phone, legal_entity_name, from_name,… | The business owner (Brand Kit). | /solo/{account}/growth/catalog — the Campaigns 'Catalog' subtab absorbs the brand-kit alias (src/lib/routing/t… | No per-field date, so 'last verified' for a single brand asset cannot be shown truthfully. |
| Examples of finished work Paige has kept so she can match your style next time. | `PARTIAL` | public.paige_prompt_memory (supabase/migrations/20260718205814_paige_prompt_memory.sql). Written by rememberArtifact -> captureToMemory (supabase/functions/_sha… | PAIGE (capture and recall are both automatic). | NONE EXISTS — no surface lists, rates, or manages these. The rating column (tenant_rating, 1-5) is grant-writa… | No capture path for non-image artifacts, and no surface for the owner to see or correct wh… |
| Whether Paige remembers, between conversations, what you have told her about how you work. | `NOT_CONNECTED` | public.paige_owner_memory and public.match_paige_owner_memory (supabase/migrations/20260810120000_paige_owner_memory_l8_fabric.sql), relaxed for the tenant-less… | Ours to build. Nothing the business owner can do makes this… | NONE EXISTS. | No tenant write path (deferred), and no embedding on the rows that do exist — so even if r… |

**No source today (7) —** Whether Paige's answers from your knowledge were actually useful / any accuracy figure. The column exists and is never written: public.kb_query_teleme… · Knowledge gaps Paige has flagged — topics she keeps being asked about and cannot answer. The table exists: public.kb_coverage_signal (topic_cluster, d… · Answers grounded in a shared or industry knowledge library rather than your own documents. public.knowledge_base has 0 rows on prod, and the live body… · What Paige has learned about each individual client. public.client_memory has 0 rows on prod and carries NO tenant_id column at all (confirmed via pg_… · When Paige last searched your knowledge and found nothing. The telemetry row is prepared only inside the 'if (kept.length > 0)' branch at supabase/fun… · Whether the links you registered in Setup still resolve or are current. public.tenant_setup_knowledge_sources stores source_url with an https-shape CH… · A per-asset 'last changed' date for brand values. public.tenants has a single row-level updated_at (confirmed in information_schema.columns) and tenan…

> EVIDENCE BASIS. Repo at HEAD 62b95486, read 2026-09-04. Every count and every function definition below was measured on prod (project ref xygzykjyynhzqytbqnzu) via SQL, not inferred from migrations — several live objects differ from what the repo migrations declare, which is exactly why. Nothing here was driven in a browser: no live-drive of an authenticated Solo session was performed, so every statement about what a Solo owner SEES is a source-and-schema reading, and the CLAUDE.md 32.c authenticated live check remains OWED to a browser-capable session.  TIER SCOPE — THIS IS A SOLO-ONLY SURFACE, AND THAT NEEDS AN EXPLICIT DECISION (CLAUDE.md 56). The sub-account tier does NOT share this Syst…


### 8.9 Security, permissions, and governance

| Signal | Status | Source | Owner | Next action | Blocked by |
|---|---|---|---|---|---|
| Who can get into this workspace, at what access level, and who is the owner. | `LIVE` | RPC public.get_solo_team_workspace(_search,_permission,_limit,_offset) — supabase/migrations/20260901001520_solo_team_workspace.sql:1-195 (re-declared 202611050… | Business owner (or a workspace admin). | /solo/{account}/settings/team — the Team sub-tab, confirmed in src/solo/settings.tsx:1436 (tabs list) and :156… | Nothing. |
| Invitations that are still open — who was invited, at what access level, when it expires, and whether the email actually reached anyone. | `PARTIAL` | Same RPC get_solo_team_workspace, invites branch, reading public.tenant_invite_tokens (live columns 2026-09-04: email, default_role, kind, created_at, expires_a… | Business owner or workspace admin. | /solo/{account}/settings/team (src/solo/settings.tsx:1436, :1566) — the same surface that lists, resends and r… | Delivery visibility only, and only for invitations older than the send log. Not a blocker… |
| Seats that have never signed in, or have not signed in for a long time. | `LIVE` | public.get_solo_team_workspace — the roster selects au.last_sign_in_at from auth.users (supabase/migrations/20260901001520_solo_team_workspace.sql:84; carried i… | Business owner or workspace admin. | /solo/{account}/settings/team (src/solo/settings.tsx:1566) — the roster is where a seat is removed or downgrad… | Nothing for the read. |
| What Paige is allowed to do on her own here, capability by capability, and which of those you actually chose versus inherited. | `PARTIAL` | RPC public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL) → (tool_key, label, category, mode, is_default, updated_at). Current declaration: supabase/migration… | Business owner (the grant is theirs); the ceiling half is th… | NONE EXISTS IN THE SOLO SHELL. Searched src/ for every caller of list_tool_autonomy / set_tool_autonomy: src/c… | The displayed mode is not the effective mode. Closing it needs the read to publish the eff… |
| Repeatable processes you have let Paige run on her own, and how much of each she handles alone. | `NOT_CONNECTED` | public.paige_automations (process: name, trigger_key, trigger_config, conditions, granted_lane 'auto\|confirm\|off', state) + public.paige_automation_acts (the… | Business owner (only a tenant admin may author or change a p… | UNVERIFIED — I did not confirm a shipped Solo route that lists or authors these. The adjacent shipped Solo sur… | Nothing in the backend. Zero rows exist because nothing has authored one; two of four trig… |
| When platform support last entered this workspace, and when they left. | `LIVE` | public.paige_audit_log rows with action 'operator.tenant.enter' / 'operator.tenant.exit', written with tenant_id set to the entered tenant by public.operator_en… | Platform operator performs the act; the business owner is th… | NONE EXISTS. Searched src/ for a tenant-side reader of these rows: the only paige_audit_log readers found are… | No tenant-facing read seam and no Solo surface. The RLS already permits it for an admin; n… |
| Changes to who can do what here — invitations sent, withdrawn and accepted, seats removed, roles granted. | `PARTIAL` | TWO different tables, and that split is the finding. (1) Platform-role grants go to public.paige_audit_log as action 'role:grant' via grant_tenant_member_role —… | Business owner or workspace admin. | NONE EXISTS. No Solo surface reads either table; searched src/ and found audit_logs consumed only by src/compo… | The Solo Team governance trail is written to a table with no tenant_id whose only tenant-s… |
| Two-step sign-in on your own account. | `NEEDS_ATTENTION` | supabase.auth.mfa.listFactors() / enroll() / challengeAndVerify() / unenroll() in src/components/settings/AccountSecurityPanel.tsx:205-290 — a real, shipped TOT… | Each person, for their own account. Nobody can enrol on some… | NO ROUTE INSIDE THE SOLO SHELL. Searched src/ for every mount of AccountSecurityPanel: exactly two — src/compo… | The control exists and is not mounted in the Solo shell; the Solo Security & data tab is p… |
| Part of Paige's limits here are set by the platform, and that part is not published to this workspace. | `PROOF_OWED` | The clamp is real and binds: public.resolve_tool_autonomy consults public.trust_effective_rung() before returning a mode — supabase/migrations/20261039000000_au… | Platform operator. Raising or re-attesting is super_admin on… | NONE EXISTS for a Solo owner, and none should be invented — this is not the owner's control to operate. The on… | No tenant-safe projection of the effective rung exists. Closing it means publishing a narr… |
| Client-portal access you have granted — who you have given portal access to, and whether that invitation is still open. | `PARTIAL` | public.tenant_invite_tokens rows with kind='consumer' (live column and value read 2026-09-04). Minted through the create_tenant_invite_token RPC; the tier rule… | Business owner or workspace admin. | NO SOLO ROUTE FOUND. The owning surface by subject matter is Clients; the four shipped minters are all /admin… | No Solo surface reads or mints these, and the grant itself leaves no audit row. |

**No source today (6) —** Whether the platform's cross-tenant isolation checks are passing — NOT readable by any Solo tier, though I verified the underlying loop and it is now… · Two-step sign-in status for anyone other than the person looking — no source exists. Searched supabase/migrations, supabase/functions and src for mfa_… · Who viewed sensitive client information in this workspace — no tenant-readable source. public.pii_access_log exists and is written (measured 2026-09-0… · Active sessions and devices signed in to this workspace — no source. Searched supabase/migrations for last_sign_in\|sign_in_history\|active_sessions\|… · Data export and deletion rights for this workspace — nothing a Solo owner can drive. Searched supabase/migrations and supabase/functions for data_expo… · A per-workspace security or governance CHECK inside the Systems Check itself — none exists, which is the structural finding for this whole area. Measu…

> SCOPE AND METHOD. Every claim below is either a file:line / migration citation or a read-only query executed against the production project xygzykjyynhzqytbqnzu on 2026-09-04. Where I inferred rather than measured, I wrote UNVERIFIED. I proposed no visual treatment and expressed no view on how anything should look (CLAUDE.md §00).  THE HEADLINE FOR THIS AREA. The Systems Check pipeline itself carries ZERO security, permissions or governance checks at the tenant tier — 10 tenant checks, 4 domains, none of them this subject (measured; enumerated in genuinely_unavailable). Every truthful signal I found in this area therefore comes from a DIFFERENT source than the one the current tile reads (use…

## 9. Cross-references

§00 jurisdiction · §9 platform/tenant seam · §11 no internal jargon in visible copy · §13 honest
reporting · §18 one home · §32 a green build is not a working surface · §36 intuitiveness · §37
producer/consumer inventory · §51/§56 tier matrix · §58 anti-regression · §66 same-commit matrix
update · §69 flow-by-flow · §70 the owner must be able to USE it.

Related: `docs/doctrine/tier-matrix.md` · `docs/doctrine/paige-agent-registry.md` ·
`docs/doctrine/solo-agent-placement-map.md` · `docs/doctrine/connections-rail-contract.md` ·
`docs/doctrine/autonomy-architecture.md`.

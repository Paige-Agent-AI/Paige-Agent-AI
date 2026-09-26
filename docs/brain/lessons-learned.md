# Lessons Learned — recurring traps

The failures that have actually cost time/money, written as **symptom → root cause → rule** so the
next session recognizes the trap before repeating it. These are the concrete instances behind the
RED-LINE index and the §-doctrine; this file is the fast-lookup version.

---

### "Handled by another path" is a claim — name the path, or the case is open (2026-09-26)

**Symptom.** #1458's first head refused a shortened id before it could become an approval card, and
said a MISSING id was "the required-field path's to report." Its docstring and a test both said so.
The §39 peer-gate searched for that path and found none: the handler has no required-argument check
and tool calling is not strict. A missing, a blank and a numeric id each became a card, spent the
approval, and failed at the executor, which is the incident's shape.

**Rule.** A comment, docstring or test that hands a case to another path must name that path (file
and function). If you cannot find it, the case is yours and it is open. The same review found the
same class twice more. The shape table covered the subject but not the second `uuid` the executor
casts. A copy guard matched two bad phrasings and missed a third ("they can approve it again").
**Guard the class, not the instance you happened to see:** every id the executor casts, and every
operator-facing terminal note read whole.

### Consumed is not executed — and a recovery must name a control that exists in that state (2026-09-26)

**Symptom.** `action_advance` showed 13 proposals and 1 consumed, which read as "mostly broken, once
worked." It had never worked: the consumed approval was claimed and the action it approved failed on
a shortened id. Separately, a refusal told the operator to "press Not now to clear them" — a fix for
an earlier impossible instruction — while no card, and so no Not now, was on screen.

**Root cause.** An approval being *claimed* was read as the action *running*. And a recovery was
checked against the component that offers it (the card has a Not now button) instead of against the
screen in the state where the instruction is spoken (after Approve, the card is gone).

**Rule.** Confirm an approved action by reading the record it was meant to change — the action's
status, the contact's row — never by the approval row alone. And prove a recovery instruction by
rendering the real surface in the state it is given in, pressing what the person pressed, and
asserting the named control is there. A recovery that is true only in some states is a trap.

---

### A red job is read STEP by step — and a step behind an aborting step never ran (2026-09-26)

**Symptom.** PR #1454's `verify` job was red. The failing `Test` step was measured against an
`origin/main` worktree — 20 failures, same five files on both sides — and the job was reported as
pre-existing. A second failing step beside it, `ESLint (changed src)`, went unread; it was failing on
a file the PR itself wrote, and merged red. In the same PR, a new pgTAP proof was reported as the
evidence for the fix while it had never once executed: `database-contract` had been aborting at its
first step for two days, and every step after it was skipped.

**Root cause.** "Pre-existing" was established for the JOB instead of for each failing STEP, and
"the proof exists" was allowed to stand in for "the proof ran". A lint scoped to changed files is by
construction about the change, so it cannot be pre-existing — and under `bash -e` with no step
conditions, one early failure silently darkens everything after it, including proofs owned by lanes
that do not know.

**Rule.** List the job's steps (`list_workflow_jobs` returns each step's conclusion) and account for
EVERY failed and every skipped step by name before calling a red job someone else's. Cite a proof by
run, job, step and result (master doc §0 *Executed proof*); a skipped proof step is absent, not green.

---

### Provider identity must never come from a field the tenant can edit (2026-09-24)

**Symptom.** A de-duplication matcher, with 147 green tests and a real-Chromium render drive behind
it, would let a generic MCP server a tenant named after a vendor claim that vendor's catalogue tile —
opening an unrelated connection's drawer AND, because the parent suppresses a tile it believes is
held, **removing the real vendor's setup path from the surface entirely**. Found by an external
adversarial review at the merge gate, not by any of my own proof.

**Root cause.** The matcher's last arm compared the connection's `label` — free text the tenant types
— against the catalogue vendor's name, treating a display field as provenance. It was added as a
"falls through to its name" convenience for catalogue entries carrying neither a provider key nor a
URL, and the convenience was never weighed against what a hostile or merely careless label does.
Worse, it never served the case that motivated it: the labels it was meant to match tokenized to
values that never equalled the vendor keys, so the arm was load-bearing for nothing.

**Rule.** Identity comes from a **stable** attribute — a provider key, a host, an id — never from a
name, label, title, or any field a user can rename. When a heuristic can be wrong, decide which
direction it fails in *before* writing it: here a missed de-duplication shows one extra tile
(cosmetic) while a wrong match removes a capability (functional). Fail toward the cosmetic one. And
when an arm is removed, check what actually depended on it — every existing test here matched
through `provider_key` or `server_url_host`, which is how a supposedly load-bearing branch was
proven to carry nothing.

---

### One flag answering two questions is a race (2026-09-24)

**Symptom.** A drawer could render "Checked just now" directly above the action list it had read
*before* the check — an older in-flight request overwriting a newer response.

**Root cause.** A single `alive` boolean was asked both *"may I still call setState"* (an unmount
question) and *"is this the latest read"* (a generation question). A reload tears the effect down and
re-runs it immediately, so the boolean is false for an instant and **true again before the older
request resolves** — the stale answer passes the guard. The tenant-scope check sitting beside it
looked like protection but only catches a workspace switch, never a same-tenant reload.

**Rule.** Unmount-safety and staleness are different questions; give them different variables. A
monotonic generation claimed at call time and compared on resolve is the correct shape, and the
effect's teardown must **increment** it so in-flight work is retired rather than left current. When
testing it, hold every request and settle them by hand newest-first — real timing only sometimes
produces the losing interleaving, so a test that relies on it passes over the bug.

---

### A stale local git tag will misreport deploy drift (2026-09-24)

**Symptom.** Immediately after a successful `deploy-migrations` and `deploy-edge-functions`,
`git diff edge-live..HEAD` listed six changed edge functions — reading as real drift on a deploy that
had just succeeded.

**Root cause.** `git fetch origin --tags` does **not** move a tag that already exists locally. Both
`db-live` and `edge-live` were pinned to a commit from days earlier, so the diff was against ancient
history rather than the deploy the pipeline had just recorded. `--tags --force` showed both tags at
the new merge commit with zero drift.

**Rule.** Force-refresh (`git fetch origin --tags --force`) before reading ANY deploy tag, and never
report drift from a tag you have not just re-fetched. This is the same class as the "re-fetch
origin/main before asserting anything about trunk" rule, and it bites in the more dangerous
direction: it invents a problem on a healthy deploy, and the natural reaction to invented drift is a
redundant redeploy.

---

### A restriction written into the identity model is indistinguishable from a single-user product (2026-09-24)

**Symptom.** Live Conversation shipped as a multi-tenant capability with a 39-assertion suite fully
green, and no Solo account other than the platform operator could use it. Each review looked correct:
the edge callers resolved standing canonically, the tests passed, the privacy posture was honest.
The repair that was drafted next made it worse — it kept the single-account shape and simply let the
operator point it at one *other* membership.

**Root cause.** A temporary rollout restriction was expressed as an **identity predicate**
(`pilot_actor_user_id = _actor_user_id AND pilot_authorized_by = _actor_user_id AND
is_platform_owner(...)` over a singleton row) instead of as **operational configuration**. Once
eligibility is a stored user id, "restricted to one person today" and "built for one person" are the
same code, and nothing downstream can tell them apart. The suite could not see it either: it asserted
the restriction, and never drove a *different* active member of the *same* enabled workspace — so
"only one person can use this" and "the rule works" were one observation, not two.

**Rule.** Build the capability for the whole shell — every account of that type, resolving each
authenticated person's own tenant, role, permissions, thread and memory — and enforce the current
restriction as configuration: a flag, an allowlist, a gate, with each admitted subject carrying its
own acceptance so nobody's consent stands as anybody else's authorization. Prove the refusal rather
than asserting it, and make the negative subject a *legitimate* active member of a *legitimately*
enabled workspace with the positive passing one line above; a negative taken against someone who
lacks standing anyway would pass identically if the gate were never consulted. Both directions of
this error are wrong: building for one account because a restriction exists, and assuming the
restriction lifted because the build is multi-tenant.

---

### A test that has never been RUN is a test that proves nothing, however carefully it was written (2026-09-24)

`supabase/tests/mcp_tool_catalog_tenant_scope.sql` was written with care, reviewed, committed, and
wired into CI. Executed against Postgres for the first time it failed **three times** before it
passed — `tenants.slug` is `NOT NULL`, a `BEFORE INSERT OR UPDATE` trigger refuses an
already-expired approval so that fixture could not be written through the front door at all, and
`_mcp_endpoint_hash` is REVOKEd from `authenticated` so an assertion could not call it after
impersonating a tenant member. None of those are subtle. All three were invisible to reading.

Worse than the three failures was what the passing version would have hidden: its connections
carried no encrypted endpoint, so every assertion in it about a *live* approval was passing over
consent the runtime verifier would have refused — the exact defect the file was written to catch,
sitting inside the file. **Writing an assertion is not running it, and running it is what tells you
which fixtures your production schema will actually accept.** Run the thing before you cite it.

### `approved` is not `authorized`, and a weaker predicate in a READ becomes a lie in a SURFACE (2026-09-24)

The MCP catalogue read returned `approved` from `a.tool_name IS NOT NULL` — an approval ROW exists.
The function that decides whether Paige may actually run something refuses on **seven** conditions.
The read modelled two. Everything downstream inherited the gap: the edge counted blocked rows as
consent, and the drawer rendered *"You approved this"* over an approval bound to an endpoint the
connection no longer used, with no control on that row because nothing looked wrong.

**When a read backs a surface that states an authority fact, enumerate the authority function's
refusal conditions and model every one the read can see — then say plainly which ones it cannot.**
Here two genuinely cannot be known from a list (one compares against the endpoint a runner LOADED
for a specific dispatch, the other against a specific call's arguments), and inventing inputs for
them to "reuse the one function" would have fabricated the very values those guards exist to check.
Naming the boundary is the honest move; silently modelling two of seven is not.

### One catch-all in a test double can make an entire surface's test suite green over a broken render (2026-09-24)

A `world()` helper served ONE resolved value to every edge action. The new `tools` call received a
connection-shaped body, the hook found no array where it expected one, and the drawer rendered its
degraded branch — **in all 52 tests that open a drawer, every one of them passing.** The same
helper's rpc lane answered any unrecognised name with a connection-shaped success, which is exactly
the shape the hook's acknowledgement guard accepts, so a renamed RPC would have been
indistinguishable from the real writer working.

**A test double should dispatch on what was actually asked and fail loudly on anything else.** The
cost of the strict version is naming the three real RPCs and four real actions; the cost of the
catch-all was a suite that could not fail.

### "Backward compatible" is a claim about a REPLACE that `create or replace` may not have performed (2026-09-23)

`create or replace function` cannot replace across a **differing argument list**. Given a new
signature it creates a **SECOND** function and leaves the old one live. A migration that adds
optional trailing parameters and describes itself as *"backward compatible — existing grants and
callers unchanged"* has done the opposite unless it also DROPs what it superseded.

`public.record_capability_run` is the live case: `20270107000000` added four trailing defaults as a
new 10-argument signature next to the existing 6-argument one, with no DROP anywhere. Every
parameter past the fifth defaults on **both**, so a five-argument call satisfies both and Postgres
refuses it — `42725 function is not unique`, measured on production.

**Three things made it invisible for months, and each is the reusable lesson:**

1. **The callers were right to swallow it.** A Rail receipt is best-effort and must never turn a
   completed action into a reported failure, so all three callers `console.error` and continue.
   Correct design; it also means a total filing failure looks exactly like no traffic. When a write
   is deliberately best-effort, something else has to assert it is *possible* — a test, a counter,
   an alert. Otherwise "never fired" and "never worked" are the same observation.
2. **Arity decided who noticed.** The two in-database callers pass ten positional arguments and
   resolve fine, so the Rail had rows and looked healthy. Only the five-named-argument PostgREST
   callers were refused. A partial break reads as a working system.
3. **The check I said was impossible was one tool call away.** The prior entry recorded this as
   *"production SQL is permission-denied to this session, so this is flagged, not measured."* The
   Supabase MCP `execute_sql` tool reaches prod, and `PREPARE` parses and plans **without
   executing**, so the exact failing call can be measured against production while writing nothing.
   **Verify the blocker before recording one** — an unverified claim of inability is the §13
   absence-claim failure wearing a different hat, and it is the reason this sat unmeasured.

**The rule:** a migration that changes a function's signature says which overload it REPLACES and
drops what it supersedes, or explains why two are wanted. Where a function must stay single, count
it in a test — `supabase/tests/record_capability_run_single_overload.sql` does, and PREPAREs the
real call shapes so the assertion is about resolution rather than about existence.
## `git fetch --tags` does NOT move a tag that moved — a drift report built on it is fiction (2026-09-23)

- **Symptom.** The INT-178 lane reported **"13 edge functions undeployed — 4 mine, 9 other lanes'"** and
  concluded the platform had a deploy backlog: work merging green and never reaching production. The
  owner reasonably treated that as a serious finding. **There was no backlog.** Other lanes' work had
  deployed normally and `edge-live` was exactly where it should have been.
- **Root cause.** `edge-live` and `db-live` are *moved*, not created. `git fetch --tags` **silently keeps
  an existing local tag at its old value** — updating a moved tag requires `--force`. Every
  `git fetch origin --tags` that session returned a stale `edge-live` of `186a978f` while the remote was
  at `2a190b71`. Measured:

  ```
  $ git rev-parse --short edge-live            # local, after plain --tags fetch
  186a978fe
  $ git ls-remote --tags origin edge-live      # the truth
  2a190b71a...
  $ git fetch origin --tags --force && git rev-parse --short edge-live
  2a190b71a
  ```

- **Why it is worse than it looks.** Here it failed in the *alarming* direction and invented a backlog,
  which is embarrassing but self-correcting. The same mechanism fails in the *dangerous* direction just
  as easily: a session that force-fetched once and then reads the cached ref later reports drift as
  **ZERO when it is not** — the §32.a false-green this evidence standard exists to prevent, produced by
  the very command that is supposed to establish it.
- **Rule.** **Resolve a deploy tag from the REMOTE, never from a local ref.** Use
  `git ls-remote --tags origin db-live edge-live`, or `git fetch --tags --force` immediately before
  reading. A drift number obtained from a plain `git fetch --tags` is not evidence and must not be
  reported as one. And **distinguish "tag behind" from "work undeployed"** — `db-live` legitimately lags
  `main` whenever no migrations have landed, because the tag only moves when migrations actually run; a
  lagging tag with zero migration drift is healthy, not a backlog.
- **Corollary, same day, same seam.** A merge is not a ship. PR #1388 merged green at `7ebdd9fe` and its
  `deploy-edge-functions` run then FAILED on a GHCR rate limit, so `Record deployed commit` was skipped
  and `edge-live` did not move — merged, closed, **not live**, with nothing on the PR surface saying so.
  Confirm the tag moved before calling anything shipped (#1391, #1393).

---

## Flipping a draft STARTS a review; merging in the same breath KILLS it (2026-09-23)

- **Symptom.** PR #1367 was flipped out of draft and merged ~15 seconds later. The draft flip triggered
  the Codex review, which was still `Running` when the merge closed the PR. It posted **zero reviews and
  zero inline comments**, so the change — which included a §9 tenant-isolation fix *and* a deliberate
  relaxation of two CI guards — landed on `main` carrying **no review pass at all**. The `Running` badge
  sitting on the merged PR reads, at a glance, exactly like a review that found nothing.
- **Root cause.** Two correct instructions composed into a wrong outcome. "Merge on the standard, don't
  wait to be told" is right; "flip the draft to mark it ready" is right; doing both in one breath races
  the reviewer that the flip just summoned. Nobody decided to skip the review — the sequence discarded
  it. This is the **second occurrence in the program**; the first cost a lane six real findings it
  nearly missed.
  **And the rule was already written down.** `AGENTS.md` § *Merge gate* states it outright: marking
  Ready auto-triggers a review on the exact head, you wait for it to complete before merging, and
  *"never merge ahead of either"* the requested or the auto-triggered review — a gate that exists, in
  its own words, *"because a PR marked Ready and merged seconds later has had real defects — including
  a P1 — surfaced by the auto review only after merge."* Both the lane and the coordinator reasoned out
  a standing rule the repo already carried, and the reasoned version came out **weaker** than the
  in-tree one. That is the §BRAIN.2 trap in process clothing: answering *"what is our rule?"* from
  reasoning instead of from the source. The first move on a rule you think you just discovered is to
  grep for it.
  **And then this entry got it wrong twice more, which is the part worth carrying.** Draft one offered
  a post-merge review as an equal path; a review caught it. Draft two removed that but still said
  "wait for the exact-head review" — singular — which lets an agent wait for the auto review and merge
  without the requested one; a second review caught that. Between those two drafts the lane **merged
  PR #1383 on the auto-triggered review alone**, having read the gate an hour earlier and corrected
  someone else's reading of it. So: reading the authority is not the same as applying it, a rule you
  are actively writing down is exactly when you are most confident and least careful, and a gate
  stated as "wait for the review" will be read as one review by whoever is in a hurry — which is
  always. Name both.
- **Rule.** There is one valid sequence, `AGENTS.md` § *Merge gate* is its authority, and it requires
  **TWO reviews, not one**: **flip (which auto-triggers a review on the exact head) → also REQUEST one
  (`@codex review`) → wait for BOTH to complete → disposition every finding → merge.** The gate's own
  words: *"'Exactly one review' means one REQUESTED review plus the auto-triggered exact-head review.
  Never merge ahead of either."* Waiting for the auto review alone and merging is a weaker gate than
  the one written down — and it is the mistake this entry itself made twice before it said so (below).
  A fix pushed for a finding changes the head, so the wait repeats once; a second round means escalate
  rather than merge.
  Requesting `@codex review` after the fact is **forensic recovery from a gate already missed**, never
  a second acceptable path — it does fire on a closed PR (measured: 👀 reaction plus the summary
  flipping to `Manual request`) and it is exactly what you owe once a review has been lost, but it
  cannot un-merge an unreviewed change. Its findings become follow-up PRs off current `main`; merged
  history is never edited. Such a review names the PR **head** commit, not the squash commit — same
  tree, different SHA, worth stating precisely rather than claiming the merge commit was reviewed. And
  never let a `Running` badge stand as approval: say the review is *absent*, not clean.
  **It happened again on 2026-09-26 (PR #1468, docs only), and this is the case against relying on
  prose.** The lane had cited this entry in its own session summary as a rule it knew. It spent its
  care on proving the red `verify` was inherited, then marked the PR Ready and merged two seconds
  later: the review started at 20:45:18Z and the merge landed at 20:45:20Z. The failure was not
  forgetting the rule. The lane attached "wait" to the CI checks it was already looking at, and "the
  reviews" were not on that checklist. Each occurrence has come right after a long evidence-gathering
  step that felt like the last gate. **The durable fix is mechanical, not another paragraph.** A merge
  helper, or a required check, should refuse unless **both** reviews have positively *completed* on the
  exact head: the auto-triggered one and a requested one. A review that is absent, failed or
  cancelled counts as not done, never as clean. Blocking only on a `Running` status would pass all
  three. The Codex summary comment is not the evidence. On #1468 and #1470 it replaced the
  auto-triggered row with the manual request, so the guard has to read the review records themselves. §71's honest note already names this pattern.

## Two pacing rules, from the same lane (2026-09-23)

- **Symptom.** (a) A complete, merge-ready branch sat for seven hours because the assignment never named
  the finish line, so the lane kept watch instead of finishing. (b) Over those hours it fired seven
  hourly check-ins that each reported "nothing changed" — seven wake-ups, zero information.
- **Root cause.** (a) Treating "return to coordinator" as "wait for permission to merge" when the merge
  standard was already met. (b) Confusing *watching* with *polling*: arming a fixed hourly tick for a
  thing that only changes on an event, so the cadence was paid whether or not anything could have moved.
- **Rule.** (a) **A lane that meets the merge standard merges, and reports afterwards.** Coming back
  first is only required for a change made under a coordinator-granted exception, or at one of the
  material boundaries §69 lists. (b) **If you have nothing to report and nothing to do, do not wake up
  to say so.** Wait on the event itself, or arm a single long-interval fallback. A quiet check-in only
  earns its cost when the thing you are waiting for could plausibly have moved — so pace the interval
  off *that*, never off a habit.


## A proof that stands up its own preconditions proves the RULES, never the REACHABILITY (2026-09-22)

- **Symptom.** INT-163's agreements engine shipped with a 19-negative database integrity proof
  asserting the exact SQLSTATE of every refusal, 36 Deno tests, and a green typecheck — all exit 0.
  The independent review of the pushed diff then found that **nothing in the repository ever inserted
  a row into `paige_agreement_signers`**. `save_paige_agreement` created the agreement alone, and the
  send path and the link-minter both refused with *"add a signer"* on every agreement the product
  could produce. Draft → send → sign → seal could not be exercised **once, by anybody**.
- **Root cause.** Every proof inserted its own fixture signers, because a test needs a signer to test
  a signer rule. So the suite exercised the trigger logic perfectly, on rows no production path could
  create. The missing INSERT was invisible from inside the suite by construction: nothing in it ever
  had to ask where a signer comes from. Three sibling defects hid in the same blind spot — sealing
  demanded a stored PDF the approved page's own freeze path never produces, a resend wrote a status
  its own forward-only trigger refuses, and the tenant half of the retained-record obligation had no
  delivery path at all while its email said otherwise.
- **Rule.** Every integrity/proof suite carries at least one control that **drives the product's own
  create path and counts what comes out** — not a fixture, the real writer the UI or the tool calls.
  Name it, assert on it, and make the runner fail loudly when it returns zero. Corollary, and it is
  the §70 test in a different register: *before citing a green suite as evidence, ask what it had to
  set up by hand, because that is exactly the part nobody is testing.* `N1` in
  `scripts/agreements/signer-seam-proof.sql` is the worked example — it calls `save_paige_agreement`,
  counts the signers that exist afterwards, and then issues the link that was previously impossible.

---

## A declared tier flag with zero call sites is not a control, and a ledger that records it as live is lying twice (2026-09-22)

- **Symptom.** `agreement_signing` was declared in `tierFeatures.ts` as a §61 exception locking the
  capability away from a pure Agency, documented as a deliberate exception, and recorded in
  `docs/doctrine/tier-matrix.md` as **LIVE on merge**. A repo-wide grep found the identifier at three
  declaration sites and two doc lines — **zero `hasFeature` call sites, no render gate, no server
  check on most paths.** The same ledger table then showed `✓` for Agency in four tool rows, three
  paragraphs under the row saying Agency was excluded.
- **Root cause.** Declaring a flag feels like enforcing one, and the ledger recorded the declaration
  rather than the behaviour. Nothing mechanical connected the two, so both drifted independently and
  the table ended up giving two different answers to one question.
- **Rule.** A tier decision is enforced where it cannot be bypassed — for anything with a database
  writer, that is the database (a trigger or an in-body gate), because the RPC can always be called
  directly and the service role bypasses RLS entirely. The `tierFeatures.ts` declaration stays as the
  question a surface asks; it is never the answer. And §60's honesty clause is a real obligation:
  **state the enforcement layer in the declaration comment**, so the next reader does not have to
  grep for call sites to discover there are none. When correcting a ledger row, correct every row
  that answers the same question in the same table.

---

## A headless/structural comp must mock the REAL shell chrome, or it renders the component in the wrong responsive mode and misses container-collapse bugs (2026-09-21)

- **Symptom.** On the Mind orb-hero + right-rail layout (#1314), the structural comp harness reported 1366×768 PAIGE-open as a ~956px container → 2-column, and every comp looked clean. Codex's exact-head review then found a **P1**: at 1366×768 PAIGE-open the real container is ~830px → the ≤900 stacked layout fires, and a short-wide `@media` `grid-template-rows` override left the stacked 3-area grid with only 2 row sizes → the rail became an unbounded implicit track that clipped the orb/list. The comp missed it entirely.
- **Root cause.** The harness mocked the PAIGE panel at a flat `410px` and OMITTED the 72px nav rail. The real `TenantCommandCenterShell` gives PAIGE `minmax(440px,34vw)` (=464px at 1366) PLUS a 72px nav rail — so real Mind = 1366−464−72 ≈ 830px, not 1366−410 ≈ 956px. Because the comp put the container in the wrong bucket (2-column vs stacked), it exercised the wrong CSS branch and the container-query/media-query cascade clash never appeared. A container query (`@container`) is only as truthful as the container width you feed it.
- **Rule.** When a comp stands in for a surface governed by container queries, reproduce the REAL ancestor chrome that sets the container's inline-size — every fixed rail/sidebar width AND the responsive formula of every flexible panel (here PAIGE `minmax(440px,34vw)`), plus the exact ancestor attributes/ids that high-specificity selectors key on (`[data-tenant-shell][data-paige="open"] #tenant-shell-main`). Read the shell's actual `grid-template-columns`/panel widths from source; never approximate them with a round number. And treat a green comp at container-query breakpoints as *necessary, not sufficient* — the authenticated live render (or a peer review reading the real geometry) is still owed (§32.c). This is the layout twin of §32 "a green build is not a working render": a green comp on fabricated geometry is not a verified layout.

## A push to an already-Ready bot-authored PR auto-triggers NEITHER Codex re-review NOR the `ci` workflow (2026-09-21)

- **Symptom.** During PR #1303's re-review rounds, pushing a new fix head to the (already Ready, bot-authored) PR produced no Codex review and no `ci/verify` run — the head sat with stale checks and no review, and time was lost waiting for events that never fired.
- **Root cause.** For a bot-authored PR that is already `ready_for_review`, a subsequent `push`/`synchronize` does not re-fire the Codex reviewer (it keys on open/ready/`@codex review`, not every synchronize) and does not auto-run `ci.yml` for the bot actor. The `pull_request`-triggered workflows (`ui-delivery-evidence`, `audit`, `web-fetch-hardening-smoke`) DO auto-run on the synchronize; `ci.yml` and Codex do not.
- **Rule.** After every push to a Ready bot-PR, explicitly (1) post an `@codex review` comment to request the exact-head review, and (2) `workflow_dispatch` `ci.yml` on the branch (`actions_run_trigger` run_workflow). `ci.yml` needs a `workflow_dispatch` trigger for this; a workflow without one (e.g. `ui-delivery-evidence.yml`) can't be dispatched but auto-runs on the PR event anyway — verify via the PR's check-runs rather than assuming. Confirm the reviewed head equals the head you intend to merge before merging.

## Never hand over a FLAT approximation of a real rendering ask — build the proven stack, and the visual DIRECTION is Claude Design's, not CC's (2026-09-20)

- **Symptom.** Asked to recreate the Mind orb, CC first shipped a flat 2D pseudo-3D canvas circle ("a very light circle with a couple of dots in the middle"). The owner rejected it outright — "a thousand times better" — and re-issued the visual direction himself (the owner-approved "Synapse" reference), because the approximation was neither the fidelity asked nor a design CC had any authority to choose.
- **Root cause.** Two compounding misses. (1) §31 engineering shortcut: a flat 2D stand-in was handed over where the ask implied a real GPU particle field on the proven three.js stack — an approximation hoped to pass. (2) §00 jurisdiction: CC treated the orb's look as its own to invent, when the visual direction is Claude Design's; CC's job is to PORT the approved pack faithfully and prove it runs, never to originate or approximate a design.
- **Rule.** For any real rendering ask, build the FULL thing on the proven stack at the fidelity asked (§31) — a flat/2D stand-in for a real particle/3D surface is an automatic reject. The DIRECTION is not CC's to choose (§00): with no approved pack, ask CD; do not fill the gap. When a reference IS given, port it verbatim (shaders, form math, parameters), confirm it RENDERS (not just compiles, §32 — swiftshader under-accumulates additive blending, so a headless still proves structure, never device-brightness parity), and hand the frames over as EVIDENCE, never as a design CC judged or invented.

## A guard that keys on the STORED value of a mutable discriminator has a symmetric launder-IN hole — pin BOTH directions of change to it (2026-09-13)

- **Symptom.** #15's orchestration INSERT guard blocked a JWT caller from creating a `source='paige_orchestration'` row already `approved` and from transitioning one to approved. Codex found a bypass anyway: INSERT an ALLOWED non-orchestration row at `status='approved'` (out of the guard's scope), then UPDATE only `source='paige_orchestration'` — leaving an approved orchestration row `execute-approval` never drove.
- **Root cause.** The approve-gate keys on the STORED `old.source` and early-returns for a non-orchestration `old.source` (correct — to fast-return genuine non-orch rows). The existing pin only blocked laundering a stored-orchestration row OUT to another source. There was no pin blocking a non-orch row from being relabeled INTO orchestration, so the reclassification reached the early-return before any gate, and status never transitioned (it was already approved), so the JWT/ledger checks never fired. A guard that trusts `old.<discriminator>` must defend both edges of that discriminator, not just the one the first threat model imagined.
- **Rule.** When a security guard gates on the STORED value of a MUTABLE classifying column (`source`, `type`, `tenant_id`, a status), pin **both directions**: reject changing the protected value OUT, AND reject changing an unprotected row's value INTO the protected class. The "launder-out" pin and the "launder-in" pin are twins; shipping only one leaves a cross-branch bypass that passes every test written for the other. Prove both with a fixture that relabels an already-`approved` row and asserts refusal, plus a benign same-column no-op that must still pass (the pin must not over-fire).

## Layered review catches different CLASSES — external Codex found the bypass the internal §39/§5 both missed; and a text-lint's limits are an owner-ruled boundary, not an infinite treadmill (2026-09-13)

- **Symptom.** On #15 the internal §39 adversarial peer returned "no confirmed defect" and §5 compliance returned SHIP — yet the EXTERNAL Codex, on the exact same head, found a real P1 (the launder-in bypass above). Separately, Codex then produced round after round of ever-smaller findings on the CI text-lint (escaped keys, escaped table literals, regex-literal lexing) — each a genuine fail-open, none the accidental regression the lint exists to catch.
- **Root cause.** (a) §39 reasoned about the INSERT branch and confirmed the UPDATE branch was preserved, but did not try the CROSS-branch insert-then-relabel sequence; different reviewers instinctively probe different shapes, so a single "SHIP" is never proof of absence. (b) A regex/mini-lexer text lint has unbounded obfuscation bypasses (variable table name, aliased client, escaped literal, split statement); chasing each one grows it toward a partial TypeScript parser with no natural stopping point.
- **Rule.** (a) Treat peer-gate + external review + CI as LAYERED defenses — none alone is sufficient; a green internal review does not waive the external one, and vice versa (§39 doctrine, proven again here). (b) A text-based CI lint is DEFENSE IN DEPTH, not the enforcement boundary; its structural limits (documented in its header) are the accepted line, and the real enforcement belongs at the server/DB layer. The owner's ruling — "the mini-lexer's scope is sufficient; do not grow it into a partial TS parser" — is binding and OVERRIDES the default "fix every bot finding": document the limit, decline the expansion, and move the real fix to the DB slice. A specific owner ruling beats the general drive-to-green default.

## A mint that populates the WRONG field renders "(no summary)" — assert the human-visible field the surface actually reads, and fold the discriminating value INTO it (2026-09-13)

- **Symptom.** C5 slice 2 (#1225) shipped a DB trigger that minted a companion approval row for a held Layer-C act; the migration was green, its pgTAP passed, the inbox rendered — and every held-act approval read **"(no summary)"**. An external Codex review of the merged slice caught it (§70 defect), fixed-forward in #1235.
- **Root cause (two compounding traps).** (1) The mint wrote `draft_content='{}'` with no `summary`, but `ApprovalRow.tsx`/`ApprovalsInbox.tsx` render **only** `summary` (with a "(no summary)" fallback) — they never read `preview`/`body`. Populating fields the surface ignores is invisible work. (2) Even once a description existed, putting the discriminating value (WHICH journey stage) only in `preview`/`body` left every "Advance Journey Stage" approval reading identically — the operator could approve a high-risk mutation without seeing its target. The original slice-1 pgTAP asserted the row EXISTED, not that its rendered field was READABLE, so it passed on an unusable result (the §70 render/usability gap, the twin of §32's compile≠run).
- **Rule.** When a trigger/RPC mints a row that a UI renders, (a) find the EXACT field the surface reads (grep the renderer — here `summary`) and assert THAT field's human-readable content in the test, never just row existence; and (b) fold the value that distinguishes one row from another INTO that rendered field, because the surface may ignore every other column you populate. "The row exists" and "a green migration" are not "a human can read and safely act on it" (§70/§70.1). The fix: a pure content helper humanizes capability + snapshot args + subject into `summary` (args folded in), and section-G/H pgTAP asserts the readable string + idempotent legacy repair.

## A closeout commit's LABELS drift from truth in three predictable ways — the top-line token overstates, the recovery is git-revert, the sibling doc still says "continue" (2026-09-13)

- **Symptom.** After the `match_paige_memory` slice merged (#1233) and its closeout landed (#1236), a post-merge peer review (Codex) raised three P1 accuracy defects that the build's own §32/§39/§5 passes had not caught — because they were about the *records*, not the code.
- **Root cause (three distinct closeout traps).** (1) **Top-line token overstates the body.** The entries' prose honestly said "row-count reconfirm PROOF OWED," but the scannable heading tokens read `✅ RESOLVED/DONE/FIXED`. A reader takes the token, not the paragraph — and per §70 a merged migration + a synthetic boundary test is NOT production proof, so a bare `✅ RESOLVED` on a PROOF-OWED fix is a §13/§70 lie of emphasis. (2) **`git revert` "recovery" for a persisted `CREATE OR REPLACE`.** The documented recovery said revert-the-commit restores the prior function body. It does not: the migration version is already recorded in prod `schema_migrations`, so `supabase db push --include-all` SKIPS it forever — the file leaves the tree, the hardened body stays LIVE. This is the schema twin of "it compiled but didn't run" (§32) and the doctrine already knew it; the closeout just failed to apply it. (3) **A status ruling that didn't sweep its siblings.** "Harness Completion Program COMPLETE / construction STOPS" landed in the decision-log while `harness-completion-map.md` still directed "continue phase by phase" — the same record asserting two states (§BRAIN STEP 4: a change must sweep for what it FALSIFIES).
- **Rule.** (a) A status TOKEN carries the same honesty as the prose: on a PROOF-OWED item, the label itself says `FIX SHIPPED … production runtime UNVERIFIED (PROOF OWED §32.c/§70)`, never a bare `✅ RESOLVED/DONE`. (b) Recovery for any persisted `CREATE OR REPLACE` migration is a NEW higher-version forward migration, never `git revert` (a persisted version is never re-applied by `db push`). **And for a SECURITY fix specifically, the recovery target is fail-closed — never "restore the prior body," because the prior body IS the vulnerability** (a second Codex P1 on #1240 caught exactly this: the first fix corrected the mechanics but still said "CREATE OR REPLACE back to the prior body," which would reopen the forged-ID/global-role IDOR). Roll back a security fix only by forward-fixing while preserving the security property, or by revoking/denying the seam — never by reinstating the pre-fix body. (c) A status-change ruling reconciles EVERY doc it touches in the same commit; if it can't, it is a §13 drift, not a closeout. (d) These are closeout defects, invisible to §32/§39/§5 on the code — the closeout needs its own accuracy pass (the §66/§BRAIN discipline is that pass).

---

## A SECURITY DEFINER READER that self-authorizes on a caller-supplied target id is a cross-tenant read IDOR — and an auth.uid()-only guard silently DIES for its service-role caller (2026-09-13)

- **Symptom.** `match_paige_memory` (SECURITY DEFINER, granted `authenticated`; the CLIENT-memory + chat-embedding semantic recall RPC) let an authenticated caller read ANY user's `client_memory.content` and `chat_message_embeddings.content_excerpt`. Confirmed in the R1 role audit (§4c) and left open as a filed follow-up; the read twin of the `paige-write-back` write IDOR below.
- **Root cause (three distinct traps in one guard).** (1) **Self-reference bypass.** The guard passed when `auth.uid() = _target_client_id` — but `_target_client_id` is a CALLER-SUPPLIED param. Passing `_target_client_id := auth.uid()` (self) with `_target_user_id := victim` made that conjunct FALSE, so the whole `AND` was FALSE and the RAISE never fired, while the DATA predicate still keyed on the attacker's `_target_user_id` → victim's rows. A caller-supplied id used in the AUTHORITY decision is the bypass; it belongs only in the data predicate, and only AFTER a server-derived authorization for that exact id. (2) **Global-role trap** (§53/§59): `has_role('admin')` is tenant-agnostic → any tenant owner reads cross-tenant. (3) **Unbounded search params**: caller-supplied `_match_threshold := -1` turned similarity search into a full dump.
- **The guard was DEAD for its only real caller, and that hid all of it.** The sole runtime producer (`paige-ai-chat`) calls on the SERVICE-ROLE client, where `auth.uid()` is NULL — so the `auth.uid()`-only guard's four `AND` conditions were all true and it always `RAISE`d `Unauthorized`, swallowed by the caller's `.catch(()=>[])`. Semantic memory recall never actually ran in production. A green build (and even a search_path fix in `20261029000000`) proved nothing about behavior (§32); the attack surface was the DIRECT `authenticated` API call, which no producer exercises, so no test noticed.
- **Rule.** A SECURITY DEFINER reader must derive authority from SERVER facts PER TARGET (self = `auth.uid() = _target_user_id`; operator = `is_platform_operator`; cross-contact = the canonical `can_access_contact` for a `clients.id`), and **gate each data-predicate branch on its own per-target flag** so authorization for target A never returns target B through a different branch.
- **The §39-Finding-1 refinement (the reviewers caught what the build missed):** a per-USER staff grant (coach / same-tenant admin, keyed on a user id) is only tenant-safe when EVERY row it returns carries a resolvable tenant to re-check per row. Where the row's tenant is optional (`client_memory.client_id` is nullable) or ABSENT (`chat_message_embeddings` has no tenant column at all), a per-user staff grant cannot be tenant-scoped and silently over-returns a MULTI-TENANT subject's other-tenant rows — the exact cross-tenant read the fix set out to close, narrowed to one co-membership hop. So: limit cross-USER access to self + operator, and route staff access to a specific client through the per-CONTACT helper (`can_access_contact`, which resolves that one contact's tenant). "Mirrors the RLS fence" is not automatic — a fence that scopes per ROW cannot be reproduced by a per-USER boolean. And a boundary proof whose fixtures are all single-tenant cannot see this: include a subject who belongs to two tenants with a cross-tenant row. Bound every caller-supplied search parameter (`threshold`→`[0,1]`, counts→`[0,50]`). And when the sole caller is service-role, decide the service-role posture DELIBERATELY — trust it to pass server-resolved ids (the governed-memory-seam pattern) only where a producer inventory proves the server resolved scope upstream; otherwise it fails closed and the feature is dead, which is a §32 finding in its own right. The class of proof that catches all of this is a **caller inventory against the tenant matrix** (who calls this, as which role, having proven what?) — never a unit suite over the code path a dead function's absent callers never run.

## A refusal that returns HTTP 200 must be propagated to SERVER-to-server callers, not just the frontend — the §37 consumer inventory covers every caller CLASS (2026-09-13)

- **Symptom.** The Funding & Coaching Tools gate (#1222) refuses by returning HTTP **200** with `{ ok:false, available:false, result, reason }` — a shape the two admin frontends (`BusinessCreditAdmin`, `BusinessVerificationCard`) read correctly (`activated===false` / `ok===false` → honest toast). But two SERVER-to-server callers — `skill-runner` (verify_business_sos) and `paige-mcp` (verify_business) — key on the HTTP STATUS, not the body: skill-runner left `runStatus` at its `succeeded` default (inflating `success_count`) and paige-mcp returned `ok(body)` (telling the agent the tool completed). A refused verification was recorded as a success. Codex's 2nd pass caught it; the #1222 §39 peer + §5 compliance both missed it (layered defense — external review is a real layer, never redundant).
- **Root cause.** The #1222 §37 producer/consumer inventory verified the FRONTEND consumers of the refusal shape and stopped there. It never opened the server-to-server consumers, which interpret success differently (HTTP status, not `body.ok`). "The frontend renders it honestly" is not "every consumer records it honestly." A 200-with-`ok:false` is exactly the shape a status-keying caller misreads as success.
- **Rule.** When a function signals a handled non-success as HTTP 200 + a body flag, the §37 consumer inventory is incomplete until you have OPENED every caller CLASS — frontend `invoke`, sibling edge `fetch`, DB trigger, cron, MCP tool — and confirmed each reads the OUTCOME (`body.ok`/the flag), not just the transport status. Prefer fixing the consumer over flipping the status to non-2xx: here a non-2xx would have degraded a body-reading frontend that shows a generic `error.message` (BusinessCreditAdmin), so the safe fix was to make the two status-keying server callers body-aware. A refusal reported as success is the §13 "a fire is not a delivery" failure, hiding inside a green transport. (Companion trap, re-confirmed here: `deno check` is NOT the repo's `ci:tsc` — the repo tsconfig doesn't narrow discriminated unions, so an edge module can pass `deno check` and still fail `ci:tsc` with TS2339; run `ci:tsc` before trusting an edge-module type change.)
- **Two refinements from a SECOND external pass (Codex on the fix-forward PR #1228 — layered defense caught what BOTH the internal §39 peer AND §5 compliance missed, twice in one workstream).** (a) **Not every non-success is the same status.** The first fix mapped *every* HTTP-200 `ok:false` to `cancelled`; but business-verifier returns 200 `ok:false` for OPERATIONAL errors too (`BUSINESS_LOOKUP_FAILED`, the `BUSINESS_VERIFICATION_FAILED` catch-all), and burying a real service/DB failure as a policy `cancelled` hides it from status-based monitoring/retry. Distinguish POLICY refusal (the funding-gate `result` ∈ {setup_required, unavailable} → `cancelled`) from OPERATIONAL failure (everything else non-success → `failed`). (b) **A caller-propagation claim of `BEHAVIORAL_EVIDENCE: PASS` is an overclaim if no test exercises the caller branch.** The gate's own unit tests don't prove the *callers* map its refusal correctly. The fix for both: extract the decision into a pure exported helper (`_shared/business-verify-outcome.ts` → ran/policy_refusal/operational_failure) that BOTH callers apply and a unit test covers against every real response shape — testability is the §18 dividend of one home. Label untested branches `UNVERIFIED`, never `PASS`.

## A `high`-classified, provider-contacting, caller-INITIATED action adopts the AUTHORITY half of the governed seam, not the propose gate (2026-09-13)

- **Symptom.** `business-verifier` (contacts external registries + auto-activates PAID adapters) needed governed adoption to close its §9 IDOR. The obvious move — route it through `decideGovernedExecution` like `paige-write-back` — would have broken it.
- **Root cause.** Its canonical key `business_verify` is classified `high` (action-risk.ts). The seam clamps a `high` act `auto→confirm` and, with no approval claim, returns `propose`. But this endpoint is SYNCHRONOUS and caller-INITIATED (a human clicks verify; a trusted service dispatches) with no approval card to redeem — so routing it through the execute/propose gate would REFUSE every legitimate producer (a §58/§70 regression). Write-back was safe to route through the gate only because `update_client_data` is `ordinary` (→ execute).
- **Rule.** For a caller-initiated action whose canonical key is `high`, adopt the parts of the governed pattern that close the actual holes — the AUTHORITY re-resolution (authenticate; person/system split; resolve authority against the resource's own tenant; derive the actor from the JWT, never the body; authorize BEFORE any spend/provider contact) and a governed AUDIT receipt (record the `high` class honestly) — and EXECUTE on a passed authority verdict. Do NOT run the autonomy/propose clamp: that clamp governs PAIGE-AUTONOMOUS invocation (an unattended loop choosing to spend), which is a separate §67 concern to wire when a Paige loop calls the endpoint on nobody's behalf. Defer it explicitly in a header comment; never silently skip it. The person/system split: `getUser` returns a user → `person` (actor = auth.uid()); else bearer `=== SERVICE_ROLE_KEY` → trusted `system`; else 401 (an anon-key JWT passes `verify_jwt` but is neither — refuse it). This pattern generalizes to the other provider-contacting bypasses (nav-pull-profile, docusign-send-envelope, smartcredit-pull-snapshot).

## Re-deriving a "same-tenant staff" gate as `tenant_members.role IN (owner,admin,coach)` silently 403s real staff — mirror the surface's OWN read authority (2026-09-13)

- **Symptom.** Closing the `business-verifier` cross-tenant IDOR, the first authority model gated the `person` path on `tenant_members.role IN (owner,admin,coach)` for the business's tenant. It type-checked, tested green (16/16), and passed two review rounds — but it would have silently 403'd a legitimate same-tenant `sales_rep`/`cs_rep`/`finance`/`viewer` who can reach the Verify card today.
- **Root cause.** TWO role systems that do not correspond. `tenant_members.role` is a 4-value enum (owner/admin/coach/member); the GLOBAL `user_roles.app_role` is the functional set (admin/coach/sales_rep/cs_rep/finance/viewer/…). `map_app_role_to_tenant_role` maps ONLY admin→admin and coach→coach — **every other staff app_role collapses to `member`**. But the surface's own read gate, `businesses_tenant_staff_select`, admits all of admin/coach/sales_rep/cs_rep/finance/viewer (tenant-scoped). So a `sales_rep` reads the card (app_role admitted) yet carries `tenant_members.role='member'` → a `tenant_members`-only verify gate denies them. That is a §58/§70 capability removal + a visible-flow regression, invisible to a green suite.
- **Rule.** When a service-role endpoint re-implements the authority that guards a UI surface, mirror the SURFACE'S OWN gate, do not re-derive a role list. The faithful, drift-proof way: establish authority by reading the target through the CALLER'S JWT client (RLS-enforced) — "can the caller SELECT it?" is exactly "can they use the surface?", it closes the cross-tenant IDOR for free (the RLS tenant-scopes), and it can never fall out of sync with the surface. Keep an explicit platform-owner fast-path (covers a tenantless resource) and an `agency_can_manage_child` fallback (covers the delegated case the surface's RLS may miss). NEVER use the service-role client for the authority read — that bypasses RLS and re-opens the hole. **The class of proof that catches this is grounding the role model against the migrations BEFORE choosing the gate** (read `map_app_role_to_tenant_role` + the target table's SELECT policy), not a unit suite over the gate you already chose — the suite only proves the gate you picked behaves as you wrote it.

## "Closes the IDOR" is only true of the doors you actually closed — enumerate every SIBLING door to the same capability, and scope the claim to what shipped (2026-09-13)

- **Symptom.** The business-verifier PR closed the cross-tenant verify IDOR at the direct edge endpoint and asserted "closes the cross-tenant IDOR." An internal §39 peer-gate on the pushed diff caught that the SAME capability is still reachable unscoped through a sibling door: `paige-mcp`'s `verify_business` tool forwarded an arbitrary body `business_id` with the service-role key → classified `system` → blanket-allowed with zero tenant scoping, verifying any tenant's business and burning paid-adapter budget. The claim was true of the endpoint, false of the capability.
- **Root cause.** The §37 producer inventory enumerated the producers but didn't verify that each one that reaches the capability via a DIFFERENT path also enforces scope. `system` (service-role) being a blanket-allow at the door means the capability's safety depends on EVERY service-role caller self-scoping first — skill-runner did (`.eq("tenant_id", callerTenantId)`), paige-mcp did not. A green endpoint + a clean external review (Codex) both passed; only the adversarial read that explicitly asked "what else calls this, and does IT scope?" surfaced it.
- **Rule.** When a door trusts `system`/service-role as a blanket allow and defers scoping to the dispatcher, the §37 inventory is incomplete until you've OPENED each such dispatcher and confirmed it tenant-scopes the target before calling — a sibling tool reaching the same capability is part of the same bypass, not a separate slice. And a security claim ("closes X") must be scoped to what actually shipped: either close every door to the capability in the slice, or qualify the claim to the doors closed and name the open ones as the immediate next work (not buried as a vague follow-up). Closing one door while the headline says the capability is closed is the §13 honesty failure this catches.
## A SECURITY DEFINER helper in an RLS policy must be EXECUTE-granted to EVERY role the policy runs under; and fixing a pgTAP's first failure EXPOSES the next one it was masking (2026-09-13)

- **Symptom.** After reordering a SET-ROLE pgTAP fixture to satisfy `guard_active_tenant_membership()` (its first, masking failure), the proof hit a SECOND failure at the account-switch case: `permission denied for function is_tenant_admin`, raised while evaluating the `threads_select_owner_or_admin` RLS policy on `paige_chat_threads` as the `authenticated` role.
- **Root cause (two traps).** (1) `is_tenant_admin(uuid)` is `SECURITY DEFINER` and is referenced by that policy's admin-oversight branch, but it was EXECUTE-granted only to `anon` (`20260703131428`), never `authenticated` — while its sibling in the SAME policy, `is_platform_owner()`, DID get the `authenticated` grant (`20260628220854`). A caller needs EXECUTE to INVOKE a definer function even though the body then runs as owner; the asymmetry left the admin client-thread oversight read unable to evaluate for `authenticated`. (2) A pgTAP that aborts on `ON_ERROR_STOP` at its first failing statement HIDES every later failure; fixing the first (the membership-guard order) is not "the fix" — it only reveals the next latent one. Expect to iterate until the terminal row prints.
- **Rule.** When an RLS policy calls a SECURITY DEFINER helper, confirm that EXECUTE is granted to every role the policy is declared `TO` (here `authenticated`), not just `anon` — audit the whole helper family for parity, since these grants were added per-role in batches and one can be missed. And treat a green pgTAP as proven only when it reaches its explicit terminal row (`...PROVEN`) and `ROLLBACK`; a single `permission denied`/`RAISE` aborts the rest, so re-read the LAST psql line, not the step's red/green alone. The platform-level grant fix is tracked as issue #1204 (kept OUT of the task↔thread slice; the slice's proof grants it in its own harness with a comment).

## A service-role write-back keyed on a caller-supplied target, gated on a GLOBAL role, is a cross-tenant write IDOR (2026-09-13)

- **Symptom.** `paige-write-back` let a tenant-A admin/coach write a tenant-B user's credit/identity record (`businesses`/`profiles`/`intake`/`credit_*`) — a §9 cross-tenant write. Surfaced during the A/B governed-adoption caller inventory, not by a failing test (the endpoint "worked" for every legitimate caller).
- **Root cause.** The endpoint authenticates on an anon client, then writes through a SERVICE-ROLE client (RLS bypassed). For a cross-user write it checked `user_roles` for an `admin`/`coach` role — but `user_roles` is GLOBAL (no `tenant_id`), the §53/§59 global-role trap. A global role is necessary, NEVER sufficient: nothing bound the caller's workspace to the target's. The RLS the service client bypassed was the only thing that would have stopped it, and it was bypassed by design.
- **Rule.** Any SECURITY DEFINER / service-role path that writes tenant/PII data keyed on a CALLER-SUPPLIED target must re-enforce the caller's scope IN-BODY: a TENANT BOND (caller's server-resolved `current_user_tenant_id()` owns the target), not a global role; cross-tenant authority is `is_platform_owner()` (super_admin, §53), never a tenant-level app_role; fail closed on any unresolved identity/tenant/read. The grant is never the guard (§59). And the class of proof that misses this is a green test suite — only a caller inventory against the tenant matrix (§37/§51) surfaces "works for everyone, including the attacker."
- **Companion trap (same session).** Concluding a §58 behavior change from a PARTIAL diff read: the first 120 lines of the diff showed only the role check removed, which read as "the coach-assignment requirement is NEW" — the REST of the diff showed the old code already had the `coach_clients` check, so the only real change was the tenant bond (the IDOR fix), no collateral regression. I had already written a "§13 correction" comment asserting the false claim before catching it. Rule: read the WHOLE diff before asserting what behavior changed, and never let a half-read drive a code comment or a §58 flag.
- **The trap has TWO halves — closing only the cross-tenant one leaves an escalation (post-merge Codex catch, #1197).** The slice-1 fix added a tenant BOND (target must be in the caller's active workspace) but still read the caller's admin/coach role from the GLOBAL `user_roles`. Because `current_user_tenant_id()` admits an active membership at ANY role, a global admin/coach of tenant A who is only a PLAIN MEMBER of tenant B could switch active workspace to B and pass BOTH the global-role check and the tenant bond — writing B's client PII without being an admin/coach OF B. The cross-tenant half (active≠target) was closed; the same-active-tenant-wrong-role half was not. **Rule:** the global-role trap is closed only when the ROLE SOURCE is tenant-scoped (`tenant_members.role` for the resolved workspace), not merely when a tenant bond is bolted on. Resolve the workspace FIRST, then read the role IN it; a global role must not be an input at all. **Review lesson (layered defense is real):** my §39 peer-gate AND §5 compliance both returned SHIP — the peer even checked "the global-role trap" but verified only the cross-tenant half. The EXTERNAL reviewer (Codex) caught the residual escalation on the merged diff. Internal adversarial review is necessary, never sufficient; an independent external pass catches a different class, and the regression test must assert the EXACT escalation (plain member + global role elsewhere → denied), not just the cross-tenant case.
- **Tightening can UNDER-shoot: scope an authority check to match the tenant-RESOLUTION logic (#1201, third Codex pass).** Fixing P1 by reading a DIRECT `tenant_members` row only was too narrow — `current_user_tenant_id()` resolves a tenant for a caller with NO direct row via its `agency_can_manage_child` branch, so a direct-only authority check denies a caller the resolver treats as legitimately operating there. Rule: when you gate "may act IN tenant X", resolve authority the SAME way the platform resolves "may operate IN X" (minus the roles that shouldn't write) — here, direct admin/coach OR `agency_can_manage_child`. A resolution branch that exists is a reachable state your authority check must cover. **Reconciling a reviewer disagreement against the primary source:** Codex said the agency flow breaks; the §39 peer said it doesn't (because `agency_enter_subaccount` force-inserts a direct admin row). Both were partially right — reading the actual RPC showed the canonical entry path has the row (peer) while the resolver's agency branch covers an edge without it (Codex). Don't pick the reviewer you like; read the function both cite and state which case each is describing.

## A client write-gate must be evaluated against the VIEWED tenant, not `current_user_tenant_id()` (2026-09-13)

- **Symptom.** On Settings › Connections › Calendars, "New preset" (and edit/enable/hosts) was disabled/hidden for an owner who could actually write — the surface read but could not be operated. The reported "empty state with no way to create" was really a write-gate that resolved false.
- **Root cause.** `canWrite` was read from `is_current_user_tenant_admin()`, which is `is_tenant_admin_as(auth.uid(), current_user_tenant_id())` — admin of the caller's OWN active tenant (`profiles.active_tenant_id`), not the account being VIEWED (`activeTenantId`). Those diverge on a stale profile pointer, a tenant switch before the profile persists, and when an operator/agency acts as another account — the same read-scope divergence the surface already handled for readiness but not for authority. A single boolean gate was also sourced from a different tenant AND a different predicate than the RLS write it guards.
- **Rule.** Evaluate a client write-gate against the tenant the surface is showing, using the SAME predicate the write's RLS enforces (`is_platform_admin() OR is_tenant_admin(viewed)` mirrors the `calendars` manage policy). Never gate a write on `current_user_tenant_id()` when the surface can view another account. Prove parity two ways: a hook test that the gate calls the tenant-scoped check with the viewed id (plus stale-profile, platform-admin, tenant-switch), and a local-Postgres RLS-parity harness that the gate predicate matches the actual INSERT outcome. Prefer existing deployed+granted helpers so the fix is live on frontend deploy with no migration.

## A booking write refusal must classify into an honest, actionable category — never a raw dump, never a false success (2026-09-13)

- **Symptom.** A real "New appointment" refusal could surface a raw PostgREST/SQLSTATE string (or, for an RPC that failed to resolve, a cryptic schema-cache message); the concern was that a failure could read like a booked appointment.
- **Root cause.** `createBooking` mapped only the overlap codes (23505/23P01) and passed every other `err.message` through verbatim. A `PGRST202`/`PGRST203` (function not deployed / ambiguous overload) or a transport failure had no honest category.
- **Rule.** Route every booking write error through one shared classifier (`classifyBookingWriteError` → `{category,message}`) covering conflict/forbidden/not_found/invalid/unavailable/network/unknown; an RPC that never resolved reads as "nothing was booked — try again", a transport failure as a connection problem, and an unrecognised cause is surfaced verbatim (§13, never swallowed). The submit UI closes only on `ok` so a refusal can never present as a save. Server seams are proven sound by a faithful local-Postgres replay before concluding a live failure is client-side.

## Security reconciliation must promote prevention controls, not preserve stale warnings (2026-09-12)

- **Symptom.** Historical audits, open issues, green workflow definitions and merged migrations were read as if they described today's deployed platform, while older direct Edge paths sat beside newer canonical Harness controls without inheriting them.
- **Root cause.** Source, merged state, deployment, production catalogue, authenticated runtime and proposed repair were collapsed into one evidence class. Findings recorded an instance but not the invariant that prevents its next form.
- **Rule.** Pin health statements to an exact merged-main SHA and timestamp; label `VERIFIED/PARTIAL/UNAVAILABLE/PROOF OWED/UNVERIFIED`; keep local remediation non-shipped; and inherit these controls:
  - public identity-changing endpoints require signed, expiring, purpose-bound authority;
  - service-role functions derive tenant, actor, target and authority server-side—an ordinary JWT is not internal-service authority;
  - URL ingestion uses canonical bounded `safeFetch`, including redirects and response size;
  - tenant views deliberately preserve RLS semantics and prove deployed grants;
  - consequential automation resolves current authority, stable identity, idempotency, budget, readback and receipt/Rail through one path;
  - a green workflow definition is not proof of a required gate or deployed behavior;
  - a capability is not live until declared, executable, proven and owner-visible truth agree.
  Preserve each reconciliation snapshot. A later repair appends a new exact-SHA entry naming what changed and which proof closed the finding; it never edits the older snapshot into a success it did not observe.

## A new result/status vocabulary must be cross-mapped to the existing CI-enforced one, not silently forked (2026-09-12)

- **Symptom.** The proof-lane framework (Harness Layer G) introduced a runtime verdict vocabulary
  `VERIFIED/PARTIAL/PROOF_OWED/UNAVAILABLE/UNVERIFIED`. The repo already has a CI-enforced
  release-accounting vocabulary in `scripts/ci/binding-ledger-lint.mjs`
  (`LIVE/PARTIAL/READ_ONLY_CONTEXT/INTENTIONALLY_ISOLATED/UNAVAILABLE/PROOF_OWED`) and
  `release-governance-lint.mjs`. Three tokens matched verbatim; `LIVE` was renamed `VERIFIED` and
  `UNVERIFIED` was added — a silent divergence a future reader could mistake for drift.
- **Root cause.** Two honest layers (a runtime per-flow test verdict vs. committed surface-release
  accounting) legitimately need different tokens, but nothing documented the relationship, so the
  rename read as an accidental fork rather than a deliberate layer boundary (§18 one-home tension).
- **Rule.** When adding a status/result vocabulary, grep for an existing one in the same domain and
  either reuse it or **document the crosswalk in the same PR** — here, a proof-lane `VERIFIED` flow is
  exactly the `authenticated_runtime` evidence that moves a binding-ledger row `PROOF_OWED → LIVE`
  (`scripts/live-drive/PROOF-LANE.md`). Full token reconciliation, if wanted, is its own tracked
  issue — never done silently, never under time pressure.

## A second `CREATE TABLE … IF NOT EXISTS` with a DIVERGENT schema silently yields the WRONG schema — and no from-zero replay runs on a non-migration PR to catch it (2026-09-12)

- **Symptom.** `database-contract` (the from-zero `supabase db reset` replay in `paige-spine-contract.yml`)
  was RED on *every* migration-carrying PR with `ERROR: column "tenant_id" does not exist` at
  `20270117000000_social_operations.sql` — yet `meta-schedule-post` kept writing the table fine and prod
  looked healthy. (#1155.)
- **Root cause.** `public.paige_social_posts` had TWO creators under one name: an earlier operator-scoped
  schema (`20260627193825`, no `tenant_id`) and a later tenant-scoped redefinition
  (`20270117000000`, `tenant_id NOT NULL`). The later `create table if not exists` is a **silent no-op**
  when the table already exists — it does NOT reconcile or validate against the new definition — so the
  new columns/constraints never appear, and the migration's own `tenant_id` index + RLS policies then
  error on fresh replay. Two truths diverged: prod/incremental-apply carried the operator schema; the
  from-zero replay tried to build the tenant schema and died. The replay gate only fires on
  `supabase/migrations/**`, so PRs that didn't touch a migration never ran it — the break sat latent until
  a migration-bearing PR surfaced it.
- **Rule.** Never introduce a SECOND `CREATE TABLE` for a name that already exists with a different shape —
  a table has ONE authoritative schema; evolve it with explicit `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
  never a second `create if not exists` that silently wins or loses by apply-order. When a from-zero replay
  and incremental prod-apply can diverge, the replay is the canonical contract — keep it green. A
  `create table if not exists` that no-ops is not a safety net; it is how a wrong schema ships invisibly.
  And a tenant-scoping retrofit on a LIVE operator table (`tenant_id NOT NULL`) will break the live writer
  unless the producer moves first — that is a §9 product decision, not a migration tweak (#1161).

## 00. A new by-id EXPORT/read edge function that trusts RLS is a cross-tenant IDOR — marketing_content's RLS has a global-admin OR-branch (2026-09-06)

- **Symptom (caught by the §39 peer-gate, missed by §5 compliance).** A new `export-document` edge fn
  read the source doc with the caller JWT by id only (`.eq("id", contentId)`, no tenant filter) and
  trusted `marketing_content` RLS to scope it. A tenant-A admin could export a tenant-B document by id and
  get a working signed download URL.
- **Root cause.** `marketing_content_tenant_manage` (migration `20260711014952`) is
  `(tenant_id = current_user_tenant_id() AND has_any_role(...)) OR has_role(auth.uid(),'admin')`. The
  second branch is the §59 global-role trap: `user_roles` has no `tenant_id`, and EVERY tenant owner/admin
  holds the GLOBAL `admin` app_role (the `tenant_members→user_roles` sync trigger), so the OR-branch is
  TRUE for any row. Coaches are unaffected (global `coach`, not `admin`). RLS therefore does NOT scope an
  admin's by-id read to their own tenant.
- **Rule (§59).** A NEW by-id data reader/exporter MUST re-enforce caller scope IN-BODY — never trust the
  RLS grant. Require a MANAGE role IN THE ROW'S TENANT: owner/admin via `is_tenant_admin(row.tenant_id)`, or
  coach via `has_tenant_role(uid, row.tenant_id, 'coach')` — **NOT `is_tenant_member`**, which a PLAIN member
  of the row's tenant passes, re-opening the exact cross-tenant bypass above (Codex #1017). Allow cross-tenant
  ONLY for a platform operator (super_admin/platform_admin via the operator role), NEVER the tenant-level
  app_role. And because `marketing_content` RLS itself REFUSES a legitimate freshly-provisioned Solo owner
  (global role only `user`; their authority is an owner membership `is_tenant_admin` recognizes), the row is
  read with the SERVICE-ROLE client (a privileged, RLS-bypassing read) and the in-body manage-role check is
  the ONLY access decision — failing CLOSED as a 404 (never 403) so the by-id endpoint never reveals that an
  out-of-scope row exists. Order matters: authorize BEFORE any response that varies by the row's kind/tenant
  shape, or those status codes become a cross-tenant existence oracle (Codex #1017 M1). And: a source-grep
  test titled "tenant scope by RLS" that only greps for the read shape proves nothing about isolation —
  name it a source contract and owe the real two-tenant drive (§32.c). The underlying RLS OR-branch is a
  separate platform-wide gap (any tenant admin can read any tenant's marketing_content via raw PostgREST) —
  fix it in its own slice; the in-body gate closes each new reader regardless.

## 0. A NEW edge-native Paige capability cannot be a new inline chat tool NOR a Spine `action` today — extend a baseline tool (2026-09-06)

- **Symptom.** Building the document-export capability, the obvious move (a new `export_document` chat
  tool in `paige-ai-chat`) FAILS `chat-tool-registry-lint` — the inline baseline is frozen at 94 and may
  only DESCEND (new capabilities register in the Spine). But registering it as a Spine `action` ALSO
  fails: `paige-spine-registry-lint` requires `action.executor` to be either a `public.*` DB RPC or the
  n8n-management edge-proof shape (`integrations.*` key + `rpc('acquire')`/`project(...)` lease structure).
- **Root cause.** An edge-native capability whose executor is the model router / a first-party edge path
  (render → Supabase Storage → signed URL) fits NEITHER: a Postgres RPC can't render or mint signed URLs,
  and it isn't n8n-shaped. The Spine `action` executor model currently has exactly two accepted shapes,
  and "generic edge logic" is not one of them.
- **Rule.** For a new FIRST-PARTY edge capability, the §18-clean path is to **extend an existing baseline
  tool** (export shipped as an `export_format` param on `document_generate` + a standalone `export-document`
  edge function it invokes) — NOT a new inline tool, NOT a forced Spine registration. Generalizing the
  `registry.ts` edge-native executor allow-list (beyond N8N_MANAGEMENT) is a real follow-up if edge-native
  capabilities should become first-class Spine citizens; until then, don't fight the two lints — extend.

## 0a. A service_role-only RPC called from the anon+JWT seam writes NOTHING, and every gate stays green (2026-09-05)

> **AMENDED 2027-04-11 — the lesson stands; the fact it rests on does not.** This entry was true
> when written. On 2027-01-07, `20270107000000:94` added a TEN-argument overload of
> `record_capability_run` with no GRANT and no REVOKE, so that signature defaults to `EXECUTE TO
> PUBLIC`, and its body never calls `auth.uid()`. On that path the anon+JWT client does not get
> `permission denied` — it WRITES THE ROW. The failure described below is loud only while the
> signature actually invoked is locked. `20270416000000` restores the lock on both (in the repo;
> MEASURED 2026-09-24: prod already service-role-only on both signatures; the hole is not live and the migration makes that lock reproducible). That makes the generalisation SHARPER, not weaker: check the grant against the
> client **and against the exact signature the caller binds** — an overload is a new `pg_proc`
> entry and inherits nothing.

- **Symptom (caught in design, before it shipped).** The obvious way to make PAIGE's acts visible was
  to record once at `paige-ai-chat`'s single tool-dispatch seam, which every executed tool result
  already passes through. A crew took the design apart and found it would have produced a feature
  that compiled, type-checked, passed review, deployed — and wrote **zero rows, forever**.
- **Root cause.** `record_capability_run` is `REVOKE ALL … FROM PUBLIC, anon, authenticated` +
  `GRANT EXECUTE … TO service_role`. The dispatch seam holds `supabaseClient` — the **anon key plus
  the caller's JWT**. supabase-js returns `permission denied for function record_capability_run` as
  an `{error}` **value, not a throw**, so the seam logs one console line and carries on. Nothing is
  red. Nothing is missing. The rows simply never exist.
- **Three more defects in the same design, all silent.** (2) **Double-recording** — n8n and Zapier
  already record inside their own executors AND pass through that seam; each mints a fresh run id,
  so the UNIQUE key cannot collapse the duplicate, and the Zapier one renders twice on the
  Integrations panel. (3) **Records what never ran** — `executed.push(tc)` sits ABOVE the
  client-seat gate, the quote guard and the role gate, so a refusal that never reached a provider
  would render "Did not buy a phone number" for a call that could not have spent a cent.
  (4) **Loses a completed act** — a batch aborted by `scopeInvalidated` breaks BEFORE the audit
  loop, so a tool that already ran with real effects never reaches it.
- **Rule.** Record a capability run **at the executor**, never at a central dispatch hook. The
  executor holds the service-role client, the provider's own error taxonomy, and the knowledge that
  the act actually reached a provider. `_shared/capability-record.ts` supplies the mechanism so each
  executor does not re-implement it; `_shared/comms-capability-outcome.ts` is the per-executor
  taxonomy for Communications. **This is written down because at least three future adoption waves
  will reach for the same central seam and hit the same invisible failure.**
- **The generalisation, which is the part worth carrying:** whenever a new caller is wired to an
  existing RPC, check the GRANT against the CLIENT the caller actually holds. A permission error
  that arrives as a value rather than an exception is indistinguishable from success at every gate
  we run — it is the §32 "compiles but does nothing" shape wearing a database's clothes.

---

## 0b. A tenant-isolation proof cannot see a ROLE leak — the caller inside the tenant (2026-09-03)

- **Symptom:** `get_business_context_readiness` passed a six-scenario local Postgres proof, including
  an explicitly mutation-tested IDOR probe. It still leaked: a workspace's own **CLIENT** could read
  their coach's Setup readiness, while the capability descriptor declared `audience: owner_internal`.
- **Root cause:** every scenario in that proof varied the same axis — **which tenant** the caller
  belongs to. A client of tenant A *is* an authenticated user of tenant A, so
  `current_user_tenant_id()` resolved correctly and the function answered correctly for the wrong
  person. The gate the reference adapter has
  (`get_pipeline_spine_evidence`: `has_any_role(uid, array['admin','super_admin','coach'])`) was
  simply absent, and no assertion asked for it. The proof was green and the audience promise was
  false at the same time, which is exactly the §39 "what would make this GREEN proof a lie?" case.
- **Rule:** a `SECURITY DEFINER` read has **two** access axes, and tenant isolation is only one.
  Before calling such a proof done, write the assertion for the second: *which ROLES inside the
  resolved tenant may see this?* If the capability declares `audience: owner_internal`, a non-staff
  member of that same tenant must be refused, and the refusal must be **tested** — it is invisible to
  every cross-tenant assertion you already wrote. Prefer a refusal that keeps the response shape
  (four rows, reason `not permitted for this account`) so a consumer can tell "may not" from
  "could not" (§13).
- **Second rule, learned the same day by getting the FIRST fix wrong:** write that gate
  **tenant-scoped**, not global. My first fix copied the Pipeline reference adapter's
  `has_any_role(uid, array['admin','super_admin','coach'])`. `user_roles` carries **no `tenant_id`**,
  so a global role answers the wrong question in both directions (§59's global-role trap):
  it **wrongly admits** — a user who is 'admin' because of workspace X passes while resolving
  workspace Y, where they may be a member or a client; and it **wrongly refuses** — the current
  deferred-signup path (`record_signup_acceptance` / `provision_tenant`, `20260808190000`) grants a
  new owner the base role `'user'` and nothing else, so a freshly provisioned Solo owner holds no
  staff row at all and would be silently turned away from the very capability built for them.
  Use `is_tenant_admin(<resolved tenant>) OR is_platform_owner()`. **And the copied predicate is
  worth flagging upstream:** `get_pipeline_spine_evidence` still carries the global form, and its
  binding is `PARTIAL` with no authenticated drive — so nobody has yet exercised the path where it
  would matter.
- **What made the second miss findable:** the test INSERTED the `user_roles` rows itself, so it
  proved the gate works without ever proving real owners hold that role. The fixture now gives the
  REFUSED caller a global staff role while leaving them a mere workspace `member` — so a regression
  to a global predicate turns the refusal assertions red instead of passing for the wrong reason.
  **When a gate reads a table your fixture also writes, ask what production actually puts there**;
  the answer here came from counting roles on prod (7 of 7 owners hold `admin` today — which is
  history, not construction, since the current signup path grants `'user'`).

---

## 0f. A mocked write hides a required field, and every test still passes (2026-09-03)

- **Symptom:** Campaigns → Sales shipped a "Quick offer" create with 42 green tests, a clean `tsc`
  ratchet, a passing build and green CI. The write could not have succeeded ONCE, on any tier.
- **Root cause:** the draft omitted `tenantId`. `useCatalogOffers.saveOffer` forwards it as
  `_expected_tenant_id`, and `runWrite` merges `{ _expected_tenant_id: activeTenantId, ...args }` —
  so a draft that OMITS the key still contributes `undefined`, which **wins the spread** and is then
  dropped entirely by `JSON.stringify`. `save_solo_offer` declares that parameter with no DEFAULT and
  its 14-argument overload was dropped in `20261111000000`, so PostgREST resolved no function and
  answered `PGRST202` with the raw signature rendered into the drawer footer. The contract test mocked
  `saveOffer` outright and asserted `id`/`name`/`kind`/`priceInterval` — never the field whose absence
  broke it. `// @ts-nocheck` (the house pattern in `src/solo/`) suppressed the missing-required-field
  error that would otherwise have caught it at compile time.
- **Rule:** when a test mocks a write, assert **every field the real callee requires**, not the fields
  the feature is about — a mock proves the handler was CALLED, never that the call could succeed. And
  a present-but-`undefined` key is not the same as an absent one: it beats a spread fallback and then
  vanishes on the wire. `git grep` the callee's required-field list and assert it.

## 0g. RLS is a ROW FILTER, so "permission denied" never arrives (2026-09-03)

- **Symptom:** a flag written to distinguish *"you have none"* from *"I could not look"* could never
  be false. Its honest copy — *"not readable at your access level"* — was unreachable, so a plain
  member of a workspace WITH recorded payments would be told, in a definite sentence, that it had none.
- **Root cause:** the code read `const ordersReadable = !response.error`, modelling authorization as an
  ERROR channel. `tenant_orders` GRANTs `SELECT` to `authenticated`, so every signed-in caller holds
  the table privilege and never sees `42501`; the only gate is the RLS policy, and RLS **filters rows**
  — a non-admin's read returns `200`, `data: []`, `error: null`. The adapter test compounded it by
  faking the denial as `{data: null, error: {code: "42501"}}`, an input that configuration cannot
  produce, so the test encoded the wrong model and passed.
- **Rule:** a table with a broad `GRANT` and a narrow RLS policy denies by returning **nothing**, not
  by erroring. Derive "may this caller read it" from the same predicate the POLICY uses, never from
  the error channel — and when a fixture models a denial, check the grant first that the denial shape
  is one the database can actually emit.

## 0h. Reporting a capability as absent when the session actually held it (2026-09-03)

- **Symptom:** a slice shipped with no rendered evidence and a PR body, commit message and tier-matrix
  ledger all giving the reason as *"this session holds no browser tool"*. An independent reviewer ran
  `npm run harness:selftest`, which launched real Chromium through Playwright and passed every
  falsifiability arm — including the contrast arm that catches exactly the defect class the same
  review then found in that surface's own CSS.
- **Root cause:** "could not reach live prod" was true and got generalised into "no browser", which was
  not. The generalisation was never tested against the repo's own harness, which is one npm script away.
- **Rule:** §32.c keys the honest degrade to **lacking the capability**, never to the agent's name or a
  guess. Before writing that a capability is absent, RUN the repo's own check for it — here,
  `npm run harness:selftest`. An unreachable production target does not license skipping LOCAL render
  evidence, and a capability wrongly reported as absent is a §13 violation even when the rest of the
  report is accurate.

## 0c. A migration numbered at "the next free slot" collides the moment `main` moves (2026-09-03)

- **Symptom:** Billing Foundation A's migration was `20261044000000`; while the branch was under review
  `main` merged an unrelated `20261044000000_rail_authority_…`. CI's `database-contract` job
  (`supabase db reset` on the PR's MERGE ref) failed with a duplicate `schema_migrations` key — after
  the migration itself had applied cleanly. Had it merged, `deploy-migrations.yml` would have hit the
  same key on prod.
- **Root cause:** a version chosen from the branch's view of `main` at branch time; the two-dot diff
  against a moved `main` also hides the collision (the other file looks like "main added a file").
- **Rule:** before every push of a migration branch, `git fetch origin main` and compare the version
  against `git ls-tree origin/main supabase/migrations`; renumber to a free version (content unchanged,
  `\i` lines / parity-test paths / registry rows follow). Treat the `database-contract` job as the
  canary it is — it applies the merge ref, which is the only place the collision is visible.
- **AMENDED 2026-09-03, after this happened again to a session that had READ this entry.** Following
  the rule above is not enough, and the reason is worth stating exactly: I fetched `main`, compared
  versions, renumbered `20261107000000` → `20261111000000` — and `main` merged
  `20261111000000_the_offer_editor…` into that very slot **in the minutes between my check and my
  push**. A manual comparison is a snapshot; on a branch that moves 188 commits in a day, the snapshot
  is stale before the push lands. **The repo already ships the guard: `npm run lint:migration-versions`
  (`scripts/ci/migration-version-collision-lint.mjs`), which compares against `origin/main` at the
  moment you run it and names both colliding files.** Run it as the LAST step before every push that
  touches `supabase/migrations/**` — not the eyeball comparison, and not only in CI. Note it reads
  COMMITTED state, so commit the rename first, then run it. Both `verify` and `database-contract` went
  red for this single cause; one local command would have caught both.

## 0d. Proof-authoring traps in a `BEGIN … ROLLBACK` role-impersonating SQL proof (2026-09-02)

Each cost one failed run on prod (rollback, nothing persisted) before it was written down:
- `INSERT INTO auth.users` already creates the `profiles` shell (`handle_new_user`) — seed the pointer
  with `UPDATE`, not `INSERT`.
- `trg_guard_active_tenant` refuses `profiles.active_tenant_id` pointed at a workspace where the user
  holds no seat — to fixture an "act-as with no seat" shape, seed the seat, set the pointer, delete the seat.
- `set_config('request.jwt.claims', …, true)` OUTLIVES `SET LOCAL ROLE`/`RESET ROLE` — clear it
  explicitly (`'{}'`) or the next block runs as the previous user.
- Temp tables need `GRANT` to the impersonated roles (`authenticated`, `anon`) or every property
  written under them fails on the report table, not on the thing under test.
- `ROLLBACK TO SAVEPOINT` discards the result rows a mutant wrote — un-mutate explicitly
  (`CREATE OR REPLACE` the original) instead of rolling the savepoint back.
- A property that is "0 rows visible" is vacuous unless a sibling proves the row EXISTS to the owning
  role (P52 needed P55).
- **AMENDED 2026-09-03 — a hand-built local stand-in passes exactly the checks it models, and no
  others.** With no Docker in the session I could not run `supabase test db`, so I shimmed pgTAP
  against a local Postgres with hand-written stub tables. It reported **18/18 green**; CI then failed
  the same file at the fixture, on `trg_guard_active_tenant` — a REAL trigger my stub schema simply
  did not have. The shim was not wrong about the assertions; it was silent about everything it had
  not been told existed, and silence read as success. Two rules: (1) when the fixture writes to a
  table production guards, model the guard in the stand-in — after adding this one, the shim
  reproduced CI's exact error string and the corrected ordering went green; (2) never quote a shim
  run as proof the CI file passes — it is evidence about the assertions, not about the schema. The
  actual fix was already written down two bullets above (seed the seat, then the pointer); the shim
  is what let me skip reading it.
- **The batch you RAN is not the file you COMMITTED unless you re-derive it.** The MCP runner takes a
  derived batch (`\i` expanded, `RAISE NOTICE` swapped for a report row). A fix applied to the derived
  copy in `/tmp` and not to the committed mutants file left the repo carrying a subquery that fails
  `42P01` — caught by the compliance reviewer's parity check, not by the green prod run. Rule: fix the
  committed file first, re-derive the batch from it, and diff the two (non-comment lines) before
  quoting the run as proof of the file.

## 0a. Ruling-conversion discipline — don't re-open a ruling as options (D7, 2026-08-11)

- **Symptom:** the owner ruled D7 (Option A, direct C-Corp conversion, standalone, no holdco). CC's §37
  producer inventory then surfaced adjacent stale doctrine the ruling hadn't named (the Portfolio-mode
  C-suite architecture; CoreConnect/Disputera refs). Cowork re-presented this to the owner as "Reading 1
  vs Reading 2" options. Owner, frustrated: *"There's no need to keep going back and forth… delete it and
  update it. That's it."*
- **Root cause:** treating a *scope-completeness* question ("the ruling didn't literally name this
  adjacent thing") as a *decision* question ("which way do you want it?"). Adjacent doctrine that
  **contradicts** an owner ruling is dead by implication — it doesn't need a fresh ruling to delete.
- **Rule:** when the owner has ruled, convert the ruling into COMPLETE execution guidance across the full
  scope §37 surfaces — do NOT re-open it as options. §28 protects CURRENT approved designs, not
  superseded doctrine; superseded doctrine gets deleted/updated, not preserved-and-flagged. (Genuinely
  NEW, separate facts a ruling couldn't have known about — e.g. an unrelated brand-licensing entity on
  the public footer — are still flagged, once, tersely; that is not the same as re-litigating the ruling.)

## 0b. Deep-research-not-memory — defer to real research, don't fake structure (2026-08-11)

- **Symptom:** asked to design a domain surface (e.g. "what an investment/portfolio surface looks like")
  with no concrete knowledge, the reflex is to synthesize plausible-sounding structure from memory.
- **Root cause:** guessing reads as authoritative but isn't grounded; it ships wrong shapes that cost a
  rebuild. Owner: *"do some homework, do some deep, deep diving and research."*
- **Rule:** when you lack concrete domain knowledge, DEEP-RESEARCH it against best-in-class references
  when the work fires — GOAT-anchored, the same discipline the skills wave uses — or defer the work until
  that research can happen. Never fabricate plausible structure from memory. (Applies to Cowork planning
  AND to what Cowork directs CC to build; e.g. the #129 Portfolio-feature surface is explicitly deferred
  with a research directive rather than guessed now.)

## 0d. Standing-pattern codification — a rule the owner repeats across sessions IS doctrine, codify on the 2nd occurrence (§61, 2026-08-11)

- **Symptom:** Cowork/CC asked the owner which tiers get the §60 `skills` feature-key — when the answer
  followed a pattern the owner had already stated multiple times across sessions in different framings
  (God has everything · Solo + Sub-account default · Agency resells · Enterprise hybrid). Owner, verbatim:
  *"This is yet another time that you guys have asked me something around the idea of where things should
  be placed when we should actually already have this understanding for the entire platform."*
- **Root cause:** treating each occurrence of a recurring decision as a fresh per-instance question,
  instead of recognizing the consistent implicit pattern underneath and locking it as doctrine. A rule the
  owner has stated across multiple sessions IS doctrine even before it is formally captured — asking again
  is the miss.
- **Rule:** when the owner has ruled the same pattern across sessions, **codify it into doctrine on the
  SECOND occurrence, not the fifth.** Recurring per-feature questions whose answer follows a consistent
  pattern are the signal that the pattern must be doctrine-locked (name it, number it PROPOSED, add it to
  CLAUDE.md + the brain + the master doc). The anchor case is §61 Standing Tier Distribution Default (God
  YES · Solo YES · Sub-account YES · Agency RESELL · Enterprise YES+RESELL). Same class as lesson 0a
  (ruling-conversion discipline — convert a ruling into complete guidance, don't re-open it as questions).

## 0c. A tool error is NOT proof the record is absent — the false-negative→false-knowledge trap (#127, 2026-08-11)

- **Symptom (owner live-drive):** Paige told the operator "there's no contact named Tashia Anderson on
  file" — but the contact existed. Two independent defects wore the same face: (1) the CRM search
  tokenizer matched the WHOLE phrase `"Tashia Anderson"` against EACH single column, so a real row with
  `first_name="Tashia"` + `last_name="Anderson"` (SEPARATE columns) matched 0 rows; (2) an unrelated
  nested tool (content-draft/generate-image) 500'd, and its error was narrated as if the *lookup* had
  failed. Paige collapsed both — an empty result AND an errored call — into the same confident claim:
  "no record."
- **Root cause:** an empty/errored search result was treated as positive evidence of absence. A query
  that returns 0 rows means "this query matched nothing," never "this thing does not exist"; a tool that
  throws means "I could not check," never "the answer is no." Collapsing *found-nothing* and *could-not-
  check* into *does-not-exist* manufactures false knowledge and misleads the operator.
- **Rule:** three outcomes are NEVER collapsed — **found** (real rows), **found-nothing** (a clean query
  that matched zero — say "no match on that search," suggest a narrower/looser retry), and **could-not-
  check** (an error — say the lookup failed, do NOT assert absence). The §18 one-home fix: tokenize the
  search (`_shared/contact-search.ts` — each token ORs across columns, tokens AND-combine via chained
  PostgREST `.or()`), plus a LOOKUP HONESTY prompt block forbidding the collapse. Full-name and
  multi-word queries never live in one column — assume tokenization for any human-name search.

---

## 1. The voice live-drive trap (ElevenLabs, #24 / #170 / PR #409)

> **SUPERSEDED 2026-09-07:** the literal defaults and `ELEVENLABS_VOICE_ID` behavior below describe
> historical wiring only. Paige speech now resolves exclusively through the approved service-side
> Paige Voice Profile; request-level provider/voice overrides are rejected, and active sessions keep
> their immutable profile revision.

- **Symptom:** "I updated the ElevenLabs agent but I still hear the old voice." Sessions changed a
  ConvAI agent's voice and heard no change.
- **Root cause:** Paige's TTS path does **not** read the ElevenLabs **ConvAI agent** at all. The
  ConvAI stack was removed in #170 / §49 Wave A. The actual voice is set by
  `PRIMARY_ELEVENLABS_VOICE` **hardcoded** in `supabase/functions/_shared/tts-router.ts` — **now
  `"0S5oIfi8zOZixuSj8K6n"` (Ivanna)** as of #409 (was `"6aDn1KB0hjpdcocrUkmq"` "Warm" pre-#409) — with
  `ELEVENLABS_VOICE_ID` honored **only** by the separate legacy `_shared/elevenlabs.ts` path. Updating
  the agent touches neither.
- **Rule:** To change Paige's voice, edit `PRIMARY_ELEVENLABS_VOICE` in `tts-router.ts` (and/or set
  `ELEVENLABS_VOICE_ID` for the legacy path) — never the ConvAI agent. Verify by driving the actual
  TTS endpoint, not by trusting the ElevenLabs dashboard. (Being persisted as a "Voice Configuration"
  CLAUDE.md section on PR #409; see `config-registry.md` → Voice.)

## 2. Cross-worktree / cross-branch file leakage (§254 worktree discipline)

- **Symptom:** A session's changes appear on, or collide with, another in-flight branch's work; an
  edit meant for one task lands in another's tree.
- **Root cause:** Multiple agents run in parallel on sibling branches
  (`claude/s3-operator-communications`, `claude/voice-fix-ivanna`, etc.). Editing the shared main
  working tree, or reading one branch's uncommitted state as if it were `main`, leaks work across
  lanes.
- **Rule:** Substantive work runs in an **isolated git worktree** branched from `origin/main`
  (this task did: `.claude/worktrees/second-brain`). Never touch another agent's named branch. Treat
  facts found on an unmerged branch as **in-flight**, not as `main`/prod truth (this is exactly why
  `config-registry.md` marks the operator-Twilio + voice sections as ⚠ in-flight).

## 3. "It compiled" ≠ "it runs" (§32 green-build-is-not-a-render)

- **Symptom:** `tsc`/`vite` pass, PR merges, but the surface renders nothing (or crashes) at runtime;
  the owner catches it live. Worst case a `SceneBoundary` **silently swallowed** the throw, so the
  page just "didn't populate" with zero signal.
- **Root cause:** A passing build proves types, nothing about runtime. Error boundaries that render
  `null` without logging turn every runtime bug into the same invisible symptom.
- **Rule:** Smoke-test crash-prone runtime logic **headless** (Node against real inputs, e.g.
  `scripts/studio-hero-smoke.mjs`); every boundary/degrade path must **log loudly** and degrade to
  something **visible**; when you can't see the render, err **bold + loud**, not silent. For
  auth-gated surfaces, drive the deployed surface if the session has a browser tool
  (`scripts/live-drive/live-drive.mjs`), else explicitly mark the live check **owed** to a capable
  session — never claim a drive that didn't happen (§32 capability-conditional post-deploy).

## 4. Migration merged-but-never-applied — the false-green (§32 / #408-class, #275)

- **Symptom:** A migration "passed" and merged, but prod's schema is behind; the table/column/policy
  it was supposed to create isn't there. (1c-vi `20260722010000` and 1c-viii-a `20260722160000`
  merged while `schema_migrations` stayed two versions behind.)
- **Root cause:** A `BEGIN..ROLLBACK` proof only proves the **SQL executes** — it proves nothing
  about **persistence**. When no CI applied it (Supabase preview integration failed on #275), the
  migration was never actually run on prod.
- **Rule:** A migration is done only when (a) prod `supabase_migrations.schema_migrations` has
  **advanced** to include the version, and (b) the created object **actually exists** on prod
  (query it). This is now the `deploy-migrations.yml` pipeline (push→`db push`→`migration list`
  verify→move `db-live` tag). Confirm with `git diff db-live..HEAD -- 'supabase/migrations/**'` =
  empty. *(This pass verified 762 applied = 762 repo files = zero drift — the good state.)*

## 5. Producer-inventory misses — a hardening kills a legitimate caller (§37)

- **Symptom:** A security/contract fix ships and silently breaks a legitimate producer — a `pg_cron`
  job stops firing, an admin button 4xxs, an MCP tool errors. (Readiness-scan §9 hardening removed a
  contract still called by a cron migration, an admin "Run manual scan" button, and a `paige-mcp`
  tool — Hotfix-1, 2026-07-25.)
- **Root cause:** Static review confirms "implemented as described" but not "still works for every
  caller." The endpoint had producers across multiple caller classes nobody enumerated.
- **Rule:** Every contract-changing endpoint gets a **producer inventory across all eight caller
  classes** (frontend, sibling edge fns, DB triggers, `pg_cron`/`pg_net`, GitHub Actions, external
  webhooks/OAuth, n8n/Zapier/MCP, tests/scripts) **and names the tier for each** (§51). Half-hardened
  is worse than un-hardened. Template: `docs/doctrine/producer-inventory-template.md`.

## 6. The ⌘K collision — a green compliance + design-critic pass still missed it (§39 peer-gate)

- **Symptom:** A shipped keybind/command collided with an existing one; the pre-ship compliance and
  design-critic passes both returned clean, yet the defect was real. (Cited as an anchoring case for
  the peer-gate.)
- **Root cause:** A §32 proof / compliance pass only tests what its author thought to test. A green
  proof is necessary, never sufficient — it can be a **false green** for a whole class of defect the
  assertions never reached.
- **Rule:** Every §32-verified change also gets an **independent adversarial read of the real pushed
  diff** by a second set of eyes (not the proof's author), hunting the defect the proof couldn't
  cover — **then CI still has the last word.** Peer-gate + §32 proof + CI are layered; none alone is
  sufficient (§39; note §39's own honesty caveat — the peer-gate itself missed a `TS2304` in #350
  that CI caught).

## 7. Doctrine stated in chat evaporates — the §46 persistence miss

- **Symptom:** A "standing rule" the owner stated is forgotten by the next session; the same mistake
  recurs; the owner has to repeat himself ("where's your team, my friend?").
- **Root cause:** A rule that lives only in a chat transcript is gone on context reset. Only what's
  in `CLAUDE.md` (or a doc it points to) reloads every session.
- **Rule (§46 / §BRAIN):** Persist owner rulings into `CLAUDE.md` **in the same commit** as the work,
  and record feature/config/decision state into `docs/brain/`. A ruling not written down is a §13/§46
  drift waiting to happen. This is the entire reason the Second Brain exists — **not writing it down
  is the bug.**

## 8. Re-ruled a settled decision — the §BRAIN.2 miss (Ivanna voice, 2026-08-09)

- **Symptom:** Cowork/CC re-surfaced the **Ivanna voice choice** (`0S5oIfi8zOZixuSj8K6n` as
  `DEFAULT_TTS_VOICE`) as an **open question** — when the owner had already ruled it across multiple
  prior sessions (and it was merged in PR #409). The owner should not have to make the same decision
  twice.
- **Root cause:** The "decision" was pulled from session memory / a blank slate instead of the brain.
  A settled owner ruling that isn't checked against the decision-log gets re-litigated on every reset.
- **Rule (§BRAIN.2):** A decision the owner has **already made** is **relayed, not re-asked.** Before
  surfacing any "which should we do?" question, check `decision-log.md` + `config-registry.md` — if the
  owner already ruled, state the ruling as settled and move on. Re-asking a settled decision is itself
  the violation.

## 9. "Assumed unprovisioned" — treating a live integration as fresh (Twilio, 2026-08-09)

- **Symptom:** A plan defaulted to treating a third-party integration as **fresh/unprovisioned** — e.g.
  framing the operator SMS surface as needing new `TWILIO_OPERATOR_*` secrets the owner must paste, when
  the platform's **master Twilio account already exists and phone calls already work today**. (Twin of
  the voice #24 miss: the app was already using a *different* voice system, yet a session assumed it had
  to stand one up.)
- **Root cause:** Reaching for "set it up from scratch" without first checking whether the platform's
  actual behavior proves the credential already exists. If calls/SMS already work, the Twilio creds are
  already set.
- **Rule (§30 diagnose-first):** Before asking the owner for a credential paste, **check the platform's
  actual behavior** — *is X already working? then the credential exists; find it, don't ask for it.* Only
  a genuinely new value (e.g. the A2P Messaging Service `MG…` SID) is worth a `⚠ verify-whether-already-set`
  — and even that gets verified before an ask, never assumed missing.

## 10. Sub-account treated as an agency — the four-times seam bug (§51)

- **Symptom:** A sub-account owner lands on the `/agency` operator dashboard, or sees the parent's
  aggregate data; the same tenant-tier seam bit four times in a month (#86→#130→#172→#588).
- **Root cause:** Crews build on one tier and verify on one tier, never checking the others. A
  child tenant mis-modeled `account_type='agency'` (or carrying a stray `agency_team_members` row)
  resolves as an agency manager.
- **Rule (§51):** A sub-account is **structurally** never an agency (child ⇒ NOT `agency`/
  `enterprise`), locked at the DB layer (CHECK + trigger + `agency_current_id` guards). Every
  tenant-scoped change runs the **six-tier matrix** (God/Agency/Standalone/Sub-account/Client/
  Anonymous) pre- and post-deploy, and post-deploy-walks a tier you did **not** build on.

## 11. "Migration-only PR can't fail `verify`, so it's flaky" — a misdiagnosed real failure (§13, PR #437)

- **Symptom:** A migration-only PR's `verify` check went `failure` with an **empty** output
  summary. Assuming a migration touches no frontend, the failure was called a "phantom flake" and
  re-triggered with an empty commit — twice — instead of read. The empty check-run `output` (a
  GitHub App quirk) reinforced the wrong "nothing really failed" read.
- **Root cause:** `verify` is ONE job that bundles the **migration** regression-lint (`npm run
  ci:regression`, which scans `supabase/migrations/**`) alongside the frontend steps. A migration
  PR absolutely can fail it. Here the real cause was line-oriented: `scripts/ci/regression-lint.mjs`
  flags any ADDED line with `USING (false)`/`WITH CHECK (false)` that lacks `restrictive` **on that
  same line** — the policy WAS `AS RESTRICTIVE` but spread across 3 lines, so the modifier sat on
  the line above the deny clause and the lint couldn't see it. Fix: collapse so `AS RESTRICTIVE` and
  the `USING/WITH CHECK (false)` share one line (semantically identical, lint-visible).
- **Rule:** **Never label a CI failure "flaky" without reading the failing STEP's logs.** The
  check-run `output` is often empty; the truth is in `get_job_logs` — grep the full log for
  `##[error]` and the step group above it. A red check is real until its own logs prove otherwise;
  an empty summary is not proof. And a multi-line `CREATE POLICY … AS RESTRICTIVE … USING (false)`
  trips the line-oriented regression-lint — keep `AS RESTRICTIVE` on the deny-clause line.

## 12. Availability-by-accident — a tier-universal feature hidden by an empty-book gate (§56, task #99)

- **Symptom:** The tenant Systems Check showed on Mogul Maker Academy but not on several fresh
  sub-accounts. Owner reported it as a tier bug ("Paige thinks it's a solo account still").
- **Root cause:** NOT tier classification. `<SystemsCheckTile scope="tenant" />` was mounted INSIDE
  the non-empty branch of `PracticeOverview.tsx`'s `{emptyBook ? … : …}` conditional (`emptyBook` =
  0 clients + 0 attention + 0 approvals), so every freshly-provisioned tenant — solo OR sub-account —
  rendered only the "blank canvas" and never the check. Academy has clients so it showed. A
  capability meant for *every* tenant was hidden by an incidental empty-state gate; the agency's own
  default landing (`/agency`→`AgencyBoard`) never carried the tile at all.
- **Rule (§56 — new doctrine):** Before building/placing anything, check `docs/doctrine/tier-matrix.md`:
  (1) name which account type(s) it's for; (2) decide per-tier whether it belongs. A feature meant
  for "every tier" must render on every tier **regardless of empty-book/branch/route accident** — an
  empty account needs a setup check *most*. Fix mounted the tile ABOVE the empty/non-empty split
  (`PracticeOverview`, solo + sub-account) and added it to `AgencyBoard` (agency), matching the
  operator tile on `OperatorCommandCenter` (God).

## 13. `activeTenantId` on an OPERATOR surface can be a CHILD — tenant-scoped tiles leak (§9/§51, Codex P1 on PR #434)

- **Symptom:** the own-business Systems Check tile added to `AgencyBoard` (`/agency`) could show a
  *sub-account's* check as the agency's own, and let the agency approve the child's remediation from
  the agency dashboard.
- **Root cause:** on `/agency` the operator may still be scoped INTO a child (e.g. Back after
  `agency_enter_subaccount`); `AgencyLayout` preserves eligibility, so `useTenantContext().activeTenantId`
  is the CHILD id. A `scope="tenant"` tile trusts that ambient id → cross-tenant surface + action. The
  §39 adversarial verifier and the §5 compliance officer both MISSED it (they reasoned "activeTenantId
  here is the agency parent" from the happy path); Codex's independent read caught it — a live example
  of §39's "peer-gate is one layer, not infallible."
- **Rule:** On any OPERATOR/agency surface, never trust ambient `activeTenantId` for a tenant-scoped
  tile/action — it can be a child. Guard on the §51 invariant (own top-level tenant:
  `parent_tenant_id === null` AND `account_type ∈ {agency,enterprise}`) or resolve the intended tenant
  explicitly. Add "does this surface ever hold a DIFFERENT tenant in context than the one this
  tile/action is FOR?" to the §51 per-tier check. Third independent reviewer (Codex/CI) is worth
  keeping — it catches what the crew's own passes rationalize away.

## 14. SECURITY DEFINER = owner-run = RLS bypass; the grant is never the guard (§9, #117 / PR #448 — twin of the #116 view-drift lesson)

- **Symptom:** an authenticated `SECURITY DEFINER` function returns or mutates another tenant's rows —
  20 such leaks found across the codebase, incl. 1 HIGH total auth bypass.
- **Root cause:** a DEFINER function runs as its OWNER (postgres) and therefore BYPASSES RLS on every
  table it touches. That is safe **only if the function BODY enforces the caller's scope.** The leak
  class: a DEFINER data-returner/writer granted `anon`/broad-`authenticated`, keyed on a caller-supplied
  param, with no self/tenant/role guard. Three sub-patterns:
  - **(1) Global-role bypass** — `user_roles` has no `tenant_id`, so `has_role('admin')` /
    `has_any_role(...)` is TENANT-AGNOSTIC; a tenant-A admin can act on tenant B. Use
    `is_platform_owner()` / `is_platform_operator()` for cross-tenant authority (§53) and
    `is_tenant_admin(current_user_tenant_id())` for tenant scope — never the tenant-level app_role.
  - **(2) Param-IDOR** — never trust a caller-supplied `user_id`/`tenant_id`; gate on `auth.uid()` /
    `current_user_tenant_id()` (or validate the param `== caller` / `is_platform_owner`).
  - **(3) NEVER role-check a caller-SUPPLIED identity param** — `delete_credit_report_upload` role-checked
    a passed `_calling_user_id`, so any caller could pass a known privileged UUID = total auth bypass. The
    auth subject is ALWAYS `auth.uid()`; a passed actor is honored only on a service-role/trusted path
    (where `auth.uid()` is NULL).
- **Rule:** For every DEFINER fn that returns/mutates data, run the A/B/C classification — A=SAFE (body
  enforces scope, keep DEFINER); B=convert to `security_invoker` (DEFINER unnecessary — only touches
  tables the caller already has RLS on); C=fix in place (DEFINER needed but the guard is missing/broken —
  add the exact self/tenant/role predicate + REVOKE `anon` where over-broad). Ask: *"does the BODY
  re-enforce who the caller is (self / tenant / operator role that RAISES), or is it trusting the EXECUTE
  grant, a caller-supplied id param, or a tenant-agnostic global role?"* If the grant is the only guard,
  it isn't §9-safe. **Anti-recurrence:** `lint:definer-fns` CI guard (`scripts/ci/definer-fn-lint.mjs`)
  fails any migration granting a new public DEFINER fn to `anon`/`PUBLIC` without an inline
  `-- definer-anon-exempt: <reason>` escape. Twin of the #116 view-drift lesson (`lint:views`).

---

## 15. Naming-debt — one internal route overloaded across account types (§65, `/admin`, 2026-08-17)

- **Symptom:** the agency owner kept reporting he "lands on the same landing page" no matter what — and
  a whole night of credits went to chasing routing that "keeps going in the wrong direction." Sub-account
  vs Solo vs Agency vs God all felt indistinguishable at login.
- **Root cause:** ONE internal route — `/admin` — was the login target for FOUR distinct user mental
  models (Solo, Sub-account, Agency, God). Because the URL couldn't say *whose* surface it was, the
  router (and the human) had to infer the account type from session state, and any miss (e.g.
  `resolveAgencyLanding` sending an agency owner to the OLD `/agency` surface unless
  `agency_login_default='last_account'`) read as "same page again." The defect was in the NAME, not the
  auth: `/admin` carried four meanings, so no amount of routing logic could make it self-evident.
- **Rule (§65):** every human-visible name — URL path, tier label, nav word, landing route — maps to
  **how the user thinks about the surface**, one name per mental model, never to the internal router tree
  or DB column. The fix is one route per account type named for WHO is there
  (`docs/doctrine/route-and-url-taxonomy.md` §2a: `/operator` · `/agency/{account}` ·
  `/enterprise/{account}` · `/solo/{account}` · `/business/{account}` · `/portal/:tenantSlug`). The name
  READS; session-derived scope + `getTierFeatureSet()` still ENFORCE (the address is never the grant,
  §9/§51/§60). Migration stays redirect-safe (§58 — old routes never 404) and staged; the taxonomy +
  migration order are owner-reviewed BEFORE any code rename. **The three anchoring naming-debt cases:**
  (a) **Solo vs `standalone`** — marketing "Solo" ≠ internal `account_type='standalone'` (task #67); the
  user never types "standalone." (b) **Enterprise-in-name vs `account_type='agency'`** — "Project Mogul
  Enterprise" is an AGENCY (owner: "PME is NOT an Enterprise account 😂"); the name misled a session into
  reading it as the Enterprise tier. (c) **`/admin` 4-way overload** — this lesson. Ask: *"would a human
  who's never seen our code know from this name whose surface they're on and what they can do — and does
  this name mean exactly ONE thing?"* If it only makes sense from the inside, or it's overloaded, it's
  naming-debt.

---

## 16. State-driven tabs = no addressable branches = Paige can't orchestrate (§65 tree, 2026-08-17)

- **Symptom:** the owner asked why Paige couldn't "find the growth branch on that sub-account" and why
  every tab in the new shells had no URL (refresh always snapped back to Command Center, nothing
  bookmarkable). Deeper: "how are we routing data inside a brain and orchestrating a machine when we don't
  have any actual branches of data?"
- **Root cause:** the new tier shells (`src/agency/AgencyApp.tsx`, `src/solo/SoloApp.tsx`) switch tabs with
  a `useState` (`const [route,setRoute]=useState('command')` + `screens[route]`), importing nothing from
  react-router. Each "tab" is in-memory state, not a URL. So no section is addressable — and an
  interaction surface whose sections aren't addresses gives the §8 action bus, the §16 departments, and
  the §37 producer inventory **nothing to point at**. "Route data inside the brain" has no coordinates.
  (Contrast: the legacy `/admin` console is already real nested routes — the proven pattern.)
- **Rule (§65 tree architecture):** every interaction surface's sections must be **real URL branches**,
  not `useState`. The route tree is the addressing SPINE — an address IS a data route (`/business/{n}/growth`
  is a handle Paige routes to/from, a §10 callable seam, an §8 action-bus target owned by a §16 department,
  a §37 producer address). Design it as a **declarative per-tier registry** (`TIER_BRANCHES`, §18 one home)
  cloned per account at signup, rooted at `account_number`. Convert state→routes, never ship state-tabs on a
  surface Paige must orchestrate. Full design: `docs/doctrine/route-and-url-taxonomy.md` §10–§15.

---

## Standing bars — owner-locked doctrine (2026-08-11)

Three sections ratified by the owner (drafted PROPOSED overnight in #449, locked morning 2026-08-11). Binding on every future PR.

- **§57 — Super Admin = source of truth (source-of-truth architecture).** Every tenant/agency surface
  DERIVES from what the God-level (Super Admin) record says is real — one record of truth, many
  read-only projections. Two surfaces showing different "truths" for the same tenant is a §57 defect
  (usually a §51 tier bug underneath), not a display quirk. Anchor cases: Fleet Console stale MRR on
  $0-paid tenants; a tenant misclassified `SUB_ACCOUNT` vs God-level topology; operator Analytics
  emptier than a tenant projection. *Test: does this surface derive from the God-level record, or compute
  its own answer that can diverge?*
- **§58 — Anti-regression (anti-regression discipline).** Twin of §28. A shipped, owner-approved
  capability is NEVER silently removed/hidden/gated-off in a later PR. If a change removes/hides one,
  call it out explicitly + get owner sign-off before merge — even on a PR nominally about something
  else. **§39 verifier checklist now carries a standing item: *"Did this PR silently remove any
  previously-shipped capability?"*** — a "yes" with no explicit flag + sign-off blocks the merge.
- **§59 — SECURITY DEFINER caller-scope-in-body (Postgres security posture).** A DEFINER function
  bypasses RLS; safe ONLY if the body re-enforces caller scope (self / `current_user_tenant_id()` /
  operator role that RAISES) — the EXECUTE grant is never the guard. The global-role trap (§53):
  `has_role('admin')` is tenant-agnostic; cross-tenant authority is `is_platform_owner`/
  `is_platform_operator`. Never role-check a caller-SUPPLIED identity param. Enforcement is LIVE:
  `lint:definer-fns` CI guard + `pg_proc` drift advisor (shipped #117/PR #448). See Lesson #14 for the
  full A/B/C classification.

- **§60 — structural tier-lock over text-only doctrine (owner-named drift class).** When an owner has
  re-stated a discipline across sessions and keeps catching drift, the correct response is a STRUCTURAL
  enforcement primitive (§18 one home + CI guard), NOT a text-only rule that relies on humans/agents
  remembering. `getTierFeatureSet()` + `lint:tier-features` is the tier-lock equivalent of #116's
  `security_invoker` + `lint:views` and #117's DEFINER caller-scope + `lint:definer-fns`. **Rule:** if the
  owner has said it 3+ times and it keeps drifting, structurally lock it — don't wait for the next
  violation. Corollary to §18 "don't scaffold": a structural anti-recurrence primitive for an owner-named
  drift class is NOT "scaffolding a non-problem" — it is the fix. (Anchor: task #122; the §18-grounds
  deferral was explicitly reversed by the owner, master §10 correction #7.)
- **§37/§60 — a lock that gates N of N+1 producers is not a lock (enumerate ALL minters).** The #122
  build gated 4 of the 5 surfaces that mint a consumer-portal token and reported the lock closed; the §39
  peer-gate found the 5th (`WorkspaceSettingsPanel`, on the UNIVERSAL Setup surface) still fully
  functional on the excluded tier. **Rule:** when locking a CAPABILITY to a tier, run a §37 producer
  inventory on the underlying seam (here: every caller of `create_tenant_invite_token` with
  `_kind='consumer'`) and gate EVERY producer — "4 senders gated" GREENs the diff while the capability
  is still reachable. The peer-gate (§39) exists to catch exactly this; a build's own self-report doesn't.
- **§13/§60 — don't let a UI gate's comments claim SERVER enforcement.** A build-time/UI tier lock (helper
  + lint) is real, but it is not the server auth boundary (§9). If the server RPC doesn't yet tier-gate,
  the in-code comments must say the lock is UI-only, not "structural / server-enforced." (Anchor: #122
  `customer_portal_invite` — `create_tenant_invite_token` did not gate `_kind='consumer'` on
  `account_type`; corrected in the helper header before ship. **UPDATE #125: the server gate then landed —
  migration `20260823000000`, §32.a-proven — so `customer_portal_invite` IS now server-enforced. The
  lesson stands for the NEXT UI-only lock: state honestly whether the server backs it.**)
- **§13/§0 — ground "customer risk" against CURRENT state before deferring (correction #8, 2026-08-11).**
  Before invoking "we might break a legitimate <tier> customer" to defer a change, VERIFY that customer
  class exists in current state — query the `tenants` table / master §4 SHIPPED / this brain. Hypothetical-
  customer risk is not real risk when the class has zero members. Pre-MVP, **Enterprise has zero customers**,
  so every "we might break Enterprise" deferral was hypothetical drift (it deferred the #125 server gate for
  no real reason; owner reversed it). Real classes today: Solo + Sub-account + Agency + Super-Admin operator.
  Rule: verify customer existence FIRST; defer only on real-customer risk.

- **A shared component's LOCAL state forks the moment a second mount exists (2026-08-19).**
  *Symptom:* the operator console mounts Paige twice (Paige branch + ✦ slide-out) and CD's own footer
  promises *"Same brain as the Paige tab — one thread, two doors."* *Root cause:* `PaigeAIChat` held
  `activeThreadId` in local state, so the second mount's first send called `ensureThread` and inserted
  a **new thread row**. It LOOKED fine because navigating unmounts the tab and it re-resumes the newest
  thread. *Rule:* before mounting a stateful shared component twice, make the shared selection a
  CONTROLLED prop held above both mounts (`undefined` = uncontrolled and byte-identical for legacy
  callers; `null` = no selection — the two must stay distinct). **And move the "already showing this"
  early-return off the selection onto what is actually HYDRATED** — in controlled mode the parent has
  already moved the selection before the load, so an `id === activeThreadId` guard bails and the
  content never arrives. This recurs the instant any other tier gets a second Paige door.

- **Correct code that renders NOTHING, silently (2026-08-19).** *Symptom:* the Fleet Console 3D field
  drew zero nodes in production while `tsc` and `vite` were green; three sessions guessed at it.
  *Root cause (the real one, after a zero-height red herring):* `withAlpha()` turned modern
  space-separated `hsl(H S% L%)` into `hsla(H S% L%, A)` — mixing legacy and modern CSS colour syntax.
  Browsers reject it, so **every** `addColorStop`/`fillStyle` threw or no-oped. Correct form is the
  slash syntax `hsl(H S% L% / A)`. *Why it stayed hidden:* the error boundary rendered `null` with no
  `console.error`. *Rule:* §32 — a green build proves types, never render. Crash-prone runtime logic
  (canvas/WebGL/parsers/samplers) gets LOUD failure (`console.error` **and** a visible message) plus
  event-driven sizing (`ResizeObserver`), never `getBoundingClientRect()` re-measured in a paint loop.
  Making the failure visible turned a multi-session guess into a one-line fix.

- **Two disagreeing numbers usually hide a real defect — don't "fix the copy" (2026-08-19).**
  *Symptom:* Systems Check said *"10 checks"* in one place and *5* in another; both offered remedies
  (wire 5 more / change the wording) were wrong. *Root cause:* ten checks DO run — `pass 4 + fail 1 = 5`,
  so **five SKIP every hour**, including `operator_cross_tenant_canary`, a **blocking** check that has
  never run (an unassessed §9 cross-tenant blind spot). A 4/5 ratio silently drops the skips and
  flatters the surface. *Rule:* when two numbers disagree, **query the rows and find out why** before
  changing either. Render `4 of 10` + *"5 could not run"*, and name each skip and its reason.

- **Don't declare a capability missing off one narrow grep (2026-08-19).** *Symptom:* a first pass
  grepped two edge functions for one keyword and reported Paige's brain as barely built. The owner
  pushed back — *"can we do a search on her brain if you're not seeing it? We spent a little time
  developing some form of a brain for her."* *Root cause:* the brain is FOUR layers under different
  names (`owner-context.ts` §52 context · memory fabric + `paige_prompt_memory` · `paige-context-router`
  for per-contact scope · `paige-mcp` tool registry), and none of them contain the searched keyword.
  *Rule:* search by ARCHITECTURE (migrations, `_shared/`, edge-fn names) before concluding something
  is unbuilt — and see `paige-brain-wiring-standard.md` §2, which now names all four layers so the next
  session doesn't repeat the search. The narrow finding *was* right (Systems Check is unwired); the
  characterisation of the surrounding system was not.

- **The "Supabase Preview" check fails on a PRE-EXISTING bootstrap collision — NOT on your migration
  (2026-08-19).** *Symptom:* any PR touching `supabase/**` gets a red **Supabase Preview** check:
  `ERROR: relation "profiles" already exists (SQLSTATE 42P07) At statement: 7 — CREATE TABLE
  public.profiles`. It reads like the PR's migration broke something. *Root cause:* the preview branch
  replays the ENTIRE migration history from scratch, and **two of the oldest migrations both create
  `public.profiles` unguarded** — `20250908112334_remote_bootstrap.sql:27` (`uuid_generate_v4()`, no UNIQUE) and
  `20251009234919_3d7566f7-…sql:11` (`gen_random_uuid()`, `user_id` UNIQUE) — neither uses
  `IF NOT EXISTS`. The replay builds the table from the first and dies on the second, roughly 200
  migrations BEFORE anything a current PR adds. `At statement: 7` is the ZERO-INDEXED statement
  *within that migration file* (seven `CREATE TYPE`s precede it), not the 7th statement of the run —
  do not read it as "it failed almost immediately". Prod is unaffected because it applied these incrementally against its own `schema_migrations` ledger and
  never replays. *Rule:* when this check goes red, **read the failing statement before assuming it is
  yours.** If the SQL quoted is not in your diff, it is this. Verify with
  `grep -rln -- "-- Create profiles table" supabase/migrations/`. The decisive proof on #554: pushing a
  **markdown-only** commit reproduced the identical failure — a commit that touches no SQL at all cannot
  break a migration. It is invisible on PRs with no `supabase/**` change (the integration skips them),
  which is why it can look new.
  **Standing risk (owner decision owed):** every future migration-carrying PR will show this red, which
  trains everyone to ignore a check — the classic route to missing a real one. The fix is either
  guarding those two bootstrap `CREATE TABLE`s or turning the preview integration off; editing historical
  migrations is not a thing to do casually mid-fire.

  **RESOLVED 2026-08-30 by #643 (`ba6c038c`, "restore fresh-database replay of the committed history"),
  confirmed 2026-09-01 — the standing risk above is CLOSED and needs no owner decision.** #643 took the
  first of the two options: `20251009234919_…sql:11` now reads `CREATE TABLE IF NOT EXISTS
  public.profiles`, and the bootstrap file was rewritten (50 insertions, 90 deletions). A sweep for an
  unguarded `create table public.profiles` across every migration returns **nothing** — all guarded.

  Measured on #721: Supabase Preview completed **Configurations ✅ → Migrations ✅ → Seeding ✅ →
  Edge Functions ✅** on four consecutive runs across three heads. The failure this entry describes no
  longer reproduces.

  **Two places still assert the old state and are now WRONG:**
  - `.github/workflows/ci.yml` (the deno-ratchet block) — *"the migration replay, which fails on every
    PR (#211) — observed: Configurations ✅ → Migrations ❌ → Seeding ⏸️ → Edge Functions ⏸️, so it never
    runs."* Corrected in this commit. **The gate itself is untouched and stays:** the deno ratchet
    compares the PR BASE against the HEAD and fails only on NEW diagnostics, which Preview has never
    done and still does not. Only the stale justification changed.
  - The paragraph above, corrected here rather than deleted (§58).

  *Rule this leaves behind:* **a "standing risk, owner decision owed" is a claim with a shelf life.**
  This one was fixed by an unrelated PR eleven days later and stayed on the books as an open owner
  decision because nothing re-checked it. When an entry says a decision is owed, the cheapest thing to
  do before escalating is re-run the check that produced it.

- **A CONFLICTED PR silently suppresses every `pull_request` workflow — that is NOT "Actions is broken"
  (2026-08-19).** *Symptom:* PR #554 showed only Vercel + Supabase checks. No `ci`, no `lint`, no
  `verify`, no `prove`. A stale plan note said "GitHub Actions has not run on this repo since
  2026-08-18 21:10 UTC", and that got repeated to the owner **twice** as "an account-level Actions/
  billing setting only you can fix." *Root cause:* GitHub runs `pull_request`-event workflows against
  `refs/pull/<N>/merge`, which **does not exist while the PR has merge conflicts**. #554 was created
  already conflicted (main had moved at 21:03 via the squash-merge of #553), so every commit pushed
  to it produced zero Actions runs. The instant the conflict was resolved, all four jobs fired within
  seconds. Actions had in fact been running all day — `ci.yml` alone had 8 successful runs that
  afternoon (18:12, 18:29, 18:44, 18:56, 19:20, 19:23, 19:33, 21:03). *Rule:* **"no workflow runs on
  this PR" is a symptom with two very different causes — check the PR's mergeability BEFORE concluding
  anything about Actions health.** Verify with `list_workflow_runs` on the repo (does ANY branch have
  recent runs?) rather than inferring repo-wide state from one PR's check list. And never escalate an
  infrastructure claim to the owner off a plan-file note without re-verifying it — a stale "honest
  limit" repeated confidently is indistinguishable from a fresh finding, and it burns the owner's time
  on a non-problem. Related trap: `deploy-migrations.yml` only triggers on pushes to `main` that touch
  `supabase/migrations/**`, so an idle run history for it is normal and is NOT evidence of a broken
  pipeline either.

  **THIRD OCCURRENCE, 2026-09-01 (#721) — and the lesson above did not prevent it.** Same symptom,
  same wrong conclusion, same escalation: I told the owner it might be "an Actions incident, a
  spending/quota limit, or a repository Actions setting", and that a spending limit "would need the
  repository owner." `GET /pulls/721` returned **`"mergeable_state": "dirty"`** the whole time. The
  branch was cut from `60f42210` and main moved to `1b50aa86` (#720), which edited the same regions
  of `package.json` and `.github/workflows/ci.yml`; `refs/pull/721/merge` therefore never existed.
  Merging main in and resolving one conflict fired `ci` and `Security Audit` within seconds.

  **Why the existing lesson did not fire: I never read it.** I diagnosed live, from the API, and
  never searched the lessons file for the symptom — the §BRAIN.1 read-before-work step, skipped
  precisely because the investigation felt like it was going well. A lesson only works if something
  makes you open it, and "no workflow runs on my PR" is that trigger.

  **The tell that makes this cheap to falsify, hoisted so it cannot be missed:**

  > **Before saying one word about Actions health, run `GET /pulls/<N>` and read `mergeable_state`.
  > `dirty` means conflicted, which means no `pull_request` workflow can be scheduled. It is ONE
  > call, and it settles the question.**

  **Also recorded, because it is how the wrong answer got its confidence:** I supported the claim
  with "no runs repo-wide since 16:16Z", which was *true and meaningless* — nothing else had been
  pushed since #720 merged at 16:16. **A quiet CI is not a broken CI.** Evidence of absence is only
  evidence when something should have been present, and the check for that is whether anything was
  pushed, not whether anything ran.

- **A check that has never failed is an untested branch, not evidence — negative-control every guard
  (2026-08-23).** *Symptom:* the Super Admin design pack's compiled `standalone.html` had been swept for
  §50 marks and format-valid identifiers on every delivery, always clean. *Root cause:* the standalone
  stores its payload as a **gzip+base64 `__bundler/manifest`**, so a plaintext `grep` across the file was
  reading compressed bytes. It could not have found a mark if one were there — the sweep was structurally
  incapable of failing, and its green was pure noise. The same session produced a second instance of the
  identical class: the screenshot tool selected the theme toggle by matching its label, but the label names
  the **current** theme rather than the target, so 64 frames were captured and captioned with inverted
  themes before anyone noticed. Both passed. Both proved nothing. *Rule:* **before trusting a guard's
  green, make it go red on purpose.** Every checker gets a negative control — feed it the thing it is
  supposed to catch and confirm it fails. For anything that inspects a compiled, bundled, minified or
  compressed artifact, **unpack first and assert the unpacked content matches its source**; a substring
  search over an opaque blob is not a check. For anything that sets state before observing (a theme, a
  route, a feature flag), **read the state back and refuse to record a result you cannot confirm** rather
  than assuming the setter worked. `scripts/live-drive/pack-verify.mjs` (`npm run verify:pack`) is the
  worked example: it gunzips the manifest, asserts each bundled asset is byte-identical to its source file,
  then sweeps the decompressed text — and both arms are negative-controlled in the commit that added them.
  *Second-order trap from the same investigation:* plaintext-matching source literals against that opaque
  blob scored 2/40, which nearly became a confident report that the vendor's artifact was not a build of
  our source at all. It was byte-identical once unpacked. **A measurement you do not understand the
  encoding of produces a number, not a finding** — unpack before you accuse.

- **A screenshot is not a test — and a comment is an assertion (2026-08-23).** *Symptom:* three
  separate things read as verified without having been verified — an audit log labelled
  `immutable · Live` when append-only was only a GRANT; screenshot frames captioned with a theme the
  tool never read back; a hard reload defended by a comment that had been false since 2026-07-28.
  *Root cause:* in each case the confidence of the artifact is what stopped anyone re-checking it.
  *Rules:* **derive it or verify it, never assert it** — and a comment justifying a mechanism should
  **name what it depends on**, so the day the dependency changes the comment becomes falsifiable
  rather than merely old. Second half, found while building the design harness: **four of five defect
  fixtures render byte-identical** — a missing `min-width:0` with nothing to provoke it, a sub-AA
  colour on small text, and content below the fold all look the same at viewport scale. So **the
  assertions are the evidence; the frame is only the record.** Never review a clean-looking frame and
  conclude the checks passed. A human eye catches geometry, proportion, rhythm, type and colour
  relationships; it cannot catch an unprovoked min-width defect or 4.3:1 vs 4.5:1.

- **A gitignore matching one spelling of a path protects a coincidence (2026-08-23).** *Symptom:*
  five PNGs committed into a docs-and-tooling branch. *Root cause:* the harness resolved its artifact
  directory from `cwd`, so running its selftest from a subdirectory wrote a nested
  `scripts/live-drive/artifacts/` tree that the ignore rule — which names the real path — did not
  match. *Rule:* **a tool's output location must not depend on where it was invoked from**; resolve
  from `import.meta.dirname`. And read the staged file list before pushing, not after.

- **A bug in its JURISDICTION, not in the mechanism (2026-08-23).** Four instances in one session,
  and none was a broken mechanism — each was a competent mechanism pointed at something it did not
  own. That is why they survive review: they read as correct, because they are, just about the
  wrong subject.

  | Instance | Correct about | Claimed authority over |
  |---|---|---|
  | Audit log labelled `immutable · Live` | that append-only was intended | a DB guarantee that was only a GRANT |
  | Harness asserting slot geometry | the five properties worth checking | an IA it would have been *handed* rather than read |
  | Test requiring absence body length + banning "coming soon" | constraints on a CC draft | how a **design-owned surface** reads |
  | Design screen map: Catalog/Sales have "no repo substrate" | the surfaces and their contract | **the contents of a repo the design side cannot see** |

  The pattern runs in BOTH directions — the fourth is a design artifact reaching into
  implementation, the third an implementation test reaching into design. So the question is not
  ownership-of-role, it is scope-of-claim.

  **The question to ask of any new guard, test, label, or doc claim:** *what does this claim
  authority over, and do we own that?* "Is it correct?" does not catch this class, because the
  answer is usually yes.

- **A one-sided negative control proves agreement, not derivation (2026-08-23).** A contract test
  that reads a source and compares must be falsified from BOTH sides. Editing our copy and watching
  it fail proves only that the two agree today. Editing **the source** and watching it fail is what
  proves the test is reading the source rather than agreeing with itself — a test that had silently
  stopped reading the file would pass the first control forever. Applies to every contract test:
  the IA-vs-pack slots test, the absence-copy test, and any that follow.

---

## A subtab canvas is not a second page shell (2026-08-28)

**Symptom.** A feature-rich subtab design accumulated a route title, status copy, and banner-like
chrome beneath an already complete Clients shell. The extra context looked helpful in isolation but
made the real constrained workspace feel crowded and disconnected from its sibling tabs.

**Rule.** Establish the exact visual ownership rectangle before composing a subtab. For Solo Clients,
the shell owns account context and `People · Conversations · Calendar · Portal`; Conversations owns
only the bounded canvas below it. Keep relationship and provider truth inside the operating workspace,
not in another hero. Protect the boundary with rendered checks and explicit forbidden-copy regressions.

---

*When a new class of mistake costs real time, add it here (symptom → root cause → rule) in the same
commit as the fix — a lesson only helps if the next session can find it.*

## service_role grants are invisible to every pre-merge check we run (2026-08-20, second occurrence)

**The class.** A `BEGIN..ROLLBACK` proof runs as the table OWNER. A headless smoke over pure logic
never touches the database. So a missing `service_role` grant passes every pre-merge gate and only
fails at runtime — where, if the calling code swallows the error, it fails *silently and plausibly*.

**First occurrence:** hotfix #94, the `paige_systems_check_*` family — caught by a §32.c live drive.
**Second occurrence:** A2's alerting evaluator, caught by the §32.a post-merge scan.
`tenant_revenue_classification` had NO service_role grant at all (only `authenticated` and
`postgres`), and `readTenantsAtRisk` destructured the error away — `{ data: revenue }` — so the
permission denial produced an empty classification map, which read as "no tenant is internal", so
the platform's own fixtures counted as at-risk CUSTOMER tenants. A silently inflated number in the
signal whose whole job is to be trusted.

**Why it is worth a lesson and not just a fix.** A2's own module header states the rule it broke:
*a reader that cannot produce a real number returns unreadable, never 0*. The rule was written and
then violated three functions below, because the failure arrived as an empty array rather than a
thrown error. **An exclusion list that failed to load is not an empty exclusion list.**

**Standing checks when adding an edge-function read of a table the function has not read before:**
1. `select has_table_privilege('service_role','public.<table>','SELECT')` on prod — before merge, not after.
2. Destructure and check `error` on EVERY supabase read. A `{ data }`-only destructure is the bug.
3. Ask what the empty/default value MEANS downstream. An empty filter list that silently disables a
   filter is the dangerous shape; a count that silently reads 0 is the same class.

- A UUID default is not a complete identity contract. Every producer must converge on a required immutable tenant binding, and an AI-facing lookup must return a stable human reference while resolving the internal UUID only inside a server-validated tenant boundary. A service-role query with an ID filter is not tenant safety unless the tenant predicate is present in the same query.
---

## A green proof can be wrong in the direction that flatters you — and a red one can be the finding

**2026-09-01, MET1 (metering).** A rollback proof's case P6 asserted that every metered usage row
carries a cost, and it **failed**. The reflex — and the wrong move — was to loosen the assertion so
the suite went green. Diagnosing it instead surfaced the real defect: **197 of 228 traces (86%, and
99.3% of tokens) had never been priced at all.** The direct `_shared/claude.ts` path had the
provider's own `usage` object in hand at its trace site and never priced it, while `model-router`
priced everything it touched — so the platform's belief that it had spent `$1.38` was the cost of
0.7% of its tokens.

**The rule:** when an assertion you wrote fails against real data, the first hypothesis is that the
assertion is right. Loosening a check to match observed behaviour converts a finding into a
silence, and does it in the direction that makes the report look better.

## `->>'key' IS NULL` cannot tell "explicitly null" from "key absent"

Same slice, and the sharper half. P6b was written specifically to catch the `jsonb_strip_nulls`
defect that P6 had just exposed — and it **passed under that exact mutation**, because
`metadata->>'cost_estimate_usd' IS NULL` is true both when the value is JSON null and when the key
was never written. A check vacuous against the one thing it was built for.

Compare `metadata->'key' = 'null'::jsonb` (explicitly null) or `metadata ? 'key'` (present at all).
The distinction is load-bearing whenever absence has meaning: a consumer must be able to read *"no
cost was recorded"* rather than infer it from a missing field — and must never meet a downstream
`COALESCE(cost, 0)` that books unpriced spend as free.

**Generalised:** any assertion about ABSENCE must state which absence it means. Three different
facts — the key is missing, the value is null, the value is zero — collapse into one answer under
`->>`, and the collapse is invisible in a green run.

## A fixture missing one method makes a dead code path look healthy

`traceLLMCall` ends `.insert(record).abortSignal(signal)`. The recording fake had no `abortSignal`,
so the chain threw a TypeError straight into the writer's own swallowing catch — and the row, which
the fake records one link earlier at `.insert()`, still satisfied every assertion written about it.
Every check about the trace's contents passed while the write path they were grading was dead.

**The tell:** a harness that records at the START of a builder chain proves the chain was BEGUN, not
that it completed. Where a swallowing catch sits downstream, assert something only the END of the
chain produces. This is the third time this session that a component failing soft has looked
healthy — the others being vector reads returning `[]` and a drain worker reporting 30,375
successes over a queue that never empties.

---

## A reused migration version does not fail — it is silently SKIPPED

**2026-09-01, merging main into a long-lived branch.** `schema_migrations` is keyed on the VERSION
alone. When a version is already recorded, `supabase db push` does not error and does not warn: it
skips the file. The migration merges, CI is green, the `db-live` tag advances, every badge reads
healthy, and the migration **never exists on production**. The first sign is whatever breaks weeks
later, in a place that looks unrelated.

**Three collisions arrived in one merge, and only one was reported.** The Supabase preview stops at
the first duplicate-key error, so it named `20261018000000` and nothing else. Fixing what it named
would have left two behind and looked resolved:

| version | this branch | already taken by |
|---|---|---|
| 20261018000000 | `chat_turn_append_tenant_scope` | main's `secret_read_keeps_its_approvals` |
| 20261019000000 | `credit_extraction_review_state` | main's `solo_setup_business_brief` |
| 20261020000000 | `tool_autonomy_catalogue_covers_the_gate` | **prod's** `primary_number_is_always_active` |

**The third is the shape nothing in the repository can see.** It has no duplicate filename anywhere
— its twin exists only in production's ledger, applied from a branch that is not merged. Scanning
the tree for repeated prefixes finds nothing. Comparing against the base branch finds nothing. Only
querying `supabase_migrations.schema_migrations` finds it.

**Three checks, and each misses what the others catch:**
1. duplicate filenames in the tree — misses both merge shapes;
2. versions the branch ADDS vs the merge base — misses the production-only twin;
3. the live ledger — catches all three, needs credentials CI does not have.

`lint:migration-versions` does 1 and 2 offline and **says in its own header that it cannot do 3**.
The pre-merge check for the third shape is a query against the ledger, and it belongs in the §32.a
persisted-apply confirmation. A guard trusted for more than it checks is worse than no guard.

**The fix is always to rename the NEW file** to a free, later version. Renumbering the one already
applied orphans a live row.

**Before renaming, verify three things against the ledger**, or the fix creates its own defect:
the new name was never applied under its own name (or it re-runs); the replacement versions are
free; and the replacements sort after everything already applied and before the branch's own later
migrations, so ordering is preserved.

**This class was already on record.** The `20261004000000` collision with #666 is written up above,
with the line *"a migration version collision is invisible to every gate."* It stayed invisible
because nothing mechanical was added at the time — only the note. The lesson behind the lesson:
recording a failure class without building the check that catches it buys one session's memory,
not a guard.

### 2026-09-03, PR #810: the guard works. WHEN you run it is the variable.

Offer Catalog Slice 2A was renumbered **three times** — `…44` to the Rail, `…45` to Billing
Foundation A, `…48` to team-member removal (#845). The third one adds a dimension the shapes above
do not cover, and it is a timing dimension rather than a new shape.

The branch re-grounded on main and ran `lint:migration-versions` **clean at `20261048000000`**.
#845 merged afterwards, carrying that same version. Nothing about the check was wrong; the base
simply moved between looking and merging.

**The correction that matters, because the first write-up of this got it backwards.** It was
initially reported — and committed into the migration header and the tier matrix — that the guard
was *"structurally blind"* to this. Reading the actual `verify` log disproved it:

```
BASE_REF: 1a22637c3ea8fdaa195ad24e53cec582dbc7bcd5
✗ migration-version-collision-lint: 1 collision(s).
  two migrations share version 20261048000000 ...
##[error]Process completed with exit code 1.
```

CI passes the **real merge base** to the lint, so the guard caught it the moment #845 landed, and
`database-contract` caught it independently by replaying from zero. One root cause, both red
checks, no defective guard. What was blind was the **local** run, which compares against whatever
`origin/main` the working copy last fetched — and that fetch predated #845.

**So the operative rules are about process, not tooling:**
- A green **local** `lint:migration-versions` is a hint. **CI is the authority**, because only CI
  evaluates against the base you are actually merging into.
- Re-grounding at the END is necessary and **still not sufficient**. The base moves after you look
  at it. On a contended range, expect to renumber at merge time and pick the version LATE.
- A stronger pre-merge check, when it is worth the time, is to scan **every remote branch** rather
  than main: `for b in $(git branch -r ...); do git ls-tree -r --name-only "$b" supabase/migrations
  ...`. It found that only #845's and the Rail's migrations existed at or above `…48` across all
  423 branches. That is an *improvement* to a working guard, not a fix for a broken one — do not
  file it as a defect.

**And then I broke this entry's own rule, in the same session, having just quoted it.** The
version chosen that way — `20261050000000` — was genuinely free across every branch, and still
wrong. Production's ledger already carried `20261104000000`, `20261103000000` and
`20261102010000`, whose files this repository could not see at the time: **shape 3, named a few
paragraphs above.** Applying 50 would have put it behind three migrations already live. The
branch scan answers "is it free"; only `select max(version) from
supabase_migrations.schema_migrations` answers "does it sort after what is applied", and both
must hold. It was caught because another PR's commit message happened to mention prod's newest
version — luck, not method.

So the check before taking a version is **two queries, not one**:
1. free across the repo and every remote branch (the scan above), AND
2. **strictly greater than `max(version)` in prod's ledger** (an MCP query — the repo cannot
   tell you this).

The meta-lesson, which is the reason this paragraph exists at all: reading the rule is not
applying it. This entry was open in the same session, quoted in a commit message, and the very
next decision violated it — because the decision *felt* thorough (423 branches!) and thoroughness
in the wrong dimension reads exactly like rigour.

### 2026-09-03, a FIFTH collision — and the one that is not anybody's mistake

Slice 2B chose `20261107000000` against BOTH conditions this entry demands: free across every
remote branch, and greater than prod's `max(version)`. Both were true when checked. #850's
follow-up then merged carrying that exact version, and `database-contract` failed on the replay.

**This one had no available prevention, and saying so matters more than adding another rule.**
The check was correct when it ran and stale by the time the branch pushed. Five collisions across
two slices, five different owners, all inside the same choose-to-push window. That is a property
of a contended range, not a lapse — and treating it as a lapse produces exactly the wrong
response, which is more careful checking at a moment that is already too early.

What actually works:
- **Pick the version LAST**, immediately before the push that will merge, not when writing the SQL.
- **Expect to renumber at merge time** on a contended range, and budget for it rather than treating
  each instance as a surprise.
- **Let CI be the authority.** It evaluates against the real merge base, which is the only base
  that matters. Every one of the five was caught there or by the replay; none by a local run.

`20261110000000` was then chosen against prod's ledger max (`20261108030000`) AND the highest
version on any branch (`20261109040000`), and confirmed persisted after merge.

---

## Marking ready and merging in the same beat waives the peer-gate

**2026-09-03, PR #800, twenty seconds.** Marked ready at 14:09:21. Codex began reviewing that head
at 14:09:25. Merged at 14:09:45. The review had no window, and every previous round of it on this
program found something real — five findings on 2A, two of them cross-tenant exposure.

**This is #856's lesson, repeated by the person who had just read it.** That PR exists because #850
did the same thing, and its message says it outright: *"They landed after the merge because #850 was
marked ready for review and merged in the same beat, so the review had no window to run. §39 says a
green CI never waives the peer-gate — sequencing waived it just as effectively."* I read that text
while listing workflow runs, ten minutes before doing it again.

**The rule, stated as a sequence rather than a principle**, because the principle was already known
and did not help:

1. CI green on the exact head.
2. Mark ready.
3. **WAIT for the review to return.** Not "check whether one is running" — wait for the verdict.
4. Then merge.

**Why it is easy to miss:** the MVP cadence removes *approval pauses*, and "don't add pauses" reads
like "don't wait". It does not. An owner approval is a pause; an independent review is a gate. A
cadence that tells you to stop asking permission is not telling you to stop being reviewed.

**Second-order, and the reason both of today's entries share a shape:** two separate lessons were
open in front of me and violated within the hour — the version rule while quoting it, and the
sequencing rule while reading it. Familiarity with a lesson is not a defence against it, and may be
the opposite: the recognition feels like compliance.

## Waiting correctly still needs an exit — a dead reviewer is not a silent gate

**2026-09-03, PR #863, same session as both entries above.** Applied the sequencing rule from the
entry directly above it, immediately: CI green on the exact head, marked ready, then watched for
the verdict rather than merging. Codex's review ran and failed with an unknown error. Retriggered
with `@codex review` — ran and failed again, same error, ninety seconds later. Two failures on a
service the PR's own code never touches is a service outage, not a PR defect, and the general
pattern here is the same one §32's flake rule already states for CI: confirm with one retry, then
stop hammering a dead endpoint.

The difference from #800: nobody decided unilaterally to stop waiting. The owner was told plainly —
"Codex is down, both retries failed the same way" — and gave an explicit instruction to merge on
green CI alone. That instruction is what changed the state, not a judgment call that waiting had
gone on long enough. A peer-gate that cannot be satisfied because its reviewer is unreachable is
still a gate that was asked to open; the difference between this and #800 is which party decided it
could stay closed.

**The distinction worth keeping:** "the review didn't have time to run" (a sequencing choice, #800,
a violation) is a different failure than "the review could not run at all" (a service state, this
entry, reported and handed to the one person who can authorize proceeding without it). Merging
without a returned verdict is identical code in both cases — `merge_pull_request` doesn't know why
Codex is silent — so the thing that makes one a violation and the other correct is entirely outside
the diff: who decided, and on what evidence. That evidence should be preserved here rather than
assumed obvious in the moment, because "I checked and it seemed down" is not the same claim as "two
independent runs failed with the same error, ninety seconds apart, against code Codex had not yet
seen."

**And a second-order lesson, since this is the third time this branch wrote about the same event.**
Two of the three write-ups were wrong before they were right: the first blamed the guard, and an
earlier one blamed review. Diagnose from the log, not from the shape of the story you are already
telling — a failure that has happened three times is exactly when the narrative starts writing
itself ahead of the evidence.

---

## A predicate proof is not a write proof (2026-09-01, #695 → #699)

**Symptom.** A one-time backfill in `20260901010000` chose a primary phone number for any workspace
that had an active number and no *active* primary. Reviewed, proven, merged. It aborts the whole
migration with `23505 duplicate key value violates unique constraint
"uq_tenant_phone_numbers_primary"` — **but only against one specific live state, and being precise
about which one is part of the lesson.** The collision needs BOTH conditions true at once for the
same tenant, at the moment the migration runs: an inactive row still holding `is_primary` (so the
tenant's single primary slot is occupied), AND an active row the backfill's `select distinct on`
picks for it. Either alone is harmless — a tenant whose flag was since cleared, or one with no
active number, produces no collision. History does not matter; the state at run time does.

**Root cause.** The index is `UNIQUE (tenant_id) WHERE is_primary` — **no status predicate**. The
guard `... and p.status = 'active'` was added during review on correct reasoning (a workspace whose
only primary is released has not really chosen anything, so back-fill it). In exactly the state the
new guard was written to catch, the SELECT picks the active row and the UPDATE then collides with
the released row still occupying the tenant's single primary slot.

**What the proof did, and what it therefore could not see.** The review proved the guard
"discriminates" by running the SELECT: with the guard it picks 1 row, without it picks 0. That is a
true statement about a predicate. The defect lives in the *write*, which was never run. **A proof
that exercises the read half of a read-modify-write proves the half that cannot fail.**

**Why the fix is a trigger and not another guard.** `20261020000000` makes the state unreachable:
`is_primary` is cleared whenever a row moves off `active`. A CHECK was rejected deliberately — it
would *refuse* the write that retires a primary number, turning an ordinary act into an error the
caller has to pre-empt. Clear the flag with the transition instead of blocking the transition.

**Standing checks when a migration modifies rows under a partial unique index:**
1. Run the actual `UPDATE`/`INSERT` inside `BEGIN … ROLLBACK`, against the state the guard was
   written for. Never accept the `SELECT` as the proof.
2. Read the index definition, not its name. `uq_..._primary` says nothing about which predicate is
   in the `WHERE`, and the missing `status` is the entire bug.
3. Ask whether the bad state should be *guarded against* or made *unreachable*. Repeated guards
   against a state the schema still permits is the signal that the invariant belongs in the schema.

**Second instance of the same class in one wave.** `comms_buy_number`'s schema marks
`monthly_cents` required — and tool calling is automatic and non-strict, so `required` is not
runtime validation. A malformed amount decayed to `undefined`, `comms-purchase-number` read the
absent amount as the legacy "price shown in the UI" path, skipped verification, and **bought the
number**. A declared contract is not an enforced one; the guard is `isSpendableQuoteCents`, and it
was extracted into `_shared/purchase-quote.ts` precisely because a money-path guard inside a
function with no runtime harness is a guard nobody can prove.

## A default is not a guarantee, and a prompt is not an enforcement (2026-09-01, #707)

**Symptom.** A brain record about the number-purchase path stated: *"Purchase is never autonomous
and is never retried."* Both halves are false, and the record was written by the same session that
had built the path.

**Root cause, in two parts.**

1. **Default mistaken for guarantee.** `resolveToolAutonomy` defaults to `confirm` — its own
   comment says *"safe default — never assume autopilot"* — so the observed behaviour is always a
   confirmation. But `comms_buy_number` is a registered switchable tool, and at `auto` the gate
   comments its own behaviour plainly: *"autoMode === 'auto' … fall through to execute."* A
   validly-quoted purchase then runs with no confirmation. What was observed was the default; what
   was written down was a property.
2. **Prompt mistaken for mechanism.** *"A refusal is final for that number, pick another rather
   than retrying"* and *"do not buy a replacement"* live in the tool **description**. They steer a
   model. Nothing rejects a retry. Enforcement and instruction read identically in a diff, and only
   one of them survives a model that ignores it.

**Why this one is worth a lesson.** It landed **in the close-out record itself** — the document
written to stop exactly this. The sweep half of the close-out step looks for claims the change
*falsified*; it does not look for claims the author *overstated*, and an overstatement about a
safety property is the more dangerous of the two, because the next session quotes it as settled.

**The rule.** When recording anything protective, separate it by strength and say which is which:

| Strength | Means | Example — **note every one names its lane; that is the point** |
|---|---|---|
| **Enforced** | code refuses; no configuration changes it | **in the `comms_buy_number` lane**, no purchase without a whole, positive `monthly_cents`, and the server re-verifies it. The two UI lanes send no amount and skip the check entirely |
| **Configurable** | safe today, a setting away from not being | **in the agent lane**, `confirm` is the default; a workspace may set `auto` and lose the confirmation |
| **Prompt-level** | steers a model; nothing rejects the act | "don't retry this number", "don't buy a replacement" — tool-description text only. **And the rule binding `confirm:true` to a human's yes** — the system prompt and the `needs_confirm` note both said ask first; nothing checked that anyone did. *(FIXED 2026-09-01: the flag must now spend a server-minted proposal created before the turn. The prompt text is still only steering — it is no longer the only thing there.)* |
| **Enforced but self-asserted** | code refuses without an assertion the actor can **MINT ITSELF**, and validates only its value — not who issued it. Real against an actor that omits it, worthless against one that supplies it. **The property is mintability, not who transmits it:** a JWT or capability token is also actor-supplied, and is strong precisely because the actor cannot create one the server will accept | the `confirm` gate: `index.ts` ~5973 genuinely refuses whenever `gateArgs.confirm !== true`, so it stops a model that simply calls the tool. But `gateArgs` is the model's own output, so the flag is self-minted and the gate constrains only the careless case. **Splitting this row out is the correction — calling the whole thing prompt-level was itself an overstatement in the other direction.** *(The EXAMPLE was fixed 2026-09-01 — `confirm:true` must now spend a server-minted proposal predating the turn. The row's vocabulary is the durable part and stands; do not read the example as current state.)* |
| **Best-effort** | attempted, and a failure changes nothing | the `audit_logs` write after a purchase: non-blocking by design, so a charge with no audit row is reachable |

Never write "never" about the bottom three rows. For anything money-, permission-, or
tenant-boundary-shaped, name the lane that removes the protection **in the same sentence** as the
protection — a reader who has to go find the exception will not.

**The examples above are deliberately written the long way.** An earlier version of this table put
*"no purchase without a whole, positive `monthly_cents`; server re-verifies the price"* in the
Enforced row, unqualified — and the review caught that the lesson was handing future authors the
exact unsafe sentence to copy, two paragraphs above the analysis explaining why it was false. **A
rule whose own example violates it teaches the violation**, because the example is what gets
copied and the prose is what gets skimmed.

**How it was caught, honestly:** not by me. The §39 peer-gate caught it — an automated reviewer
reading the actual diff, which is precisely the layer that exists because the author's own proof
cannot see what the author already believes.

**It then happened TWICE MORE, in the fix for it.** The corrected text — written while composing
this very lesson — still carried two overstatements, both caught on the next review round:

1. *"Every money-spent exit writes an audit row"*, filed under **Enforced**. `writePurchaseAudit`
   is non-blocking **by design** — its own comment says a failed audit must not turn a completed
   purchase into a reported failure — so a failed insert is logged and nothing else changes. A
   completed charge with no audit row is reachable. The exit *attempts* the write.
2. *"No purchase without a whole, positive `monthly_cents`"* and *"the server re-verifies"*, both
   stated categorically. They bind the **agent lane only**. Solo `PhoneSetupPanel` and legacy
   `NumbersTab` post `{ phone_number }` with no amount, and the server's check is guarded on
   `if (agreedMonthlyCents !== null)` — skipped entirely for them.

**That recurrence is the actual lesson, and it is worth more than the original.** Knowing the rule
did not prevent breaking it three times in one wave, because the failure is not ignorance — it is
that a protection you built *feels* total from the inside. The author remembers the guard they
wrote and not the branch that skips it. So the rule needs a mechanical form, not a principle:

> Before writing any protective sentence, find the code that makes it true, and then find **every
> caller that does not go through it**. If you have not enumerated the callers, write "in the
> `<lane>` lane" instead of a bare claim — and if you cannot name the lane, you do not yet know
> what you are asserting.

That is §37's producer inventory pointed at prose instead of an endpoint, and it applies for the
same reason: what breaks a categorical claim is always the caller nobody listed.

### And then, one round later, the hardest one — with the over-correction that followed it

Having written that rule, the record still described the agent `confirm` lane as the one carrying
complete authorization: operator sees the amount, confirms, server re-verifies. **The middle step
is not what it looks like.** The gate tests `gateArgs.confirm`, which is
`JSON.parse(tc.function.arguments)` — the model's own output. Nothing ties it to the
`needs_confirm` that preceded it or to anything a human said, so a model emitting `confirm:true`
on its first call executes immediately. The platform already has the enforced pattern — outbound
sends file a real approval row and wait — and this gate does not use it.

> **CLOSED 2026-09-01.** It uses one now. `confirm:true` must spend a server-minted
> `paige_tool_confirmations` row bound to the TOOL — and, for a listed set, an identity subset;
> NOT the whole arguments, which livelocked and was blocked — plus the requester and the tenant,
> unspent, unexpired, and created *before the turn began* — mirroring
> `pipeline_archive_confirmations` (#709) rather than forking a rival seam. The finding above
> stands as written; only its present tense expired. **The bound is still honest: an intervening
> turn is not a human's yes.** That last step needs per-surface UI work and is tracked separately.

**It survived the rule that was written to catch it.** I had just committed *"find the code that
makes it true, then find every caller that does not go through it"*, applied it to the price
check, and never applied it to the confirmation — because the confirmation *looks* like a
mechanism. Two-step handshake, a system prompt, a tool note, and precisely the right behaviour
every time the model complies. **A well-behaved actor is observationally identical to a guard.**
Nothing you can watch distinguishes them; the only test is to find the line that would refuse.

**And then the correction over-shot, which is the last turn of the screw.** The first fix called
the whole thing prompt-level — *"nothing rejects the act"* — and that is also false. Line ~5973
genuinely refuses whenever `gateArgs.confirm !== true`, so the gate is real against an actor that
simply omits the flag; it is worthless only against one that supplies it. Two layers, not one:
an **enforced but self-asserted** gate, and a **prompt-level** rule binding the assertion to a
human. Hence the fifth row in the table above.

**The generalisable part:** when a protection turns out weaker than claimed, the reflex is to
reclassify it to the bottom. Ask instead *what does it still stop?* A gate that constrains the
careless case and not the deliberate one is neither "enforced" nor "nothing" — and if the
vocabulary has no row for it, add one rather than rounding to the nearest existing label.

**And then the new row's own definition was wrong, which is where this entry stops.** It first read
*"code refuses without a token the ACTOR supplies"* — but a JWT is actor-supplied and is strong,
precisely because the actor cannot create one the server will accept. The property is
**mintability**, not who transmits the value: the gate is weak because the model can produce the
accepted assertion itself and the server validates only its value, never its issuer. Getting that
wrong would have classified session tokens as weak protections.

**The last round found three defects, all of them the SAME correction failing to propagate** — the
two-layer distinction had been applied to three places and was needed in six, so a risk cell still
named only `auto` as the unattended path, and a summary sentence still said "every confirmation is
prompt-level". That is this entry's own second rule failing on this entry: *search and assess every
occurrence.* Applying a correction where you were looking is not applying it.

**Why this is where it stops, stated rather than left implicit.** Successive rounds moved from
wrong claims, to wrong verification, to wrong placement, to a wrong definition inside the fix for a
wrong classification. Each was real and each was smaller. The record is now accurate on every point
anyone raised, and the remaining risk is no longer in this text — it is in the two product defects
it documents, which are filed as their own work.


## A verification sweep that filters by content deletes the evidence (2026-09-01, #708)

**Symptom.** A change removed two vendored skill bundles and their assembled `LICENSE`. The
close-out sweep for claims the change falsified was reported clean. Two files still asserted the
redistribution had happened, and pointed readers at the two deleted paths — one of them
`config-registry.md`, the mandatory source for that configuration.

**Root cause — the sweep, not the writing.** The command was:

```
grep -rn "vendored" docs/ | grep -iv "not vendored\|before vendoring\|the vendoring was"
```

Every `-v` term had been added to suppress a line already known to be fine. **Both offending lines
matched one of those exclusions.** The filter written to reduce noise removed exactly the signal.

**Why this is worse than the spelling problem the close-out step already warns about.** Varying the
spelling can only *miss* a hit that was never retrieved. A content filter *deletes* a hit you had
in hand — and it fails **silently**, because the output looks identical whether the sweep found
nothing or hid everything. There is no signal distinguishing "clean" from "blinded".

**The rules, both cheap. Note what each one is about — the property, not the mechanism:**

1. **Every omitted match must stay auditable.** The defect was not `grep -v` as such; it was that
   the excluded set vanished without being seen or counted. A **path** filter hides a stale claim
   just as effectively — narrowing to `docs/brain/` would have missed a `docs/doctrine/` copy — so
   "filter by path, not content" is the wrong invariant. A content filter is fine *when the excluded
   stream is retained and READ*. **Counting it is not enough** — in the anchoring incident the
   excluded stream contained both stale claims, so `wc -l` would have reported "2 omitted",
   satisfied any "reviewed or counted" wording, and revealed neither. A count establishes that
   omissions exist; it says nothing about whether they are false. If a count is all you have, any
   **nonzero** result has to trigger reading them. In practice: sweep unfiltered and read the hits,
   or if volume genuinely forces narrowing, read what the narrowing removed. Output too long to
   read is information about the claim's blast radius, not permission to stop looking.
2. **Search and assess EVERY occurrence; correct each one that is actually false.** Not "fix it
   everywhere" — identical wording can appear in a dated decision-log entry that was true when
   written, in a quotation, in a corrections log that must name what it reversed (§50), or in a
   scope where the claim still holds. Rewriting those corrupts an honest record rather than
   repairing it, and §58 forbids purging legitimate audit entries. The failure being guarded
   against is *not looking* at the other occurrences, which is different from *not changing* them.
   In the anchoring case all three happened to be false and all three were changed — that was the
   finding, not the rule.

**Both rules above were themselves over-stated in their first draft, and that is the sharpest thing
in this entry.** They began as *"narrow by path, never by content"* and *"fix a flagged claim
everywhere"* — a banned mechanism and a universal instruction, written inside a lesson about not
generalising past the evidence. Review caught both: a path filter hides just as well, and blanket
"fix everywhere" would have someone rewrite a dated log entry that was true when written.

The generalisation is the reflex, not the exception. A rule derived from one incident wants to be
stated as a mechanism (*don't use this tool*) because that is concrete and checkable, when what the
incident actually taught is a property (*don't leave omissions unaudited*).

**This is not an argument against mechanism-form rules as such** — and that qualifier is itself a
correction, because the first draft of this paragraph said the mechanism form is simply "wrong".
Where a mechanism genuinely has no permitted safe use, banning it outright is the right control and
is *meant* to be blunt: §50's prohibition on the listed third-party marks is exactly that, and a
meta-rule that reads as "prefer properties to mechanisms" could be used to argue it down. The
failure mode is narrower — a mechanism-form rule that **overgeneralises past its evidence**, so it
forbids safe uses of the named tool while permitting the same failure by other means.

The test, which distinguishes the two cases: state what property was violated, then ask whether the
rule as phrased would catch a version of the failure **using different means**. If it would not, it
describes the incident rather than the lesson. If it would — because the mechanism itself is the
whole hazard — the mechanism form is correct and should stay blunt.

**Recorded here rather than in a sibling PR, and that is part of the lesson too.** These two defects
were found reviewing this change, and the first draft put them in a different PR's branch to avoid
a merge conflict in this file. That defers the capture to another PR's merge and ordering — §BRAIN.3
says *same change*, and "it was more convenient to put it elsewhere" is precisely the reasoning the
rule exists to refuse. Caught on review, in a PR whose own subject is making that capture
enforceable.

## A file listing is not a file reading (2026-09-01, #708 → corrected same day)

**What happened.** A whole doctrine artifact — a `.claude/skills/README.md`, a `.gitignore` comment,
a `config-registry` row, a brain index row and a long dated `decision-log` entry — was written,
reviewed across eight rounds, and merged, asserting that the §69 delivery skill arrives
**half-installed** on every fresh container: *"the account-synced copy is `SKILL.md` and nothing else
— no `references/`, no `templates/`."*

The premise was false. The synced `SKILL.md` is **77,739 bytes** and inlines every `references/*.md`
and the template under a heading that says so in plain words: *"Inlined references (self-contained ·
2026-08-30)."* Somebody had already solved the sync limitation days earlier. A fresh container
receives the complete skill, and §69 was never best-effort.

**The mechanism.** A `find` was run. It printed one `SKILL.md` per synced skill and no `references/`
directory. That listing was treated as an inventory of **content**. It is an inventory of **names**.
The 77 KB size was in the same output, in the same column, the entire time — the evidence that would
have falsified the claim was already on screen and was read past. Opening the file cost one command.

**Why the reviews did not catch it.** They were not asked to. Eight rounds examined whether the
reasoning was sound, whether the claim was over-stated, whether the licence inference was safe,
whether the sweep was honest — and each of those found something real. Not one of them opened the
file the argument was about, because the premise was presented as an observation rather than as a
claim, and observations do not look like the thing to check.

> **A review grades the argument. It does not grade the evidence the argument stands on.**
> An unexamined premise inherits the credibility of everything correct that was built on top of it,
> and the more careful the superstructure, the more solid the foundation appears.

**The rules this leaves.**

- **`find` / `ls` / `wc -l` answer "what is named" and "how big". They never answer "what is in it."**
  Any claim about content is a claim about content, and needs the file opened. A size that looks
  wrong for the claim — 77 KB for a file asserted to be a bare index — is the tell.
- **State a premise as a claim, so it can be checked.** "The synced copy is `SKILL.md` only" reads as
  a finding. "I ran `find` and saw one filename, and did not open it" reads as what it was, and any
  reviewer would have opened it.
- **Sweep your own merged work when a later finding contradicts it.** The correction here touched
  five files; only one was the file the mistake was made in. This is exactly the Gate-6 sweep,
  pointed at yesterday's own commit.
- **The correction is worth more than the conclusion was.** The blocker recorded in #708 (the MIT
  notice cannot be reconstructed) is still entirely true and still stands. What collapsed was the
  urgency around it — and the fix that followed, shipping our close-out as our *own* repo-local
  skill, is better than the vendoring it had been reaching for.

**Related:** *"A predicate proof is not a write proof"* (a proof exercising the wrong statement) and
*"A verification sweep that filters by content deletes the evidence"* (a search that hid its own
answer) — both above, both 2026-09-01. Three variants of one failure in a day: **the check ran, and
it was not a check of the thing.**

## Every gate we run is blind to SQL — third occurrence (2026-09-01, the confirm-binding migration)

**What happened.** The migration adding `paige_tool_confirmations` shipped an INSERT with **five
target columns and four values** — `args_hash`, the column the whole mechanism binds on, was
missing from the `values` list. Every confirm-gated tool call would have raised
`42601 INSERT has more target columns than expressions` at runtime, in the one code path that
decides whether 52 mutating tools may execute.

**What passed anyway, all of it green:**

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 124 files, 1630 tests, all passing |
| `npm run build` | built clean |
| `lint:views` · `lint:definer-fns` · `lint:tier-features` · `lint:shadow-vars` · `lint:tool-catalogue` · `lint:operator-reach` · `smoke:comms-webhook-auth` | all PASS |

Not one of them parses SQL. They cannot: the migration is a text file that no TypeScript
tool-chain reads and no CI job executes. **A green pre-merge run says nothing whatsoever about
whether a migration is valid**, and a defect this crude survived every single check.

The §32 `BEGIN … ROLLBACK` proof caught it on the first attempt, in the first thirty seconds.

**This is the THIRD time this class has cost us.** See *"service_role grants are invisible to every
pre-merge check we run"* (2026-08-20, itself logged as a second occurrence) and *"Migration
merged-but-never-applied — the false-green"* (§32 / #275). Same shape each time: the SQL layer is
outside the reach of everything that reports "green", so confidence from the other gates is
confidence about a different artifact.

**The rules.**

- **Never merge a migration on the strength of tsc/tests/build/lints.** They are evidence about the
  TypeScript. Run the SQL. `BEGIN … ROLLBACK` costs one call.
- **Make the proof BEHAVIOURAL, not just syntactic.** Executing the DDL proves it parses. It does
  not prove the thing works. This proof asserted nine properties against the real database —
  same-turn refusal, cross-action, cross-tool and cross-user refusal, single-use, later-turn
  success, and both RPCs closed to non-`service_role` — and reported `pass=9 fail=0`. A DDL-only
  proof would have caught the missing column but nothing about whether the guard actually guards.
- **Force the rollback structurally.** Ending the block with `raise exception` carrying the results
  aborts the transaction by construction, so the proof cannot half-apply if something later in the
  batch fails. Verify afterwards that `to_regclass` and the migration ledger are still null/0 —
  a rollback you did not check is a rollback you are assuming.
- **A green suite next to a red artifact is worse than a red suite**, because it is read as
  permission to stop looking.

## A proof only tests what crosses its own boundary (2026-09-01, the confirm-binding livelock)

**What happened.** The first version of the confirm-binding hashed the **whole argument object** and
required the confirming call to reproduce it. Against that, the evidence looked overwhelming:

- 11 behavioural assertions against the real database, `pass=N fail=0`
- 28 unit tests on the decision module
- a **negative control** proving those tests reject the old implementation
- `tsc` 0 · 1630 vitest tests · production build · seven CI lint gates
- a CI script that imports and executes the real edge handler: 71 passed

Every one of them passed. The design was **unusable**.

Conversation history is rebuilt as `{ role, content }` only — tool calls and tool results **do not
cross a turn boundary** — and Approve sends the literal words "Approved — run it." So on the
confirming turn the model has to regenerate its arguments from prose. For `document_generate`,
whose `blocks` argument *is* the authored document, two generations are never byte-equal. Approve →
re-author → hash differs → refuse → re-propose. Forever, silently, with nothing executing and no
error surfaced. The same file already carried a comment recording that exact re-ask loop as a flaky
model bug; the hash would have made it structural.

**Why nothing caught it.** Look at where each proof lives:

| Proof | What it crossed | What it could never cross |
|---|---|---|
| SQL `BEGIN…ROLLBACK` | the database boundary | hashes were passed in **as literals** — no arguments were ever generated |
| Unit tests | the function boundary | hand-written 1–2 key objects — nothing re-authored |
| CI handler harness | one HTTP request | **one** turn; it never sends a second |
| tsc / build / lints | the type and syntax boundary | behaviour of any kind |

The defect lived in the gap **between two turns**, and not one instrument reached across it. This
is the sharpest form of a lesson already recorded twice here — *a predicate proof is not a write
proof*, *a sweep that filters by content deletes the evidence*. Same shape again: **the check ran,
and it was not a check of the thing.**

**What actually caught it:** the §39 peer-gate — an independent adversarial read of the pushed diff,
whose brief was explicitly *"find what those assertions structurally could not test."* It traced the
history construction, found `aiMessages.push({ role, content })`, and reasoned about what the model
would have to do on the next turn. No test did that, because no test could.

**The rules.**

- **Before trusting a proof, name its boundary.** Write down what the instrument crosses and what it
  cannot. If the defect class you care about lives outside every boundary you listed, you have no
  coverage, however many assertions are green.
- **Multi-turn behaviour needs a multi-turn instrument, or an adversarial reader.** We have neither
  a two-turn harness nor a reason to build one for this alone — so the peer-gate is the control, and
  it is not optional on anything whose correctness spans turns.
- **Ask what the model must REPRODUCE.** Any cross-turn binding is a demand for regeneration. If the
  thing being bound cannot be regenerated, the binding is a livelock rather than a guard. The design
  rule is *bind only on what the model can reproduce* — a value it can read back out of its own
  prose, or a stable id it can look up again. **Not** "only what the human saw": that was the first
  wording here, and the shipped map already breaks it for three tier-2 ids, so it described an
  intention rather than the code.
- **A second round found a second livelock inside the fix for the first.** The supersede keyed on
  the tool while the claim keyed on tool+identity, so proposing a second subject retired the first
  at birth and a batch ("delete these two contacts") could never execute either. Same silent shape,
  different clause. **When you fix a livelock, check that the fix's own keys agree with each other**
  — and add the assertion that would have caught it, which here was simply *two identities on one
  tool*. The eleven assertions that passed reused a single identity throughout.
- **A silent livelock is worse than an error.** The refusal path logged and re-proposed, so the
  system looked like it was politely asking again. Failure modes that resemble normal operation are
  the ones that survive review.

## Hand-applying a migration ahead of its merge WEDGES the deploy chain (2026-09-01, #711 / issue #198)

**What I was solving.** `deploy-edge-functions.yml` and `deploy-migrations.yml` are two independent
workflows on the same `push: main`, with no ordering between them. #711's gate fails **closed**, so
if the edge bundle landed first, every confirm-lane tool across the platform would silently stall —
a re-ask loop, not an error — until the migration caught up. Real risk, correctly identified.

**What I did.** Applied the migration to prod myself via the Supabase MCP `apply_migration` just
before merging, so the guard would already exist when the code arrived.

**What broke.** `apply_migration` **records its own ledger version from the current timestamp** —
`20260901150312` — which matches no file in `supabase/migrations/`. `supabase db push` then refuses
to do anything at all:

```
Remote migration versions not found in local migrations directory.
supabase migration repair --status reverted 20260901150312
```

The pre-apply meant to avoid a few-minute window instead **wedged the entire migration chain**, and
`deploy-migrations.yml`'s own header says exactly what that costs: *"a wedged chain blocks all later
deploys."* Every subsequent migration merge, by anyone, would have failed until it was cleared.

**The fix** is the CLI's own prescription: delete the orphan ledger row (the OBJECTS are fine — only
the ledger entry was wrong), then re-run. `db push` applied the canonical version idempotently
(`create table if not exists` / `create or replace function`) and recorded it.

**The rules.**

- **Do not hand-apply a migration under a generated version.** If a pre-apply is genuinely needed,
  execute the SQL *and* insert the ledger row under **the repo file's own version string**, so the
  ledger matches `supabase/migrations/` exactly. `apply_migration` will not do that for you.
- **Better: don't pre-apply.** Weigh the actual window. Minutes of a fail-closed guard being absent
  is usually cheaper than a wedged chain that blocks everyone. Reach for deploy ordering, or land
  the migration in an earlier merge, before reaching for a manual apply.
- **A manual apply is not "the same thing CI does."** CI applies *and* records under the repo's
  version. Doing half of that leaves prod in a state the tooling actively rejects.
- **Check the ledger, not just the objects.** The objects existed and were correct the whole time.
  Every schema query I ran said healthy. The damage was in a table I had not thought to look at —
  which is the same shape as the day's other lessons: *the check ran, and it was not a check of the
  thing.*

**Related:** *"Migration merged-but-never-applied — the false-green"* (§32/#275) is the opposite
failure, and this one is what happens when you over-correct for it.

---

## Widening an implementation without widening the interface that declares it (2026-09-01, #717)

**What broke.** `useSoloNumbers` exposes its shape through an exported interface,
`SoloNumbersData`. I widened the *implementation* — `purchase(phoneNumber, agreedMonthlyCents)` —
and the *call site* in `settings.tsx`, and left the interface at one parameter. The consumer is
typed against the interface, so the second argument had nowhere to land:

```
src/solo/settings.tsx: error TS2554: Expected 1 arguments, but got 2.
```

**Why the suite did not catch it.** It could not. `settings.numbers.test.tsx` renders the REAL
component through the REAL hook and mocks only the Supabase client, so it asserted the true thing —
that the request body carries `agreed_monthly_cents: 120` — and passed, correctly. The runtime path
was right the whole time. Only the *declared contract* was stale, and a stale type is invisible to
every test that runs the code. **1680 passing tests are not a typecheck**, in the same way a green
build is not a working render (§32).

**Why I did not catch it either.** I reported "tsc 0" for this branch. That result was real, and it
was for an earlier state of the tree — the final call-site edit came after it, and I never re-ran.
`npm run ci:tsc` uses the same `tsconfig.app.json` as `npm run typecheck`, so there was no
environment difference and nothing subtle: I quoted a gate's verdict from before the last edit.

**The rules.**

- **Re-run the gates AFTER the last edit, not once during the work.** A green result is a statement
  about a tree state. Quoting it for a different tree state is the same class of claim as reporting
  a hoped-for outcome (§13), even when every individual run was honest.
- **When you change a function's signature, grep for every place that DECLARES it, not just every
  place that calls it.** `grep -rn "purchase: ("` would have found the interface in one command.
  An exported interface is a second declaration site that the compiler enforces and no test runs.
- **Read the step list before reading the log.** Four tool calls went into scanning a 9,487-line
  job log whose tail showed everything passing, because the failing step ran early and every later
  step carries `if: !cancelled()`. `actions_get / get_workflow_job` returns a per-step
  conclusion array and named the failing step (#32, "Typecheck (ratchet)") immediately.
- **The local gate set is the CI gate set, not the subset you remember.** `ci.yml` runs ~28 checks
  in `verify`; running seven and calling it green is a partial answer reported as a complete one.

---

## "Prod is not reachable headless" is the wrong reason — the browser tunnel is (2026-09-01)

**The conclusion on record is right and its stated cause is wrong**, which matters because the two
imply completely different fixes.

`CLAUDE.md` §32's live-drive bullet says: *"live prod was NOT reachable headless from the CI sandbox
even via the proxy, which forwards only tool/MCP hosts."* Every session inherits that and reasons
about a network-allowlisting problem. Measured in this container:

| | |
|---|---|
| `curl https://paigeagent.ai` **through `HTTPS_PROXY`** | **HTTP 200 in 1.17s** |
| `liveDrive({url:"https://paigeagent.ai"})` | `ok:false`, `proxied:true`, `executableResolved:true`, `ERR_CONNECTION_RESET` |

So the proxy forwards our host perfectly well. The helper is fine, Chromium is present
(`/opt/pw-browsers`), `playwright` resolves. **What fails is the browser's tunnel**, and the proxy's
own diagnostics name it — `curl "$HTTPS_PROXY/__agentproxy/status"` → `recentRelayFailures`:

```
{"kind":"ws_closed_mid_exchange","host":"paigeagent.ai:443",
 "detail":"tunnel closed (code 1006, Connection ended) after 6s;
           1819 B sent, 39 B received, client reading"}
```

~1.8KB out (a TLS ClientHello), 39 bytes back, closed after 6s. **And it is not about our domain:**
identical `ws_closed_mid_exchange` for `www.google.com:443`, `accounts.google.com:443`,
`android.clients.google.com:443` — every host Chromium tried. Uniform across hosts is the signature
of an environment limitation, not an application or configuration problem.

**So the owed §32.c drive has two independent blockers, both now measured rather than assumed:**

1. the relay does not sustain Chromium CONNECT tunnels in this container; and
2. `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` are unset, so even a working browser could not
   authenticate.

**Why the distinction earns its words.** "Unreachable" points at allowlisting, which nobody needs to
do. The actual unblocks are the ones §32.c already names: a **browser-capable session** (its Cowork /
Chrome MCP drive lane) and a **scoped test-tenant credential** in env — never owner PII.

**`CLAUDE.md` §32's wording is doctrine and is OWNER-OWED.** It is not corrected here: a session does
not quietly edit doctrine because it found a contradicting measurement. The measurement is recorded;
the ruling is the owner's.

*Rule:* **when a blocker has been inherited rather than measured, measure it before repeating it.**
This one had been restated all session as a reason to skip a check, and one `curl` falsified half of
it. An inherited limit is a hypothesis with a citation, not a finding.


---

## A NOT FOUND from an enumeration you never proved complete (2026-09-03, Rail #877 — SECOND occurrence)

**What happened.** Verifying that the new Solo Rail panel was really on production, a two-level
crawl of the deployed JS chunks reported the panel **absent from all 427 chunks**. Taken at face
value that reads as "the deploy did not carry the change" — a release-blocking claim.

It was wrong. A **control** — a string known to have been in the deployed bundle *before* this
slice — came back absent from the same 427. A string that is definitely there cannot be missing
from a complete enumeration, so the enumeration was incomplete, not the code. The real chunk sat
deeper in the graph: closure took **five rounds and 733 chunks**.

**The second trap, underneath the first.** A chunk named `SoloApp-CQ9-3o2z.js` WAS reachable at
level two, and it did not contain the panel. It was **12,562 bytes**; the real one
(`SoloApp-DxVYmu_L.js`) was **650,307**. Vercel keeps assets from earlier deployments, so an old
artifact answers `200` under a plausible name indefinitely. Grepping the first plausible name and
believing the result is how a stale chunk gets mistaken for the current one.

**Why this is the second occurrence.** The same shallow-crawl false negative happened days earlier
verifying Slice B, where `PaigeRailFeed`'s chunk was reported missing for the same reason. It was
recorded then as "my chunk enumeration was incomplete" — and the method that produced it was used
again anyway, because the lesson was written as a note about one incident rather than as a rule.

*Rules, both of which had to fail twice to get written down:*

1. **Run a control before believing a NOT FOUND.** Search for something you already know is there.
   If the control is also missing, you have measured your search, not the artifact. This costs one
   extra query and is the only thing that distinguishes "absent" from "not looked hard enough".
2. **Crawl to closure, and cross-check size against a local build at the deployed commit.** A
   fixed number of levels is a guess about the graph's depth. Byte-size equality between a locally
   built chunk and the served one is strong, cheap evidence they are the same source — and it is
   what exposes a stale same-named artifact.

## A claim written once and copied six times is checked zero times (2026-09-03, Rail #877 → #879)

**What happened.** The Solo Rail slice was justified by "the tenant-wide rail was dark for every
Solo tenant." That is false. `TrustCompass` is mounted on Solo (`SoloApp.tsx:253`) and its panel
calls `useSoloActivityFeed` (`compass.tsx:469`); so does Team → Activity (`team.tsx:233`). Both read
`get_solo_rail_activity` — the tenant-wide reader. Solo already had two tenant-wide rail surfaces.

The true statement is narrower: **`PaigeRailFeed` specifically is unreachable on Solo, and the
Command Center — Solo's default landing route — carried no Rail surface.**

**How it survived.** The sentence went into the master reference, this brain record, the tier
matrix, the PR body, the commit message, and the report to the owner. Six copies, and every one was
written by consulting the previous copy rather than the code. Worse, the tier-matrix edit that
carried the claim **also carried a table two rows above marking Trust Compass and Team Activity as
✓ for Solo** — the refutation and the claim shipped in the same diff, in the same file, and neither
the author nor the pre-merge checks noticed. An independent review caught it after merge.

**Why the usual defences all missed it.** Tests do not assert prose. Lint does not read English. The
peer-gate reads the diff for defects, and this defect was *consistent with itself* everywhere it
appeared — a lie repeated identically looks like corroboration.

*Rule:* **a claim gets re-derived from the source at every place it is written, or it gets written
once and linked.** Copying prose between records copies its errors and manufactures false
confidence, because each copy looks independently attested. When a record and a table in the same
change disagree, the table — which was built from the code — wins.

---

## 0i. A gate that mounts the component alone cannot see the layout it lives in

**2026-09-03, Campaigns → Sales round 2 (shipped, then repaired the same day).**

The Sales surface had a render gate with **344 passing checks** across four widths and two palettes.
It shipped a regression that took **three of the six Campaigns tabs off the screen** at ordinary
laptop widths, and the gate could not have caught it: `sales-mount` mounts `SalesOps` **by itself**.
The tab strip is not in it. Neither is the Solo shell, which is where the actual constraint lives —
`viewport − 216px rail − max(340px, 26vw) PAIGE`, so a 1366px window gives this surface a **795px**
content column and a 1024px window gives it **468px**.

The bug itself is one line of reasoning: a legend was hidden by `@media(max-width:1050px)` while the
space it consumed belonged to a container ~500px narrower than the viewport the query was reading.
Every responsive rule on a surface that does not span the window has this hazard, and three of the
nav's rules had it.

*Rule:* **a responsive rule inside a shell must key on the container, not the viewport** — that is
what `container-type: inline-size` and `@container` are for. And more generally: **a harness that
mounts a component in isolation proves the component, never its place.** When a surface lives inside
a shell that takes space away from it, at least one gate has to render it *in* that shell, at the
real column width, or the number of green checks is measuring the wrong thing. 344 of them did.

*Corollary, also earned here:* the new gate was run **red first** (naming the exact tabs that were
clipped) before it was run green. A gate written after a fix, never seen to fail, is a hypothesis —
the one that shipped this regression had 344 checks and no arm that could fail on it.

*And the sting in the tail:* **the replacement gate's own model of the shell was wrong, and an
independent reviewer caught it.** It subtracted the BASE grid (`216px | 1fr | minmax(340px,26vw)`)
while Solo *overrides* the PAIGE column to `minmax(440px,34vw)` docked and `minmax(620px,52vw)`
expanded, and compacts the rail under an overlay below 1080px. So it claimed 920px at 1536 where the
real docked column is 797px, and 468px at 1024 where the real overlay leaves 952px — one case easier
than production, one harsher — and never tested the narrowest real column at all (439px, PAIGE
expanded on a 1366 laptop). Corrected, the regression was worse than first reported: four of six tabs
clipped, not three. **A gate is only as good as its model of where the thing lives**, and a
plausible-looking geometry constant is exactly the kind of thing that is never checked because it
looks like arithmetic rather than a claim. Derive it from the component that sets it, cite the line,
and drive every posture that component can be in — not just the one you happened to think of.

---

## 0j. The resting state is not the only state — measure the one the pointer creates

**2026-09-03, same round.**

The contrast sweep read every text pair on the surface and found nothing new. The primary action —
the button that records how a business takes money — dropped to **2.79:1 in dark mode on hover**,
because the hover rule moved the ground to `--violet-2`, which is *lighter* than `--violet` in both
palettes, against a label fixed at white. The sweep never saw it: it runs on the resting DOM.

A second variant of the same blindness sat two rules away. A decorative sheen was drawn with
`::after { inset: 0 }` and no `z-index`, so it painted **over** the sentence it was meant to draw the
eye to, taking that copy from 7.03:1 to 4.13:1 each time the sweep crossed a word. Nothing static
measures that either — the harm only exists mid-animation.

*Rule:* **a contrast gate that only measures the resting state is measuring the state nobody is
looking at when they act.** Hover, focus, and any overlay that animates across text are all states a
person is in at the moment they commit. Drive them and measure them. Two direction checks that cost
nothing: a hover on a fixed-light label must **darken**, and an `::after` over text needs
`z-index:-1` with `isolation:isolate` on the parent, not `inset:0` alone.

---

## 0k. A constraint that describes the happy path forbids the escape hatch

**2026-09-03, Solo Sales client agreements.**

`CHECK (status = 'draft' OR (starts_on IS NOT NULL AND price_basis <> 'quote_pending'))` reads as an
obvious rule: a draft may be incomplete, anything you commit to may not. It shipped a surface where
**a half-finished draft could never be cancelled** — because `cancelled` is not `draft`, so
abandoning an incomplete record demanded that it first be completed. Reproduced before the fix: the
UPDATE was refused and the row stayed `draft`.

The same shape hid three more times in one migration. Every cross-field CHECK that had no matching
`RAISE` in the RPC body surfaced to the user as
`violates check constraint "tca_price_basis_quote_ck"` — a database object name in visible copy,
from a control the surface had enabled. One of those paths was **two clicks from the empty state**.

*Rule:* **enumerate the TERMINAL and ABANDONMENT transitions before writing a completeness
constraint** — cancelling, deleting and archiving are exits, not achievements, and a rule written
about the happy path will block them. And **every CHECK needs a sentence in front of it**: if the
constraint is the error surface, the constraint name is the error message.

---

## 0l. Schema with no writer reads as delivered

**2026-09-03, same slice.**

Six columns, an immutability trigger and a CHECK constraint shipped to hold a dated catalog-price
snapshot. The editor hardcoded `catalogPriceId: null` and never offered the basis that would set it,
so **not one of them could ever be written**. The trigger was guarded on a column that was always
null and could never fire; the CHECK could never be exercised; and the migration's own header
claimed the two records were "linked by id and by a dated snapshot" — false in the shipped product.

Nothing failed. Typecheck passed, the build passed, the tests passed, and the next session reading
the schema would have concluded the feature was there.

*Rule:* **a column is not shipped until something writes it and something reads it back.** For every
new column, name the write path and the read path before merge; if either is "later", say so in the
record rather than letting the schema imply otherwise. The cheap check is a query that would be
non-zero if the feature worked — `select count(*) where <new column> is not null` — and knowing, in
advance, which user action makes it non-zero.

## A proof can be sound about the wrong artifact (2026-09-03)

Two independent misses in one session, same shape. Both proofs were correct. Both proved something
adjacent to the thing that mattered.

**Miss 1 — the resting state is not the capability (#885).** The `get_tenant_people` gate repair
was reported as a no-op for every current user, on the strength of a production measurement. The
measurement was of the *resting state*: both operator accounts happen to sit at
`active_tenant_id = NULL`. One click of Act-as in Fleet Console falsifies it —
`operator_enter_tenant()` sets `active_tenant_id` and writes no `tenant_members` row by design, so
the operator's roster read went **3 rows → 0**. A shipped capability, silently removed, because the
population that exercises it was dormant at the moment of measurement.

**Miss 2 — the predicate is not the call site (#892, caught by peer review BEFORE merge).** A
workspace-binding guard was proven on production across three cases under a simulated JWT
(`set_config('request.jwt.claims', …)`). The predicate was right. The *code* called it on the
**service-role** client, where `auth.uid()` is NULL, so `current_user_tenant_id()` would have
returned NULL for every caller and the guard would have refused **all nine CRM tools for all nine
active operators** — a total outage, from the fix for a latent leak. Nothing shipped: the §39
peer-gate found it on the pushed diff. A SQL proof structurally cannot fail on the client choice,
because no client exists inside it. `deno check` cannot either — both clients are the same
TypeScript type.

*Rule:* **name the artifact your proof actually exercises, and check it is the one that ships.** A
`set_config` proof exercises the SQL, not the caller. A count of who is affected today exercises the
data, not the capability. Before reporting a change verified, ask what could be wrong that this
proof is structurally incapable of detecting — and say that out loud in the record rather than
letting a green result imply coverage it does not have.

*Corollary, cheap and specific:* in `paige-ai-chat`, any RPC keyed on `auth.uid()` —
`current_user_tenant_id`, `get_paige_persona_context` — must be called on `supabaseClient` (L577,
carries the caller's Authorization header), never `supabase` (L589, service-role). The file states
this at L1571 and it was still got wrong 7,400 lines later.

---

## A test double more generous than the real client cannot catch a grant (2026-09-04, #924)

**Symptom.** A one-line change to a browser `select()` passed 1,454 tests, a clean build and a
green type ratchet, and would have blanked Solo Settings → Connections → Registration for every
workspace on deploy.

**Root cause.** `hasLeftPreparation` reads eight columns, three of which (`brand_sid`,
`campaign_sid`, `messaging_service_sid`) the query never asked for — and its own comment
deliberately treats an unrequested column's `undefined` as "no value", so three of the server's
eight immutability conditions were silently inert. The obvious repair is to select them. But
`20261201000600` REVOKED select on `tenant_a2p_registrations` from `authenticated` and re-granted
a column list that excludes exactly those three, so PostgREST answers `permission denied for
column`, which the hook correctly reports as `unreadable`, which renders the whole surface as a
retry card. Every UI test still passed, because the mock's `select()` ignored its argument and
returned the whole fixture row.

**Why the proofs could not see it.** A double that returns whatever it is asked for is not a model
of PostgREST; it is a model of a database with no column privileges. Grants are precisely the class
of behaviour it erases. The §39 peer-gate caught it by reading the migration, not the test.

*Rule:* **when a fix is "just ask for one more column", check the grant first.** Column-level
`GRANT SELECT (...)` is used deliberately on this platform to keep identifiers out of the browser,
and the fix for a predicate that needs them is a server-computed boolean — `comms-a2p-register`
already returns `has_brand` / `has_campaign` / `has_messaging_service` for this exact reason — not
a wider select. And when a double stands in for a privilege-bearing client, either make it honour
the projection or assert the column list directly; `settings.registration-business.test.tsx` now
does both.

*Second, smaller rule from the same PR:* a shipped capability can be missing a **writer** rather
than a UI. No function in the product wrote four columns `missingProfile()` requires, so a filing
was structurally unreachable for every Solo tenant and no screen said so. When a readiness list
never empties, check that something writes what it is checking.

---

## Cataloguing a signal by what it holds today, instead of what it can hold

**2026-09-04, Systems Check grounding.** An eleven-agent pass catalogued 101 tenant signals against
live production and recorded a status for each. It was careful, sourced, and wrong in a way no
amount of care would have caught, because the method itself was the defect: **each signal was
classified by the value one workspace happened to hold on the day it was read**, not by the set of
states the signal can occupy.

The tell was that two words in an eight-word closed vocabulary — `PENDING PROVIDER` and `PAUSED` —
came back unused. That reads like the vocabulary is too big. It is not. Both had real, reachable
sources, and one was **occupied on production at the moment of the read**: the only
`tenant_email_domains` row sat at `status='verifying'`, with a live provider id and three DNS records
written. That workspace had done its part and the provider had not answered. The catalogue recorded
it `NOT_CONNECTED` — which tells an owner to go and do something they have already done.

Two further consequences only a state-space read surfaces:

- The persisted finding store is CHECK-constrained to `pass | fail | skip | error`, so **no signal
  read from it can ever express `PENDING PROVIDER` or `PAUSED`.** Those two words must come from the
  live source table that actually holds the state. Nothing in a per-signal snapshot reveals this.
- `suspended` is a live CHECK value on six tables, written by Twilio, by a platform operator, and by
  an agency admin — a capability switched off **by someone who is not the owner**. Zero rows sit in
  it today, so a value-based catalogue cannot see it at all, and none of the eight words fits it.

*Rule:* **when you catalogue a status, read the source's own CHECK constraint or enum, not the row.**
The row tells you where one tenant is standing. The constraint tells you where anyone can stand, and
that is what a status vocabulary has to cover. A vocabulary word that comes back unused is a prompt
to go looking for its source, never evidence that the word is surplus.

*Corollary:* an unoccupied-but-reachable state is a real finding and belongs in the record with its
occupancy stated honestly — "reachable, zero rows today" — so the next session knows it was
considered rather than missed.

## An OMITTED field is not an EMPTY one (OAuth `scope`, 2026-09-05)

`postToken` read a token response's scope as `str(body.scope)?.split(...) ?? []`, so a response
that simply did not carry `scope` produced ZERO scopes. RFC 6749 §5.1 makes `scope` OPTIONAL
"if identical to the scope requested by the client", and a `refresh_token` grant sends no scope,
so servers commonly omit it. Silence meant "unchanged"; we read it as "nothing".

The cost was not a bad label. Every downstream scope assertion failed, the caller **revoked the
token it had just been issued**, and the provider had already invalidated the old refresh token by
rotating it. The grant became unrecoverable and the only way back was a full re-authorization —
once per token lifetime, indefinitely. It presented to the owner as "we get disconnected from our
tools every time the platform updates", which pointed at deploys and was nothing to do with them.

*Rule:* **when a protocol says a field is optional, decide explicitly what its ABSENCE means, and
write that meaning down at the parse site.** `?? []` is a default, not a decision, and it silently
asserts the most restrictive possible reading of silence.

*Corollary, found by reading the fix's own diff:* the first repair used
`typeof body.scope === "string" ? parse : requested`, which also swallowed a present-but-MALFORMED
value and read it as agreement. The RFC gives meaning to an omitted field; it gives none to a
broken one. Absent → the requested set. Present → parsed strictly, and refused if it disagrees.

*Diagnostic note (§13):* a failed refresh left NO trace — `last_error` stayed `NULL` and no Rail
row was written, because the verify path throws before it reaches `probe`. Four `oauth_success`
events in twenty hours were the only visible evidence that anything was wrong. A failure path that
records nothing is why this took a live report to find.


---

## Asserting that a warning APPEARED, without asserting what it SAID

**2026-09-05 · Systems Check partial-coverage banner · PR #933**

The owner photographed his own console showing:

> **The picture is incomplete.** The last run recorded **10** checks but only **10** results are
> readable here.

Ten and ten. The sentence contradicts itself, and it was doing so on **all 15 tenants**, on every
scan. Across 941 runs since 2026-08-10 the condition that sentence describes had occurred five
times, and every one of those five was *also* a run that never finished — a state the sentence never
mentions. So the one message the component could print **had never once been true while displayed.**

The mechanism was ordinary: three independent conditions raised one flag, and the render branched on
whether the finding list was empty rather than on *which* condition fired, so every non-empty case
printed the sentence written for one of them.

**The part worth keeping is why the test suite did not catch it.** The obvious diagnosis — "no
fixture had that shape" — is wrong, and I shipped that diagnosis in a commit message before checking
it. Two fixtures already had the exact shape, and rendering the pre-fix component against them
prints the contradictory sentence, twice, inside a green suite. What was missing was any assertion
that read the message. Every test asserted `toContain("The picture is incomplete")` — the first four
words, the part that is identical no matter which branch produced it — and then stopped.

*Rule:* **asserting that a message appeared is not asserting that the message is right.** For any
text that varies by branch, assert the varying part, and add a negative assertion for the specific
wrong output — the one here is `not.toMatch(/recorded (\d+) checks? but only \1 /)`, which catches
the identical-number form generally rather than one instance of it. A fixture cannot catch what
nothing asserts on, so "we need a test for that case" is usually the wrong repair; the case is often
already covered by a test that is not looking.

*Corollary, found the same night:* two assertions in that file — `not.toContain("All available
checks are clear")` and a sibling — named strings that appear **nowhere in the component**. They
could never fail. A negative assertion against a string that does not exist reads as a guard and is
one, of nothing. Grep the string before trusting a `not.toContain`.

---

## A summary and the list beneath it must be derived from the same place

**2026-09-05 · Systems Check strip vs. sections · PR #933, three reviewers**

The same surface carried a header strip ("10 checks · 6 passed · 3 need attention") above sections
listing those findings. The strip read the run row; the sections read the findings. They agree right
up until the two sources diverge — and they diverge on ordinary, reachable states:

- **A resolved failure.** `fail_count` records what the scan saw *at scan time*; resolving a finding
  afterwards does not rewrite it. The strip said "1 needs attention" directly above a section saying
  "Nothing from the last check needs you", with nothing to explain the gap.
- **A crashed run.** Counts are patched at the end, so the row reads 0/0 beside real findings.
- **A resolved *unevaluable* finding.** The banner counted raw status, the strip counted through a
  filter that reclassifies resolved — zero and one, for one quantity, forty lines apart.

*Rule:* **derive every figure in a summary from the collection the reader can see, not from a stored
tally that describes it.** A stored count is a snapshot of a different moment; the list is now.

*And the corollary that cost a second round:* once the tallies derive from the list, **every member
of the list needs a bucket**, or the summary stops adding up. Removing the wrong number that used to
fill the hole left "1 check · 0 passed · 0 need attention" — accounting for none of the one check it
claimed. Codex caught that; I had spotted it an hour earlier and reasoned my way out on the grounds
that "no number claims to be the total of the others," which is false whenever one of them is
`total`.

*Process note worth its own line:* three review layers ran on this change — an adversarial crew on
the pushed diff, Codex on the PR, and my own re-read — and **each caught a different defect that the
other two missed.** The crew found the wrong denominator and a test that pinned the bug; Codex found
the summary hole the crew's fix opened; the re-read found a comment asserting the opposite of the
truth. None was redundant.

---

## A test double that discards its arguments is not a test — it is decoration (2026-09-05)

Writing the tenant revenue-check runner, CC shipped seven tests that all passed and proved nothing
about the query. The double declared `eq() { return builder; }` — arguments thrown away — and
resolved on the table NAME alone. Mutation proof under CI's exact flags: with **both**
`.eq("tenant_id", tenantId)` calls **and** the `.eq("stage_type", "won")` predicate deleted from the
runner, **7 of 7 passed**.

This matters more here than in most code. A systems-check runner executes as **service-role**, so
there is no RLS underneath it to catch a missing tenant filter — the test is the only thing standing
between an omitted `tenant_id` and a cross-tenant read. The four most expensive bugs in this
codebase (#86, #130, #172, #588) are all that omission.

**The rule:** when a test double stands in for a query, it records what was asked for, and at least
one test asserts it. Verdict assertions test what the code CONCLUDES; only filter assertions test
what it ASKED. A suite with no assertion in the second class cannot fail on the defect class that
actually costs money here.

**And the meta-lesson, which is the third time this session:** the vacuity was invisible to its
author and obvious to three independent reviewers, who found it separately. CC had explicitly
resolved *earlier in the same session* not to ship another vacuous assertion, and then did. A
resolution is not a control; the mutation run is. Mutate the thing under test and watch the suite go
red — if it does not, the suite is decoration, whatever its count says.

*Also from the same gate, worth its own line:* two independent refuters reached **opposite verdicts**
on the same finding, and both were partly right — one measured production (zero occurrences today),
the other traced the mechanism (reachable by real shipped callers). The resolution was neither
verdict but a third reading: the proposed fix would have introduced a false FAIL, so only the honest
half — an over-claiming sentence — was changed, and the reasoning was written into the module header
so the next session does not re-argue it.

## When two readers disagree, the bug is usually that BOTH are lossy (2026-09-05, Spine #40)

**The shape.** Two readers answered the same question about the same workspace and gave opposite
answers. The instinct — the one that had to be actively resisted — is to work out which reader is
*right* and make the other match it. That instinct was wrong, and it would have shipped a
regression while looking like a fix.

**Why.** The two readers were not answering the same question badly. They were answering
**different questions** and both presenting the answer as if it were the whole truth:

- *Does a value exist at all?* — yes, in a legacy record.
- *Did the owner confirm it?* — no.

One reader answered the first and dropped the second; the other did the reverse. Each was locally
defensible. **Picking a winner would have preserved one true fact by continuing to erase the
other** — which is why "make the wrong one match the right one" is not a reconciliation, it is
choosing which half of the truth to keep losing.

**The tell that this is the case you are in.** Both answers survive contact with the data. If you
can look at the source rows and say "well, they're both sort of right", you are not looking at one
bug and one correct reader — you are looking at **one field carrying two facts**, and the fix is to
decompose it, not to arbitrate it.

**The corollary that found a second defect.** Once the fields were decomposed, the same question was
asked of every neighbouring fact rather than only the two that contradicted. `industry` turned out
to be wrong in exactly the same way for **twice as many** workspaces — and nobody had ever noticed,
because it had no second reader to contradict it. A contradiction is not the defect; it is the
**only symptom loud enough to be seen**. Sweep the siblings, or you fix the one that made noise and
leave the ones that did not.

**And a third, in the opposite direction.** `primary_business_email` defaulted to
"present from a connected account" whenever a value existed with no provenance recorded — on
production, that was every workspace holding one. The first defect invented *absence* from a value
that existed; this one invented a *source* from a provenance that did not. Both are the same rule
broken: **state only what a row proves.** A default that fills in a plausible provenance is a
fabricated fact wearing the clothes of a sensible fallback.

**Where the fix goes when the readers have different caller gates.** The obvious move — have one
reader call the other — was wrong here, and the reason generalises: the two gates were genuinely
different (one tenant-scoped, one the §59 global predicate), so calling through would have imposed
one reader's authorization on the other's callers. Measurement said every current user passes both,
which is precisely the argument that tempts you to collapse them. **A latent difference is not a
licence to collapse it.** The shape that works is a shared *internal resolver* both readers derive
from, with each keeping its own gate, its own tenant resolution and its own response shape.

**Sweeping the siblings is not the same as finding the other READERS, and the section that enumerates
readers is the one most likely to stop early.** This change carried a section titled "A third answer
exists, and is deliberately left alone" — written precisely to catch a reader nobody had inventoried.
It named one (an A2P echo) and stopped. The §39 peer-gate then found a **third reader of a different
field**: Setup's own `get_solo_business_context()` and its client hook both default
`primary_business_email` to `connection_sourced`, exactly as the readiness reader did. Correcting the
readiness reader alone would have made PAIGE and the Setup badge disagree about one field in the same
second — **the defect being fixed, newly created by the fix.**

Two things generalise. First: **finding one third reader feels like having finished**, and that
feeling is the bug; the enumeration is per FIELD, not per change. Second, and sharper: **a correction
that leaves two of three readers untouched is not a partial fix, it is a new defect.** Three readers
agreeing on a falsehood is a smaller problem than two readers disagreeing, because the disagreement
is what a human sees. The right move was to unbundle the correction and ship it where it can move all
three together — even though that meant shipping *less* truth in this change than the draft claimed.

**Make the resolver unreachable rather than defended.** It takes a tenant parameter, which is
exactly the input a caller must never supply. Rather than adding a third gate inside it, `EXECUTE`
was revoked from `PUBLIC`, `anon`, `authenticated` and `service_role` — so only the already-gated
`SECURITY DEFINER` parents can invoke it, and the surface that would accept a caller-supplied tenant
does not exist. A gate can be reasoned around; an absent grant cannot.

## A `file:line` citation is a moving target, and a rotted one is worse than none (2026-09-05, #45)

The governed MCP door shipped a capability policy whose whole selling point, stated in its own
header, is that a reviewer can re-verify any verdict without re-reading a 5,900-line file. Every one
of its 350 line citations was correct when written and wrong by the time it merged: three later
commits in the same session inserted 163 lines above them.

**The failure is not "the numbers drifted", it is that a confident wrong pointer is worse than no
pointer.** No citation makes a reviewer read the handler. A wrong citation sends them somewhere
specific, they find unrelated code, and the honest conclusions of the whole table become
un-checkable in one motion. Evidence that cannot be re-derived is indistinguishable from evidence
nobody gathered — which is the exact §13 property the field exists to provide.

**The fix that would have been wrong: applying the offset.** The peer gate measured the drift as
uniformly +3 and offered that as the repair. It was +3 against the commit the gate read, and already
larger by the time the fix was written — a second wrong-but-confident answer, arrived at more
carefully. **An offset is a claim about a diff; a mapping is the diff.** Rebuilding old→new line
numbers with a line-level `SequenceMatcher` and rewriting through it costs the same effort and does
not go stale mid-repair.

**And the repair has to prove itself, not merely be internally consistent.** A remap that renumbers
every reference coherently can still be uniformly wrong. The assertion that mattered was
content-identity: for each of the 350, the line it now names must be *byte-identical* to the line it
named at verification. That check is what turns "I remapped them" into "they are right", and it runs
in seconds.

**Generalises to any evidence that names a position rather than a thing.** Line numbers, array
indices, migration ordinals, screenshot coordinates. If a citation must survive later commits in the
same branch, either re-derive it at the merge commit with a self-proving remap, or cite something
stable — a symbol name, a unique string — instead of a position.

## A completion check over a set nothing has populated yet is trivially true (2026-09-05, #45)

A CI watcher declared **"ALL CHECKS COMPLETE"** on a freshly pushed head and it was reported as
green. It was not: at the moment it polled, GitHub had registered only the two preview checks on
that commit, and `all(status == "completed")` over those two was true. The five workflows that
actually matter — including the one carrying the full test suite and every lint — had not been
created yet.

**`all(...)` over an empty or barely-populated collection returns true, and that is the whole bug.**
The predicate was written to answer "has everything finished?" and instead answered "has everything
I can currently see finished?", which at t+2s is a different question with a much more comfortable
answer. The same shape appears anywhere a guard iterates a list it did not first prove was complete:
zero findings from a parser that matched nothing, zero leaks from a scan whose glob missed the
directory, zero failures from a suite that collected no tests.

**The fix is a floor, not a smarter predicate.** Require a minimum population before the completion
question is allowed to be asked at all — *at least four runs must exist* before "all complete" can
mean anything — and fail closed below it. Several guards in this repo already do exactly this
(`policy.length < 40`, `chat.declared.length < 50`, `keys.size < 40`, each with a comment saying a
regex that matches nothing reports a clean bill of health). The watcher was written without one.

**The second half: a watcher must emit on failure, not only on success.** The same script filtered
to terminal conclusions but had no floor and no explicit failure line, so a red run and a run that
never started produced identical silence. Silence read as "still fine". Before arming any watch, ask
what it would print if the thing being watched had already crashed — if the answer is "nothing", the
filter is wrong.

## A `toContain("## X")` heading assertion passes on `### X` — anchor it to the line (2026-09-06, #1017)

The doc-export regression test asserted `expect(md).toContain("## Scope")` to prove a `section-header`
block rendered as an H2 beneath the document's H1 title. It was green. The real output was `### Scope`
(H3) — the block had been coerced one level too deep, and the markdown serializer added a title-offset
on top. **`"### Scope"` contains `"## Scope"` as an offset substring** (drop the first `#`), so
`toContain` matched and the test verified H2 while the code emitted H3. A section rendering deeper than
a plain top-level heading shipped invisibly behind a passing assertion.

**A substring assertion on a prefix-delimited format cannot distinguish `##` from `###` from `####`** —
every longer run of the delimiter contains the shorter one. The same trap sits under any `toContain`
on markdown headings, list bullets (`-` vs `- ` inside `-- `), blockquote depth (`>` vs `>>`), or an
indentation level. The assertion reads like it pins the level; it pins only "some line has at least
this many hashes somewhere in it".

**The fix is a line-anchored regex, not a longer substring.** `expect(md).toMatch(/^## Scope$/m)` matches
only a line that is *exactly* `## Scope`, and fails on `### Scope`. Whenever a test's whole point is the
LEVEL of a prefix-delimited token — heading depth, nesting, indent — anchor to the line (`^…$` with `/m`)
so a one-level regression cannot pass on the shorter token hiding inside the longer one. Caught here by a
§39 adversarial re-read of the FINAL diff, not by the green suite — the substring green was indistinguishable
from a correct green until someone computed the actual output by hand.

---

## A shared governance seam must carry the full intersection, or one door re-opens what another closed (2026-09-12)

The Capability Gateway decides what Chat may SEE; `decideGovernedExecution` decides what any caller
may RUN. For a while those were two separate truths: the gateway hid a capability from Chat, but
nothing at the shared seam re-checked the same status, so the capability stayed reachable from an
MCP client, a durable job, or a delegated subagent. **A capability hidden in one door is not hidden
until the SHARED seam every door converges on re-resolves the same fact.** The fix was to extend the
seam with the capability-status dimension (a step-5.5 gate), not to make the gateway stricter — the
gateway is not on the MCP/job/subagent path. General lesson: when admissibility and execution are
decided in different places, the EXECUTION place is the one that must carry every dimension, because
it is the one no door can skip.

**And the adoption honesty:** the new dimension is OPTIONAL and does not fail closed on absence — the
deliberate exception to this seam's "absent = refuse" rule — because fail-closed on a
freshly-added dimension would refuse every un-migrated caller (every current read) the instant it
shipped. An incrementally-adopted gate says `"unknown"` for callers that have not wired it yet and
names their adoption as sequenced follow-up, rather than pretending enforcement is universal (§13).
The class of mistake this avoids: claiming a cross-cutting guard is "enforced platform-wide" when it
is enforced only where callers opted in.

---

## A parallel array and its consumer drift apart silently — the "dropped signal" class (2026-09-12)

**What happened (twice).** The capability manifest's `buildCapabilitySignals` returns a hand-written
array of signal objects, while a separate `CapabilityFacts` interface declares the facts and the
`index.ts` gatherer passes them. Twice now, a rewrite of the return array dropped ONE capability
(`integrations.list` during the #1166 rewrite; `integrations.n8n_run_workflow` during the 2026-09-12
Slice 1 rewrite) while the interface field and the gatherer's passed fact stayed in place. Nothing
failed at transpile — the unused fact is just ignored — so the omission was invisible until a test
asserted on the missing key (`m["integrations.n8n_run_workflow"]` → undefined).

**Why a green transpile missed it.** TypeScript does not flag an interface field that a function
chooses not to read, and it does not flag a parallel array that is "one element short" — there is no
declared length. The array and its facts are coupled only by convention, so they drift silently.

**The lesson (the class, not just the fix).** When a hand-maintained list must stay 1:1 with a
separate declaration (an interface, an enum, a registry), the proof that catches drift is an
EXPLICIT completeness assertion, not the type-checker and not the feature tests. The signals suite's
`ALL_KEYS` equality check (`expect(keys).toEqual(ALL_KEYS)`) is exactly that guard — it is what
turned both silent drops into a loud red. A feature test that only asserts "research resolves
needs_setup" would have stayed green with n8n missing; the whole-manifest key-set assertion is the
one that cannot. Keep that assertion, and extend `ALL_KEYS` deliberately whenever a capability is
added — the friction of updating it IS the check.

### A source-assertion test is a CONSUMER of the code it reads — inventory it before refactoring (2026-09-12)

**What happened.** Refactoring the chat dispatch's inline action-class clamp
(`const classForClamp = classifyAction(...); if (autoMode === "auto" && ...) autoMode = "confirm"`)
into the shared `clampLaneByRisk` helper removed those exact literals from `paige-ai-chat/index.ts`.
A test in a DIFFERENT area — `src/solo/paige-team-capability.test.ts` — read the handler's SOURCE and
asserted it `toContain('autoMode === "auto"')` / `'classForClamp === "high"'`. The refactor made those
literals vanish, so the test's `HANDLER.indexOf("const classForClamp = classifyAction(")` returned -1,
its slice went empty, and it failed in CI `verify` (not caught by the capability unit tests, which pass
through a transpile port and never read the dispatch source). The §39 re-review verified the runtime
behavior was identical but did not run the full vitest suite, so the source-assertion consumer slipped
through to CI.

**The lesson (the §37 class).** A test that asserts on the *source text* of a file is a CONSUMER of
that file's exact spelling, the same way a caller is a consumer of a function's signature. When a
refactor changes a literal that such a test pins — even a behavior-preserving one — that test breaks.
Before refactoring a load-bearing code region, grep the test tree for source-assertions against its
literals (`grep -rn 'toContain.*<the literal>'`), not just for callers of the symbol. And a local
proof that runs only a *subset* of tests (the ones you edited) cannot see a consumer in an area you
did not touch — the full `vitest run` (or the CI it mirrors) is what catches it. Prefer behavioral
assertions over source-string matching where the behavior is importable: this fix replaced the broken
source-slice assertions with direct `clampLaneByRisk(...)` calls (real code), keeping only the one
source check that genuinely needs source (the clamp is APPLIED above the branch it protects).

## A direct Edge route must enforce the governed truth ITSELF — the acting tenant is the CALLER's, never the target's (2026-09-13)

**What happened.** `skill-runner` ran `draft_and_email_document`, `build_game_plan`, `verify_business_sos`,
and the interpreter path by deriving the acting tenant from the REQUEST — the target `contact_id`'s own
tenant (an unscoped `clients` lookup), or `body.tenant_id`, or `body.invoker_kind` — instead of the
authenticated caller's server-resolved tenant. A caller could pass another tenant's `contact_id` and the
function would draft/email/read under tenant B's identity (the §9 cross-tenant leak), and `body.invoker_kind`
was trusted to skip the first-run admin-confirmation gate (spoofable authority). The function leaned on
upstream callers (Chat/MCP) to have governed the call; the DIRECT Edge route governed nothing itself.

**The lesson (the class).** A callable seam with an external effect must re-resolve actor, tenant,
role, and authority SERVER-SIDE from the verified credential, and scope every subject lookup to the
caller's own tenant — `.eq("tenant_id", callerTenantId)`, so a cross-tenant id resolves to *nothing* rather
than leaking. Never derive the acting tenant from the thing being acted ON (a contact, a business) or from
any request-body field; those are inputs, not authority. "An upstream door already checked" is not a
property of THIS route — every door enforces the full governed decision itself (the §BRAIN "shared seam
carries the full intersection" lesson, applied to a second door). The fix routes skill-runner through the
canonical `decideGovernedExecution` and binds the one external send to a durable, single-use,
fingerprint-bound approval in the existing `paige_pending_confirmations` table — never a parallel system.

**The proof class that missed it.** There was no negative test driving a *cross-tenant* `contact_id`, a
*spoofed* `invoker_kind`, or a *replayed/forged* approval against the route — only happy-path runs. A seam
whose whole job is authority is unproven until its refusals are proven: the new matrix
(`src/__tests__/skill-runner-governed.test.ts`) asserts same-tenant allowed, cross-tenant denied,
service-principal denied, body-tenant inert, and missing/expired/replayed/forged/cross-target/minting-request
approvals all denied with NO send and NO receipt. The JWT→tenant derivation itself lives in Deno and is the
authenticated-live-drive class of proof, owed separately — a unit test of the pure decision cannot stand in
for it.

**A second proof-class miss the §39 peer-gate + §5 compliance caught (and the author + integrator did not).**
The first cut reported a FAILED external send (Resend 4xx/5xx, or a missing key) as `status: "succeeded"` —
the pure flow returned `{kind:"sent"}` unconditionally and the host mapped it to HTTP 200/succeeded, while the
durable `paige_skill_runs` row and `communication_log` were honest. The integrator's own review fixed the
`communication_log` half but missed the response-status half; the test's injected `send` double **always
returned `{ok:true}`**, so the failed-send path had zero coverage. TWO independent reviewers (adversarial +
compliance), reading the real pushed diff, both surfaced it — the exact §39 value: a defect the proof's own
assertions structurally could not reach because the double never failed. Lesson: when a seam has an external
effect, the test double must exercise the effect's FAILURE, and "a fire is not a delivery" (§13) binds the
response contract, not only the durable record. Fixed with a distinct `send_failed` outcome → a
502/`status:"failed"` response (consume-then-execute means the one-time approval is already spent, so the
caller re-drafts) + a failed-send test.

## A same-tool approval BATCH collapses to the exact fingerprint, and drift turns the gate into a silent re-ask loop (2026-09-13, the P0 confirm loop — emergency fix, live proof owed)

**Symptom (owner-reported, production).** An owner-confirmed `action_advance` dismissal repeatedly
re-issued a fresh confirmation/fingerprint and then "failed flat"; a separately requested bug report
also failed to create. Nothing was dismissed, filed, or sent.

**What is GROUNDED vs what is OWED (say which, §13/§32.c).** The loop MECHANISM is established by
reading the DEPLOYED SOURCE, not by tracing the live incident: the `#711` `paige_tool_confirmations`
token path is unwired in `paige-ai-chat`, so the live gate is `paige_pending_confirmations` +
`confirmFingerprint` + a request nonce; within a BATCH of same-tool proposals the ONLY disambiguator
is the exact fingerprint, which a drifted hashed arg on the approval turn defeats, both fallbacks then
refuse on ≥2, and the drifted fp records a NEW `"created"` proposal — a self-reinforcing re-ask loop.
(#1166 had closed only `decision_rationale` drift.) What is NOT established from here: the actual
failing request's confirmation/action rows and the server error category — that needs prod log/DB
access this session does not have. So the diagnosis is a grounded SOURCE reading, not a runtime trace
of the incident, and the fix is not "fixed" until the authenticated battery passes after deployment.

**The fix, and the distinction that matters.**
- **Repair (containment of the loop into a resolvable map):** disambiguate a batch by the ONE field
  the model reproduces verbatim — a required, stable subject id (`action_advance.action_id`), matched
  WITHIN the operator's already-approved fingerprint set (never widening what is claimable; stored args
  still execute).
- **Containment (the owner's explicit ask):** an un-pinnable approval yields ONE truthful terminal
  ("Action execution is temporarily unavailable; nothing changed or sent." + the action ref + a
  correlation id) and records NOTHING — never a silent re-ask. **A silent livelock is worse than an
  error**; the cure is an honest terminal, not a better retry.
- **Honesty (§13/§70):** "file a bug report" routes to `improvement_propose`, which refused a
  tenant-less God/operator caller by THROWING — a generic error the prose could paper over as "filed."
  It now returns an explicit "nothing was filed."

**Proof boundary (keep the label honest).** The CONTAINMENT is LOCALLY PROVEN — fail-closed logic +
unit/wiring tests show an un-pinnable approval cannot loop and cannot execute. The REPAIR firing rests
on one unproven runtime assumption — that the `args->>action_id` jsonb filter matches the approved row
on the deployed chat — whose failure mode is safe (0 matches → the honest terminal). So the loop is
CONTAINED; whether the batch REPAIR actually fires, and the full owner battery (benign dismissal, batch
resolve, expired/replayed/forged/cross-tenant, receipt/Rail, no-outbound), are PROOF OWED on the
deployed surface. Do not report "contained" as "fixed" until that battery passes post-deploy.

**How to catch this class.** For any confirm-gated tool proposable in a BATCH: ask what maps each
re-emitted call to its approved proposal, and whether that key survives the model re-authoring its
arguments next turn. If the only key is the full-arg fingerprint, a batch loops the moment one arg
drifts. Bind the mapping to a required, stable, model-reproduced id — and make the un-pinnable case an
honest terminal, not a re-ask. **Accepted edge (noted so it is not rediscovered as a new loop):** if
the model drifts the SUBJECT id itself, the narrow finds 0 matches and a fresh card is recorded — the
premise is that `action_id` is reproduced verbatim; subject-id drift is a separate, accepted edge.
### A code anchor proves a path EXISTS — never that the provider WORKS; couple the claim to code via a CI-resolved, controlled-kind anchor (2026-09-13)

**What happened (the gap this closed).** The Integration Capability Registry catalogued 23 providers with
a DELIVERY status (LIVE/PARTIAL/PROOF_OWED/…) but nothing coupled a "this is built" claim to the real code
that backs it — exactly why Upload-Post and fal.ai merged owing entries (its own `registry_steward_role`
note named the mechanism gap). The fix: a `code_anchors` field citing the real adapter/entry-point code,
plus a `findDeadCodeAnchors` CI resolve that fails on a cited path missing from disk (reusing the binding
-ledger's `findDeadAnchors` pattern, §18 — no new lint).

**The lesson (two durable halves).** (1) A doc field that ASSERTS something is built must be mechanically
coupled to the artifact it claims, or it drifts and lies with authority (§BRAIN) — the binding-ledger
already proved this for surfaces; the same dead-anchor resolve is the right tool for any registry that
cites code. (2) **A code anchor proves only that a relevant code PATH EXISTS — never that the provider
works, is connected, available, or customer-ready, and it must NEVER raise status** (§13/§32 — the
existence≠function distinction, the sibling of "a green build is not a working render"). Enforce the
distinction in the data with a controlled, lint-enforced `role` vocabulary where the only "it genuinely
runs end-to-end" kind (`proven_runtime`) requires real §32.c authenticated proof and is used by default on
NOTHING; a contained/refusing path (e.g. a 503) is anchored as `fail_closed_containment` precisely so it
can be traced WITHOUT ever reading as LIVE (Meta's social 503 is the anchor case). And every provider must
cite ≥1 PROVIDER-SPECIFIC path — a generic dispatcher/router (model-router, generic send-message, generic
mcp-client) is traceability padding, never sole evidence a specific provider is wired.

**The Codex-hardening half (a guard you can evade by malforming its own anchor field is not a guard).**
The first pass gated the `code_anchors`-contract check behind `field_schema && typeof === "object"`, so a
`null`/string/number/**array** `field_schema` short-circuited it — CI would have accepted a registry with
the entire newly-required accountability contract silently removed. An independent Codex pass caught it
(P2), not my §39/§5 crew: the honesty guard had a hole in exactly the field it exists to enforce. The
durable rule: **a check on a container's CONTENTS must first prove the container's SHAPE** (non-null,
non-array object), THEN read its contents — and the self-test must replace the container with each wrong
type (`null`/string/number/array), not only mutate a value inside it. This is why three independent review
layers (§39 adversarial + §5 compliance + an external reviewer) and CI are LAYERED, never substitutes: the
pass my own crew missed is exactly the pass the third reviewer caught (§39's own "none alone is sufficient"). Proven across FOUR external catches on this one PR: (a) a non-object `field_schema` that skipped the contract; (b) a Deepgram seam mis-attributed to ElevenLabs; (c) DIRECTORY anchors that could not detect file-level drift — so an anchor must name an exact adapter FILE and the resolver must require a file, not a directory; and (d) an ORPHAN anchor (an unimported `_shared` helper) standing in for the reachable client that actually backs the provider — so an anchor must point at code that is actually REACHABLE/called, not merely provider-named-and-present. "Exists" has three distinct failure modes a naive check misses: wrong provider, wrong granularity (dir vs file), and unreachable (orphan).
### A service-role write that stamps a client-supplied reference bypasses the RLS that would validate it (2026-09-13)

**What happened.** `crm_create_task` recorded a task's originating conversation by stamping
`tasks.source_thread_id` from the request-body `threadId` — through a SERVICE-ROLE insert. The
service-role client bypasses RLS, so the thread id was never checked against the caller: a client
could POST another tenant's thread id (or a forged uuid) and the task would record it as provenance.
It read as safe because "a dangling uuid grants no read" (the thread stays RLS-gated on its own), so
no transcript leaked — but it is a §9 integrity hole and exactly the "client-supplied id stamped on
faith" the owner forbids. The tell that masked it: the insert correctly server-resolved `tenant_id`,
so the row LOOKED tenant-safe; the foreign-reference field riding alongside it did not get the same
scrutiny.

**The lesson (the class).** When a service-role (RLS-bypassing) write stamps a field that REFERENCES
another tenant-scoped row — a foreign key, a thread id, a contact id, any "this belongs to X" pointer
— and the value originates from the request (body or model), that field must be VALIDATED on the
CALLER's RLS client before it reaches the service-role write. Server-resolving the row's OWN
`tenant_id` is not enough; every client-supplied reference it carries needs its own owner+tenant
check. The validation belongs on the caller-JWT client (RLS-enforced) with explicit
`id`+`tenant_id`+`owner` filters — defense in depth — and an unresolved reference resolves to NULL,
never the unvalidated claim. Put the decision in one home so every writer of that reference shares it.

**How to catch it:** for any service-role insert/update, list every column whose value comes from the
request and is a reference to another row; each one is a potential cross-tenant stamp unless validated
on the RLS client first. "The row's tenant_id is server-resolved" answers only the row's own scope,
never the scope of what it points at.

### CRM mutation reach must be counted from the real command door, not tool names

A Chat tool name, human CRUD screen, direct service-role branch or draft PR can all make an operation look present while bypassing tenant authority, risk, idempotency, readback or Rail. The recurrence guard is a shared action-to-tool catalogue plus contract tests proving every exposed CRM tool dispatches to the single authenticated `crm-command` door. Consequential operations need a server preview that binds exact targets, versions and dependency counts; a model `confirm` argument is never approval. Result UI must render server readback and router-owned links, not reconstructed model prose. Source-complete still is not LIVE until database/RLS, authenticated account-switch and deployment proof pass.
### A route-level grep is not a guard audit — check the component before assigning severity

**What happened (2026-09-23, Platform Reach census).** The census reported two production routes as
carrying no auth guard: `/tenant-redesign` (`src/App.tsx:233`) and `/broker/app` (`:353`), both
mounted with only `PageSuspense` where `/app` (`:260`) wraps in `RequireCompleteSignup`. The
route-level observation was correct, and it was reported with an implied security severity that sent
both onward as bug fixes. Reading the components reversed it:

- `BrokerWorkspace.tsx:34-52` **guards itself** — `onAuthStateChange` bounces a signed-out visitor,
  and `getSession()` returns to `/auth` *before* the `user_roles` read. Fails closed.
- `src/prototype/TenantRedesign.tsx` is **deliberately public and dataless**; its own rendered copy
  says so — *"This public design route never invents CRM records."*

**The lesson (the class).** "Which routes lack a guard wrapper?" is a one-line grep and it produces a
list that LOOKS like a security finding. It is not one until two further things are established:
whether the component guards itself, and whether the data behind it is RLS-scoped server-side. A
client-side `navigate("/auth")` never protects data either way — **RLS does**. So an unwrapped route
is, on its own, a *consistency and reviewability* finding: the protection is invisible to anyone
reading the router. It becomes a security finding only where the server-side scope is also absent.

**How to catch it:** before assigning severity to any "surface X is ungated" finding, open the
component and answer (a) does it self-guard, (b) does it hold authenticated data at all, and (c) is
the server-side scope present. Report what you checked and name what you did not. The recurrence
tell is a finding phrased as a property of a *route table* rather than of a *data path*.

Recorded as [#1409](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/1409), which files the
accurate, downgraded version and withdraws the overstatement rather than quietly restating it.

## Do not measure a file an agent is still writing, then report it as your commit's state

**2026-09-24, PR #1394.** I grepped `scripts/ci/tool-catalogue-lint.mjs` while a crew agent was
mid-write, saw `await import("./tool-catalogue-lint.selftest.mjs")` at :217, confirmed that file did
not exist, and concluded the self-test could not run. That was TRUE at the instant I measured it.

By the time I ran `git add -A`, the agent had rewritten the file: `selfTest()` is now INLINE at :226
and there is no external import. The self-test works and its negative fixtures bite. But my commit
message on `1ffef5dd1` states the opposite as fact, and I repeated it to the owner.

The same race produced a second defect in the same stretch. `git status` showed two changed paths, so
I described the commit as two files. Between that check and the `git add -A`, the agent wrote two
more — including a 524-line new lint. `1ffef5dd1` shipped four files. Then `32ed90b10`, whose message
describes only an ACL correction, swept in 30 lines of `.github/workflows/ci.yml` and 3 of
`package.json` that I never read before pushing. Four new CI steps entered the pipeline on a commit
message about something else.

**The rule:** a working tree with a live agent in it is not a snapshot. Either the agents write to a
worktree of their own (`isolation: "worktree"`), or they return their work as data and the integrator
applies it — which is what I asked for and then undercut by handing them a toolset with write access.
`git add -A` against a moving tree is not staging; it is a gamble on timing.

**And the narrower one:** never describe a commit from a `git status` taken before the work finished.
Read `git show --stat` of what you actually committed, after committing, before writing the message
into a report. The diff is the only account of a commit that cannot be stale.

This is the same failure as the `20270412000000` citations and the receipt-ACL claim, in a third
costume: acting on a stale read of something that moved underneath.

## A migration version collision does not skip a file — it WEDGES the whole prod chain

**2026-09-24, PR #1436.** Two files shared version `20270106000000`: the durable-job weekly-summary
claims migration, which merged first and applied, and the Secure Browser control plane, which merged
second in PR #1046. I reported this as the second file being "silently skipped," reasoning that
`schema_migrations` is keyed on version alone so the later arrival is ignored.

**That is not what happens, and the difference is the whole incident.** The deploy log:

```
Applying migration 20270106000000_paige_secure_browser_control_plane.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20270106000000) already exists.
At statement: 93
##[error]Process completed with exit code 1.
```

`supabase db push` ran all 92 DDL statements, then failed on statement 93 — its own bookkeeping
`INSERT` — and rolled the transaction back. Then it **exited 1**. Every migration queued behind it
stopped. Production deploys had been failing for ~30 minutes across two merges, and the Long-Form
durable document engine the owner merged himself was stuck behind a collision in someone else's
feature. `main` carried 1079 distinct versions; production had 1077.

**What made it invisible:** three separate green signals. Both branches passed
`lint:migration-versions`, because `migration-version-collision-lint.mjs:97` resolves its base as
`origin/main` — a branch only ever compares itself to trunk, never to another open branch (#1425).
Both PRs' CI was green, because CI does not deploy. And the incident issue #198 exists and was
commented on twice, but it is a dedup issue 29 comments deep, so a new failure looks like the old one.

**The rules:**

1. **A red `deploy-migrations` run is a production outage of the migration pipeline, not one
   feature's problem.** Check it on any "why isn't this schema on prod" question before theorising.
   The count comparison is two queries: distinct versions in `supabase/migrations/` versus rows in
   `supabase_migrations.schema_migrations`. A gap is a wedge until proven otherwise.
2. **Read the deploy log before explaining the mechanism.** My "silently skipped" story was coherent,
   consistent with the evidence I had, and wrong. The log was one call away and said something
   materially different — that the chain was blocked, not that one file was missing.
3. **Un-wedging makes OTHER people's dormant SQL runnable.** Auditing my own migration was not
   enough; the merge is what executes the two Long-Form migrations queued behind it. Audit
   everything the unblock will run — destructive statements, dependency presence, and above all a
   `UNIQUE` index on a pre-existing table. (Theirs was safe: partial, `where work_id is not null`, on
   a column added in the same block, so zero rows were indexed at creation.)

Same root as the entries above it: I explained from a plausible model instead of measuring the thing
itself. The difference here is that the unmeasured part was not a detail in my account — it was the
severity.

## The trace's token counts exclude cached tokens, and the tenant-facing figure inherits it

**2026-09-24.** Anthropic's `usage.input_tokens` is the **uncached remainder**, not the prompt size.
True prompt = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Until
`20270421000000` nothing in the repo read either cache field, so every token-volume figure derived
from `paige_llm_trace` was an UNDERCOUNT on any cached turn.

That is not confined to an internal table. `meter_llm_usage` writes
`quantity = tokens_in + tokens_out` into `platform_usage_events` (`20261033000000:112,126`), and
`src/solo/billing-contract.ts:611,636` renders that as the tenant-facing **"Used this period — N
tokens"**. So a tenant on a heavily-cached workload is shown less usage than they actually drove.

**Why this is deliberate and must stay deliberate.** Cache counts were given their own columns rather
than folded into `tokens_in` precisely because that sum is the metered quantity. Widening `tokens_in`
would have changed every tenant's metered number as a side effect of an observability fix — a pricing
change nobody decided (§38/§17). The exclusion is a known, chosen position, not an oversight.

**What makes it safe today and what changes that.** Nothing is charged for this usage — the card says
so in its own copy. The undercount is therefore a truthfulness gap, not a billing harm. **It becomes a
billing harm the moment metered usage is charged**, and whoever turns that on owns this decision:
either cache tokens enter the billable quantity, or the tenant-facing label stops implying it counts
everything.

**The rule:** before reading any token or cost total off `paige_llm_trace` or
`platform_usage_events`, ask whether cached tokens belong in the answer. For "what did this cost us"
they do. For "what is the tenant metered at" they currently, deliberately, do not — and those two
numbers are not the same number.

## Two approval systems on one surface: the button ticked, the action never ran (2026-09-25)

> **THE CAUSE IS NOW ESTABLISHED AND FIXED (2026-09-25, PR #1450, commits `c23d61a5f` +
> `c504dd67c`).** Read this first; the two blocks below are the record of getting there wrong twice,
> kept because how the misses happened is the reusable part.
>
> **The real defect lived in the CRM approval door in `paige-ai-chat`, not in the Solo client at
> all.** `crmApprovalSubject` keys update-shaped actions on a stable record id, but a `*.create` has
> none and fell back to hashing the WHOLE command. The door narrowed the operator's approved set
> with an SQL equality on that subject **computed from the model's re-emitted arguments** — while
> the model is explicitly told on the approval turn that it need not reproduce them. Any drift
> returned zero rows, the approval was refused, and each refusal made Paige file another proposal,
> which made the next approval genuinely ambiguous. Self-perpetuating.
>
> The production split is the proof, and it is the cleanest natural experiment in this file:
> `crm_update_contact` (subject = `contact_id`, drift-proof) **2 asked / 0 stranded**, against
> `crm_create_contact` **4 asked / 3 stranded** and `deal_create` **2 asked / 2 stranded**. Same
> door, same tenant, same week — the only variable is whether the action had a stable id.
>
> **The general (non-CRM) gate was repaired for exactly this on 2026-09-13. The CRM door never got
> the fix.** That is the reusable lesson: when a gate is repaired, enumerate every door that shares
> its shape and port it, or write down why it does not apply. A fix applied to one of two twins is
> a fix with a shelf life.
>
> **Three of the four findings that mattered came from RUNNING things, not reading them.** The
> build's own reasoning was sound and its tests bit; what it could not see was (a) an `18.H25`
> regression in `scripts/client-memory-authz` — found by running the harness and measuring 333/1
> against the base's 334/0 — and (b) a §39 peer-gate finding that the fix reintroduced the exact lie
> it exists to end: the sole-candidate rule claimed the one live approval regardless of which call
> was being resolved, so approving "create John" and asking for Jane in the same turn made Jane's
> call spend John's approval. The write stayed safe (stored args execute) but Paige would have
> narrated a record the owner never got. **A fix for a lying-about-outcomes bug is exactly where to
> look hardest for a new way to lie about outcomes.**
>
> **And one in the copy.** The refusal told the operator to "approve them one at a time" — the card
> has a single Approve button and cannot do that. Correct diagnosis, correct code, and an
> instruction the interface cannot obey (§36/§70.1). Check the recovery you name against the control
> that exists.

> **CORRECTED THE SAME DAY, before the entry was a day old (§58 — marked, never deleted).** The
> diagnosis below is accurate as a reading of `src/solo/agent.tsx` + `useSoloChat.ts` and **wrong
> about why the owner's approvals failed**, because THAT PAIR DOES NOT SHIP. Nothing in `src/`
> imports `agent.tsx`; its strings are absent from `dist/`. The live Solo chat is
> `SoloPaigeWorkspace` → `PaigeAIChat`, which has always carried the body-borne fingerprint echo.
> The measurement (36 proposals in 30 days, 21 never consumed) stands; the cause named below does
> not explain it.
>
> **What the re-measurement showed instead: the 21 were never one bug.** Three unconsumed
> `n8n_create_workflow` rows carry `server_issued_at IS NULL` — the documented unrecoverable legacy
> class, working as specified. Six are CRM-door tools whose `thread_id IS NULL` is deliberate (the
> door stores and reads with null thread/client scope), and the same door shows `crm_update_contact`
> at 4 asked / 0 unconsumed, so it is not broken per se. Twelve are `action_advance`, which the
> 2026-09-13 batch-ambiguity terminal already explains. Two `team_invite_member` rows carry a null
> thread WITHOUT being CRM-door tools, and the inline gate scopes `.eq("thread_id", payloadThreadId)`
> — that pair is genuinely anomalous and remains unexplained.
>
> **The lesson the original entry missed, and the one worth keeping:** *is the surface REACHABLE?*
> A file's folder and name are not evidence that it ships. `agent.tsx` sits in `src/solo/`, exports
> `Agent` and `PaigePanel`, owns `useSoloChat`, and reads exactly like the Solo chat. It was edited,
> tested, committed and pushed before anyone asked what imported it — by the same session that wrote
> §71 that morning, which is why §71.1 now carries the reachability half, cited here.
>
> **A second method lesson from the same day:** proving "these failures are pre-existing" with
> `git stash` on an already-clean tree stashes nothing, pops with "No stash entries found", and
> compares a tree with itself. It cannot fail, so it measures nothing, and it looks exactly like a
> passing check. A worktree at the base commit is the comparison that can disagree. The under-measured
> claim ("19 across 4 files") was corrected to the real figure (21 across 6, identical both sides)
> only because CI disagreed. §71.3 now carries both.
>
> The body below is left intact as the original reasoning, which is still correct about the code it
> describes — and is the exact shape of a confident, well-evidenced, wrong root cause.

**Symptom (owner-reported, production).** The owner pressed **Approve** in the Solo shell and the
action did not happen. He pressed it eight times across two hours in one client session. Nothing
executed once — no contact created, no document written, no email sent. The card was visibly there
and visibly responded, which is why this read as "approvals are flaky" rather than as a seam bug.

**Root cause — two disjoint systems, mistaken for one.** Solo's Approve button called
`execute-approval`, which claims a row in **`paige_pending_approvals`**. The chat gate in
`paige-ai-chat` executes a confirmation-required action only when the exact fingerprint of the
stored call is echoed back in the **request body**, against **`paige_pending_confirmations`**.
Nothing in the repo converts one into the other — `execute-approval` contains zero references to the
confirmations table, and the only place both names meet is a pair of *independent* FK columns on
`paige_social_jobs`, whose trigger validates each separately. So the rail ticked and the gate went
on waiting.

Three compounding defects made it invisible:

1. **`useSoloChat` deleted the pending ask on arrival.** `if (parsed.paige_confirm?.summary)
   continue;` — dropped on the stated grounds that confirms were *"already surfaced in the 'She
   proposed today' rail"*. One wrong sentence in a comment. That rail is the other table, so the
   drop routed the frame nowhere; it destroyed the only handle on the action.
2. **The shared card was built to allow a dead button.** `fingerprints` was optional, and its own
   doc-comment said a caller without it renders fine and *"that caller's approvals simply will not
   open the gate."* The hazard was known, written down, and shipped as a type.
3. **Summary and fingerprint were parallel arrays with one of them `.filter()`ed**, so a single
   action missing a fingerprint shifted every later summary onto the wrong call.

**The proof class that missed it.** Every existing test asserted the card **rendered** and the
button **fired**. None asserted the **action ran**. That gap is invisible to unit tests, to
typecheck, to a build, and to a screenshot — a button with no binding behind it renders,
type-checks, and photographs exactly like one that works. It is only visible from the other end of
the seam: does a row in `paige_pending_confirmations` ever reach `consumed_at`? Measured on
production, it did not — **36 proposals in 30 days, 21 never acted on**, while the one surface wired
correctly (`PaigeAIChat`, via `crm_update_contact`) showed 4 asked and 0 unanswered. The divergence
between two surfaces' consumption rates was the signal, and no test could have produced it.

**A second-order lesson about the fix that preceded it.** #1418 — the self-approval branch a model's
own `confirm:true` could spend — was a real defect and its removal (`cda229c`, deployed
2026-09-24 03:47:50 UTC) was correct. But that branch was also, by its own comment, *"necessary,
because five of the six surfaces render no card"* — it was the compensation keeping the card-less
surfaces working, scoped to them and refused for `high` risk. Removing it turned the acknowledged
outage on. **A security fix that removes a compensation must measure what the compensation was
holding up**; the write-up of the incident asserted the blast-radius measurement "does not need to
be run", and it was exactly the thing that needed running.

**The rules.**

- **A control that cannot work must be unrepresentable, not merely discouraged.** An optional
  binding with a warning comment is a loaded gun with a label on it. Make the type refuse: bind
  per-action, and render no approve affordance when there is nothing to spend.
- **Assert the effect, never the affordance.** "The button rendered and the handler fired" is not
  evidence the action ran (§70). Where the effect crosses a seam, prove it at the far side.
- **Two stores that answer the same question are a defect, not an architecture.** Before adding an
  approval path, check which table the executing gate actually reads (§18 — the one home is
  `docs/doctrine/one-approval-gate.md`).
- **When a comment explains why a frame is safe to drop, verify the claim.** This one named a
  destination that did not exist, and cost every Solo write path for a month.
- **A per-tenant workaround is not a fix.** The account where this "worked" had ~60 tool-autonomy
  rows set to skip asking; every other account had zero to three and defaulted to
  `coalesce(_mode,'confirm')`. The seam repair is what makes a brand-new tenant work with no
  configuration — the configured account was hiding the bug, not demonstrating the cure.

# Paige Agent AI — Working Doctrine

Standing rules for how work gets done in this repo. These persist across sessions.

## 00. UI AUTHORITY — THE FIRST RULE. IT OVERRIDES EVERY SECTION BELOW IT.

> **"I told you to use Flow by Flow and then use Impeccable. That's it. We don't need Claude Design
> any longer. You can update all the rules to make sure that that's clear: Flow by Flow, then
> Impeccable. Impeccable is your priority when it comes to my user interface."**
> — Antonio, 2026-09-22
>
> **"It's the reason I hired you to do this work for me in the first place, so I'm not going to
> approve anything until I actually see a design."** — Antonio, 2026-09-22

**Claude Code owns the user interface — design and engineering both — and executes it in a fixed
order: FLOW-BY-FLOW first, then IMPECCABLE. Impeccable is the priority authority on anything the
user sees.** The owner approves the design before it ships. There is no third party in this loop.

### The order, and it is not optional

1. **Flow-by-Flow** — inspection, flow mapping, the pre-edit packet, the proof gates. It decides
   WHAT is being built and WHICH actor-goal flows must work. Read `flow-by-flow/SKILL.md` and the
   references it routes to (§69 governs this and is unchanged).
2. **Impeccable** — the design itself: direction, craft floor, audit, harden, finish-review. It
   decides HOW the interface looks and behaves. Read its `SKILL.md`, then the playbook for the
   request, then `reference/craft-floor.md` immediately before any UI edit. Its OPERATE mode
   governs settings/tools/dashboard surfaces; its refuse-list is binding, not advisory.
3. **Owner approval** — the owner sees the design and approves it BEFORE production. A design he
   has not seen is not finished, however green the build is.

### What this means in practice

- **CC DOES:** decide the visual direction · judge whether a surface is good enough · propose and
  build better designs unprompted when the current one is weak · run Impeccable's audit and act on
  it · own hierarchy, motion, type, colour, spacing, layout, iconography and in-surface copy · and
  still own everything under it — RPC and edge seams, tenant scoping and RLS (§9/§51/§53), the
  callable seam (§10), performance, CI gates, migrations, and proof that what shipped runs (§32).
- **CC SHOWS THE WORK.** A design is presented to the owner as something he can SEE and, where it
  has hover or motion, something he can FEEL — a rendered frame or an interactive page, never a
  description of a design and never a Vercel link he has to log into to find.
- **Measurements remain measurements.** Contrast ratios, type sizes, grid tracks, whether a face
  loaded, whether a control 404s, whether a surface renders — these are facts and CC reports them
  plainly. CC now also decides what to DO about them.
- **A weak surface is CC's problem to raise.** If a screen is a flat wall, says so and brings a
  better one. Shipping something CC can see is mediocre, and waiting to be told, is the failure
  this section was rewritten to end.

### Evidence discipline — survives the rewrite, because it was never about the pack

Before writing or thinking *"missing" · "not specified" · "needs designing" · "a blocker"*, **search
first**: at least four spellings grepped across the relevant source, plus the sibling files, plus
READING the region of code. One grep is not a search.

**The standard:** never *"we don't have X."* Always *"searched for a, b, c, d and read L1234–L1290
— not there."* An unfalsifiable claim of absence is indistinguishable from not having looked.

Where a design reference, prototype or prior artifact DOES exist in the repo, it is evidence and a
starting point — read it before inventing a fourth variant of something already solved (§18/§30).
It is no longer an authority that outranks CC's judgement or Impeccable's craft floor.

### What still stops CC cold

- **The design cannot be wired as drawn** — the surface needs data that does not exist, a write with
  no seam, or a value no tenant-scoped read may return (§9). Name the exact impossibility.
- **The backend must change for the design to work** — a new table, column, RPC, edge function,
  index or policy. Name it and stop.
- **Owner approval before production**, per the quote above.
- Every material boundary §69 lists: missing authority or a credential, spending money, accepting a
  legal term, a destructive real-data action, a material product decision, unbounded scope.

Difficulty is not impossibility. If it CAN be built, build it.

### This rule DELETES its conflicts. It does not negotiate with them.

Any rule — here, in a nested `CLAUDE.md`, in a doc, in a skill, in a handoff, in a subagent brief —
that hands interface authority to a party other than CC + the owner, or that forbids CC from
judging or proposing design, **is void and is DELETED on sight rather than reconciled.**

**Reversed 2026-09-22 by owner ruling, recorded per §58 so the change is not silent:**
- **The Claude Design jurisdiction** — the prior §00 gave CC "ZERO input on design," made Claude
  Design the deciding authority on everything visible, and bound every subagent to the same limit.
  The owner removed Claude Design from the loop. CC now owns the interface, through Impeccable.
- **PACK-FIRST as an authority** — the requirement to treat a delivered CD pack as "the ANSWER,
  never an input to CC's judgement." The pack is now reference material like any other. Its useful
  half — search before claiming absence — survives above.
- **"Follow their designs with strict absoluteness"** and the round-table escalation for anything
  beyond a backend impossibility. Superseded: CC designs, the owner approves.
- **The subagent gag** — "No agent debates UI." Verifiers and reviewers CC dispatches may now judge
  the interface against Impeccable's craft floor, and are expected to.

**Sections that survive and are NOT touched:** §11's token / gold-budget / AA rules and §23's
contrast and light-vs-dark rules remain binding **constraints CC designs within**; §69's gates;
§70's usability gate; §13 honesty; §28 approved-frozen; §58 anti-regression.

**The test, every time:** *"Did I run Flow-by-Flow, then Impeccable, and can the owner SEE and
approve this before it ships?"* If the answer is a description instead of a design, it isn't done.


## 0. SESSION START — READ THE MASTER PROJECT REFERENCE FIRST (single source of truth).

**Directive (owner: Antonio, 2026-08-09) — NON-NEGOTIABLE, FIRST RULE.** Before responding to ANY substantive request, every agent — Cowork, Claude Code, Codex — reads **`docs/PAIGE-MASTER-PROJECT-REFERENCE.md`**. That doc is the ONE source of truth for this project: business requirements, system requirements, Owner Trilogy taxonomy (4 platform pillars + 7 Customer Portal pillars × 5 stakeholders), MVP definition (Wave 4), what's SHIPPED (integrations, capabilities, backend seams, data model landmarks — with evidence), what's GAPPED, sequential roadmap, and the §13 corrections log.

**The three moments this rule ALWAYS fires (the owner's explicit triggers):**
1. **At the START of every session** — open the master doc (Sections 4, 5, 7, 10) before touching anything substantive.
2. **Before/at every MAJOR BUILD** — a new branch/feature routes back to the master doc; the plan is checked against Section 5 (gaps) + Section 7 (roadmap) so the build fits, and the merge updates Section 4/5/10 in the SAME PR.
3. **Whenever you ask "do we HAVE this tool / feature / integration?"** — the answer is grounded against **Section 4 (SHIPPED)** FIRST, never from memory. Any capability claim ("we have X" / "we don't have X") that isn't checked against Section 4 is a §13 violation. If a grep disagrees with Section 4, CC's live-code check wins and the discrepancy is logged as a §13 correction in Section 10.

<!-- RELEASE_GOVERNANCE_POLICY -->
**Release-governance trigger (owner: Antonio, 2026-09-06).** Before opening or closing a PR, merging,
deploying, assigning a version/name, or publishing a customer update, read
`docs/doctrine/release-governance-and-customer-update-policy.md`. Keep exact internal build identity,
release channel, and earned customer release identity separate. A deployment is not a customer release;
customer publication still requires the policy's evidence gate and owner decision.

**Single, single, single. That means ONE.** Do NOT create sibling reference docs. Do NOT fragment the source of truth across scattered files. If information is missing or wrong, UPDATE `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` IN PLACE and commit. That doc is the durability primitive.

**When Cowork produces a paste for CC or Codex**, the paste ends with: *"Reference `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` first. Update Section 4 on merge. Log any §13 corrections in Section 10."* CC and Codex confirm read at start of every session. This kills the "did they know X was already built?" failure mode that's cost us hours.

**When a new branch is created for feature work**, it ROUTES BACK to the master doc — every merge updates Section 4 (SHIPPED) or Section 5 (Gaps) or Section 10 (§13 corrections) in the SAME PR. No orphan branches, no unmerged intel.

Owner's exact framing (2026-08-09): *"I want a single source of truth. Single, single, single. That means one. That means that you don't create a whole bunch of extra branches unless they route back to that one."*

## 1. Always hire a team. Never a single point of failure.

**Directive (owner: Antonio):** Do not do any substantive job alone. For every real
piece of work — research, design, build, review — draft a specialist **team** of
agents, right-sized and relevant to the job, and act as the **conductor/integrator**
rather than the lone builder. This is a non-negotiable standard: *"I have never gotten
successful, rich, or made money without a team."*

- **Team by default.** Anything with real design, judgment, or scope gets a crew
  (e.g. for landing/design work: copy · forms & pop-outs · layout/symmetry ·
  color/design-system · logo/brand-mark).
- **Always include a verifier.** Every crew carries an adversarial **review agent**
  whose only job is to catch what the others missed — off-voice copy, broken forms,
  symmetry/contrast flaws, off-brand color, and any content-rule violations.
- **One integrator.** Specialists produce specs/assets/code in their lane; a single
  integrator (the main thread) assembles them into one coherent result so nothing is
  woven together sloppily.
- **Solo is only for the trivial.** A one-word tweak or a deploy check does not need a
  team — spinning up five agents to flip a boolean is theater. Everything else: team.
- Orchestrate teams via the Workflow tool (parallel specialists → verify → integrate).

**MANDATORY — no exceptions (owner: Antonio).** This is not a preference; it is the
operating standard on *every* substantive task, every single time. Before starting any
build, research, design, review, or debugging effort, the FIRST move is to convene a
right-sized team via the Workflow tool — the conductor never builds or diagnoses alone.
The only work exempt is the genuinely trivial (a one-liner, a status check). If in doubt,
convene the team. The conductor may delegate freely and decide who is on the crew, but a
crew there must be — with a verifier and (per §5) a compliance officer on anything that
ships. Catching yourself mid-solo is the signal to stop and staff the team.

**THE HARD GATE — a mechanical STOP before the first build action (owner: Antonio, 2026-07-18).**
Prose alone has failed this rule more than once ("where's your team, my friend?"), so like §18
it is now a real gate, not a reminder. **Before the FIRST `Edit`/`Write`/build action on any
substantive task, the crew must already be dispatched via the Workflow tool** — state, out loud,
who is on it (name the specialists + the verifier). The trigger is objective and self-catching:
*if you have written or edited any product code on a substantive task and no Workflow crew was
convened for it, you are ALREADY in violation — stop immediately and staff the crew before the
next action.* A single upfront research/Explore agent is a good scout, but it is **not** the crew
and does not satisfy this gate — the build/verify/compliance team is what the gate requires.
Do not let "I'll just wire this one piece first, then convene" happen: that *is* the solo, every
time. The only exemptions are the genuinely trivial (a one-liner, a rename, a status/deploy
check). When in doubt, the gate resolves to **convene**. The Workflow does not have to be heavy —
right-size it (2–3 specialists on a small diff, more on a real feature) — but it must exist and
must run before the work is called done.

## 2. Content rule — client-based service businesses, never consumer finance.

The product and all marketing are for **client-based service businesses** —
coaches, **consultants, agencies, thought leaders, advisors**, and any professional
who manages clients: client management, follow-ups, workflows, onboarding,
scheduling, retainers, outcomes. **Do not hardwire "coaching"** so narrowly that
consultants, agencies, and thought leaders feel excluded — the audience is broad;
prefer inclusive words like *business · company · clients · work · team* over
"coaching" in shared/platform copy. **Do NOT use "practice" as the inclusive word** —
per the owner ruling (2026-08-08): "Practice" is prohibited in shipped/marketplace copy
until HIPAA + SOC-2 + related certs land, so on the "practice" vs. "business/company"
choice the ban wins — recommend *business* / *company*. (This is the §3.b "Practice"-ban
ruling; its formal numbered paste into §3 is a tracked pending doctrine amendment, #40/#93 —
until then this note in §2 carries it.) **Never** mention credit, credit repair, funding,
lending, loans, financing, readiness or funding scores, lender products, or anything
that reads as consumer finance/credit **in the platform defaults** — the marketing
site, the shared/platform copy, the coaching-generic default sets, the Super Admin /
God-level account, or any code path that ships to *every* tenant. The review agent
explicitly checks for both: the platform-default finance prohibition AND over-narrowing
to "coaching."

**Clarification (owner: Antonio, 2026-07-09) — funding/credit is an allowed *offer*,
never a *default*.** Credit and funding coaching is one of the real coaching offers the
platform supports (it's what the owner does). The rule was never "the product can't do
funding"; it is **"funding/credit must not be hardcoded into every tenant or into the
platform/God defaults."** So:
- **Allowed:** a credit/funding **Playbook preset** a tenant can *choose*, and
  funding-specific surfaces (e.g. the "Funding Readiness" tab) gated behind a per-tenant
  feature flag that the preset turns on. If offering it as a selectable preset requires
  "hardcoding" the preset itself, that's fine — it lives as an **opt-in option**, off by
  default.
- **Not allowed:** funding/credit wording or surfaces shown to *all* tenants by default,
  seeded into the coaching-generic platform default registry, or living in the Super
  Admin / God account (§9). Generic coaching/consulting/agency tenants must never see it
  unless they opt in.
- **The test:** *"Is this funding/credit content a default everyone gets, or an option a
  tenant chose?"* Default → prohibited. Chosen preset/flag → allowed.

## 3. Voice.

Direct, confident, mogul-founder. Never "AI-powered" → "Paige-run." Never "streamline"
→ "Paige handles it." Never "seamless." Never "empower coaches" → "give coaches back
their time."

## 4. Shipping.

Production ships to the live domain are the owner's call. Build on the working branch,
verify, and merge to `main` to deploy; keep prior designs parked (not woven in) when a
direction is fully replaced.

**Pre-launch shipping stance (owner: Antonio, 2026-07-09).** The platform is not yet
public — no real customers, nobody knows the site exists. Until that changes, finished,
verified work goes **straight to live production** (merge to `main`); the owner reviews
in **live view**, not preview. Preview/Vercel runs are fine for a quick self-check
before shipping, but don't park work in preview waiting for sign-off. **This flips the
moment real customers start onboarding** — the owner will say so, and shipping reverts to
preview-first + explicit approval before each production merge. Always verify before the
merge regardless of stance.

**THE PROTOTYPE GATE DOES NOT OUTRANK THIS — GO ALL THE WAY TO MAIN (owner: Antonio, 2026-09-05).**
His words, and note the weariness in them: *"I have to explain this every single time to every new
agent that comes on the team."* So it is written here, where it reloads, instead of being explained
again.

§69's flow-by-flow gates — Gate 1 (approve the prototype before production UI) and Gate 2 (authorize
before ready-state/merge) — read as a licence to stop and wait. **Pre-launch they are not.** The
owner ruled: *"we go all the way to Gate B… you just merge it to main or merge it live on prod."*

- **Build through to merge and MERGE, on every substantive slice, without asking.** Prototype where a
  prototype genuinely helps you get it right — then keep going. Do not park a green, verified branch
  behind a request for sign-off.
- **A Vercel preview link is NOT a deliverable.** *"I can't log into every Vercel login and check for
  those updates."* Previews are for CC's own self-check. What the owner reviews is **live**.
- **The MVP facts that make this safe, and that keep getting re-litigated:** no active clients, no
  live customer data, every account promotional, nobody outside the team on the platform. The blast
  radius of a wrong pixel is a follow-up commit. The cost of holding is his time, which is the
  scarcer thing.
- **What CC owes INSTEAD of a permission request:** merge, then say plainly **what to go look at and
  where** — the surface, the route, and the specific thing to judge. He replies with adjustments and
  the loop continues. *"Let me know what I need to go see and confirm for you, and then I'll let you
  know what adjustments we need to make."*
- **What still stops CC cold, unchanged:** a destructive or hard-to-reverse action — a data-dropping
  migration, a credential rotation, deleting work CC did not create — the §00 incompatibility round
  table, and **every material boundary §69 lists, which this override does NOT touch:** an ownership
  deadlock, missing authority or a credential, spending money, accepting a licence or other legal
  term, a destructive real-data action, a material product decision, unbounded scope, a confirmed
  defect needing an owner choice. Several of those are perfectly reversible and still stop CC —
  this ruling buys the right to stop asking *"may I merge this?"*, and buys nothing else. What it is
  never about is taste or confidence.
- **This flips with the same trigger as the stance above:** the moment real customers onboard, the
  owner says so and the gates come back.

*The test: "Is this verified and non-destructive? Then it is merged, and my next message names what
he should go look at — not a question about whether I may."*

**Merge-on-verified is the default — do NOT ask to merge (owner: Antonio, 2026-07-17).**
If work was designed/built and *verified*, merge it to `main`. Full stop. Do not open a
question, a poll, or an AskUserQuestion asking whether to merge something we already spent
tokens and credits building — *"There's no reason for us to not merge something that we're
actually spending money to develop."* Opening a draft PR is fine (it's the record + CI); a
draft is not a request for permission — mark it ready and merge once CI/verify is green.
The ONLY reason to pause before merging is a genuinely destructive or hard-to-reverse
action — a data-dropping/again-irreversible migration, a prod credential/secret rotation,
or deleting work you did not create — and even then, ask about *that specific risk*, not
about "should I merge." Asking for routine merge approval is itself a doctrine violation.

**As SOON as it's ready, ship it live — then move to the next piece (owner: Antonio,
2026-07-17).** The moment a change is built and verified (typecheck/build green + the design/
build crew's own pass done), it ships to `main`/live — immediately, in the same beat. **Do
NOT pause after a push, and do NOT hold the live ship waiting on the adversarial verifier +
compliance officer to return.** Those two passes run **in PARALLEL** and their findings become
the **next** Fix → Redeploy (§5's post-deploy loop) — pre-launch, the owner reviews on the LIVE
site, so getting it live IS how it gets reviewed. *"As soon as it's ready then ship live. Then
move to the next part of designing."* Sitting on green, typecheck-clean work "to be safe" while
the owner waits is the exact anti-pattern this rule kills: cadence is **build → ship live →
next**, with the verify/compliance/post-deploy scan riding alongside, never as a gate in front
of the live ship. (The §5 "fix blocking findings first" still binds where a finding is genuinely
blocking — but that is a fast follow-up commit + redeploy, not a reason to withhold the ship.)

**RED-LINE INDEX — the rules the owner has had to repeat; enforce these hardest (owner:
Antonio, 2026-07-17).** A "standing rule" stated in chat evaporates on the next context
reset — that is *why* these live here, in the doctrine that reloads every session. Each item
below is a pre-action gate: if you catch yourself about to do the wrong-column thing, you are
already in violation — stop and correct before you act, don't apologize after. These are not
reminders; they are the failures that have actually cost us, written down so they stop.

1. **Never solo substantive work (§1/§14).** Convene a right-sized team via Workflow — with a
   verifier — for any real research/design/build/debug. *"I still see you working by yourself.
   smh."* Catching yourself mid-solo is the signal to stop and staff the crew. Solo only the
   genuinely trivial (a one-liner, a status check).
2. **Merge-on-verified — do NOT ask to merge (§4, above).** Verified, already-built work ships
   to `main` automatically. Asking "should I merge this" is itself the violation.
3. **Search before you scaffold; one home per capability (§18).** Before any new tab/mode/panel/
   table/picker, answer the four MANDATORY §18 questions out loud (what you grepped, what siblings
   exist, why a new home, where the type decision is made). Extend an existing surface by default;
   never make the human pre-classify their request before Paige has heard it.
4. **Banners are the exception, not the reflex (§11).** Default to a compact `variant="plain"`
   header; the real work leads above the fold. A hero/gradient masthead is earned only by a true
   landing/first-run surface — never plastered on a working page where it eats a third of the view.
5. **Probe and propose; never ship placeholders (§15/§13).** Resolve the real specifics (names,
   dates, links, sending identity) from data or by asking one tight grouped question. No
   `[PLACEHOLDER]`/`[BRACKET]` tokens handed over as "done"; offer the smarter format, don't just
   execute. A hoped-for result is not a real one (§13 honesty).
6. **Two passes before every ship — verifier AND compliance officer (§5/§11).** The verifier hunts
   defects; the compliance officer judges it against best-in-class + §2/§3/§6/§9/§18. Both run
   before a production merge; fix blocking findings first. Not optional, even when it "looks fine."
7. **Finance/credit is never a platform default (§2).** Funding/credit wording or surfaces only
   ever appear on a per-tenant opt-in (`funding_enabled`/preset). Never in platform/God defaults,
   the coaching-generic registry, or any path that ships to every tenant.
8. **Ask "who is this for?" — platform vs tenant (§9).** Before building or placing anything, name
   the audience: operator/Super-Admin (coaching-generic, our controls) vs tenant (tenant-authored,
   tenant-scoped). Don't conflate them; keep the seam clean.
9. **Everything stays Paige-governable (§10).** No feature's logic lives only inside a React
   component a human clicks. Every create/update/delete gets a callable seam (RPC/edge/config-as-
   data) so Paige can drive it by voice or text. Don't ship a dead end.

If in doubt on any of these, the doctrine's default answer is the more disciplined one: staff the
team, extend the existing surface, cut the banner, probe for the real value, run both passes, keep
finance opt-in, name the audience, expose the seam — then ship it without asking.

## 5. Always run a compliance / standards officer.

**Directive (owner: Antonio):** Beyond the bug-hunting verifier, every substantive
shipment also gets a **compliance/standards officer** agent that goes behind the work
and asks a different question than "is it broken?" — it asks *"is this done correctly,
efficiently, and effectively, to the standard of the best-in-class platforms in our
space, and is it fully compliant with our SOPs and quality bar?"*

- **Two distinct passes.** The **verifier** catches defects (broken logic, off-voice
  copy, content-rule violations, contrast/symmetry). The **compliance officer** judges
  *quality and standards*: brand consistency end-to-end (landing → sign-up → app),
  polish vs. top competitors, accessibility, performance, no placeholder/fake content
  shipped, SOP adherence. Both run before a production merge.
- **Take our time.** Speed is for manufacturing; we are *designing*. The compliance
  pass is where we slow down and make sure it's genuinely excellent, not just working.
- **Reports, doesn't rubber-stamp.** It returns concrete gaps ranked by severity; the
  integrator fixes blocking items before shipping and logs the rest.
- **TWO scans per cycle — a POST-DEPLOY scan is now mandatory, not just the pre-deploy one
  (owner: Antonio, 2026-07-17).** The pre-deploy crew (verifier + compliance) catches static/
  logic bugs *before* the merge — that stays exactly as-is. But it structurally cannot catch
  runtime behavior, and the owner keeps having to catch those live himself (the double-submit,
  copy stalling at "Draft with Paige"). So **every deploy is followed by its own post-deploy
  scan** that asks a different question than "is the code correct?": *"Did we actually ship the
  RIGHT thing, and does it do what we intended when it's actually running?"* Concretely the
  post-deploy pass confirms: (a) **deployment integrity** — the intended commit/edge-version/
  migration is truly live (not stale/cached), and the build silently dropped nothing; (b)
  **runtime behavior** — the feature actually does the thing end-to-end (drive the flow where
  drivable; a fresh adversarial re-trace of the *deployed* behavior against intent where it
  can't be driven headless). Anything it surfaces becomes the next Fix → Redeploy. The burden
  of catching runtime regressions is **ours, not the owner's** — where a surface genuinely can't
  be driven autonomously (e.g. the authenticated Studio flow), say so honestly (§13) and push to
  make it drivable (a permission-scoped test tenant, Playwright against the live URL) so the
  post-deploy scan stops depending on the owner's eyes. The loop is: Study → Build → **Analyze
  (pre-deploy scan)** → Fix → Deploy → **Post-deploy scan** → Fix → Redeploy → repeat.

## 6. Brand consistency is one continuous system.

From the landing page through the sign-up transition and into tenant/app onboarding,
the imagery, quality, copy, voice, palette (gold + indigo), logo (the shared
`PaigeMark`), and CTA style must feel like **one product** — no jarring hand-off. The
compliance officer explicitly checks this continuity on every public-facing change.

## 7. North star — Paige is the intelligent client portal (two-way).

**Directive (owner: Antonio):** Every competitor sells a client portal; they are static
filing cabinets. **Paige is the client portal that reasons, suggests, and acts.** She
operates from the client/consumer standpoint — a **hyper-personalized assistant that
feels like the coach's own**, under the coach's brand — while running **two directions
at once**:

- **For the client:** onboards, answers, probes like a domain expert, nurtures, and
  acts on their behalf.
- **For the staff/coach:** surfaces what each client needs, drafts the follow-up, flags
  at-risk, proposes and (on approval or autonomously per policy) takes the next move.

Two-way communication, two-way intelligence — **one Paige Runtime Harness facing both sides.** The
portal is the product; the intelligence is the moat. It must be **tenant-authored** so
each coach's Paige is native to *their* practice — persona, probing questions, journey,
and templates configured per tenant (the "Playbook" model), never a hardcoded vertical.
Every build decision serves this.

**Tenant Client Portal MVP correction (owner: Antonio, 2026-09-08).** The Tenant Client Portal is
MVP scope and a competitive differentiator. It is a deliberate client-scoped projection through the
one shared Harness—never a separate portal agent, Brain, memory, authority system, or app logic.
`Tenant business → shared governed Paige Runtime Harness → client-scoped portal experience`.
Every client operation independently resolves external client, sponsoring tenant, relationship,
workspace/record scope, role/consent, allowed sharing, tenant policy, provider/file/document state,
verification, receipt, and Rail. A future Paige Enterprise Success Portal for Paige's direct
enterprise customers is separate later scope and is not authorized here.

## 8. Paige runs a team — AI orchestration of two coordinated departments.

**Directive (owner: Antonio):** Paige is not a single agent; she is an **orchestrator**
of her own AI team. The build requires real AI orchestration on her behalf, organized
as **two coordinated teams**:

- **Owner Ops team** — works for the business owner (coach / consultant / agency):
  pipeline, follow-ups, retainers/dunning, content, campaigns, scheduling, at-risk
  triage, the daily brief.
- **Client Experience team** — works for each client: onboarding &amp; conversational
  intake, domain-expert probing, answers, nurture, and the hyper-personalized portal.

The two teams **communicate with one another and create actions amongst each other**
(the "action bus"): the Client team detects a need → files an action to the Owner team →
drafts the move → routes to the coach's approval; the Owner team sets a play → the Client
team personalizes it per client. **That cross-team coordination is the product.**

**Positioning:** people are not hiring a chatbot — *"they're hiring her entire team."*
The substrate already exists (sub-agent forge, `delegate_to_subagent`, ~12 sub-agents,
skills engine, approvals / propose→confirm); the work is formalizing it into two
departments + the action bus under Paige's orchestration, tenant-authored per Playbook.

## 9. Always separate platform (Super Admin) from tenant. Ask "who is this for?"

**Directive (owner: Antonio):** Before building or placing *anything*, answer one
question first: **is this for the primary Super Admin (the platform operator — us),
or for the tenants who run their businesses on the platform?** They are different
audiences with different needs, and conflating them is how a platform rots. This
question is non-negotiable and gets asked *every* time.

- **Platform / Super Admin (top-down, "us"):** the operator's own controls — fleet
  management, tenant provisioning, platform billing, the master brand (Paige Agent
  AI), and the clean **default sets** that ship to everyone. This layer stays
  coaching-generic; it is **never** seeded with one vertical's content (e.g. no
  credit/funding email templates in the platform default registry, no
  vertical-specific copy in the super-admin account).
- **Tenant (every coach / agency / sub-account):** each tenant authors their **own** —
  brand, voice, Playbook, email templates & sequences, automations, journeys —
  native to *their* practice, tenant-scoped, and available **platform-wide to all
  tenants**. A vertical-specific product (e.g. **Mogul Maker Academy / Project Mogul
  Enterprise**) lives as a *tenant's* configuration and may reuse archived assets as
  **its** templates — never as a platform default.
- **The test, every time:** *"Does this belong to the operator, or to a tenant?"* If
  tenant-facing, it must be tenant-authored and tenant-scoped (per Playbook), not
  hardcoded into the Super Admin. If operator-only, keep it out of tenant surfaces.
- **Keep the seam clean:** no mix-ups about who a feature, asset, or template is for.
  Archive vertical content for reuse by the tenant it belongs to; keep the platform
  default coaching-generic. This reinforces §7 (tenant-authored portal) and §8
  (per-tenant Playbook).

## 10. Everything must stay Paige-governable — never close a feature off.

**Directive (owner: Antonio):** The end state is a **single Paige Agent AI section**
in the menu where the operator or a tenant can, by **voice or typing**, tell Paige to
run *any* part of the platform — *"create a new form," "build a web page," "schedule a
calendar meeting," "add a contact,"* and so on — and she does it. That one chat governs
the whole company. We are not building that surface yet, but **every section we build
must leave the door open for it.**

- **Callable seam, always.** No feature's logic may live only inside a React component
  where a human clicking is the only way to drive it. Each create/update/delete action
  needs a clean, programmatic entry point — a Supabase table/RPC or an edge function —
  that Paige's agent can invoke. The UI is one caller of that seam; Paige is another.
- **Data over hardcoding.** Prefer config-as-data (JSONB/rows) the agent can read and
  rewrite (e.g. a calendar's intake questions are a `jsonb` column, not hardwired
  markup) so Paige can author it end-to-end without a code change.
- **The test, every time:** *"Could Paige do this from the chat, by voice or text, with
  no human in the UI?"* If not, expose a tool/RPC/function so she can. Don't ship a
  dead end.
- This serves §7 (Paige is the intelligent portal) and §8 (Paige orchestrates the
  teams): the moat is that she can **operate** the platform, not just answer about it.

## 11. World-class is the floor, not the ceiling — premium on every surface.

**Directive (owner: Antonio, 2026-07-10):** the premium design standard set by the
Marketplace redesign and the shared primitive layer is now the **baseline for
everything we build — "this kind of standard for everything, and better."** No surface
ships looking like generic admin CRUD again. Every new or touched page is held to the
best-in-class bar; when in doubt, raise it.

- **Build on the primitive layer.** Use `@/components/ui/page`
  (`PageShell` · `PageHeader` · `SectionCard` · `StatTile`/`StatRow` ·
  `DataTableShell` · `EmptyState` · `Toolbar`/`FilterChip` · `StatePill` ·
  `GlyphPlate`). Do **not** hand-roll headers, KPI tiles, tables, or empty states on
  raw shadcn `Card`. If a primitive is missing, add it to the layer — don't fork a
  one-off. The Marketplace (`SkillCard` + hero masthead) is the reference bar.
- **Gold discipline (§6), enforced.** Gold is spent **only** on the act/approve/on
  moment (`Button variant="gold"`, `StatePill state="on"`) — never a resting border,
  decorative icon, avatar tint, selected row, or focus ring (rings are indigo `--ring`).
  Gold-as-text uses `--gold-dark`; gold-as-fill pairs `--accent-foreground`.
- **Token-only, theme-aware, accessible, motion-safe.** Zero hardcoded hex in shipped
  UI; semantic status via `--success`/`--warning`/`--destructive`; AA contrast in light
  **and** dark; every animation guarded by `useReducedMotion`.
- **No amateur tells.** No scroll-walls (collapse to tabs/rails/accordions, §67); no
  raw `<pre>`/JSON dumps as product UI; no bare "Loading…"/`return null` blanks (use
  skeletons + crafted `EmptyState`); no native `<select>`/`<input type=checkbox>`; no
  backend table/function names, internal jargon (`MMA OS`, `n8n`, `§NN`, secret var
  names, "once Antonio approves"), or owner PII in visible copy (§3).
- **Banners are the exception, not the default — vertical space is the scarcest resource
  (owner: Antonio, 2026-07-16).** A big hero/gradient masthead at the top of a working
  surface is NOT what makes it premium — most of the time it just eats a third of the
  viewport and pushes the actual work (the projects, the list, the tool) below the fold.
  Do **not** plaster a `PageHeader variant="hero"` banner on every page by reflex. The
  default header is compact (a title row, `variant="plain"`), and the primary content —
  what the user came to do — is the first thing above the fold. A full banner is earned
  only where it genuinely serves the design: a true landing/marketing surface, or an
  empty first-run state with nothing else to show yet. On a **working** surface (a
  gallery, a builder, a dashboard, a table) the content leads and the header stays lean.
  Premium is *more usable space for the real work*, not more decoration. **The test:**
  *"Does this banner earn its pixels, or is it just taking a third of the screen from the
  thing the user actually opened this page to see?"* If the latter, cut it to a compact
  header.
- **The design crew is mandatory on design work (§1/§5).** Every page/surface carries a
  **design engineer** (builds to the primitives), an **adversarial verifier** (hunts
  gold misuse, contrast, broken states, jargon, regressions), and a **compliance
  officer** (judges it against best-in-class + §2/§3/§6/§9 — **and §18: explicitly
  checks whether this surface fragments or duplicates an existing one**, not just
  whether it looks polished in isolation). The integrator fixes blocking findings
  before merge. This pass is non-negotiable — it has already caught render bugs that
  would otherwise have shipped, and (§18) an entire creation tool built as five
  redundant silos that no compliance pass ever flagged because each silo shipped in
  its own session and was only ever judged against itself.
- **The Studio must feel developable at a "video-game level" — the measuring stick moving
  forward (owner: Antonio, 2026-07-17).** When a tenant is inside the Vibe Studio *building*
  something, it should feel like a highly-animated, alive, game-grade creative environment —
  not an admin form. The owner frames it as "video game level" because that's the felt quality
  bar, not a literal game engine: cinematic loading/"cutscene" moments (the build screen),
  choreographed screen-to-screen transitions that feel like one continuous act, motion that
  makes creating feel powerful and responsive. Concentrate the heavy motion (3D/WebGL, particle/
  aurora, spring choreography) where it *earns its pixels* — the build/"loading-the-idea" moment
  and key transitions — never plastered on working surfaces (§11 banner rule still holds). This
  is now the **measuring stick for all Studio work**: *"Does building in here feel game-grade and
  alive, or does it feel like CRUD?"* We do not compromise this quality to move faster. Still
  §-bound: motion-safe (`useReducedMotion`), token-only, AA both themes, gold only on the act
  moment.
- **The test, every time:** *"Would the owner call this world-class, and does it read as
  one continuous system with the rest of the platform?"* If not, it isn't done.

## 12. Organize what you create — always ask "where does this belong?"

**Directive (owner: Antonio):** Every time we create a tool, resource, workflow, asset,
table, function, or file, we **stop and ask whether it needs to be organized** — named to
a convention, tagged, foldered, filed into the right registry, and placed where it belongs
for the audience it serves (§9 platform vs tenant). We do not dump loose artifacts into a
shared space and move on. A thing that isn't findable, isn't named like its siblings, or
isn't filed into its home is not done.

- **Name to a convention.** Anything Paige (or we) create carries a consistent,
  recognizable name so it's obvious what it is and who made it — e.g. Paige-authored n8n
  workflows use a stable prefix, drafts end in `[DRAFT]`, archived work is tagged
  `[archived]`. No mystery names, no one-offs that don't match their neighbors.
- **File it into its registry/folder.** If a home exists (the per-tenant workflows
  registry, a folder, a tags scheme, a table), the new thing goes there on creation — not
  "later." If no home exists and we're making several of something, we make the home first.
- **Tenant-scoped and clean-seamed (§9).** Organize by who it's for. Tenant artifacts live
  in the tenant's space under the tenant's naming; platform/operator artifacts stay out of
  tenant surfaces. Never let a vertical's assets pollute the shared/platform defaults.
- **The test, every time:** *"If someone opens this account/repo/registry in six months,
  will they instantly see what this is, who it's for, and where it lives?"* If not, organize
  it before shipping.

## 13. Build like the best developers in the world — every time.

**Directive (owner: Antonio):** Every build is held to the standard of the best engineers
alive. Not "good enough to work" — genuinely excellent: correct, secure, tested, readable,
and maintainable, the way a top-tier team at the best software companies would ship it. This
is the engineering counterpart to §11 (world-class design is the floor): §11 governs how it
looks and feels, §13 governs how it's built underneath.

- **Correctness is proven, not assumed.** Trace the real failure paths, guard the edges,
  and verify end-to-end (drive the actual flow, not just a typecheck) before calling it done.
  The adversarial verifier and compliance officer (§1/§5) apply to code, not only UI.
- **Secure and truthful by construction.** Least privilege, tenant isolation, no IDOR/SSRF/
  injection holes, no secrets in artifacts. Systems report what actually happened — never a
  hoped-for outcome (a fire is not a delivery). Honesty is a build requirement, not a nicety.
- **Clean, idiomatic, maintainable.** Code reads like the surrounding code, names say what
  they mean, no dead ends or copy-paste forks; when a primitive is missing we add it to the
  shared layer instead of one-offing. Structured errors that explain the real cause, never a
  swallowed generic.
- **The test, every time:** *"Would a world-class engineer put their name on this and be
  proud of it in code review?"* If not, it isn't done.

## 20. Dispatching a team of agents is a CHAT act, never a separate surface.

**Directive (owner: Antonio, 2026-07-16).** Everything Paige does — including standing up a
**team of agents** to spread work across a job — happens **inside the chat**, by voice or
typing. It is **never** a separate tab, panel, or "agent manager" the human has to learn.
People are used to a conversation: you tell Paige *"have your design agent build the landing
page while copy writes the emails and forms wires the intake,"* she dispatches the team, and
their **assignments, progress, and results stream back in the transcript** — the same chat
you were already in. This is §1/§8/§14 (never solo; orchestrate a team) surfaced the only way
that stays §18-clean: through the one conversation, not a new surface.

- **Dispatch is conversational.** No "add agent" button, no team-management screen. The brief
  (and Paige's own plan) decides who to spin up and what each does; she reports the team back
  in the thread (who's on it, what each is doing, what they produced) — honestly (§13: what
  the agents *actually* did, never a hoped-for result).
- **Status may surface ambiently, but control lives in the chat.** A working surface (e.g. the
  Vibe Studio project) may show an *ambient* signal — an artifact reading "building," by which
  agent — but the act of dispatching, steering, and hearing back is the transcript, not a panel.
- **This binds every surface, not just Studio.** Anywhere Paige runs a team (Studio, the
  command center, the departments of §16), the team is convened and monitored **in her chat**.
- **The test, every time:** *"Did I put agent-team control behind a tab/panel the human has to
  operate, or is it just something they say to Paige in the chat?"* If it's a surface, it's wrong.

## 19. The Studio is the whole campaign, end to end — one session, not five.

**Directive (owner: Antonio, 2026-07-16).** The Vibe Studio (Campaigns tab) is not a page
builder with some other stuff bolted on — it is the **complete campaign creation surface**.
A tenant should be able to create, edit, modify, launch, and deploy **every** part of a
real campaign without leaving that one session: visuals/images, websites/landing pages,
questionnaires (forms), and funnels — all of it, wired together, in the same place, with
the **copy embedded inside** each of those assets held to a direct-response bar.
The point is retention as much as capability: **the more of the platform a tenant can do
without leaving it, the better it is for them and the better it is for us.** Never design a
piece of this as a reason for the tenant to go somewhere else.

- **§19 scope correction (2026-07-17):** The Studio authors **creative/design assets** —
  landing pages, funnels, forms/questionnaires, and images/visuals. **Copy is not a Studio
  artifact type.** Copy is two things: **(a) embedded-in-asset quality** — the headline/
  subhead/CTA/body/question wording *inside* a generated page, funnel, or form, held to the
  direct-response bar by the generation prompts; and **(b) standalone words** (a post, email,
  ad, caption) — which Paige drafts **in chat** (the `content-draft` seam), never as a
  separate Studio artifact. So the "everything in one session" completeness bar covers
  **visuals, pages, forms, funnels, and the copy embedded in them** — standalone marketing
  text lives in Paige's conversation, its one §18 home. (Replaces the earlier wording that
  listed "marketing copy" as a Studio artifact type.)

- **No artifact type is a permanent second-class citizen.** If one type (e.g. funnels) has
  less AI-generation depth than the others today, that is a sequencing fact, not a scope
  decision — it stays on the roadmap as real, near-term work, not "later, someday." Log it
  as its own tracked task the moment it's identified as a gap; don't let it quietly become
  the thing nobody schedules.
- **Funnels are a composition problem, not a lesser feature.** A funnel is multiple pages +
  forms + a sequence between them — harder to draft from one brief than a single page, which
  is why it sequences after single-artifact drafting, never why it gets skipped. The bar is
  the same: one brief in, a real working funnel out, exactly like page/form drafting today.
- **Everything created here stays reachable from here.** Once an artifact exists (a drafted
  page, a generated image, a built funnel, a form), the tenant must be able to
  come back into this same Studio session and keep working on any of it — not export it, not
  hunt for it in a different tab of the app.
- **This extends §18, it doesn't relax it.** The unification (§18: no upfront type-picker,
  one conversational entry) and the completeness bar (§19: every artifact type, fully
  capable, in one session) are the same objective seen from two angles — don't ship one
  without keeping the other in view.
- **The test, every time:** *"Could a tenant build, wire together, and ship their ENTIRE
  campaign — every visual, every page, every form, every funnel step, and the copy embedded
  in all of them — without ever leaving this session?"* If any piece still requires leaving
  Studio, or any artifact type is permanently weaker than the others, it isn't done.

## 21. ONE session per project — everything streams inside it, no artifact-type tabs.

**Directive (owner: Antonio, 2026-07-17).** Everything that comes out of the Vibe Studio
streams inside **the same single session**. You start a session from the dashboard → you see
the rendering → it opens the actual studio session, and **inside that session there is no
option for "page" or "copy" or any other artifact type.** The owner's words, said three times
in a row until it landed: *"we don't need a separate button to make copy… there's not a single
Vibe Studio that has this button"* · *"everything that comes out of the Vibe Studio all gets
streamed inside of the same studio. We don't have extra tabs… Inside of that session, there
doesn't need to be an option for page or copy or anything else"* · *"we don't build those as
separate tabs inside of the Vibe session. It's literally inside of the one session. Stop
confusing people with all these multiple tabs. Nobody does that."*

- **No artifact-type tab strip. At all.** Not an upfront picker (§18 already forbids that), and
  not a "switch what you've built" type-tab row either — no Page/Copy/Form/Image/Funnel tabs
  anywhere in the session chrome. A tenant never clicks a type; they describe what they want and
  Paige's classifier routes it. The one persistent navigator is the **project rail**
  (`ProjectNavigator`) — it lists the session's actual artifacts by *name* (§12, one home), which
  is navigation, not a type-picker. If a second surface exists to switch artifact *types*, delete
  it; the rail already carries it.
- **One session holds every type.** *"I don't care if they say they want a website / a funnel /
  a PDF / an e-book / a downloadable document. I don't care what it is. It all stands inside of
  that one same single session."* Website, funnel, form, image, copy, PDF, eBook, manual — every
  output lives in the one project session. Adding a new capability (e.g. documents, §119) means
  wiring it INTO this session's conversational flow + the rail, never bolting on a new tab.
- **Copy/text is a chat capability, not a surface.** Drafting copy is something Paige does in the
  conversation and files into the project — never a mode the human toggles into. The same holds
  for any output that is fundamentally "Paige hands you a deliverable" (images, documents): it
  streams in the session, it lands in the rail; it is not a tab.
- **This is the concrete enforcement of §18/§19/§20.** §18 says no pre-classification gate; §19
  says every type, fully capable, in one session; §20 says team-dispatch is a chat act, not a
  surface. §21 is the same rule for the artifacts themselves: **one session, one project, zero
  type-tabs.**
- **The test, every time:** *"Did I make the tenant pick or switch an artifact TYPE anywhere in
  the session — a tab, a chip, a mode button — instead of just talking to Paige in the one
  session and letting the rail hold what they've made?"* If there's a type-tab, it's wrong.

## 22. The Vibe Studio is benchmarked against best-in-class — motion, 3D, and craft are the mandatory bar.

**Directive (owner: Antonio, 2026-07-17).** The Vibe Studio is developed against the best AI-builder
studios in the world — **Lovable and Emergent** — and the broader best-in-class motion/3D web (Bolt · v0 ·
Framer · the Awwwards/Codrops/Three.js lineage), studied 2026-07-17 (synthesis parked at
`scratchpad/studio-motion-3d-plan.md`). **That study is now the STANDING BAR:** every Studio surface is
built to it, and the verifier + compliance officer (§5/§11) judge every Studio ship **against this
standard, not just against itself.** The owner's line is the whole point — *"you just made it dark, that's
not design"*: **depth, motion, and craft are the bar; a palette flip never is.**

- **Depth from LAYERED surfaces, not darkness.** Best-in-class builds depth from a 3-tier elevation stack
  (base → card → raised) + hairline borders + consistent radii tokens (a real scale: 6/8/12/16/24/28) —
  never a flat fill. Our chrome is layered indigo/violet elevation tokens with hairline borders. **Flat =
  fail; "made it dark" ≠ designed.**
- **One accent, spent on the act.** Best-in-class reserves exactly one color for the CTA/interactive moment
  (Lovable's blue). Ours is **gold — ONLY on the primary act**; everything else neutral/indigo (§11).
- **Type carries the hierarchy — weight + size + tight NEGATIVE tracking on display sizes** (the "expensive"
  tell). A real scale (display → title → body → caption; `tabular-nums` for metrics). Weak/default type = fail.
- **Real thumbnails, real hover, refined borders.** Project cards render **REAL scaled artifact previews**
  (never a glyph-in-a-box placeholder), lift on hover (spring, motion-safe), and use a tokenized border — a
  traveling **gold beam ONLY on the actively-building card**, indigo/plain everywhere else.
- **The composer is ONE tight command bar that IS the hero** — compact, dense inline affordances in a footer
  row, a blinking caret, no banner above it (§11 banner rule), no artifact-type chips (§18/§21).
- **The build cutscene is the marquee "video-game" moment** — a cinematic split: streamed *human-readable*
  build steps + a progressive skeleton of the artifact-to-be + the living PaigeMark as hero of the wait +
  **named-agent handoff** (§8 "they're hiring her whole team," made visible in motion) + a **self-verify
  "scan" beat** (§5 verifier, made visible) — resolving **INTO the session/rail (§21)**, never a dead spinner
  or modal. Streamed lines reflect the **ACTUAL** phases, never a script that plays regardless (§13 honesty).
- **Transitions are one continuous act** — shared-element FLIP (dashboard card → build → studio), spring not
  duration, staggered reveals (§6 continuity).
- **The chrome is ALIVE** — the hero field flows (a real animated shader gradient, not a static arc); the
  sidebar carries ambient "stardust." Alive, not decorative.

**Fidelity doctrine (where the GPU earns its pixels):**
- **Heavy WebGL is spent in EXACTLY two places — the hero and the build cutscene** — each one shader quad /
  one weighted object at capped DPR. Everything else (sidebar stardust, cards, composer, transitions) is
  lightweight CSS + framer-motion. Concentrate motion where it earns its pixels; never plaster GPU work on a
  working surface (§11).
- **Build our own primitives — no new dependency by default.** The 3D/motion stack already ships (`three` ·
  `@react-three/fiber` · `drei` · `framer-motion` · `gsap`) with a working WebGL precedent (`PaigeScene`).
  New surfaces reuse it and add primitives to the shared `ui/page` layer (§18: one home, don't scaffold or
  fork). A new npm dep is a *proposal* (§13/§14 cost-low), never a reflex.
- **Every effect writes its OWN reduced-motion fallback** — these libraries don't ship one: gradient speed→0,
  particles paused, beams static, morph→instant cut. Motion-safe is per-primitive, not an afterthought.
  Token-only, AA in **both** themes, gold only on the act — all still bind.

**Honesty caveat (§13) — do not over-claim.** The competitor build-cutscene details are **SECONDARY**: both
studios are auth-gated, so their loading/handoff moments were reconstructed from reviews/walkthroughs, not
seen first-hand; the heavy-shader hero/cutscene is imported from the directly-inspectable Awwwards/Codrops
lineage, **not proven** to be a competitor's own studio behavior; borrowed tokens are extractor-approximate.
Build these as **our** interpretation of a well-attested pattern — never tell anyone "Lovable does exactly X"
as fact.

**The test, every time:** *"Does this Studio surface clear the best-in-class bar — layered depth, real type,
real thumbnails, alive motion where it earns its pixels — or is it a flat palette flip?"* If the latter, it
isn't done.

## 23. Color is emotional — every palette is chosen for the feeling it evokes, and light ≠ dark.

**Directive (owner: Antonio, 2026-07-17) — MANDATORY, platform-wide.** Color is not decoration; it is
**emotional signaling**. Certain colors and color relationships reliably invoke certain feelings, and that
is well-documented — so **every color decision on every surface is made with color→emotion intent**, not by
picking "a darker shade" or "a lighter shade." This is a standing standard we design by *everywhere* (the
whole Vibe Studio and the whole platform), not a one-off. It reloads every session precisely so it is never
forgotten.

- **Design for the feeling, not just the value.** Choose hue, saturation, and temperature for the emotion the
  surface should evoke — e.g. **light** themes lean open · fresh · clear · trustworthy · energizing;
  **dark** themes lean focused · premium · immersive · calm-power. Gold is the act/approve/celebration
  accent (§11); indigo is the calm, credible ground (§6). Never reach for a color just because it "fills the
  box."
- **Light mode must be genuinely LIGHT; dark mode genuinely DARK — a clear, felt distinction.** A human
  instantly sees the difference between a lighter surface and a darker one; the toggle must deliver that.
  **Light mode does NOT mean "slightly less dark," and it never means the cheesy gray** (§11) — it means a
  real, bright, premium light theme with depth from **elevation + hairline borders + soft shadow**, not from
  gray fills and not from darkening. Dark mode is a real dark theme with layered depth (§22). Flipping the
  theme anywhere on the platform must produce an **unmistakable** light↔dark change on **every** surface — no
  surface hardcoded to one theme so the toggle looks dead.
- **Still §-bound.** Token-only (no hardcoded hex), AA contrast in **both** themes, on-brand (indigo + gold,
  §6), gold spent only on the act (§11). Emotional intent never overrides accessibility or the gold budget —
  it *guides the choices within* them.
- **The test, every time:** *"Did I pick this color for the emotion it creates and the story it tells — and
  is my light theme actually light and my dark theme actually dark, clearly distinct — or did I just reach
  for a value?"* If it's just a value (or light ≈ dark), it isn't done.

## 18. Check for redundancy before you build — one home per capability, never two.

**Directive (owner: Antonio, 2026-07-15):** Before starting any build, the first question is not
just "who is this for" (§9) but *"does this already exist somewhere else on the platform, under a
different name?"* The concrete case that forced this section: Vibe Studio's Page/Funnel/Form/Copy/
Image mode chips make the operator pre-classify what they're building *before* Paige has even heard
the brief — the opposite of "vibe" — because each mode was built in its own session without anyone
asking "should this be one surface." That is the failure mode this directive exists to stop, everywhere,
not just there.

- **Search before you scaffold.** Before adding a tab, a mode, a settings panel, a table, or a
  picker, grep the codebase and walk the relevant hub/nav for anything that already does this job.
  A team (§1) includes a research pass for exactly this reason — run it every time, not only when
  it's convenient.
- **One capability, one home.** If two surfaces do the same job, that is a bug, not a feature —
  collapse them, don't stand up a third. Default posture: *extend an existing surface*, never
  *build a sibling that overlaps it* (§12 already says this for naming/filing a thing once it
  exists; this section says it before the thing is built at all).
- **Decide the priority home before you build, not after.** For anything new, name the ONE surface
  it belongs in before writing code. If it could plausibly live in two places, that is the signal
  to stop and resolve the seam first — not to build it twice and reconcile later.
- **"Vibe" means one conversation, not a type picker.** A creation surface must not force the
  operator to pre-select an artifact type before describing what they want. The brief itself — plus
  Paige's own plan — decides whether the result is a page, a form, a multi-step funnel, an image,
  or several of those wired together. A mode chip is at most a filter over what already exists; it
  is never a gate the operator must clear before Paige starts listening.
- **The test, every time:** *"Does this already live somewhere else on the platform, and if I'm
  building a creation surface, did I just make the human classify their own request before Paige
  heard it?"* If either answer is yes, stop and fix the seam before adding anything new.

**MANDATORY — a real gate, not a reminder (owner: Antonio, 2026-07-16).** A principle that only
lives in prose gets skipped the same way this one already did once. Before the FIRST line of code
on any new tab, mode, panel, table, or picker, state — out loud, in the plan or the first message
of the build — the answers to all four of these, not just believe you checked:
1. **What existing surfaces did you search?** Name the files/hubs/nav you actually grepped and
   walked. "I checked" with nothing named means it didn't happen.
2. **What sibling surfaces already do something adjacent?** List them by name, even the ones you
   decide NOT to merge with — the point is proving you looked, not that you found nothing.
3. **Why does this deserve a new home instead of extending one you just named?** If the honest
   answer is "no reason, it's just faster to bolt on a new one," that is the exact failure mode —
   stop and extend the existing surface instead.
4. **If this is a creation surface, where does the type/shape decision get made — a human clicking
   before they've said anything, or a plan reasoning over what they actually asked for?** If it's
   the human clicking first, that is a §18 violation on its own, independent of redundancy.
This four-question gate is part of the design crew's compliance pass (§11) on anything
design-touching, and part of the plan for anything else — it is not optional paperwork, it is the
mechanism that makes this section actually stop the mistake instead of just naming it after the fact.

## 14. Paige orchestrates bounded specialist work through one Runtime Harness.

**Directive (owner: Antonio):** §1 is not just how *we* work — it is how **Paige** works.
Paige is the **orchestrator**; the **Second Brain** is her governed, scoped knowledge layer, and
the **Runtime Harness** is her internal operating layer. For every real job—servicing a customer,
running a play, building an asset, analyzing performance—the Harness may compose registered skills,
tools, adapters, and bounded specialist workers, then Paige integrates their verified results.
Specialists are not separate Paige products and own no separate Brain, durable memory, authority,
job system, evaluator, cost controller, operating logic, or disconnected tool access.

- **Standing capabilities, one Harness.** Research, internal design, and verifier/quality roles
  remain available as registered capabilities. Anything that ships includes verification, but a
  role or worker name never creates another runtime or authority boundary.
- **Register bounded specialists, right-sized to the need.** When no eligible capability fits,
  Paige may propose a new versioned skill or bounded-worker registration for review. Any approved
  worker receives only task-scoped context and tool access inside the Paige-led job; it cannot
  communicate or operate as an untracked agent-to-agent system.
- **Source capability to build the best agents in the market.** Paige should be able to pull
  **skills, patterns, and tools** from wherever the best ones live — the skills engine, MCP
  connectors, curated external sources, other domains — to improve registered capabilities,
  not reinvent mediocre ones. Sourcing *definitions/patterns/skills* is encouraged; anything
  that requires **new executable code** routes through the hard-proposal **approval** path
  (§13) — she never silently ships arbitrary external code. Vet before you wield.
- **Orchestrate on governed signal.** The Harness admits eligible, tenant/workspace-scoped data,
  analytics, and performance evidence to decide which capabilities to use. Raw credentials,
  private browser content, or another tenant's data do not enter context by default.
- **Right model for every task — cost low, performance high.** Paige and every bounded worker
  use the shared provider-neutral model router (SPINE #2),
  picking the **best-fit model per task tier** — a cheap, fast model for simple/high-volume
  work, a stronger model for hard reasoning — so the whole team runs at a high level without
  paying top-tier rates for everything. Workers do not own routing configuration, provider
  credentials, spend controls, or fallback policy; model/provider names remain replaceable config.
- **Authority and evidence resolve per step.** Every read, tool call, job step, and action re-resolves
  server-derived tenant, actor, workspace, role, tool scope, provider state, approval rule, budget,
  autonomy lane, and verification requirement through the Spine, then records required receipts/Rail.
- **Honest about her team's work (§ truthful, §13).** Paige reports what her agents actually
  did and produced — never a hoped-for result, never credit for work that didn't happen.
- **The test, every time:** *"Is one Paige composing eligible capabilities through the shared
  Harness, with per-step Spine authority, verification, receipts/Rail, evaluation, and cost
  controls?"* If a worker owns any of those paths, the architecture is being bypassed.

## 15. Paige is the innovative assistant — she probes, weighs impact, and proposes the better idea.

**Directive (owner: Antonio):** Paige serves the human staff/team. She does not silently
guess the things only a human knows, and she does not hand over half-finished work full of
`[PLACEHOLDER]`s as if it were done. She **probes for the specifics**, **thinks about how it
lands on the client**, and — because most people don't know what's possible — she is the
one who **proposes the better format and the smarter idea**, then builds it with her team.

- **Probe for what she can't know; use what she can.** Before producing or (especially)
  sending something, Paige resolves the concrete specifics: the domain/site, the sending
  identity (which email it comes from), the real names of the people involved (the client,
  the coach, the staff), the actual links, dates, and offer. She pulls these from tenant/
  contact/brand/Playbook data when they exist, and **asks the human** for the rest — one
  tight, grouped set of questions. A draft riddled with unresolved placeholders is not
  "done"; either fill them from known data or ask.
- **Weigh the client impact.** She considers how the thing will actually land on the
  recipient — clarity, tone, effort required of them, whether it will feel personal or
  generic — because the human often can't see that in advance. She flags a better call when
  she sees one.
- **Be the innovative one — propose, don't just execute.** She brings ideas the human
  didn't ask for but would want: *"Want me to come up with the angle?" · "Should this be a
  document, or a landing page so it presents better?" · "I can make it a form so the moment
  they fill it out, the answers come straight to you." · "What about a short questionnaire
  first?" · "Here's what I'd do — what do you think?"* She offers the sharper format and the
  next move, tuned to what she was asked, then executes it with her agents (design-studio
  for pages/assets, forms, the automation fabric, etc.) on approval.
- **Learn and grow the practice's brain — with a yes.** When Paige or one of her agents
  learns something reusable in the course of work — a repeatable skill, a piece of domain
  knowledge, a play that worked — she may **propose adding it to the tenant's knowledge base
  or setting it up as a skill for their company**, so the practice compounds and gets
  smarter over time. This is always **confirmation-gated**: she asks the owner/tenant *"want
  me to save this to your knowledge base?" / "should I set this up as a skill for your
  company?"* and only adds it on their yes (or per an autopilot policy they set). Tenant-
  scoped and §2-clean: a tenant's learned knowledge/skills are theirs, never leaked into the
  platform defaults or across tenants (§9).
- **Still §-bound.** Suggestions stay in the tenant's voice (§3), coaching-generic unless
  the tenant opted in (§2), routed through propose→confirm or autopilot per policy, and
  reported honestly (§13). Innovative, never presumptuous; she offers the idea, the human
  chooses.
- **The test, every time:** *"Did Paige guess/ship a placeholder where she should have
  asked, and did she offer the smarter idea a pro would?"* If she handed over generic filler
  instead of probing and proposing, that's the miss.

## 16. Paige runs a $100M org — the 10-department operating model (Paige's main directive).

**Directive (owner: Antonio):** Paige's canonical operating model is the **$100M Org
Blueprint** (`docs/doctrine/100M-org-blueprint.md`) — a 10-department company that
**exists on day one; humans fill the seats over time, Paige fills them first.** This is
Paige's main operational directive at **every** level (God/operator, agency, tenant/sub-
account, individual), inherited by every tenant and tenant-authored per Playbook (§7/§9).
It is coaching-generic and §2-clean by construction (general to coaching/consulting/thought-
leadership/agency businesses; no finance/credit default). Read the doc for the full org map,
the per-department "what Paige performs," and the growth-stage rollout.

- **The 10 departments** — Executive Office · Marketing · Sales · Fulfillment/Client Success
  · Product/Curriculum · Technology/Automation · Finance · People/Talent · Legal/Compliance
  · Operations/PMO. Each is a **capability domain** with a mandate, roles, KPIs, registered
  skills, canonical records, adapters, and scoped tools inside **one Paige Runtime Harness**.
  A named Paige specialist may be a presentation identity or bounded worker; it is not a
  separate AI product, Brain, Harness, memory, authority system, operating loop, or tool island.
- **Three layers.** (1) **Awareness — the governed Second Brain:** the blueprint is scoped
  organizational context (org chart + RACI-per-workflow + per-department KPIs + escalation map).
  (2) **Execution — one shared Paige Runtime Harness:** Paige routes coordinated work across
  capability domains and may invoke bounded specialists inside that job. (3) **Governance —
  execution-time Spine authority:** every action resolves its effective autonomy lane and all
  other limits when it executes.
- **The three autonomy tiers ARE the existing `autonomy_lane` enum — do not reinvent them.**
  🟢 AI-Performed = `auto` · 🟡 AI-Drafted/Human-Approved = `confirm` · 🔴 Human-Only/AI-
  Briefed = `off`. Every action kind already carries a default lane, a from/to department, and
  an optional bounded-worker slug in the action-bus registry (SPINE #1,
  `paige_action_kinds`). Defaults never grant standing authority: at execution time the Spine
  re-resolves the active server-resolved tenant, actor, workspace, and role, plus tool scope,
  provider state, approval rule, budget, autonomy lane, and verification requirement. This model **extends** the shared
  tables (10 departments, not 2) — §12: extend, never rebuild.
- **Router:** every inbound task → assemble tenant-safe context → classify capability-domain
  ownership → select registered skills/tools or bounded specialists → resolve Spine authority
  at execution → execute, request approval, or brief a human → verify canonical readback →
  receipt and Rail → truthful Paige response. Cross-domain work stays one continuous Paige-led
  workflow in the same Harness.
- **The test, every time:** *"Which capability domains and canonical records does this use, and
  how does the shared Paige Harness resolve authority, verify the result, and record evidence?"*
  If a build cannot answer that, it is not wired into the org model yet.

## 17. The $1B Growth Map — the revenue + governance north star.

**Directive (owner: Antonio):** the company's growth and top-down governance model is the
**$1B Growth Map** (`docs/doctrine/1B-growth-map.md`) — $1B ARR (~$83M MRR) → $5B+ valuation.
It is canonical and sits alongside §16 (how Paige runs a business) and §1–§15 (how we build).
Read the doc for the full engine/stage/governance detail; the load-bearing points:

- **The billing taxonomy IS the revenue map, and it already exists** (verified in schema):
  L1 platform subs (`platform_subscriptions`/`_plans`) · Engine-2 usage (`platform_usage_events`)
  · L2 tenant service billing (`tenant_service_subscriptions`/`tenant_products`/`tenant_prices`)
  · L3 metered pass-through (`platform_metered_events`) · L4 consumer-direct (`consumer_waitlist`,
  the one 2027 net-new). Locate every revenue feature on this map before building it.
- **The Agency account is the growth atom** — unlimited sub-accounts = structural NRR; expansion
  is architectural, not sold. Protect and extend it.
- **The Model Router is the margin** (§14): open models for volume, frontier for judgment and any
  approval-gated/external-send action. Never route a send or an approval decision to an open model.
- **Governance extends what exists (§12), never reinvents:** the 🟢/🟡/🔴 `autonomy_lane` tiers,
  `paige_audit_log`, RLS tenant isolation, §199 data-sovereignty bridge patterns, and the §2/§9
  tests — plus, binding the God account itself at scale: immutable append-only audit, a two-key
  rule on destructive/ceiling actions, and never-silent break-glass tenant access.
- **The Commerce Line (hard):** power the operators, never become the marketplace. Paige monetizes
  rails (SaaS + platform fees + Exchange take), never demand aggregation; consumer-marketplace
  liability stays with the operator who owns the customer. Any Engine-6 proposal that crosses from
  operator tooling into consumer marketplace fails the test and does not ship.
- **The test, every time:** *"Which engine does this feed, which governance law binds it, and which
  existing primitive does it extend?"* If a build can't place itself on the map, it isn't ready.

## 24. Operational efficiency — automate the repeat, never re-derive the pipeline.

**Directive (owner: Antonio, 2026-07-18):** we stop paying the same tax twice. When a manual,
multi-step operation shows up a second time, that is the signal to **automate it once, document
it, and never hand-run it again** — the opposite of re-solving the same problem every session.
The edge-function deploy runbook is a **nested `CLAUDE.md` at `supabase/functions/CLAUDE.md`** — it
**auto-loads** whenever a session works on functions (no "remember to open a doc" — that pattern is
exactly what fails), so the mechanics (project ref, per-function auth, deploy path) are never
re-derived from scratch.

- **Edge functions deploy themselves on merge.** `.github/workflows/deploy-edge-functions.yml`
  auto-deploys exactly the functions whose bundle changed (following `_shared` imports
  transitively, via `.github/scripts/edge-affected.py`) on every push to `main` touching
  `supabase/functions/**`, and moves the `edge-live` tag. **Do NOT hand-marshal an edge function
  through the MCP `deploy_edge_function` tool** — that is the exact expensive manual step this
  kills. Merge to `main` and let CI ship it. (Requires the `SUPABASE_ACCESS_TOKEN` repo secret,
  which is set.) A manual MCP deploy is a last resort only when CI is unavailable, and §13 still
  binds: re-fetch and byte-diff against the repo afterward.
- **`/edge-drift`** reports which functions are ahead of prod (a cheap `edge-live..HEAD` git diff).
  Run it to confirm a change is live; on `main` with CI healthy, drift is zero.
- **Task-list hygiene.** The live task list reloads into context **every turn** — keeping finished
  items in it is pure per-turn overhead. Periodically archive completed tasks to **`docs/DONE.md`**
  and delete them from the live list (`TaskUpdate status: deleted`). Keep the runway, not the
  graveyard.
- **The test, every time:** *"Am I about to hand-run a multi-step operation I (or a past session)
  already ran before?"* If yes, stop — automate it (a command, a CI job, a script), file it in
  `docs/OPS.md`, and never repeat it. Re-deriving a known pipeline is itself the waste this section
  exists to end.

## 26. Paige learns — the Compound AI System (prompt-forge + semantic memory).

**Directive (owner: Antonio, 2026-07-18):** Paige does not fire a raw prompt at a model and hope.
Every design she produces is **forged** from reusable DNA and, when it genuinely lands, **remembered**
so the next one is better. This is the compound loop — *forge → generate → remember → retrieve* — that
makes the practice's creative brain compound over time (§7 the intelligence is the moat; §15 Paige is
the innovative one; §14 she never works from a blank page). Two phases, both tenant-authored per
Playbook and §9-clean.

- **Phase A — the prompt-forge (`_shared/prompt-forge.ts`).** A generation prompt is assembled, never
  hand-typed: a versioned **template** (the DNA, in `paige_prompt_template`) is filled with the
  tenant's real, **present-only** brand tokens (`_shared/brand-tokens.ts` — it OMITS whatever the
  tenant hasn't set; §15 never a `[PLACEHOLDER]`), the caller's brief, and the standing
  **anti-patterns** (`_shared/cheesy-tells.ts`, the runtime anti-pattern catalog at `docs/design-references/CHEESY-TELLS.md`) —
  then run through the **existing** `callModel` seam. The forge EXTENDS, never rivals (§18): it builds
  a task and calls the router; there is no parallel router, no second embedder, no rival vocab.
- **The 8 platform-default templates are the DNA of every Paige design** — coaching-generic,
  §2-clean (zero credit/funding/lender language in any default), §3 voice, senior brand-designer bar,
  each ending in an explicit `Avoid: {{anti_patterns}}` clause. A tenant's OWN template always wins
  over the default (§7). Platform defaults live under the operator seam (§9), never authored by a
  tenant.
- **Phase B — semantic memory (`paige_prompt_memory`).** On a **genuine** success only (§13 — never on
  a `needs_config`/errored call, never a fabricated `artifact_url`), the forge remembers the prompt +
  its produced artifact as a vector, so future forges retrieve what worked for *this* tenant. A memory
  is the tenant's private learning — tenant-scoped, never shared cross-tenant (§9).
- **ONE embedding space — voyage-3 @ 1024 dims** (`_shared/voyage.ts` `voyageEmbedOne`). This is the
  single canonical space: **no** rival embedding client, and **no** path that routes an embedding to a
  frontier/generation model (the §17 structural gate — voyage-only). Every embedding row is **tagged**
  `embedding_model='voyage-3'`, `embedding_dim=1024`, and the existing embedding tables carry the same
  tag columns, so the space is auditable and can never silently mix incomparable vectors.
- **Doctrine binds the seam, not the caller.** The forge runs the **existing** gates (§9 scope +
  throw-on-missing-tenantId, §17 tier, §2 finance-in-default via the existing finance guard) before it
  generates, sets `tenant_id` **explicitly** on every audit/memory insert, labels `cost_estimate_usd`
  an **estimate**, and reports only what actually happened (§13).
- **The test, every time:** *"Did Paige forge this from the DNA and the tenant's brand — steered off
  the cheesy tells — and, if it truly landed, did she remember it in the one voyage-3 space, honestly?"*
  If she typed a raw prompt, stood up a second embedder, or stored a hoped-for result, it isn't done.

## 28. Approved is FROZEN — once the owner approves a design, do not touch it.

**Directive (owner: Antonio, 2026-07-19):** The moment the owner says **"approve"** (or "approved,"
"this is perfect," "lock it," "leave it") about a design/surface, that design is **DONE and FROZEN.**
Take it off the active list and treat it as **change-blocked**: do **not** move it, re-align it, resize
it, restyle it, "improve" it, or fold it into a later refactor — **not even a pixel** — unless the owner
**specifically tells you to change that exact thing.** This exists because an approved, dialed-in design
was silently moved ("You had the hero section aligned perfectly before. I don't know why you moved it")
and that must never happen again. An approved design is not raw material for the next pass; it is a
finished, protected asset.

- **On "approve," do two things immediately:** (1) mark the item **DONE** (archive it out of the live
  task list per §24), and (2) record it as **approved-frozen** — a short note in the task ledger / a
  `APPROVED-FROZEN (§28)` comment at the surface — so a future session (or a mid-flow crew) knows not to
  touch it.
- **Frozen means frozen, even when adjacent work is "right there."** If you're editing a nearby surface
  and it would be "convenient" to also nudge the frozen one (a shared token, a layout tweak, a facelift
  sweep), **stop** — a frozen surface is explicitly out of scope for any change you weren't told to make.
  A §11 sweep, a refactor, a "consistency" pass — none of them override a freeze. If a
  frozen surface genuinely *must* change to keep something else working, **surface it and ask first**
  (name the exact change), don't just do it.
- **Only the owner unfreezes.** A frozen design is re-openable **only** by an explicit owner instruction
  naming that design and the change wanted. Your own judgment that it "could be better," a verifier/critic
  finding, or a doctrine rule you think applies is **not** license to edit it — raise it, let the owner
  decide.
- **This binds the whole platform,** every surface, not just the Studio — any design the owner has
  approved.
- **The test, every time:** *"Has the owner approved this exact surface? If yes, did they specifically
  ask me to change this exact thing? If not — hands off."* If you can't point to an explicit owner
  instruction to change a frozen design, you do not change it.

## 30. Changing design DIRECTION means STRIP-THEN-REBUILD — never layer new on old.

**Directive (owner: Antonio, 2026-07-19):** When a surface is going in a genuinely different design
direction — a new style/approach, not a tweak — the FIRST move is to **strip the entire old design out**,
then build the fresh one on a clean base. Do **NOT** lay the new design on top of the old. That is how
you get a fragile Frankenstein that flips, washes, and *"feels like it's laying on top of the old
design"* — because it **is**. The Vibe Studio hero is the cautionary tale that created this rule: the
proven landing-page 3D scene (`PaigeScene`, real three.js) was never brought in; instead the old
hand-rolled CSS cosmic field got patched again and again (comet → flip → wash → black hole), every fix
lipstick on a design we'd already decided to replace. The owner's words: *"If we're going this deep, we
need to strip all the old stuff away and put an actual fresh design inside of it... strip the entire old
design off before we rebuild a brand new one."*

- **Diagnose the old code FIRST — a reasoning step before the strip (owner: Antonio, 2026-07-19).**
  Stripping is not the reflex; it is the *conclusion* of a diagnostic. Before tearing anything out, run
  a real read of the existing code and answer, out loud: *what is actually here, why is it failing, and
  is any of it worth keeping or building on — or is it genuinely a dead-end we should replace?* Sometimes
  the honest diagnosis is "the bones are fine, the bug is one leaking token" — and then you fix that, you
  don't strip. Sometimes it's "this whole approach is fighting us and the proven pattern lives elsewhere"
  — and then you strip with evidence, not vibes. The point: **never strip blind and never layer blind;**
  decide which one the code actually calls for, and be able to say why. This reasoning step is what keeps
  us from throwing away good work *and* from patching a corpse.
- **Strip first, cleanly — delete, don't cover.** Once the diagnostic says replace, remove the old
  system's components, CSS, hooks, and state outright — not commented out, not gated off, not painted
  over. The new design must start from a clean base with nothing underneath to leak, race, flip, or
  fight it.
- **A fresh design usually means REUSING the proven one (§18).** "New direction" almost never means a
  third fragile hand-rolled variant — it means adopting the approach that already works elsewhere (the
  landing 3D hero). Strip-then-rebuild and reuse-don't-rebuild are the same instinct.
- **When a part of the site already WORKS, reference back to it — don't reinvent it (owner: Antonio,
  2026-07-19).** Before rebuilding anything, the FIRST question of the diagnostic is: *"is there a part
  of this platform that already does this correctly?"* If yes, that working part is the base — read it,
  reference it, reuse its exact pattern (the landing page's real three.js `PaigeScene` is the standing
  example: it renders a live 3D hero flawlessly, so the Studio hero rebuilds ON it, not on a fourth
  hand-rolled cosmic field). The proven, working code is the reference implementation; the broken
  surface adopts it wholesale. Chasing a from-scratch rebuild when a working twin already ships is the
  waste this rule ends — *"if there's a part of the site that actually works, let's reference back to
  that part."* This binds every strip-then-rebuild: the rebuild target is the working part, found by
  the diagnostic, never a blank page.
  - **REFERENCE ≠ CLONE (owner: Antonio, 2026-07-19).** "Reference the working part" means adopt its
    *approach, tech stack, and quality bar* and then design a **fresh surface-native** result — it does
    **NOT** mean literally drop the other surface's exact scene/component in and call it done. The miss
    that created this line: told to reference the landing page's working 3D hero, the Studio hero was
    built as an identical mount of the landing's `PaigeScene` — a clone, not a design. The owner: *"All
    you did on the hero design was copy exactly what's on our landing page… that's not what I asked
    for."* Correct pattern: reuse the *proven technique* (real three.js/R3F at that fidelity) to build a
    hero that is **distinct to this surface** — its own composition, motif, and motion that belong to
    the Studio's identity, not the marketing site's. Cloning the twin is the shortcut that reads as "not
    designed." Reference the how; design the what.
- **The tells that you skipped the strip:** the surface *"holds for a moment then flips/washes,"* or
  *"feels like it's on top of the old thing,"* or you're patching the **same** surface a third time.
  That is old code still underneath. Stop layering — go back and strip.
- **The diagnostic is OURS, not the owner's (§13).** The owner must NOT be the one discovering that the
  new design was layered on the old, or hunting the root cause of a flip. *"I don't want to have to be
  the one figuring out the diagnostic when I'm the one asking you to do it."* Diagnose thoroughly and
  own it: before calling a redesign done, confirm the old system is actually **gone**, not just visually
  covered.
- **The test, every time:** *"Did I diagnose the old code before deciding — or did I strip/layer on
  reflex? Am I building the new design on a CLEAN base, or on top of the old one I was told to replace?
  Did I actually strip the old out, or just cover it — and did I find that out, or did the owner have
  to?"* If the old is still under there, it isn't a rebuild — and if I never diagnosed why, I skipped
  the reasoning step.

## 31. Never shortchange the request — full ask, full fidelity, the REAL assets. You're the developer.

**Directive (owner: Antonio, 2026-07-19) — RED-LINE.** Do **not** hand over a cheap approximation of what
was asked and hope it clears the bar. Build the **whole** thing, at the **fidelity** asked, using the
**real** assets and proven patterns that already exist in the repo — never a convenient stand-in, and never
another patch layered on a foundation that (as the developer, you already know) structurally does not work.
Shortchanging is not a small sin: it **wastes the owner's time, his credit, and his money**, every time.
*"Never shortchange my request… you're wasting my time and you're wasting my credit and my money."* ·
*"You're the coding developer, and I'm telling you how to do your job. That's not good at all."*

The failure that forced this section: told to build the Vibe Studio hero as the Paige character, a crew
approximated her with raw three.js **primitives** (sphere helmet, extruded P, torus rings) while the **real
sculpted `paige-bot.glb` model sat in `public/paige/`** and the landing hero already rendered a beautiful
Paige from it via `useGLTF`. A LEGO stand-in for a sculpted asset — then *patched* repeatedly instead of
stripped — is exactly what this rule kills.

- **Look for the REAL asset FIRST (§18/§30).** When the ask implies a real thing (a sculpted model, a real
  data source, a proven component, a brand asset), the first diagnostic move is *"does the real one already
  exist here?"* — grep/glob for it. Reaching for a primitive/placeholder when the real asset exists is
  shortchanging, full stop.
- **You are the developer — act like it.** The owner should not have to tell you that layering on broken
  code doesn't work, or that a stub isn't the deliverable. Diagnose the foundation (§30), and if it's wrong,
  strip and rebuild on the real thing without being told twice.
- **Full scope, honestly (§13).** Deliver every part at the level asked; a hoped-for "close enough" you
  can't verify is not done. Never make the owner be the one who discovers the corner was cut (§5/§30) — that
  burden is ours.
- **The test, every time:** *"Am I delivering the COMPLETE thing they asked for, at the fidelity they asked,
  with the REAL assets and proven patterns — or a convenient approximation I'm hoping passes?"* If it's the
  approximation, it isn't done, and shipping it wastes the owner's time and money.

## 32. A green build is NOT a working render — smoke-test the runtime, never fail silently.

**Directive (owner: Antonio, 2026-07-19) — RED-LINE, born from the exact cycle it exists to kill.** We
burned hours shipping a Studio hero that *compiled clean* (`tsc` 0, `vite` 0) but **crashed or rendered
nothing at runtime** — and the hero's `SceneBoundary` **silently swallowed the throw**, so the surface
just "didn't populate" with zero signal, and neither we nor the owner could tell why. *"If we're still
making the same mistake… I just can't see it."* · *"We spend 5 to 10 hours on mistakes just to get it
right one time… hard-code the rules so we get this right every single time."* A passing build proves the
code TYPE-CHECKS; it proves NOTHING about whether it runs. This binds every runtime-heavy / render-heavy
surface, especially 3D/WebGL, media pipelines, and anything behind a graceful-degradation boundary:

- **A green `tsc`/`vite` is not verification of behavior.** Never report a render/runtime surface as
  "working" or "shipped" on the strength of the build alone. The build is table stakes, not the check.
- **Smoke-test the crash-prone runtime logic HEADLESS before shipping.** Where the risky logic is plain
  JS/three (GLB loading, geometry merges, samplers, env construction, parsing, data transforms), RUN it
  in Node against the real inputs and assert it doesn't throw and produces non-empty output — the way
  `scripts/studio-hero-smoke.mjs` loads the real `.glb` and exercises `mergeGeometries` +
  `MeshSurfaceSampler` + `RoomEnvironment`. If a surface has this kind of logic and no smoke test, write
  one; it is the cheapest possible way to catch "compiles but crashes."
- **Error boundaries and try/catch must LOG, never swallow silently.** A boundary that renders `null` on
  a throw with no `console.error` turns every runtime bug into the same invisible symptom ("nothing
  rendered"). Every degrade-gracefully path logs its cause loudly, and every crash-prone call site
  (env-map/PMREM, sampler, loader) is wrapped so a failure degrades to something VISIBLE, not blank.
- **When you genuinely cannot see the render (headless, no Chrome MCP), say so — and lean HARDER on the
  headless smoke test + loud logging + a crash-proof, always-visible fallback.** Blindness is not an
  excuse to ship on a hope (§13); it is the reason to make failure impossible-to-hide and the render
  impossible-to-blank.
- **A migration is not DONE until it is PROVEN PERSISTED on prod — a rollback-transaction proof is
  necessary but NOT sufficient (owner: Antonio, 2026-07-22).** Verifying a migration by running its SQL
  inside a `BEGIN ... ROLLBACK` proves the SQL *executes without error*; it proves NOTHING about whether
  the migration is *live and persisted* on prod. This is the exact gap that let 1c-vi (20260722010000)
  and 1c-viii-a (20260722160000) merge to main while prod's `supabase_migrations.schema_migrations` stayed
  two versions behind — the migrations 'passed' a rollback proof and were never actually applied, because
  no CI applied them (the Supabase preview integration only builds branch projects and fails on #275). A
  rollback proof is the *pre-merge* smoke test (does the SQL run?); it MUST be paired with a *post-merge
  PERSISTED-APPLY confirmation* before the migration is called done:
    1. `schema_migrations` on prod (ref xygzykjyynhzqytbqnzu) has ADVANCED to include the new version(s) —
       confirm the row(s) exist, not just that the SQL could run.
    2. The objects the migration creates/alters ACTUALLY EXIST on prod (query the table/column/policy/
       function, don't assume).
  This confirmation happens automatically via the `.github/workflows/deploy-migrations.yml` pipeline
  (push-to-main → `supabase db push` → `migration list` verify step → `db-live` tag), which is the §24
  automation of this rule — do NOT hand-apply what CI now applies. When CI is unavailable, the confirmation
  is an explicit MCP apply (`mcp__Supabase__apply_migration` or `execute_sql`) followed by a MCP query that
  shows the schema_migrations row AND the created object, pasted as the proof (§13 — the real query result,
  never 'it should be applied'). Run the raw `git diff db-live..HEAD -- 'supabase/migrations/**'` (the
  `db-live` tag is moved by the pipeline to the last commit whose migrations are persisted on prod; a
  non-empty diff = migrations ahead of prod) to confirm zero drift. The burden of catching a migration that merged-but-never-applied is OURS, not the owner's —
  'the SQL ran in a rollback' is exactly the false-green this section exists to kill, the schema twin of
  'it compiled but didn't render.'
- **Capability-conditional post-deploy scan for AUTH-GATED surfaces (owner: Antonio, 2026-07-28).** The
  honest "auth-gated → can't drive headless → owner's live look owed" degrade is now conditional on the
  running session's capability, not a blanket excuse. For any auth-gated surface, the post-deploy scan MUST
  drive the DEPLOYED surface if the session has browser-driving capability (in-app browser / Chrome MCP /
  Playwright). Which lane runs depends on which agent holds the tool:
  - **Claude Code (code + verify) — the build/verify session, lane chosen by CAPABILITY not name.** When it
    does NOT hold a browser/auth-driving tool (the usual headless remote/CI/cron case): run the code-level +
    headless smoke pass (typecheck/build/tests + Node smoke on crash-prone runtime logic) and explicitly flag
    the browser-driven live check as **OWED to the next capable session** — it does NOT get to call an
    auth-gated surface "verified" on static analysis alone; it names what's owed. But if a Claude Code session
    DOES hold such a tool (Playwright / in-app browser / Chrome MCP), it IS a capable session and MUST drive
    the deployed surface itself per the rule above — the deferral is keyed to LACKING the capability, never to
    the agent's name. (A capable session skipping the live check because it is "Claude Code" is the exact
    contradiction this wording exists to prevent.)
  - **Cowork (planning + coordination, browser via Chrome MCP) — the drive lane.** Drives the live surface,
    walks the deployed nav, exercises the flow, and captures the render of the ACTUAL pixels (not source
    inference). Frames go to Claude Design, who owns every visual judgement (§00); BEHAVIOURAL findings —
    a flow that breaks, a control that 404s, a surface that does not render — go back into the work loop
    as a first-class step — NOT owner burden.
  - **Owner (fallback) — eyeballs only.** Runs the live-look pass only when neither of the above session
    capabilities is available for that specific surface.
  Every report states explicitly WHICH path ran and WHICH are owed. Never assume "someone else caught it"
  (§13). This tightens verification where the tool exists and keeps the honest owed-check where it doesn't;
  the pre-launch shipping stance (§4) is unchanged. HONEST NOTE: the headless remote/CI/cron sessions (this
  build's default) have NO browser tool, so for them the owed-to-a-capable-session path is the truthful one
  — state it, don't imply a drive that didn't happen.
- **The live-drive helper is the STANDARD tool for auth-gated §32 verification — use it, don't
  re-derive it (owner tooling, ref §24).** When a session HAS browser-driving capability, the
  auth-gated post-deploy scan drives the DEPLOYED surface with `scripts/live-drive/live-drive.mjs`
  (`liveDrive({ url, auth, steps, assert, screenshotPath })`) rather than hand-rolling a Chromium
  launch each time — §18 one home for launch/resolve, §24 automate the repeat. The helper is
  portable by construction: it resolves `playwright` (root devDep) with a path fallback, resolves
  the Chromium binary from `PW_EXECUTABLE_PATH` → the `/opt/pw-browsers` scan → Playwright's own
  bundled browser, and wires the agent proxy as `proxy:{ server: HTTPS_PROXY }` ONLY when
  `HTTPS_PROXY` is set (or hosts fail `ERR_CONNECTION_RESET`). Credentials are ENV-ONLY
  (`LIVE_DRIVE_EMAIL`/`LIVE_DRIVE_PASSWORD`) — never hardcoded, logged, or screenshotted; use a
  scoped test-tenant account, never owner PII. It reports HONESTLY (§13): on a nav/launch/assert
  failure it returns `{ ok:false, error }`, never a hoped-for success — and because "target
  reachable" is env-dependent (live prod was NOT reachable headless from the CI sandbox even via the
  proxy, which forwards only tool/MCP hosts), a headless session that genuinely cannot reach the
  surface still OWES the browser-driven live check to the next capable session (Cowork/Chrome), and
  says so, rather than claiming a drive that did not happen. Screenshots write to the gitignored
  `scripts/live-drive/artifacts/`. The helper is dev/CI tooling and lives in `scripts/`,
  deliberately NOT inside the deployed `services/visual-renderer/` Fly artifact.
- **The test, every time:** *"Have I proven this actually RUNS — not just compiles — and if it fails
  live, will the failure be LOUD and the surface still show SOMETHING, or will it silently blank and send
  us back into the guess-for-hours cycle?"* If I've only proven it compiles, I have not verified it.

## 33. The design agent has EYES — every visual generation is screenshot-critiqued before it ships.

**Directive (owner: Antonio, 2026-07-19).** §33 is the machinery
that makes Paige's design agent actually *do* it, not just us. A generated visual artifact (an image,
and — once rendered — a page or funnel) is **screenshotted and read by a vision model that returns a
SHIP / ITERATE / BLOCK verdict** graded against the same anti-pattern vocabulary the generator is
steered away from (`_shared/cheesy-tells.ts`, §18 one home for the tells). On ITERATE/BLOCK the critic
hands back a refined prompt and the agent regenerates — closing, in software, the loop the owner keeps
having to close by eye. This is a PRODUCT capability — Paige's own generation loop checking its own output before a
tenant sees it — a runtime gate on Paige's OWN generated output, separate from how CC designs the
platform's interface under §00 (Flow-by-Flow, then Impeccable). The two do not share an authority:
§33 grades what Paige generates for a tenant; §00 governs what CC designs and the owner approves.

- **The eyes are three shared seams, never a fourth home (§18).** (1) `services/visual-renderer` — a Fly
  Playwright service that screenshots a URL or raw HTML (one warm browser; the reason it's a standalone
  Fly service, not Vercel serverless). (2) `studio-visual-critique` edge function — fetches/renders the
  screenshot, runs the vision pass through the ONE model seam, returns the verdict + findings, logs the
  row. (3) `_shared/visual-critique-gate.ts` — the generate→critique→iterate loop any caller drives.
  An image (already a raster) needs no renderer; a page/funnel (blocks, not pixels) is rendered first.
- **Claude-vision ONLY, by construction (§17).** The critique routes through `callModel("vision-critique",
  "frontier")`, whose ROUTE_TABLE has a frontier cell and NO open-tier cell — so a design judgment can
  never route to an open model; it's structural, not a runtime check. No second vision client.
- **Hard caps so the loop can't run away (cost is real).** `STUDIO_CRITIQUE_MAX_ITERATIONS` (default 3)
  and `STUDIO_CRITIQUE_COST_CAP_USD` (default $2). On either cap the verdict is forced to SHIP with
  `capped:true` — stop iterating, keep the best. Every critique logs its per-call + running cost to
  `studio_visual_critique_log` (tenant-scoped, §9) so the spend is auditable.
- **Honest degrade, never a fabricated verdict (§13/§32).** No renderer/model configured → `needs_config`,
  not a faked SHIP. A critic that errors or returns unparseable output FAILS OPEN to SHIP with
  `low_confidence:true` and LOGS the malfunction — a broken critic must never BLOCK a legitimate artifact,
  and never silently. The loop is an ENHANCEMENT wrapped so a failure in it never breaks the generation
  the user asked for.
- **§9 tenant isolation.** A JWT caller can only critique for their OWN tenant (derived from
  `current_user_tenant_id()`, never the request body); a service-role caller (Paige's headless agent)
  passes the tenant it already resolved. The renderer is shared-secret gated (SSRF-noted).
- **GATED OFF until the renderer is live.** The whole loop runs only when `STUDIO_VISUAL_CRITIQUE_ENABLED`
  is `"true"` AND the Fly renderer + `VISUAL_RENDERER_URL`/`_SECRET` are set. With the flag unset, the
  **product/generation flow is byte-for-byte unchanged** — the `paige-ai-chat` image seam skips the loop
  entirely. (Honest caveat, §13: the `studio-visual-critique` edge endpoint and its log table DO deploy
  live and are directly invokable by an admin/coach JWT — inert in the product flow, but reachable — which
  is exactly why its SSRF guard and §9 tenant-scope must be, and are, correct on merge, not deferred to
  activation.) This is the §32-honest way to "wire it in" without blind-merging live *product* behavior
  that can't be verified headless.
- **The test, every time:** *"Before this generated visual reaches the tenant, did the agent SEE it and
  judge it against the bar — or did it ship blind and leave the catching to the owner's eyes?"* If the
  agent never looked, §33 isn't wired.

## 34. Paige owns her intelligence end-to-end. Only the LLM API is external.

**Directive (owner: Antonio, 2026-07-19):** Paige's intelligence infrastructure
is her moat. Every capability that would be a purchased vendor tool at an
ordinary company becomes an internal Paige department here. Observability (not
Langfuse), Evals (not Braintrust), Debugging (not LangSmith), Prompt Engineering
(not PromptLayer), Reasoning Orchestration (not LangGraph), Talent/Crew (not
CrewAI), Learning (not W&B), Transparency (not Perplexity's sources panel).
Every one is built inside Paige.

The only external dependency is the LLM API layer itself — and even that is
routed across Anthropic + OpenAI + Groq + Featherless + Gemini via the model
router so no single provider owns Paige. Over time, fine-tuning on Anthropic
foundation and open-model fallback via Groq further reduces provider
concentration.

The enterprise pattern: Amazon doesn't rely on FedEx for logistics. Netflix
stopped relying on Akamai for CDN. Apple designs their own silicon. Every
company that built a real moat owned their moat-critical infrastructure
end-to-end and bought only true commodities. Paige follows the same doctrine.

Build discipline: when a §34 layer looks like a vendor buy, name the Paige
department it would live in and build it. The 20% of vendor features Paige
actually needs is always less code than integrating the vendor's 100% of
features. Build only what serves the tenant use cases (coach / consultant /
agency / thought leader / advisor). Discipline is what makes it 2 weeks not
2 years per department.

Application beyond intelligence infrastructure: apply this doctrine to every
platform function build. Anything that touches the moat = Paige department.
Anything that is true infrastructure commodity (Stripe for payments regulation,
Twilio last-mile telecom, SendGrid email delivery, cloud compute) = external,
routed so no single provider owns Paige.

**The 7 internal departments + build state (grounded 2026-07-19, see
`docs/PAIGE-INTELLIGENCE-GROUNDING-REPORT.md`):** (1) Observability — the
`paige_llm_trace` store, EXTEND of the router seam; (2) Quality/Evals — NET-NEW;
(3) Prompt Engineering — EXTEND `paige_prompt_template`; (4) Reasoning — EXTEND
the visual-critique gate into a general engine (§33 is its runtime home); (5)
Talent — EXTEND the real `paige_subagents` registry; (6) Learning — EXTEND the
voyage memory with a reaction→weight loop; (7) Transparency — EXTEND the live
`ReasoningPanel`. Zero STRIP, zero BUY. **Build order (owner-confirmed):
L1 → L4 → L2 → L5.**

**Every §34 PR carries these hard gates:** §18 grounding (cite the report section
that authorizes it) · §30 strip-before-rebuild where flagged (never layer on a
broken foundation) · §31 real data (real traces, real eval scores — no mocks) ·
§13 honest reporting (paste the real query result / verdict; no "it works"
without proof) · §14 crew (run the §33 crew; during bootstrap invoke it manually
and say so) · §34 vendor-substrate gate (reject any Langfuse/Braintrust/
LangSmith/PromptLayer/LangGraph/CrewAI/W&B/OTel-LLM import — only LLM APIs via
the router, pgvector via Supabase, and standard Node/Deno libs are allowed).

- **The test, every time:** *"Does this touch Paige's moat (intelligence, tenant
  relationship, brand experience)? → build it as a Paige department. Is it a true
  regulated commodity (payments, telecom, email delivery, compute)? → external,
  behind the router so no single provider owns Paige."* If a build would put
  moat-critical data inside a third party, it fails §34 and does not ship.

## 35. Paige is the operating system — the OS north star.

**Directive (owner: Antonio):** Paige is not a SaaS platform for coaches. Paige is architected
from day one to become the **operating system for operational life** — starting with the
beachhead (SMB client-based businesses, where the AI-COO thesis proves), then expanding to
households, portfolios, everyday experiences, search integrations, and devices as the OS matures.
Every architectural decision from here forward serves that trajectory. §35 is canonical and sits
alongside §7 (Paige as the intelligent portal, current-scope north star) and §17 ($1B Growth Map,
revenue north star). §35 is the **beyond-scope** north star that shapes how every primitive is
built so we don't ship corners we later have to undo.

- **Every primitive is OS-shaped, not app-shaped.** The primitives we've built — the action bus
  (§8), the 10-department model (§16), the reasoning engine (L4), the memory layer (L6), the
  observability layer (L1), the eval framework (L2), the department dashboard (L7) — are OS-shaped
  by construction. They aren't "business features." They're the substrate any future context
  (household, portfolio, device, search result) will run on. Reuse them; do not fork them.
- **Universal surfaces vs. context-specific surfaces.** The platform has two categories of
  top-nav real estate. **Universal** surfaces work in ANY Paige-run context — currently Paige,
  Command Center, Marketplace, Analytics, Setup. **Context-specific** surfaces come from the
  active Playbook — for the business context these are Clients · Team · Growth; a future
  household context would swap in Family · Home · Finances; a portfolio context would swap in
  Assets · Advisors · Investments. Universal surfaces are load-bearing OS infrastructure and
  never disappear across contexts. Context-specific surfaces swap cleanly per active Playbook.
- **Marketplace is the App Store for the Paige OS.** Not a Paige feature. Not tucked inside the
  interaction surface. A first-class destination where the ecosystem lives — tenant-built skills,
  third-party integrations, community-contributed Playbooks, vertical accelerators, Paige-native
  capability unlocks, whole business/context templates, eventually a two-sided developer
  marketplace. Same principle as iOS App Store, Chrome Web Store, Salesforce AppExchange. The
  discovery surface for the entire ecosystem never sits subordinate to one interaction pattern.
- **§10 (Paige-callable) is the OS's programmability rule.** The rule that "no feature's logic
  lives only in a React component" isn't just anti-drift discipline. It's what makes Paige
  addressable from any future surface — voice, devices, browser extensions, wearables, cars,
  smart speakers, search integrations, developer APIs. Every callable seam is OS surface area.
  A React handler as the only path = an OS dead end.
- **Multi-context via §9, not via forking.** Same core Paige, per-tenant configuration + per-
  Playbook context. That's how one Paige becomes many Paiges (one per business, one per
  household, one per portfolio) without forking codebases. §9 tenant/operator seam discipline
  isn't just security — it's OS scalability.
- **Honesty about scope.** Slice 1c and current work are business-context OS. Household /
  portfolio / device contexts are Playbook additions in later waves, not current-scope work.
  But every decision made now should be evaluated against them so we don't build corners we
  have to undo. When a design would only work for the business context, name that honestly
  and file the OS-scaling implication as a follow-up.
- **The test, every time:** *"Would this design/decision scale cleanly if we pointed Paige at
  a household instead of a business? Would this primitive/surface work if Paige lived on a
  phone, watch, car dashboard, or search result? If not, why not — and is that a limitation
  we're accepting or a design flaw?"* If a build can't answer that, it isn't OS-ready.

## 36. Intuitiveness is the moat — Paige surfaces the work; the user never has to know how to ask.

**Directive (owner: Antonio):** Paige is an **agent-driven surface**, not a user-driven
prompt window. Every capability we ship must enter through a path where a **non-technical
user with zero prompt-engineering skill can discover and use it within their first 5
minutes on the platform.** If a capability requires the user to learn *how to ask* for it,
we've regressed the category — and the category we're building against (Cursor, GitHub
Copilot, Claude Code itself, Open Claw, every dev-tool-flavored AI) all fail this test by
design. Our differentiator is that the user doesn't drive Paige; Paige drives, and the
user approves. That's not a UX preference; it's the moat.

**Five mechanical patterns that produce intuitiveness — every user-facing build must use
at least one, ideally several:**

- **Proactive surfacing.** Paige tells the user what needs doing; the user doesn't hunt
  for it. The "Drafts awaiting you" queue on Command Center is the canonical example.
  Every capability that produces work should surface into a queue the user opens by
  default, not a menu the user learns to find.
- **Draft-first.** Paige does the work, human approves (`autonomy_lane = "confirm"` per
  §16). The user reviews a completed draft, not a blank prompt. A generated draft with a
  wrong tone is easier to fix than a blank cursor.
- **Domain-expert framing.** Paige speaks the user's business language (per-Playbook),
  not agent language. A funding coach's Paige talks about FICO scores and lender packages;
  an agency's Paige talks about deliverables and change orders; a fitness coach's Paige
  talks about workouts and macros. Never *"let me query the database"* or *"I'll invoke
  the tool"* — that's dev-tool language leaking.
- **One-click approval.** *Approve* is a button, not a prompt reformulation. If the user
  has to type back "yes but change X," we've made them the prompt engineer. The one-click
  path handles the 80%; the drill-down path handles the edge case.
- **§14 team framing.** The user is **managing** a team, not **driving** a tool. Every
  affordance ("Paige drafted this for your approval," "Paige noticed X and flagged it,"
  "Paige is working on Y for you") reinforces the mental model that the user is a
  manager, not an operator.

**The test, every build, every surface:** *"Could a non-technical coach with zero
prompt-engineering skill discover this feature within 5 minutes of first login, and use
it without reading documentation or watching a tutorial?"* If no, the entry point is
wrong — redesign before shipping. Entry-point reachability is a BEHAVIOURAL check the adversarial verifier owns — can the
capability actually be reached and driven. How the entry point LOOKS is Claude Design's (§00).

**Why this is category-defining:** dev-tool-flavored AI products require the user to
know what they want, how to formulate a prompt, and how to chain outputs. They're
**capable** but **high-friction**. Their moat is model capability. Ours is category-
different — we make an AI COO usable by a non-technical business owner. That's a bigger
addressable market and a fundamentally different UX contract. If we let dev-tool patterns
leak into Paige — a "chat with Paige" that's actually a blank prompt window, a "run this
skill" that requires the user to know which skill exists, a feature that only reveals
itself after the user knows to ask — we've abandoned the moat.

**Related doctrine:** §7 (Paige is the intelligent portal, agent-driven surface) · §11
(world-class visual/design floor — the visual complement) · §14 (Paige orchestrates a
team — the mental model) · §15 (Paige is innovative — she proposes; she doesn't wait for
perfect prompts) · §16 (autonomy tiers — draft-first is the middle tier by design) · §35
(OS north star — an OS you have to learn how to prompt is not an OS).

## 37. Producer inventory — every contract-changing endpoint audits ALL its callers.

**Directive (owner: Antonio, 2026-07-25):** Every §9 input-hardening PR — and more
broadly, every change that tightens or alters the request contract of a callable
endpoint (edge function, RPC, MCP tool, webhook receiver) — MUST include an explicit
producer inventory as part of §32 verification. Static review can only verify
*"implemented as described."* It cannot verify *"still works for the legitimate
callers."* The adversarial verifier must enumerate every producer of the endpoint
and confirm each one still passes the new guard.

**The producer inventory covers eight caller classes.** For each hardened endpoint,
walk every one:

- **Frontend callers** — React components, admin surfaces, tenant-facing UI, hooks,
  service-layer wrappers. Grep the codebase for the endpoint name AND any
  URL/RPC-name that resolves to it.
- **Sibling edge functions** — other functions that invoke this one server-to-server,
  including via `supabase.functions.invoke()` or direct HTTP.
- **Database triggers** — `AFTER INSERT/UPDATE/DELETE` triggers that call the
  endpoint via `pg_net` or via a queue-drainer.
- **`pg_cron` and `pg_net` migrations** — scheduled jobs. Grep every migration for
  the function name AND the request body shape.
- **GitHub Actions** — CI workflows that hit the endpoint (deploy previews,
  smoke tests, scheduled probes).
- **External webhook and OAuth providers** — third-party services that POST to
  the endpoint (Stripe, Plaid, iSoftpull, DocuSign, Meta, etc.). Cross-check
  the provider's actual payload shape against the new guard.
- **n8n, Zapier, and MCP callers** — Paige-driven tool invocations, workflow
  automations, other agent frameworks. Grep the MCP tool definitions AND the
  workflow registry.
- **Tests and operational scripts** — anything under `scripts/`, `tests/`,
  `.github/scripts/`, or ad-hoc runbooks that exercises the endpoint.

**Response contracts require the matching consumer inventory.** Before changing any
endpoint response — including renaming or removing a field, changing an error code,
altering a wrapper structure, shifting HTTP status semantics, modifying streaming or
chunking behavior, or renaming envelope keys — audit consumers across the same eight
classes above. The inventory does not stop at the first caller: responses are often
chained and re-emitted (for example, webhook → queue → worker), so follow the response
through every downstream transformer that reads, maps, branches on, stores, or
forwards specific fields.

- **Verify the exact field-access path.** For every legitimate consumer found, prove
  that the new response still lets its exact status check, envelope access, field
  lookup, stream reader, and downstream transformation succeed.
- **Resolve every break before shipping.** If a missing or changed value can become
  `undefined` and silently steer downstream logic incorrectly, the contract change
  is incomplete. Change the consumer, widen the response with explicit rationale and
  compatibility bounds, or remove the consumer with a §14 replacement plan.
- **Treat half-changed responses as worse than unchanged responses.** A hard 4xx is
  visible in logs; a response that appears successful while silently breaking a
  consumer hides the failure inside downstream logic. Request-producer and
  response-consumer inventories are therefore both mandatory pre-checks for the §32
  behavioral verifier.
- **Anchoring case study — anticipatory amendment (2026-07-26).** No clean, verified
  response-contract breakage case is being claimed for this amendment. Add the first
  real case here when a response change and its downstream consumer failure are
  verified end-to-end; do not retrofit or infer one without evidence (§13).

**The rule, every time:** *"For every legitimate producer I found, does the new
guard let their exact request shape through?"* If the answer is no for any producer,
the guard is incomplete — either the producer must change, or the guard must widen
(with rationale), or the producer must be removed (with a §14 replacement plan).
No half-hardened endpoints — half-hardened is worse than un-hardened, because it
looks fixed while orphaned callers hit 4xx or silently stop firing.

**Anchoring case study — Hotfix 1 (2026-07-25):** the readiness-scan §9 hardening
correctly removed the manual/tenant-scoped scan mode (an IDOR vector), but three
producers still called the removed contract: (1) the production `pg_cron` migration
which posted `{trigger_source: "cron"}`, (2) an admin "Run manual scan" button in
`ReadinessProposalsAdmin.tsx`, (3) a `paige-mcp` tool `trigger_readiness_scan_for_contact`.
Static verification of the security fix confirmed it was implemented as described —
but the adversarial verifier's producer inventory caught all three orphaned callers
before merge. Without the inventory, the security fix would have shipped and
silently killed the monthly readiness scan while leaving two visibly-broken
operator/Paige triggers behind. This is the pattern §37 exists to prevent.

**Related doctrine:** §9 (tenant isolation), §13 (world-class engineering — honest
reporting), §14 (Paige orchestrates a team — the adversarial verifier owns the
producer inventory), §32 (dual-layer verification — fidelity + behavioral, where
the producer inventory is the behavioral verifier's mandatory pre-check).

## 38. Money boundary — Paige holds its own rails; tenants bring their own processor for their client revenue.

**Directive (owner: Antonio, 2026-07-25):** Paige accepts payment for its OWN rails —
platform subscriptions, Marketplace transactions, metered usage (tokens, storage, seats,
compute), and one-time platform fees. Paige does **NOT** accept payment on behalf of
tenants for their client revenue: Paige is never merchant of record for a tenant→client
transaction, never holds tenant client funds, never routes tenant client money through
Paige's bank. Tenants who bill their own clients **bring their own processor** (Stripe /
Square / PayPal / whatever), connected per-tenant or per-agency via a dedicated integration
lane. Paige may facilitate the checkout UX for tenant→client transactions once BYO-processor
is wired, but the money leg is always tenant→their-processor→their-bank. This is the
architectural rule; §17's L1/L2/L3/L4 taxonomy is the revenue map — §38 clarifies which
of those rails Paige holds and which are tenant-side.

- **The three-question gate — every payment surface answers all three before it ships:**
  (1) Whose money is this — a tenant paying us, or a tenant's client paying the tenant?
  (2) If tenant→us, which of Paige's own rails does it fund — platform subscription,
  Marketplace, metered usage, or one-time fee? (3) If tenant→client, is Paige merchant of
  record or facilitator-only? The answer to (3) must be **facilitator-only**, always.
- **What Paige holds** (Paige's Stripe, Paige's bank, Paige is merchant of record):
  Tier 1 platform subscriptions (L1) · Tier 2 Marketplace transactions (paid installs,
  recurring skill subs, add-ons) · Tier 3 metered usage (Engine-2 tokens / storage / seats /
  compute / third-party pass-through) · Tier 4 one-time platform fees (setup, migration,
  credits, ad-hoc enterprise invoicing).
- **What Paige facilitates but does NOT hold** (tenant's processor, tenant's bank, tenant
  is merchant of record): tenant→client storefront orders · tenant→client service billing ·
  tenant→client subscriptions · anything where a tenant is selling to their own customer.
  Paige may collect a platform application fee via Stripe Connect on facilitated flows
  where the tenant is on Stripe Connect — that fee itself IS a Paige-held revenue path,
  but the primary charge is not.
- **The B-iv Connect posture is direct-charge on tenant-connected account, never
  destination-charge on Paige's platform account.** Direct-charge = tenant's client's card
  charges the tenant's OWN Stripe account, Paige only observes via webhook and optionally
  takes `application_fee_amount`. Destination-charge = Paige is merchant of record, funds
  hit Paige, Stripe auto-transfers most to tenant — **VIOLATES §38**. If shipped B-iv
  code assumes destination-charge, that is a §38 violation and must be fixed before
  storefront plane activation (#458). This is the B-iv-spike deliverable.
- **Money Spine sequence (Lane B, expanded post-§38):** B-i discovery ✅ → B-iv storefront
  webhook ✅ (posture verify pending) → B-ii Marketplace paid install (in flight) →
  **B-Platform** onboarding subscription (NEW) → **B-Meter** tokens/usage (NEW) → B-v
  Marketplace recurring → B-iii affiliate 3-tier → B-vi IP protection → **DEFERRED**
  B-Connect tenant BYO-processor lane (Stripe Connect wiring + eventual per-tenant /
  per-agency API-level connectivity to Square, PayPal, or whatever the tenant runs).
  Full architecture reference: `docs/doctrine/money-spine-architecture.md`.
- **Extends existing doctrine, doesn't compete:** §7 (Paige is tenant-authored — same
  principle for money: tenant brings their own commerce), §9 (tenant/operator seam
  discipline — the money-side seam is another expression), §17 ($1B growth map — §38
  clarifies which taxonomy rails Paige holds vs which are tenant-side; L4 consumer-direct
  is redundant with tenant storefront under §38 and per owner decision both waitlist
  tables DELETE), §35 (OS north star — the same rule extends to future household /
  portfolio / device contexts: Paige powers operators everywhere, doesn't hold their money
  anywhere).
- **Processor/vendor-agnostic is the rule for every tenant-side CHECK and surface, not just the money leg
  (owner-locked 2026-08-09, ref Systems Check L2 / master-doc §10 miss #28).** A Systems Check runner, a
  Playbook check, or any surface that inspects a tenant's setup must NEVER assume WHICH tool the tenant
  uses for anything Paige does not own — payments (Stripe · PayPal · Square · bank merchant · QuickBooks ·
  manual), comms (SMS/email are already tenant-BYO via subaccount routing), calendar, storage. It reads a
  tenant-**DECLARED** field (e.g. `tenants.payment_processor_declared` / `payment_methods_declared`), not a
  specific processor's API. Per-processor deep-verify (reading a connected Stripe account's live methods,
  a PayPal API, etc.) is a POST-MVP Playbook slice (§35 Marketplace Check Spec DSL), never the MVP default.
  **Assumption-baking is a §38 violation regardless of build-cost** — "Stripe-native read because it's the
  cheapest path" is the exact drift this bullet exists to kill. The §5 compliance officer checks every
  tenant-side check/runner for a baked-in processor/vendor assumption, in the read path AND in the drafted
  remediation copy.
- **The test, every time:** *"Is this money going INTO Paige's own bank as revenue for a
  Paige rail, or would activating it put a tenant's client's money through Paige's bank?"*
  If the latter: Connect direct-charge pattern on tenant's account, or BYO-processor
  integration on tenant's account. **Never** merchant-of-record on Paige.

## 51. Per-tier availability + gating check — the tier-parity railing.

**Directive (owner: Antonio, ruled 2026-08-01, hardened 2026-08-01 after fourth sub-account-seam bug):** Every change — feature, endpoint, RPC, migration, edge function, UI surface, doctrine amendment — gets a **per-tier availability + gating check** before ship and after ship. Not once, not "when it feels risky" — EVERY time. This exists because the same seam has bit us four times in one month (#86 → #130 → #172 → #588 — the fourth surfaced under an unrelated user-reported symptom, #201/#587) and each bug cost real time and money. The pattern is repeatable, so the fix is systemic, not per-bug. Owner's exact framing: *"every time we work on something, two or three accounts get affected positively, and then there seems to be one thing lingering… we're not organized, and I think we need to create a better system to organize ourselves."*

**The canonical tier matrix (source of truth for every check):**
- **God / Super Admin** — platform operator (us); owns everything, sees everything.
- **Agency** — parent tenant that owns sub-accounts; scoped to its own book plus its sub-accounts.
- **Standalone Tenant** — a coach with no agency parent; scoped to its own book.
- **Sub-account** — child tenant under an Agency; scoped to its own book, isolated from parent aggregate.
- **Client** — end-consumer under a Tenant; scoped to their own portal only.
- **Anonymous** — unauthenticated public; scoped to public surfaces only.

Every tier has a documented `tenant_id` resolution path, auth-token flow, RLS posture, and permitted RPCs (see `docs/doctrine/tier-matrix.md`). Every §37 producer inventory, every §32 verification walk, and every crew brief refers to THIS matrix — not a mental model that varies per session.

**The six railing components (each ships-blocking on any surface that touches tenant-scoped data):**

1. **Tier matrix as source of truth.** The canonical enumeration above. Extended only by owner ruling.
2. **Per-tier producer inventory (§37 extension).** Today §37 walks "who calls this endpoint." Tier-aware §37 walks "who calls this endpoint FROM EACH TIER" — because the same request from a sub-account has a different tenant resolution than from the Agency parent. The producer inventory NAMES THE TIER for every producer, not just the endpoint. A producer whose tier isn't named is a producer that wasn't audited.
3. **Per-tier automated smoke tests.** For every tenant-scoped endpoint, an automated test fires it from EACH tier and asserts the correct outcome. When any tier's row fails, ship is blocked. Piggybacks on the Playwright §32 infrastructure — each fixture carries a tier axis.
4. **Per-tier compliance-officer checklist.** Every crew's compliance pass answers a fixed matrix: works for God? Agency? Standalone Tenant? Sub-account? Client? Anonymous? — with an explicit answer per row (works / fails / N/A-and-here's-why). Blank rows or "fails" rows block ship.
5. **Per-tier post-deploy walk (§32 extension).** Post-deploy verification exercises the change on at least the **most-affected tier**, which is USUALLY NOT the tier the crew built on. Sub-account bugs like #201 exist because we build on the parent tenant and never smoke-test the child sub-account before merge. §32 post-deploy scan explicitly names the tier that was smoke-tested; if only one was tested and other tiers were affected, the scan is incomplete.
6. **Task ledger tier-tag.** Every task carries `tiers_affected: [god, agency, standalone, sub_account, client, anonymous]` so tier coverage is auditable over time — and drift ("this wave always builds for standalone, never verifies on sub-account") is visible.

**The test, every time (owner-framing):** *"If this change works for the tier I built on, does it also work for every other tier that could hit this code path? Have I named the tier for each producer, tested each tier's outcome, and post-deploy-walked at least one tier I didn't build on?"* If any answer is "I didn't check," it isn't done.

**Cross-references:** §9 tenant isolation (the WHY), §37 producer inventory (the WHO), §32 dual-layer verification (the WHEN — pre-deploy simulation + post-deploy persistence). Two related directives are owner-ruled but **not yet pasted into this file** — forward-references pending the doctrine paste (#591): **platform-independence** (no tier-specific hardcoded phantoms) and **platform impact assessment** (of which the tier check is question #1 on any change). Their §-numbers are intentionally omitted until #591 lands and they exist as numbered sections here.

**Anchoring case studies — the bugs that forced this section:**
- **#86 (2026-07-28)** — sub-account showed parent-agency contact aggregate. §9 tenant-scope leak on the sub-account tier.
- **#130 (open)** — `paige_chat_thread_create` rejects Super Admin (God tier) caller. RPC's tier-caller check dropped a legitimate tier.
- **#172/#574 (2026-07-30)** — Paige chat-driven `create_contact` failed with backend error on prod. Producer-inventory miss on the action-path family.
- **#588 (2026-08-01)** — `get_paige_persona_context()` returned the wrong tenant for multi-tenant users. Two defects compounded: (1) the primary branch keyed on `profiles.id = auth.uid()` when the correct key is `profiles.user_id`, so 0 of 6 profiles satisfied it and `active_tenant_id` was silently never honored for anyone; (2) the fallback branch selected from `tenant_members` with `LIMIT 1` and no `ORDER BY`, returning nondeterministic tenants for any user with more than one membership. Live traces showed the resolver returning four different tenants for the same user — including one the user was not even a member of — while the true active tenant tracked correctly elsewhere. Platform-wide §9 defect that had shipped invisibly for weeks; discovered only because a user-reported P0 (#201/#587, initially believed to be a sub-account seam bug) forced live `paige_llm_trace` diagnosis, which surfaced the real defect underneath the reported symptom.

Three confirmed tier-seam bugs plus a fourth that had been hiding under an unrelated user-reported symptom. Each shipped because a crew built on one tier, verified on one tier, and never checked the others. §51 exists so the fifth doesn't happen — and the first live pass of the six-component railing (retro-check on the Blueprints Slice 1 substrate) already proved the doctrine catches what it's designed to catch: every tier row filled correctly, sub-account writes ITS OWN journey stages never the parent's, Client + Anonymous denied at every layer.

**Note:** #201/#587 is tracked as its own §200-class platform-wide bug (PDF attachment payload-size path — a different failure class than the tier-seam bugs above). Its fix is on a parallel track (#587).

**ABSOLUTE INVARIANT (owner: Antonio, 2026-08-07, ref #393) — a SUB-ACCOUNT is NEVER an AGENCY, and it is enforced STRUCTURALLY, not by convention.** Owner's framing: *"lock in an absolute rule so any new sub-account that comes in under any new agency, that rule remains the same — so we can't break this anymore."* A "sub-account" is any tenant with a non-null `parent_tenant_id` and a **non-manager** `account_type` (`'sub_account'` per current provisioning, or the legacy `'standalone'` some early sub-accounts still carry — both valid, both never a manager tier); an "agency" is a **top-level** tenant (`parent_tenant_id IS NULL`, `account_type IN ('agency','enterprise')`). The two are mutually exclusive by rule — the invariant keys on "child ⇒ NOT `agency`/`enterprise`", never on one exact sub-account label. (Normalizing the legacy `'standalone'` sub-accounts to `'sub_account'` is the separate taxonomy-lock task #43.) The break that forced it (Antonio Daniel LLC, tenant `e7f1b157`, a sub-account under Project Mogul Enterprise): it was mis-modeled `account_type='agency'` **while** parented, AND carried a stray `agency_team_members` row naming its OWN sub-account as the agency — and EITHER defect alone makes `agency_current_id()` resolve its owner as an "agency manager", so `resolveLandingRoute` sent him to the `/agency` operator dashboard instead of his own Command Center. Because a "standing rule stated in chat evaporates on the next reset," the invariant is locked at the DB layer (migration `20260807230000`), three layers deep — do NOT weaken any of them without an owner ruling:
- **(1) `tenants` CHECK `tenants_subaccount_not_agency`** — `parent_tenant_id IS NULL OR account_type NOT IN ('agency','enterprise')`. A child can never be a manager-tier account. Any provisioning/MCP/manual write that tries fails loudly.
- **(2) `agency_team_members` trigger `trg_agency_team_target_is_agency`** — a roster row's `agency_tenant_id` may only reference a real top-level agency, never a sub-account/standalone. (The second, independent mis-route path.)
- **(3) `agency_current_id(uuid)`** — BOTH resolver branches require the resolved tenant to be a top-level agency/enterprise, so a sub-account owner can never resolve as a manager even if a stray row slips past (1)/(2).
- **Provisioning corollary:** creating a sub-account sets a non-manager `account_type` (`'sub_account'`) + `parent_tenant_id`; it NEVER writes `account_type='agency'`/`'enterprise'` for a child and NEVER inserts an `agency_team_members` row for the child's own owner. **HONEST CAVEAT (§13):** this invariant assumes the platform has NO multi-level agency / agency-reselling-under-agency model (children are always standalone sub-accounts, per the §51 tier matrix). If the owner ever introduces nested agencies, layer (1)'s CHECK is the one to revisit first — surface it, don't silently relax it.

## 39. The peer-gate — every §32-verified change also gets an INDEPENDENT adversarial read of the REAL diff.

**Directive (owner: Antonio, 2026-08-04, ref #214):** A §32 `BEGIN..ROLLBACK` proof tests
**what its assertions test** — and nothing else. A proof can be **fully GREEN and still miss an
entire class of defect**, because it only ever exercises the checks its author thought to write.
The proof passing is necessary, never sufficient. So **every §32-verified change ALSO requires an
INDEPENDENT adversarial read of the REAL pushed diff** — not the build report, not the author's own
proof, not a re-run of the same assertions — a distinct peer whose only job is to hunt the defect
the proof's assertions structurally could not cover. This is the **peer-gate**, and it is a
MANDATORY real gate, not a reminder: no §32-verified change is called done until a second, distinct
set of eyes has adversarially read the actual pushed diff and reported.

- **It SHARPENS §5/§11's adversarial verifier onto §32 changes — it invents no new role and replaces
  nothing.** §32 is the author proving their own change runs and persists. §5's compliance/standards
  officer judges *quality and standards* — "is this done correctly, to the best-in-class bar,
  SOP-clean?" The peer-gate is the **§5/§11 adversarial-verifier seat given a specific §32 mandate**:
  a pure defect-hunter pointed at **what the §32 proof didn't think to test**. A green compliance
  pass does not waive it; a green §32 proof does not waive it — they answer different questions.
- **The peer reads the DIFF, adversarially, from scratch — and is not the author of the proof.** Not
  the PR description, not the author's proof output, not "the build is green." The real pushed change,
  read by someone who assumes it is broken and goes looking for how. The peer must be an independent
  pass — never the same agent/run that wrote the §32 assertions grading its own homework. Re-running
  the author's own assertions is not the peer-gate; that only re-confirms what was already confirmed.
  The peer's mandate is the blind spot: *"what would make this GREEN proof a lie?"*
- **This is the §14 crew's adversarial-verifier seat, not paperwork.** Convened with the crew
  (§1/§14), distinct from the design engineer and the compliance officer. On bootstrap/headless runs
  where the crew is invoked manually, say so (§13).
- **The trigger is objective and self-catching.** *If a §32 proof went GREEN and you are about to call
  the change done on the strength of that proof alone — with no independent adversarial read of the
  actual pushed diff — you are ALREADY in violation. Stop and run the peer before the change ships.*
- **Anchoring case studies — all real, this session (§13):**
  1. **§45 operator-identity seam foundation.** The §32 `BEGIN..ROLLBACK` proof was GREEN — but the
     adversarial read of the diff caught a `SECURITY DEFINER` resolver that let **any caller read
     another tenant's sender address and tradeline partners** (a §9 IDOR), because `SECURITY DEFINER`
     bypasses the very `REVOKE` the proof assumed was protecting it. Fixed by gating those fields
     behind a can-see-legal predicate; the re-proof then drove the IDOR path **explicitly** — an
     assertion that had never existed until the peer found the hole.
  2. **#227 sub-account owner correction.** The §32 assertions returned a **false-green** on a
     multi-level (grandchild) tenant leak; the adversarial-against-diff pass caught the missed level
     the proof's own tenancy assertions never reached.
  3. **F10 support-SLA.** The adversarial verifier caught that the edge function built its client with
     the **anon key and NO forwarded JWT**, so every RLS-gated read returned **0 rows** and every
     caller silently resolved to the "free" tier — a **runtime** behavior a proof of the resolver
     logic alone would never surface.
- **HONESTY — the peer-gate is NOT infallible; it is one LAYER (§13).** In #350 the adversarial
  verifier returned **"SHIP"** and still **MISSED a real `TS2304` (`guaranteeSubject`)** that the CI
  `tsc`-ratchet then caught. That is the doctrine, stated plainly: **peer-gate + §32 proof + CI are
  LAYERED defenses, and none alone is sufficient.** A green peer-gate never waives CI; a green CI
  never waives the peer-gate; a green §32 proof never waives either. Anyone claiming one pass covers
  for a skipped other is committing the exact false-green this section exists to kill.
- **The test, every time:** *"Did a second, independent set of eyes — not the author of the proof —
  read the ACTUAL pushed diff adversarially, hunting the defect my §32 proof's own assertions could
  never test, and did I still let CI have the last word — or am I calling it done on the strength of
  my own green proof alone?"* If only the author's proof ran, the change is not verified.

## §BRAIN — Second Brain read/update discipline

> **PROPOSED — pending owner ruling on exact wording (Cowork #26).** This section is drafted and
> merged as a DRAFT PR for the owner to rule on; treat its intent as binding once ruled, but the
> exact wording below is not yet final. Everything else in `docs/brain/` ships as reference regardless.

**Directive (owner-owed, drafted 2026-08-09):** The platform now carries a durable **Second Brain**
at `docs/brain/` — a verified index of doctrine + config + decisions + lessons — so a session stops
re-diagnosing systems that are already documented. A brain only works if it is **read before work**
and **updated with work**; a stale or unread brain is worse than none (§13/§46 — it lies with
authority). This is the same principle as §24 (automate the repeat) applied to *knowledge*: never
re-derive what the brain already records.

- **§BRAIN.1 — Mandatory session-start ritual.** Before substantive work on any task, **read
  `docs/brain/README.md`** (the master index + verified platform snapshot). If the task touches
  infra/integrations (Supabase, Stripe, Twilio, ElevenLabs, CI, MCP, any third-party seam), also read
  `docs/brain/config-registry.md`. If it touches a specific domain, open that domain's doc via the
  README index. Skipping this and then re-diagnosing something the brain already answers is a §13/§46
  violation — the guessing this brain exists to end.
- **§BRAIN.2 — Feature-existence check.** Answer *"do we have X? / is Y built? / where does Z live? /
  what did we decide about W?"* from the brain (README index → cited source → `decision-log.md`),
  **not** from session memory. Asserting a feature/config exists (or doesn't) without checking the
  brain or the cited source is a §13 honesty violation — state what you verified and how, or say it's
  unverified.
- **§BRAIN.3 — Update discipline (same commit).** Every PR that ships a feature, changes config/infra,
  or lands an owner ruling **updates the relevant brain file in the SAME commit**: new/changed doc →
  add or edit its row in `README.md`; config/integration change → `config-registry.md` (NAMES/IDs
  only, never a secret value; verify or mark `⚠ unverified`); merged PR or dated ruling →
  `decision-log.md`; a new class of costly mistake → `lessons-learned.md`; a new term/§-anchor →
  `glossary.md`. Shipping the change but not the brain update is a §13/§46 drift — the brain silently
  goes stale and the next session is misled.
- **The test, every time:** *"Did I read the brain before I started, answer 'do we have this?' from it
  instead of from memory, and update it in the same commit as my change — or did I let it go stale and
  set the next session up to re-diagnose what I already knew?"* If the brain wasn't read or wasn't
  updated, the work isn't done.

## Voice Configuration (§46 — superseded 2026-09-07 by the modality-neutral Paige Spine)

The former three-system, literal-voice-ID, tenant override, request override, and provider-hosted-agent
design is **REVERSED and must not be restored**. Historical IDs and instructions were removed from this
governing reference because they would recreate a hidden modality-specific execution path.

- Paige has one tenant-aware workspace and one PAIGE Spine across text, Live Conversation, future
  phone/SIP, Secure Browser, contextual handoffs, and cards. A modality may present or transport an
  interaction; it never owns reasoning, authority, memory, tools, canonical records, or mutations.
- Every spoken/text/UI intent follows: server-resolved actor + tenant + workspace + context + role →
  shared Spine registry → existing authority decision → canonical governed tool/RPC when available →
  persisted-outcome verification → receipt + Rail evidence → truthful active-modality result.
- All Paige speech output resolves the one approved server-side `paige_default_voice` profile. Browser
  requests, tenant playbooks, prompts, and shared model-router tasks cannot supply a provider voice.
  The provider reference is server-confidential. New sessions bind the current immutable revision;
  active sessions retain it until end.
- Profile and readiness data live in dedicated service-only relations. The platform-owner activation
  endpoint consumes a fresh canonical verification record and returns only Paige-facing identity and
  revision. No code deploy is needed to activate a verified revision.
- ElevenLabs is a presentation-only candidate for STT/TTS transport. No hosted provider agent, client
  tool, webhook, or provider-side action may mutate Paige or business state. Studio narration remains
  `UNAVAILABLE` until it uses the same profile/readiness resolver.
- ElevenLabs transport stays fail-closed until independent proof covers key scope, exact voice
  authorization, retention approval, explicit Zero Retention Mode applicability, realtime eligibility,
  quota, and a Paige hard cost limit. A configured secret alone is never proof and must never be read,
  logged, or tested as part of this gate.
- Raw audio, raw transcripts, card text, page content, and casual conversation are not durable facts.
  Only explicitly selected, owner-confirmed, source-backed material may enter its existing canonical
  Brain/Mind/Memory owner.
- After any approved provider/profile change, verify the next new session in the authenticated app.
  Provider configuration inspection alone does not prove what the owner hears.

Canonical detail: `docs/doctrine/paige-modality-neutrality.md` and the Integration Capability Registry.

## 50. Trademark hygiene — no active pop-culture marks in code, docs, or any public artifact (owner-locked 2026-08-09).

**Directive (owner: Antonio, 2026-08-09):** do NOT use active, well-known third-party pop-culture marks — even as internal codenames or "analogs for clarity" — anywhere that a Marvel/Disney/Apple/Amazon/Microsoft/IBM/Salesforce IP-monitoring bot could find. This includes but is not limited to: **JARVIS** (Marvel/Disney) · Skynet · HAL 9000 · TARS · Cortana (Microsoft) · Siri (Apple) · Alexa (Amazon) · Bixby (Samsung) · Watson (IBM) · Einstein (Salesforce) · Copilot (Microsoft/GitHub) · Ultron · FRIDAY (Marvel) · Data (Star Trek/CBS) · Samantha (Her) · Ava (Ex Machina) · Aria (character marks generally).

- **The public-repo test:** if the mark would be findable in this repo, in a public GitHub commit message, in a public PR title, in a code comment, in a component name, in a table name, in a migration name, in an error message, in doc filenames, in doc body content, or in any deliverable a tenant/investor could see — it does NOT go there. Even as an "internal codename." Even as an "analog for clarity."
- **Historical analog references must abstract.** When earlier docs need to gesture at "the JARVIS-tier experience," rewrite to "the operator-AI-COO archetype" or "the fictional operator-AI archetype" — describe the pattern, do not name the mark.
- **The strategy-doc rule that failed:** the Owner Trilogy strategy doc itself said *"referenced as an analog for internal clarity — never as the framing of any code, table, feature, or tenant-visible surface."* That rule held for code (zero hits) but leaked into 4 doc files (BRD, agent-ui spec, analytics UI spec, strategy doc itself). This section closes that hole: the rule now applies to docs, not just code.
- **Enforcement:** every §5 compliance officer + §39 adversarial verifier includes a `grep -ri "jarvis\|skynet\|hal 9000\|cortana\|alexa\|siri\|watson\|einstein\|copilot\|ultron\|friday\|tars\|samantha\|ava"` (case-insensitive) on the PR diff. Any hit fails the pass until removed or reframed. The list expands as new marks come up; add to the doctrine, not to the exception list.
- **Meta-exempt surfaces (exactly two permitted uses of a listed mark, and ONLY these):** (1) **this §50 doctrine section itself** — it must name the marks to prohibit them (same as the CHEESY-TELLS catalog naming the exact tells to avoid); (2) **§13 corrections-log entries recording a prior purge** (e.g. master-doc §10) — they must name what was reversed to preserve the audit trail (§11 "never remove — mark reversed and add the new entry" hard-binds). These are self-referential purge/prohibition surfaces, not product-name association — an IP bot finding *"we prohibit JARVIS"* or *"we purged Jarvis Initiative on this date"* is the OPPOSITE of the exposure risk. **Every other appearance in the repo fails the pass.** The §5/§39 grep pass explicitly `grep -v`s these two paths (`CLAUDE.md` §50 + the corrections log) so it never false-positives on the recursion.
- **The test, every time:** *"If Marvel/Disney/Microsoft/Apple/Amazon IP counsel opened this repo tomorrow, would they find a mark that lets them argue product-name association?"* If yes, purge it before it merges.

Real cost of this discipline: ~10 seconds per PR (the grep). Real cost of skipping it: legal fees + a rename after launch.

## 52. Paige opens every OPERATOR session already briefed — runtime context-loading (the §36 anchoring gate).

**Directive (owner: Antonio, 2026-08-09):** On 2026-08-09 the God/Super-Admin Paige chat opened a session and asked the FOUNDER who he was — and asked him for the North Star, the BRD, and the System Architecture, every one of which already exists as owner-locked, shipped material. For an AI COO that is a catastrophic §36 miss — a real chief of staff walks in already knowing who they report to, what the company is, and what's on the table. **Paige must open EVERY operator session ALREADY briefed** — never asking the operator to establish identity, company, or context she should already hold. This is the runtime context-loading substrate; it is a real gate, not a nicety.

- **The briefing is loaded at runtime, from data + compiled constants — never asked for.** The operator's identity, preferences, active priorities, permissions, and known context live as **config-as-data** rows in `paige_owner_memory` (§10 — the owner's identity is NEVER hardcoded in edge code), read server-side and rendered into a system block that leads the operator's chat (after Paige's persona + voice, before the operating core). Live platform state (tenant counts, real ARR) is loaded by **REAL queries with honest fallbacks** (§13/§32 — a query that returns nothing emits "not available", never a fabricated number). The doctrine §-index and master/Owner-Trilogy excerpt are **compiled constants versioned with the code** — an edge function cannot read the repo at runtime, so "read CLAUDE.md/the master doc at compose time" is a lie; the pointer index ships in the composer (`_shared/owner-context.ts`) and is kept in sync deliberately. The operator's NAME is read from **runtime auth metadata** (never the repo — §45), so Paige greets him by name without any PII in a committed artifact.
- **Operator-only, server-detected, §9/§51-clean.** The briefing ships ONLY to a tenant-less platform operator, detected SERVER-SIDE and dual-gated: `is_platform_operator()` (super_admin OR platform_admin, §53) derived from the verified JWT's `auth.uid()` (NEVER a request body, §588), plus a tenant-less persona. It is a strict NO-OP for every tenant persona and stays coaching-generic (§2 — zero finance vertical), exactly like every other platform default.
- **Honest degrade.** If the operator has no seeded memory rows, the composer returns null and the caller NO-OPs — Phase 1 never fabricates an operator identity. Missing platform metrics degrade to an explicit "not available" line, never an estimate presented as fact.
- **ENFORCEMENT GATE:** any operator-facing Paige surface that asks the operator to establish who he is, what the company does, or context Paige should already hold is a §52 (and §36) violation — the briefing must be wired into that surface's prompt assembly before it ships. Extending the briefing (new memory types, new metrics, non-operator personas in a later phase) EXTENDS the one composer, never forks a second (§18). Phase 2 (agency / tenant / sub-account / client personas, each scoped per §9/§51, plus the cross-persona identity link so Antonio's agency-owner account is known as the same founder as the super_admin account) is a separate, sequenced slice — never folded silently into Phase 1.
- **The test, every time:** *"Does Paige open this operator session already knowing who he is, how he works, what's in play, and the live state of the platform — or does she make the founder tell her?"* If she has to ask, §52 isn't wired.

## 53. Operator role tiers — `super_admin` is God-tier and invite-only via an existing super_admin; `platform_admin` is the delegated operator tier (owner-locked 2026-08-09).

**Directive (owner: Antonio, 2026-08-09):** the platform has a two-tier operator model, structurally locked. The lockdown is scoped to the **operator tiers only** — every tenant-side and staff role grant stays open per today's design.

- **`super_admin` = God-tier.** Full platform control; can grant any role. **`admin@paigeagent.ai` is the sole super_admin** until Antonio explicitly invites more. A super_admin is grantable ONLY by an existing super_admin (or a trusted service/migration context) — never self-provisioned, never minted by signup, invite, or any tenant-tier actor. It is **bootstrap-only** by construction.
- **`platform_admin` = the delegated operator tier.** A real lower-tier operator (Fleet Console, support, provisioning approval, all-tenant read) that carries platform-staff status WITHOUT God-tier. Antonio can delegate platform-admin duties without granting super_admin — but **only a super_admin can grant a platform_admin** (same lockdown as super_admin). A platform_admin CANNOT grant super_admin and CANNOT bypass the DB integrity gates (the #31 revenue-integrity trigger, Systems Check RLS, `tenant_revenue_classification` writes) — those stay super_admin-only because they are gated on `is_platform_owner()`, which is **frozen as super_admin-only**.
- **Two helpers, one frozen.** `is_platform_owner()` = super_admin only — **do NOT widen it in place** (it is load-bearing under every integrity gate; widening it would demand a §37 sweep across dozens of callers and risk a launch-critical behavior change). `is_platform_operator()` = `is_super_admin() OR is_platform_admin()` is the NEW widened helper; operator-scoped surfaces migrate from `is_platform_owner()` → `is_platform_operator()` **deliberately, one at a time**, as each opens to platform_admin (§18 — add, don't widen in place).
- **Enforced structurally, not by convention (§51-invariant pattern).** A `user_roles` BEFORE INSERT/UPDATE trigger blocks any `super_admin`/`platform_admin` grant unless the writer is an existing super_admin (via verified JWT) or a trusted service/migration context — so the lock holds on every write path (RPCs, the tenant→app_role sync trigger, a direct insert), not just the one an audit happened to check. This closed a real §9 escalation: `grant_tenant_member_role()` was tenant-admin-callable and blocked only super_admin, so a tenant admin could have minted `platform_admin` and crossed the tenant→platform seam. Every OTHER role grant (admin, coach, client, broker_team_member, sales_rep, …) is untouched.
- **Every operator surface is tier-scoped, not identity-scoped.** A platform-tier list (team, fleet, operators) filters by `role IN ('super_admin','platform_admin')` — NEVER by email domain (future operators won't carry a `@paigeagent.ai` address). Showing tenant-tier admins/coaches/clients on a platform surface is a §9/§53 leak (the same class as the grant gap above).
- **The test, every time:** *"Is this operator capability/surface gated on the right tier — super_admin for God-tier/integrity actions, `is_platform_operator()` for delegated operator work — and scoped by ROLE, never by identity or email?"* If a tenant-tier actor can reach it, or a platform surface shows tenant-tier people, it isn't §53-clean.

## 56. Check the tier matrix FIRST — the PRE-BUILD platform-impact gate (which account type, and does the feature belong there?).

**Directive (owner: Antonio, 2026-08-10) — this LANDS §51's forward-referenced "platform impact
assessment" as a real numbered section (question #1 on any change).** §51 is the *verification*
railing — it proves a shipped change works across all six tiers *after* it's built. §56 is the
*design* gate that runs **before the first line of code**: for ANY development — a feature, tile,
route, RPC, edge function, migration, surface, or copy block — you STOP and check
`docs/doctrine/tier-matrix.md` to answer, out loud, **two** questions:

1. **Which version of the platform / which ACCOUNT TYPE am I working on?** God/Super-Admin ·
   Agency · Standalone (solo) Tenant · Sub-account · Client · Anonymous. Name the tier(s) this
   change is FOR — never assume "a tenant is a tenant." A solo tenant, a sub-account, and an
   agency-as-a-tenant resolve their `tenant_id`, land on different home surfaces, and hit
   different gates. "Correct for the account I built on" is exactly the trap.
2. **Is this feature RELEVANT to that account type — should it appear there, or NOT?** Some
   capabilities belong on **every** tier (the Systems Check: God, solo, sub-account, agency —
   all must have it, "repeatable throughout the entire process," owner's words). Others belong
   on exactly one (operator fleet controls → God only; a sub-account roster → never the parent
   aggregate). Decide **deliberately**, per tier, and make the availability match the decision —
   do not let a feature silently appear on one account type and vanish on another by accident of
   which branch/emptyState/route it was bolted into.

- **This is a real gate, not a reminder (the §18/§1 pattern).** Because "this has happened one
  too many times," §56 fires mechanically: *if you are about to build/place anything and have NOT
  named the target account type(s) and confirmed the feature belongs on each, you are already in
  violation — stop and check the matrix first.* The crew's compliance pass (§5/§51) confirms the
  per-tier availability decision was made on purpose, not by default.
- **Availability is deliberate, uniform where the owner says "every tier."** When a capability is
  meant for every account type, it must render for every account type **regardless of incidental
  state** — empty book, no data yet, default landing surface. The anchoring bug (below) is the
  exact failure: a capability meant for all tenants was gated behind an `emptyBook`/branch/route
  accident and silently disappeared on the very accounts (fresh sub-accounts) that needed it most.
- **Propagation is part of the gate (§0/§BRAIN).** A tier/availability decision or correction is
  logged to the master doc (`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §4/§10) and the second brain
  (`docs/brain/`) in the SAME PR — the matrix, the master doc, and the brain never drift from what
  actually shipped.
- **Anchoring case (2026-08-10, task #99):** the tenant **Systems Check** tile was gated INSIDE the
  non-empty branch of `PracticeOverview.tsx`'s `{emptyBook ? … : …}` conditional, so any tenant
  with 0 clients/attention/approvals — every freshly-provisioned solo OR sub-account — rendered
  only the "blank canvas" empty state and NEVER saw the setup check (while Mogul Maker Academy,
  which has clients, did). The owner reported it as "sub-accounts don't show the Systems Check."
  Root cause was NOT a tier-classification bug but an **availability-by-accident**: the check meant
  for every tenant was hidden by an empty-book gate, and the agency's own default landing
  (`/agency` → `AgencyBoard`) never carried the tile at all. Fix: render the tenant Systems Check
  ABOVE the empty/non-empty split on `PracticeOverview` (solo + sub-account) AND add it to
  `AgencyBoard` (agency-as-a-tenant) — matching the operator tile already on `OperatorCommandCenter`
  (God). Now uniform across God · agency · solo · sub-account, exactly the owner's "every tier"
  requirement. Had §56 fired before the tile was first placed, the "which tiers, does it belong on
  each, does it survive an empty book?" questions would have caught it pre-build.
- **The test, every time:** *"Before I build or place this, did I open the tier matrix, name which
  account type(s) it's for, and decide — on purpose — whether it belongs on each one and renders
  there regardless of empty/default state? Or did I build for the account in front of me and let
  the other tiers fall where they may?"* If the matrix wasn't checked and the per-tier availability
  wasn't a deliberate decision, it isn't §56-clean.

## 57. Super Admin is the source of truth — every surface DERIVES from the God-level account, never independently.

> **OWNER-LOCKED 2026-08-11.** Ratified explicitly by the owner (drafted PROPOSED overnight in the
> #449 close-out; owner ruling morning 2026-08-11). Binding on every future PR.

**Directive (owner: Antonio, owner-locked 2026-08-10).** Owner's verbatim framing: *"If the super
admin doesn't say it's so, then it's just not true... they're acting like they're all independent of
one another when everything should derive from the god-level account."* Every tenant-facing and
agency-facing surface **DERIVES from what the God-level (Super Admin) account says is real.** No
surface may show data the God-level record contradicts. Cross-surface parity is enforced **top-down**
from the operator's source-of-truth record — never derived independently, per-surface, from whatever
local query each screen happened to run.

- **One record of truth, many read-only projections.** The operator's God-level classification/state
  (revenue class, tenant topology, entitlements, account type) is the authority; tenant/agency/
  sub-account surfaces render a projection of it, they do not each compute their own version. Two
  surfaces showing different "truths" for the same tenant is a §57 defect (and usually a §51 tier
  bug underneath), not a display quirk.
- **Anchor cases (the divergences that forced this):** (a) **Fleet Console stale MRR** — `$397` / `$149`
  MRR surfacing on tenants that have **no paid subscription** (the God-level revenue record says $0/
  promotional; the Fleet surface showed a phantom paid figure). (b) **Antonio Daniel LLC misclassified**
  — surfaced as a `SUB_ACCOUNT` when the God-level topology says otherwise (§51 invariant). (c) **Super
  Admin Analytics empty while a sub-account's Analytics is live** — the operator (source of truth) shows
  less than a tenant projection, which is backwards (§35 dogfooding).
- **Enforcement (§58 cross-surface parity audit).** A cross-surface parity audit (owner task #58) walks
  each tenant-facing figure back to its God-level source and flags any surface that computes/shows a
  value the operator record contradicts. Ships with the revenue-integrity work (§17/#31) where the
  figure is revenue.
- **The test, every time:** *"Does this surface DERIVE its truth from the God-level record, or did it
  compute its own answer that could contradict what the Super Admin says is real?"* If it's an
  independent computation that can diverge from the operator record, it isn't §57-clean.

**Cross-references:** §9 (platform vs tenant seam), §51/§56 (tier matrix — a §57 divergence is usually
a tier bug), §17/#31 (revenue integrity chain — the money-side enforcement), §35 (operator dogfooding).

## 58. Anti-regression — a shipped, owner-approved capability is NEVER silently removed.

> **OWNER-LOCKED 2026-08-11.** Ratified explicitly by the owner (drafted PROPOSED overnight in the
> #449 close-out; owner ruling morning 2026-08-11). Binding on every future PR. **The §39 verifier
> checklist inherits its new item — *"Did this PR silently remove any previously-shipped capability?"*
> — starting immediately on the next PR after this ratification.**

**Directive (owner: Antonio, owner-flagged 2026-08-10) — the twin of §28.** §28 says an approved
design is FROZEN (don't touch it). §58 is the other half: a **capability** that has once shipped and
been owner-approved is **NEVER silently removed, hidden, or gated off in a later PR.** A refactor,
a facelift, a "cleanup," or an unrelated change does not get to quietly drop a feature the owner
already signed off on — that regression must be caught and surfaced, not discovered by the owner live.

- **If a change removes or hides a previously-shipped capability, call it out EXPLICITLY.** Name the
  exact capability being removed/hidden in the PR description, and require an **owner sign-off before
  merge** — even (especially) when the PR is nominally about something else. Silent removal is the
  failure this section exists to kill.
- **§39 verifier checklist item (binds every PR, not just the ones about that capability).** The
  adversarial verifier / peer-gate adds a standing question to its read of the real diff: *"Did this
  PR silently remove, hide, or gate off any previously-shipped, owner-approved capability?"* A "yes"
  with no explicit call-out + owner sign-off blocks the merge.
- **The test, every time:** *"Did anything the owner already approved get removed, hidden, or gated
  off by this change — and if so, did I flag it explicitly and get sign-off, or did I let it vanish
  quietly for the owner to find live?"* If a shipped capability regressed without an explicit flag,
  it isn't §58-clean.

**Cross-references:** §28 (approved design is frozen — the design twin), §39 (peer-gate / adversarial
verifier owns the checklist item), §13 (honest reporting), §32.c (owner live-drive is where silent
regressions surface today — this moves the catch upstream).

## 59. SECURITY DEFINER functions enforce caller scope IN-BODY — the grant is never the guard.

> **OWNER-LOCKED 2026-08-11.** Ratified explicitly by the owner (drafted PROPOSED overnight in the
> #449 close-out; owner ruling morning 2026-08-11). Binding on every future PR. **Enforcement is
> already LIVE:** the `lint:definer-fns` CI guard + the `pg_proc` drift advisor (both shipped in #117 /
> PR #448) mechanically catch a new anon-granted DEFINER data-returner.

**Directive (drafted from #117, companion to #116's view class):** A `SECURITY DEFINER`
function runs as its OWNER (postgres) and therefore BYPASSES row-level security on every
table it touches — exactly like a `security_invoker=off` view (#116), but a different
Postgres object type. That is SAFE **only if the function body itself enforces the caller's
scope.** The leak class (the #588 / #55 / §45-IDOR pattern) is a DEFINER data-returner or
writer, EXECUTE-granted to `anon` or broad `authenticated`, that returns/mutates tenant/PII/
secret data keyed on a PARAMETER without verifying the caller owns that row / is in that
tenant / holds the required role. The EXECUTE grant is NEVER the access control — the in-body
check is.

- **The A/B/C classification (run on every DEFINER function that returns or mutates data):**
  - **A = SAFE, keep DEFINER.** The body enforces caller scope: (i) requires `auth.uid()` and
    touches ONLY the caller's own rows (`= auth.uid()`); (ii) tenant-scoped via
    `current_user_tenant_id()` with no client-supplied tenant param that overrides it (or the
    param is validated `== caller tenant` / `is_platform_owner`); (iii) a role/ownership gate
    that RAISES before returning data (`is_platform_admin`/`is_tenant_admin`/`_assert_*`/
    `is_platform_owner`); (iv) a token/slug public read of only safe fields.
  - **B = convert to INVOKER.** DEFINER is unnecessary — the function only touches tables the
    caller already has RLS access to, so it is bypassing RLS for no reason. Making it
    `security_invoker` lets RLS enforce scope with no behavior change for legit callers.
  - **C = fix in place.** DEFINER IS needed (reads `auth.users`, an operator/cross-cutting
    table, or a restricted-RLS table) BUT the caller guard is missing/broken. Add the exact
    missing predicate (self / tenant / role) and REVOKE `anon` where over-broad.

- **The global-role trap (§53).** `user_roles` is a GLOBAL table with no `tenant_id`, so
  `has_role(caller,'admin')` / `has_any_role(...)` is TENANT-AGNOSTIC. A function that branches
  authority on the tenant-level `'admin'`/`'coach'`/`'sales_rep'` app_role — or honors a
  caller-supplied `p_tenant_id` next to such a branch — lets a tenant-A admin act on tenant B.
  Cross-tenant authority is `is_platform_owner()`/`is_platform_operator()` (super_admin/
  platform_admin), NEVER the tenant-level app_role. Every DEFINER function that means "operator
  can act across tenants" must gate on the operator helper, not the global role.

- **Never trust a caller-SUPPLIED identity param for the auth check.** A function that role-
  checks a `_calling_user_id`/`_actor` parameter instead of `auth.uid()` is a total auth bypass
  (the caller passes any known privileged UUID). The auth subject is ALWAYS `auth.uid()`; a
  service-role/trusted path is the ONLY place a passed actor is honored, and only because
  `auth.uid()` is NULL there. (This is the #117 HIGH — `delete_credit_report_upload`.)

- **The CI drift-guard (§24 automation).** `scripts/ci/definer-fn-lint.mjs` (wired as
  `lint:definer-fns` in `package.json` + `.github/workflows/ci.yml`, next to `lint:views`)
  fails any migration that grants a new `public` `SECURITY DEFINER` function to `anon`/`PUBLIC`
  without an inline `-- definer-anon-exempt: <reason>` escape — forcing a conscious exemption
  for the genuinely-public token/slug reads. A periodic advisor re-lists every DEFINER
  data-returner with anon/broad-authenticated EXECUTE so drift is caught.

- **§37 producer inventory on every REVOKE / guard-add.** Before REVOKEing `anon`/
  `authenticated` or tightening a guard, walk the 8 caller classes: confirm no legit caller
  (esp. a service-role edge fn with `auth.uid()=NULL`, or an agency-parent acting on a
  sub-account via CONTEXT-SWITCH not a foreign tenant param) breaks. A half-hardened function
  that 4xxs a legit caller is worse than the leak.

- **The test, every time:** *"This DEFINER function bypasses RLS — does its BODY re-enforce who
  the caller is (self / tenant / operator role that RAISES), or is it trusting the EXECUTE grant,
  a caller-supplied id param, or a tenant-agnostic global role?"* If the grant is the only guard,
  it isn't §9-safe.

**Cross-references:** §9 (tenant isolation), §53 (operator tiers — the global-role trap),
§37 (producer inventory), §51 (per-tier check), §32 (SET ROLE proofs), §39 (peer-gate),
#116 (the view class — same mechanism, different object type).

## 60. Same-tier feature parity + Enterprise-only customization — every feature DECLARES its tiers through the one helper.

> **PROPOSED — owner RULED the substance 2026-08-11 (structural enforcement is MANDATORY, not
> deferred); exact wording ratified in a later pass (same pattern as §57–§59). §-number provisional.**

**Directive (owner: Antonio, 2026-08-11).** Every tenant at the same tier structurally receives the
same **base** feature set. If a feature exists on ONE Solo account it MUST exist on ALL Solo accounts —
same for Sub-accounts, same for Agencies. **Every feature built on the platform DECLARES which tiers
receive it via the shared `getTierFeatureSet()` / `hasFeature()` helper (`src/lib/tier/tierFeatures.ts`)**,
and every render gate DERIVES its answer from that helper — never from an inline `account_type` /
`tenant_id` / tier compare. The helper is the ONE HOME (§18) for tier→feature mapping. **Enterprise is
the ONLY tier that receives per-tenant customization** — on top of the Agency baseline. Feature
availability is DERIVED from CURRENT tier classification (§57), never per-tenant, never inherited from
historical state.

Owner's framing (verbatim, 2026-08-11): *"I do want getTierFeatureSet() or something like it. That way
anything we build will HAVE to have those features set for each tier. That's not an ask… You have both
mis-quoted features, skills, designs, tools, resources, etc. at every level of the platform. That stops
today. We have a Taxonomy for a reason… Sub accounts and Solo accounts will be able to send customer
portal access but there's no need for Super Admin and Agency to be able to do that… LOCK in the things
we need to LOCK into specific account types. We are a CRM and that's how they work. Then we give people
the ability to customize on top of that."*

- **Solo ≡ Sub-account, except billing.** The only base-feature difference between Solo and Sub-account
  is BILLING (Solo billed directly by Paige L1; Sub-accounts billed by the parent Agency). Every other
  base feature is identical.
- **Opt-in layers ON TOP, never replaces the baseline (§2).** Marketplace installs, Playbook choices,
  and per-tenant opt-in features EXTEND a tenant's effective set on top of its tier baseline — legitimate
  chosen customization, NOT tier variance and NOT leaks. `effective = tier_baseline(classification) ⊕
  tenant_opt_ins`. Do NOT collapse opt-ins into the baseline (the helper models baseline only; the ∪ is
  a documented call-site layer in `useTierFeatures`).
- **Enterprise customization** is the only per-tenant BASE variance permitted — Agency baseline + that
  tenant's negotiated, documented, classification-gated customizations; never leaked to other Enterprise
  tenants without an explicit flag. Enterprise is built as a strict superset of Agency so it can never
  silently fall below it.

**Baseline the owner has LOCKED (starting content — extend as features are added):**
- **Customer portal access / invite sending → Solo + Sub-account + Enterprise.** Agency + Super Admin do NOT
  get it (an Agency manages sub-accounts, not a direct consumer client book; Super Admin manages
  tenants).

**Enforcement — three layers, all mandatory:**
- **The helper is the ONE HOME.** If you're about to write `if (tenant.account_type === '…')` in a render
  gate, that's the wrong code — declare the feature's tier set in the helper and call `hasFeature(...)`.
- **§39 peer-gate checklist item (binding):** *"Does every feature-render decision in this diff derive
  from `getTierFeatureSet()` / `hasFeature()`? Any hardcoded `account_type` / `tenant_id` gate outside the
  helper (without a justified `// tier-feature-exempt:` marker for legitimate tier-ROUTING) is a §60
  violation."* And, from the anchor case below: **enumerate EVERY producer of a locked capability (§37) —
  a lock that gates 4 of 5 minters is not a lock.**
- **CI guard `lint:tier-features`** (sibling of `lint:views` #116 + `lint:definer-fns` #117): scans `src/`
  for render gates referencing `account_type ===` / a hardcoded tenant-UUID compare; any match outside the
  helper without an inline `// tier-feature-exempt: <reason>` escape fails CI. Positive + negative fixtures
  ship with it.

- **HONESTY on the enforcement LAYER (§13).** The helper + lint enforce the lock at the **UI / build-time**
  layer (every render gate derives from the helper; CI blocks new drift). For MOST features that is backed
  by server RLS/RPC authority (§9). Where a locked capability's server RPC does NOT yet tier-gate (today:
  `customer_portal_invite` → `create_tenant_invite_token` does not gate `_kind='consumer'` on
  `account_type`), the lock is UI-only until the server gate lands — say so, do NOT claim "server-enforced."
  This is not a §9 IDOR when the tenant can only act under its own `tenant_id`; it is a product-scope rule.
  The server-side tier gate is a tracked follow-up (tied to the owner-decision on whether an Agency keeps
  any direct client book).

**Anchor (§13, task #122 / owner ruling):** MMA's §16 block divergence (#121) was an empty-state placement
bug, and the platform sweep found zero same-tier leaks — but the owner ruled the helper MANDATORY anyway,
because features/skills/designs drift silently and get mis-quoted across tiers, and text-only doctrine
relies on humans/agents remembering. The structural primitive (helper + CI guard) is the tier-lock
equivalent of #116 (`security_invoker` + `lint:views`) and #117 (DEFINER caller-scope + `lint:definer-fns`).
The build's §39 peer-gate then caught the exact failure this section names: a 5th consumer-portal minter
(`WorkspaceSettingsPanel`, on the UNIVERSAL Setup surface) was ungated — proving a §37 producer inventory
on every locked capability is not optional.

**Cross-references:** §57 (Super Admin = source of truth — derivation), §51/§56 (tier matrix), §16
(department model), §2 (opt-in installs are chosen config), §18 (one home + CI guard), §37 (producer
inventory — enumerate ALL minters of a locked capability), §39 (peer-gate), §9/§53 (server is the real
auth boundary), D10 `getTierBookNoun` (the label twin).

## 61. Default tier-placement rule — the answer is already known; stop asking the owner per-feature.

> **PROPOSED — owner RULED the substance 2026-08-11; exact wording ratified in a later pass (same
> pattern as §57–§60). §-number provisional.** Authoritative statement + decision procedure live in
> `docs/doctrine/tier-matrix.md` §61 (the §18 one home); this section is the CLAUDE.md pointer.

**Directive (owner: Antonio, 2026-08-11).** §56 says *check the tier matrix before you build*; §60 says
*declare the per-tier answer in the one helper*. §61 supplies the **default answer itself**, so the
recurring "which tier gets this?" question stops going to the owner. His framing, verbatim: *"This is
yet another time that you guys have asked me… where things should be placed when we should actually
already have this understanding for the entire platform… I would love for us to lock this in as a
complete doctrine and as an understanding somewhere inside of our brain, also inside of the master
project."* Asking the owner to place a feature that the rule below already answers is itself the miss.

- **The standing default distribution — every new `getTierFeatureSet()` feature follows this unless the
  owner explicitly rules an exception:**
  - **Super Admin (God-level) — YES.** Has EVERYTHING (source of truth §57; dogfooding §35). Honest code
    note (§13): God's own `tierFeatures.ts` baseline still omits a tenant-book "doing" flag it has no book
    for (`customer_portal_invite`, the CRM cluster) — it reaches tenant data by act-as (§51 Tier 1), not by
    carrying the flag. "Has everything" = governs/derives + dogfoods everything it can operate.
  - **Solo — YES.** The operator running their own business.
  - **Sub-account — YES.** Same as Solo (§60).
  - **Agency — RESELL.** Does **NOT** use the feature at its own operator surface; it has the ability to
    **RESELL** the capability to its sub-accounts via the Marketplace. (So an Agency's `getTierFeatureSet()`
    does NOT carry the operator flag; its resell ability is the separate Marketplace mechanism.)
  - **Enterprise — YES + RESELL.** The HYBRID tier — inherits Solo ∪ Agency, so it gets both operator-use
    AND reseller ability.
- **Exception rule.** Any deviation from this default requires an explicit owner ruling AND is documented
  in the feature's declaration comment in `tierFeatures.ts`. Past-ruled exceptions, preserved:
  - `customer_portal_invite` = Solo + Sub-account + Enterprise only (Agency + Super Admin excluded).
  - `growth` + `studio` = Solo + Sub-account + Super Admin only (Agency EXCLUDED entirely — no resell).
- **Cowork/CC behavioral rule.** When a new feature ships and its tier distribution matches the §61 default,
  ship it WITHOUT asking the owner — note "§61 default: no exception." Only ask when the feature's nature
  suggests it might BE an exception (e.g. an admin-only surface that doesn't fit "operator running a
  business"). Asking a tier question the §61 default already answers is itself the §61 miss (Cowork miss #12).
- **Anchoring application (owner-ruled 2026-08-11):** the Skills Wave `skills` feature follows the §61
  DEFAULT → **God YES · Solo YES · Sub-account YES · Agency RESELL (skill-library resell via Marketplace) ·
  Enterprise YES + RESELL.** Vocab reconciliation is **MEDIUM scope** (owner-ruled): a living
  `docs/doctrine/skills-vocabulary.md` glossary + inline code comments disambiguating the four concepts
  (`paige_skills` recipes · Marketplace add-ons · sub-agents/specialists · department methodology) — **NO
  renames of shipped tables or UI surfaces** (§58 anti-regression risk, no user-facing value).
- **The test, every time:** *"Does the §61 default already answer this feature's tier distribution (God/
  Solo/Sub YES, Agency RESELL, Enterprise YES+RESELL)? If yes, I ship it and note '§61 default: no
  exception' — I do NOT ask the owner. Only a genuine exception candidate escalates."*

**Cross-references:** §56 (pre-build tier gate — WHEN to check), §60 (the helper — WHERE to encode), §57
(God derive-from-source), §51 (tier matrix / parity railing), §35 (God dogfoods everything), §2 (resellable
installs are chosen config), §37 (gate every producer), `docs/doctrine/tier-matrix.md` §61 (authoritative home).

## 62. Two-tier skills sourcing — platform baseline (OSS-distilled) + tenant-loadable.

> **PROPOSED — owner ruled the substance 2026-08-11; exact wording ratified in a later pass (same pattern
> as §57–§61). §-number provisional.**

**Directive (owner: Antonio, 2026-08-11).** Paige's skills library (`paige_skills`, concept 1 in
`docs/doctrine/skills-vocabulary.md`) has two first-class sources — both use the SAME schema, the SAME
interpreter runtime (S1b default dispatch), the SAME §16 autonomy clamp, and the SAME §61 tier framework;
the only difference is `scoping` + who authored the row. Paige treats both as first-class capabilities she
can reason with and run.

- **Platform baseline skills (`scoping='platform'`)** — NOT written from scratch. They are **pulled from
  OSS skill repos** (the Anthropic Skills registry, community skill repos, owner-curated local skills),
  **distilled mechanic-descriptive (IP-clean per §14)**, and seeded into `paige_skills`. This is what every
  tenant gets by default per the §61 tier distribution.
- **Tenant-loadable skills (`scoping='tenant'`)** — a tenant installs their OWN GitHub-repo skills into
  their Paige instance via a skill-installer / marketplace surface. Tenant-authored, tenant-scoped, lives in
  that tenant's Paige only — per-tenant intellectual property (§9). This is a follow-up wave, sequenced
  AFTER the S2 platform-baseline seeding completes.

**The distillation rule (IP-clean, per §14).** For each source skill, extract the MECHANIC (what it does,
what steps/tools, how it structures the work) and rewrite as a `paige_skills` row whose `methodology_anchor`
+ `description` + `steps` are **mechanic-descriptive ONLY** — never a source-repo name, an anchor person's
name, or a branded framework title. Source attribution stays in an internal code-review comment on the
migration commit (the §14 pattern: attribution in reference, mechanic-only in the row). `tier_availability`
= §61 default; `scoping='platform'`; `autonomy_lane` per the §16 risk mapping; `allowed_tools` least-privilege.

- **The test, every time:** *"Is this skill pulled from a proven OSS source and distilled IP-clean (platform
  baseline), or authored by a tenant for their own instance (tenant-loadable)? Did any source-repo/person/
  branded name leak into the row instead of staying in the commit comment?"* If a name leaked, it isn't
  §14/§62-clean.

**Cross-references:** §14 (GOAT registry — the IP-clean attribution pattern) · §16 (autonomy clamp) · §26
(prompt-forge — the interpreter forges from the anchor) · §51/§60/§61 (tier framework) · §9 (tenant vs
platform scoping) · `docs/doctrine/skills-vocabulary.md` (concept 1) · master §15 (the Skills Inventory this
sources into).


## 63. Owner's real business accounts are OFF-LIMITS as agent example / default / suggestion targets.

> **PROPOSED — owner RULED the substance 2026-08-12 (binding as intent immediately); exact wording +
> final §-number ratified in a later pass (same PROPOSED pattern as §57–§62). Owner picks the final
> §-number.**

**Directive (owner: Antonio, 2026-08-12) — extends §9 and §57.** Cowork and CC must **NEVER** suggest,
propose, default to, or reference the owner's REAL production business accounts — **Project Mogul
(agency), Mogul Maker Academy / MMA (sub-account), Antonio Daniel LLC (sub-account)**, or any other real
owner-operated business account — as an **example tenant, reference workspace, default target, fork
option, or suggestion** for platform work. Owner's verbatim framing: *"I don't even want them to ever
make a suggestion about something specific to Project Mogul or MMA. I don't even understand why they keep
doing that. Can we please clean that up?"*

These are the owner's REAL revenue-bearing production accounts. Treating them as "development tenants" or
"example tenants" is a §9 seam violation waiting to happen and a §57 source-of-truth muddle — every
mention entrenches drift toward pattern-matching them as "the reference tenants."

- **Off-limits everywhere an agent is choosing an example/default/target:** not in fork widgets, not in
  code comments, not in migration examples, not in "here's what a real tenant looks like" framing, **not
  even as a negative example** ("don't point platform-scope skills at MMA"). If you catch yourself about
  to name one, replace it BEFORE the recommendation is surfaced.
- **When an example/target tenant is genuinely needed, use, in order:**
  1. the designated **Paige Operator Workspace** (the §200 `platform_operator_tenant_id` config-as-data
     pointer — a purpose-built, coaching-generic operator workspace);
  2. a fresh, purpose-built **test tenant** (the platform already uses `test-tenant-*-verification` rows
     for exactly this);
  3. **anonymized placeholder** text (`some-tenant-uuid`, `example-agency`).
- **What this rule does NOT touch (§13/§58 — audit integrity):** it is a GO-FORWARD choosing rule, not a
  purge. LEGITIMATE existing references stay: real §13 corrections-log / decision-log / audit entries
  (e.g. "Antonio Daniel LLC upload seam bug"), real master-tenant gate LOGIC (the `MASTER_ONLY_TOOLS` /
  MMA-fallback resolution, migration names, real data-fix migrations), real portfolio/architecture
  documentation (the owner's actual accounts ARE the subject there, not an example), and meta-prohibition
  surfaces that must NAME the marks to enforce the ban (the platform-independence sweep regex, the "MMA
  OS" jargon lint, this section itself). Never rewrite git history.
- **Both agents, going forward:** Cowork never surfaces these accounts in any recommendation/fork/example/
  negative comparison; CC additionally never uses them as test/fixture tenants in new code.
- **The test, every time:** *"Am I about to name Project Mogul / MMA / Antonio Daniel LLC as an example,
  default, suggestion, fork option, or reference/negative-comparison tenant? If yes — swap to the Paige
  Operator Workspace, a fresh test tenant, or a placeholder before it leaves my mouth."*

**Cross-references:** §9 (tenant isolation / operator-vs-tenant seam), §57 (Super Admin = source of
truth), §200 (platform independence — no real-account phantoms baked into platform paths; the Paige
Operator Workspace pointer is the sanctioned example target), §58 (anti-regression — this is a go-forward
rule, legitimate audit entries are NEVER purged), §50 (the same meta-exempt pattern: a prohibition
surface must name what it prohibits).

## 64. Cloud-first, laptop-independent by default.

**Directive (owner: Antonio, 2026-08-12).** Every function, agent, deploy path, and maintenance job
MUST have a **cloud-native execution path** so no capability the platform needs depends on the owner's
laptop being on, awake, connected, or running a specific process. Local CLI commands and dev-tool
sessions (Cowork / CC on the desktop) remain valid *working* environments — but they are **NEVER the
sole path**. Anything that MUST run on a schedule, respond to a webhook, deploy on merge, or be
reachable by Paige runs on the **cloud** (Vercel, Supabase, Fly, GitHub Actions, cloud sandbox).

- **The test, every time:** *"If my laptop is off for a week, does anything the platform needs stop
  working?"* If yes, the missing capability gets a cloud execution path **before it ships**.
- **Concrete implications:**
  - **Deploys → CI, not a local CLI.** Merge to `main` triggers the deploy (edge functions via
    `deploy-edge-functions.yml`; the Fly services `paige-browser` + `paige-visual-renderer` via
    `deploy-fly-services.yml`; migrations via `deploy-migrations.yml`; the frontend via Vercel). A
    manual `flyctl deploy` / `supabase functions deploy` from a laptop is a **last resort only when CI
    is unavailable** (§24), never the standing mechanism.
  - **Scheduled tasks / cron / drift monitors → platform, not local cron** (`pg_cron`, GitHub Actions
    `schedule`, a cloud trigger) — never a job that only fires when a laptop is awake.
  - **Long-running agent sessions → the cloud-sandbox option**, not laptop-only, whenever the work must
    outlive the desk session.
  - **Git operations that MUST happen → a GitHub Action or the API**, not a local checkout someone has
    to remember to run.
- **Honest reporting (§13):** "the platform is up" must NEVER silently mean "if my laptop is on." When a
  capability's only execution path is local, say so plainly and file the cloud path as the fix — do not
  let a laptop dependency hide behind a green status.
- **The test restated:** *"Does this capability have a home in the cloud that runs without me?"* If not,
  it isn't done.

**Cross-references:** §24 (automate the repeat — the *mechanism* this rule generalizes), §34 (Paige owns
her intelligence end-to-end — cloud-first is the deploy corollary), §35 (OS north star — an OS that dies
when the owner's laptop sleeps isn't an OS), §13 (honest reporting — a green status must not depend on a
laptop being on), §32.a/§32.c (a cloud deploy still owes its persisted/live proof).

## 65. Names map to the user's mental model — routes, tier labels, and surfaces are named for who's there, never for internal structure.

> **PROPOSED — owner ruled the SUBSTANCE via the Route + URL Taxonomy brief (2026-08-12); exact
> wording ratified in a later pass (same PROPOSED pattern as §57–§64). §-number provisional (§65
> chosen as the next free anchor; §66 free, §67 reserved for Paige self-knowledge / task #159).**
> Authoritative statement + the locked 6-row matrix + migration order live in
> `docs/doctrine/route-and-url-taxonomy.md` (the §18 one home); this section is the CLAUDE.md pointer.

**Directive (owner: Antonio, 2026-08-12).** Every name a human sees or types — a URL path, a tier
label, a nav word, a landing route — must map to **how that human actually thinks about the surface
they're on**, never to the internal router tree, the DB column, or the table name underneath. Owner's
verbatim framing: *"Admin is not the place that an agency account should log in to… Admin should not
be the link that a solo account logs in to… we have to make this make sense, like logical sense, not
just technical but logical."* A name that forces the user to learn our internal structure — or that
means four different things to four different account types — is a §36 (intuitiveness) failure and a
naming-debt defect, not a cosmetic one.

- **The bug that forced this: `/admin` was overloaded four ways.** Solo, Sub-account, Agency, AND God
  all logged in through `/admin`, so the ONE word had to mean four different surfaces — and the agency
  owner kept landing on "the same landing page" because the URL couldn't tell the router (or the human)
  which of the four they were. That is naming-debt: one internal route bearing four distinct user
  mental models. The fix is one route per mental model, named for the person standing there.
- **The locked 6-row matrix (source of truth = the taxonomy doc §2a):** Operator → `/operator` ·
  Agency → `/agency/{account}` · Enterprise → `/enterprise/{account}` · Solo → `/solo/{account}` ·
  Sub-account → `/business/{account}` · Client → `/portal/:tenantSlug`. `/solo` + `/business` share
  ONE shell (a sub-account IS a solo operator with a parent, §51/§60); `/agency` + `/enterprise` share
  ONE shell + Enterprise's per-tenant customizations (§60). The route word names WHO is there, not
  which React tree renders it.
- **Per-account unique address (taxonomy §2b):** every account gets its own stable numeric URL segment
  (`/business/3855`) — a net-new `account_number` (address, NOT a grant; the number never widens what
  the session may do — §9/§51 still gate every read). The name/number is how a human finds THEIR
  account; authority stays session-derived.
- **The name is not the authority (§9/§51/§60).** Renaming a route or labeling a tier changes what the
  human READS, never what the server ENFORCES. A prettier URL is still gated by the same
  session-derived tenant scope and the same `getTierFeatureSet()` availability — the taxonomy is a
  mental-model layer ON TOP of the security layer, never a replacement for it.
- **Migration is redirect-safe (§58) and staged (taxonomy §6).** Old routes stay redirect-alive through
  the whole migration — no shipped, owner-approved entry point 404s. This doctrine section + the
  taxonomy doc ship as PR 1 (docs + matrix + migration order ONLY, zero code renames); the owner
  reviews the taxonomy and the migration order BEFORE any code-rename slice fires.
- **The test, every time:** *"Would a human who has never seen our codebase read this route/label/nav
  word and know exactly whose surface they're on and what they can do here — or does it only make sense
  if you already know our router tree and DB columns? And does this ONE name mean exactly ONE thing, or
  is it overloaded across account types the way `/admin` was?"* If it only makes sense from the inside,
  or it means more than one thing, it's naming-debt — fix the name to the mental model.

**Cross-references:** §36 (intuitiveness — a name you must learn is friction), §51/§56 (tier matrix —
one route per tier), §60/§61 (tier feature framework — the name reads, the helper enforces), §9
(tenant isolation — the address is never the grant), §58 (anti-regression — old routes stay
redirect-alive), §18 (one home — the taxonomy doc is the authoritative map),
`docs/doctrine/route-and-url-taxonomy.md` (the full matrix + migration plan).

## 67. Autonomy is granted to a PROCESS, not to a tool.

> **OWNER-RULED 2026-08-24.** Substance ruled; the authoritative statement, the arithmetic, the
> trigger audit and the build sequence live in `docs/doctrine/autonomy-architecture.md` (the §18
> one home). This section is the CLAUDE.md pointer, and it binds now.

**Directive (owner: Antonio, 2026-08-24):** *"The Trust Compass should be something that Paige can
call on and assign to workflows and automations not tools by themselves… Everything must be
interwoven. So we have to decide once say a campaign or emails checks or conversations or follow
ups, or calendar slot is booked. The Human user should be able to decide how much of the repeatable
task will they allow Paige, her other Agents etc to manage on their own."*

- **The unit of a human's autonomy decision is a REPEATABLE PROCESS** — a trigger, its conditions,
  and the ordered chain of acts it runs — never an atomic tool. A tool key is not a thing a business
  owner reasons about; "when a lead fills in my form, run this" is. Governing at tool level is the
  dev-tool pattern §36 exists to keep out of this product.
- **THREE LAYERS, and they compose rather than compete.** Ceiling (Trust Compass, the account) →
  Grant (the process, set once by the human) → Floor (the capability, a safety net). Effective
  autonomy is `min(grant, most-restrictive act's floor, ceiling)`, and a process whose TRIGGER has
  no substrate is dark whatever the arithmetic says. That is CD's `autoVals` arithmetic and it is
  not to be re-derived — re-deriving it is re-deciding it.
- **The per-tool floor STAYS (§58).** It is demoted from front door to safety net, never removed:
  Paige also acts from chat, from a skill and from a sub-agent, and those paths carry no process,
  so deleting the tool gate would leave the commonest path ungoverned. It is also what makes a
  whole-chain grant safe to give.
- **A process spans domains by design.** Forms, contacts, pipelines, products/services, sales,
  campaigns, calendar, analytics — one process may start in any and reach any. A trigger or act
  that cannot cross that seam is the bug.
- **The tenant ASKS and Paige builds it (§10/§15).** A tenant describes the process in chat; Paige
  composes the trigger, conditions and acts and files it — born at the floor, never above her own
  ceiling, the same rule her sub-agents are spun up under.
- **FULL AUTO EXISTS, AND THE DIRECTION DECIDES THE AUTHORITY (owner ruling, same day).** The
  daily posture may RAISE above the ceiling, not only lower — because a temporary raise that
  expires is safer than permanently moving the ceiling and forgetting. Lowering is any platform
  operator (a brake needs no God tier); RAISING is super_admin only, defaults to 4 hours, caps at
  24, and is audited as its own action. Both always expire.
- **AUTONOMY IS A COST DECISION AS WELL AS A TRUST ONE.** At `confirm` the human is the throttle;
  at `auto` there is none. Measured 2026-08-24: 639 LLM calls traced, $1.38 estimated, and **zero
  rows ever written to `platform_metered_events`** — her spend is observable and not billable, and
  no plan carries an AI allowance. Any autonomy work that widens what runs unattended states its
  metering consequence; the sequence is §8 of the architecture doc, and M1 (carry the trace into
  the meter) is the prerequisite for all of it.
- **The test, every time:** *"Is this autonomy decision one a business owner would actually
  recognise — a repeatable process they can name — or am I asking them to grant a tool? And does
  the grant still pass through the floor and the ceiling before anything runs — and do I know what
  it costs when nobody is watching?"* If it is a tool in front of a human, or the grant skips a
  clamp, or it spends unmetered, it is not §67-clean.

**Cross-references:** §16 (the `auto | confirm | off` lanes a grant is expressed in — unchanged),
§8 (the action bus this extends rather than forks), §36 (intuitiveness — the reason the unit is a
process), §10 (Paige-callable), §51 (delegation divides authority, never widens it), §58 (the floor
is demoted, not deleted), §13 (a dark trigger says so rather than never firing in silence).

## 68. No authority is permanent — a rung is held only while it is re-attested AND provably safe.

> **OWNER-RULED 2026-08-24.** Substance ruled; the arithmetic, the windows, and the check
> enumeration live in `docs/doctrine/autonomy-architecture.md` §9 (the §18 one home). This section
> is the CLAUDE.md pointer, and it binds now.

**Directive (owner: Antonio, 2026-08-24):** *"No authority should be permanent. With certain levels
of automation and autonomy there has to be security loops, checking for bugs making sure that they
are working. That's also with systems checks for."*

- **§67 grants autonomy to a process. §68 says the grant decays.** The session posture already
  expired; the CEILING did not, and a ceiling set once in March is not evidence the platform is
  safe in August. Two independent conditions now hold a rung up, and **both** must hold:
  **ATTESTATION** — a human re-affirmed it recently enough — and **PROOF** — the checks that
  prove the platform's isolation invariants are PASSING on their most recent run.
- **The window SHORTENS as the rung rises.** Rungs 0–1 never expire, because nothing acts unread.
  Expiry begins exactly where unread action begins: 30 days at rung 2, 14 at rung 3, 7 at full
  auto. The more Paige may do unwatched, the more often someone must say so.
- **`pass` is the only affirmative state.** A check that failed, skipped, errored, or never ran has
  not proven anything. Absence of proof is never proof — and this deliberately avoids parsing
  runner-authored reason strings, which drift.
- **Gate on ISOLATION, never on performance.** Whether Paige can act across a tenant boundary, and
  whether RLS still covers the tables, decide authority. A slow query is an alert. Revoking
  authority over a latency number is a false alarm, and false alarms train an operator to ignore
  the mechanism.
- **Degrade to Draft, never to Observe, and never silently.** A lapse steps DOWN to the highest
  rung whose conditions still hold — proof for rung 2 but not rung 3 grants rung 2 — and the read
  publishes `requested`, `effective` and `capped_by` together. **A clamp nobody can see is
  indistinguishable from a bug.**
- **A safety loop that does not run is the failure this section exists to catch.** The anchoring
  case is exact: the cross-tenant leak canary was registered blocking, had a correct runner, and
  had NEVER run — the edge function was never deployed, never scheduled, never gated, while the
  check honestly reported `canary_never_run` 342 times into an empty room. **Conditioning authority
  on a loop obliges you to make the loop real in the same change.**
- **The test, every time:** *"Is this authority standing on a human attestation that is still in
  date, and on safety loops that actually RAN and actually PASSED — or is it standing on a decision
  nobody has revisited and a check nobody noticed was dead?"* If either, it is not §68-clean.

**Cross-references:** §67 (autonomy attaches to a process — this is its decay law), §16 (the lanes
a grant is expressed in), §53 (renewing authority carries the same authority as granting it —
super_admin), §57 (the read is the source of truth; surfaces derive the clamp, they do not
re-compute it), §32 (a registered check is not a running one), §13 (the clamp reports its reason),
§58 (the floor and the rung both survive; only the permanence is removed).

## 69. Flow-by-Flow is MANDATORY on every software task — read it, don't invoke it and improvise.

> **OWNER-RULED 2026-08-30.** Ratified in-session and binding immediately.

**Directive (owner: Antonio, 2026-08-30):** every software task in this repo — application, feature,
screen, bug, refactor, UI or backend improvement, security review, automation, prototype, or micro
change — is executed through the installed **`flow-by-flow`** skill and its routed references. This is
a delivery requirement, not process language.

- **Read before acting.** Open `flow-by-flow/SKILL.md` completely, then `references/orchestration.md`
  completely. For Standard/Deep/release/security/permissions/persistence/integration/migration or major
  UI work, also read `references/delivery.md` completely, plus every reference the skill routes to for
  the work at hand (`audit.md` for existing product, `build.md` for implementation, `review.md` for
  independent review, `verification.md` for the proof gates). **Saying "using Flow-by-Flow" without
  performing its inspection, flow mapping, proof and approval gates does not satisfy this section.**
- **State the frame before editing.** Selected mode, depth, affected actor-goal flows, current
  main/head/tree, exact file/contract ownership and the collision result, the proposed changed-file
  boundary, the states covered, the Regression impact map, the failing-first plan, and the applicable
  gates. This is the pre-edit packet, and it is returned BEFORE the first edit.
- **Flow coverage — not file completion — is the definition of done.** A green build, a rendered
  screenshot, or a seeded fixture is not proof that the actor can reach their goal. Prove first-use and
  the central action, not only the populated happy path.
- **The two owner gates bind — EXCEPT pre-launch, where §4 overrides them. Read §4 before you stop.**
  Gate 1 is approval of appearance and intended function, via a `flow-prototype` surface for any major
  UI/UX change — no post-hoc approval, and an unanswered question is not approval. Gate 2 is explicit
  authorization immediately before ready-state, merge, deployment, or any other irreversible production
  action. Between them, continue autonomously through ordinary implementation, tests, review, fixes,
  draft PR and verification.

  **The pre-launch override (owner: Antonio, 2026-09-05) — it lifts THESE TWO APPROVAL GATES and
  nothing else.** While the platform has no live customers, §4's *"go all the way to main"* ruling
  outranks Gate 1's prototype approval and Gate 2's merge/ready-state authorization, and the correct
  action at each is to **keep going and merge**. Build the prototype where it genuinely helps you get
  the thing right — that is what it is for — then ship, and tell the owner what to go look at on the
  LIVE site. A green, verified branch parked behind a request for sign-off is the failure this
  override exists to stop, and a Vercel preview handed over in place of a merge is not a deliverable.
  **The material boundaries in the next bullet are NOT lifted — every one of them still stops you,
  pre-launch included**, and several have nothing to do with reversibility: an ownership deadlock,
  missing authority or a credential, spending money, accepting a licence or other legal term, a
  destructive real-data action, a material product decision, unbounded scope, a confirmed defect
  needing an owner choice. A reversible action you lack the authority or the money to take is still
  one you do not take. This override buys exactly one thing — the right to stop asking *"may I merge
  this?"* The two gates return the moment real customers onboard.
- **Stop only at a material boundary:** ownership deadlock, missing authority or credential, spending,
  legal acceptance, a destructive real-data action, a material product decision, unbounded scope, or a
  confirmed defect needing an owner choice. Consolidate into ONE decision gate.
- **Report evidence separately and truthfully** — automated tests, static/lint/type/build proof,
  structural or rendered proof, authenticated runtime proof, and `UNVERIFIED` with its reason. Preview
  success is not authenticated production proof.

**Installation.** The skill ships as two folders that must both be present and on the same version
(`flow-by-flow` and its required sibling `flow-prototype`) — that pairing is Gate 5 in the skill's own
`references/verification.md`, and `flow-by-flow` cannot complete its mandatory approval step without
`flow-prototype`. Install to `~/.claude/skills/` (personal) or `.claude/skills/` (repo). **A session
that cannot find the skill says so plainly and does not silently improvise its own process** — that
admission is itself required by §13.

**The test, every time:** *"Did I read the skill and its routed references and return the pre-edit
packet — or did I name the skill and then work the way I was going to work anyway?"* If the latter,
the section was not followed.

**Cross-references:** §1/§14 (never solo substantive work — the skill's specialist routing is how that
is staffed), §5/§39 (independent review, ordered specification-compliance first then adversarial),
§13 (honest, separated evidence), §32 (a green build is not a working runtime), §28/§58 (approved work
is frozen; shipped capability is never silently removed).

## 66. The tier matrix updates in the SAME commit as the ship — not later.

**Directive (owner: Antonio, 2026-08-19).** §0 binds master-doc updates in the same PR as the ship.
§BRAIN.3 binds brain updates in the same commit. §66 extends that discipline to the **tier matrix**
(`docs/doctrine/tier-matrix.md`, already the one home referenced by §51/§56/§61): every merge that
changes **what shipped, what's gated, or which tiers see a surface** updates the tier matrix in the
same commit as the code change — never a follow-up PR, never "when we get to it."

Owner's framing (verbatim, 2026-08-19): *"We need to make sure that we are documenting our taxonomy
and our matrix right along the way with everything that we're shipping."*

**What §66 binds today:** `docs/doctrine/tier-matrix.md` — specifically its **Surface ledger**, which
records per-surface, per-tier SHIPPED reality. Any additional taxonomy / implementation-status /
business-requirements docs that a real surface survey later warrants get their **own tracked slice** —
never authored under time pressure and never inferred (§13 stays load-bearing at the very moment the
rule that exists to prevent §13 drift is being born). §66 auto-extends to bind them once they exist.

**The test, every time:** *"Did this PR change what a tier sees, what's shipped, or what's gated — and
if yes, does `docs/doctrine/tier-matrix.md` reflect the new reality in this same commit? Or did I let
it drift and set the next session up to answer 'do we have X?' from stale docs?"* If the ledger still
says PARTIAL/GAPPED on a surface that just shipped, that is §13 drift — the exact answer-from-memory
failure this rule exists to end.

**Ledger entries record what is LIVE, not what is planned.** A half-finished slice writes the half
that is real and leaves the rest marked pending. Ticking a row because the commit "is going to"
deliver it is the same lie as a fabricated metric.

**Enforcement — three layers, all mandatory:**
- **Self-check.** The Definition of Done adds one line — *matrix updated* — for any ship that touches
  surface behaviour, tier visibility, or gating.
- **§5 compliance officer** on any surface-ship confirms the ledger reflects shipped reality before a
  SHIP verdict.
- **§39 peer-gate standing checklist item:** *"Does this PR change shipped / gated / tier-visibility,
  and if yes, did `docs/doctrine/tier-matrix.md` update in the same commit — or is reality already
  drifting from the source of truth?"*

**Anchoring case (2026-08-19).** The Fleet Console → Tenants slice (owner ruled a React Three Fiber
rebuild of the field, sub-tab 2). Mid-build the owner noticed that even with §0 and §BRAIN.3 catching
master-doc and brain updates, **no numbered section was catching the tier matrix** — so it had been
drifting quietly whenever a slice shipped. §66 closes that hole, and this slice is its first
application. **A §13 correction from the same session is part of the anchor:** the amendment's first
draft bound three doctrine docs (`platform-surface-tier-matrix.md`, `-implementation-status.md`,
`-business-requirements.md`) that do **not** exist on `main`, and assumed an SDLC §63/§64 collision
that does not exist either (`main` has §63 Owner's-real-accounts, §64 Cloud-first, §65 Names, and zero
SDLC sections). Grounding against `origin/main` caught both before they landed, and the rule was
rewritten to bind the doc that actually exists. Recorded because a rule about not drifting from the
source of truth nearly shipped by drifting from the source of truth.

**Cross-references:** §0 (master doc first — the parent discipline), §BRAIN.3 (same-commit brain
updates — the sibling), §13 (honest reporting — the reason, and the guard on how §66 itself was
landed), §5 (compliance officer — the enforcer), §39 (peer-gate — the audit), §BRAIN.2 (answer from
the source, never from memory — what stale docs break), §51/§56/§61 (the matrix's existing consumers).
*Forward-reference:* an SDLC close-out phase is intended to carry this too; the SDLC section is not on
`main` yet, so no §-number is asserted for it here.

## 70. Never build something the owner cannot USE on his own platform.

> **OWNER-RULED 2026-08-31.** *"I don't want you to EVER design and build something I cannot use
> myself on my own platform. Do I make myself clear?"* Binding immediately.

**The deliverable is a human completing a task on the live platform — never a code path that
exists.** A wired handler, a passing unit test, a green build, a rendered screenshot and a
"structurally correct" reading are all evidence ABOUT the code. None of them is evidence that the
owner, or a tenant, can sit down and get the job done. When those two disagree, the person who
cannot use the surface is right and the audit is wrong.

- **"The code is wired, therefore it works" is the same lie as "it compiled, therefore it runs"**
  (§32), wearing different clothes. §32 caught the build/runtime gap; §70 catches the
  runtime/USABILITY gap — the surface renders, the handler fires, and a human still cannot finish.
- **Never report a capability as shipped on the strength of reading the source.** Reading
  `onChange={set("type", …)}` proves a handler is bound. It proves nothing about whether a person
  can find that control, understand it, change it, save it, and see the result persist. Prove the
  ACT, not the wiring.
- **Proof is the human flow, driven end to end** — first use from a genuinely empty state, the
  central action, save and re-read, permission refusal, failure and retry, abandonment, and the
  account switch. A seeded fixture or a mocked success is not proof that a human can complete the
  flow; it is proof that a double behaved as instructed.
- **An audit that concludes "mostly already delivered" is a claim requiring MORE proof than a
  build, not less.** If the owner says he cannot use it and the reading says he can, reproduce
  before arguing. The reading is the hypothesis; the owner is the measurement.
- **Unavailable is a per-ITEM verdict, never a per-SURFACE excuse.** One genuinely missing backend
  contract makes THAT item honestly unavailable with a reason and a recovery path. It never
  licenses leaving the rest of the experience read-only, static, or "explained" instead of built.
- **The test, every time:** *"Can the owner open this on his own platform and finish the job —
  create it, change it, save it, and see it hold — or have I only proven that the code for it
  exists?"* If it is the second, it is not done, whatever the suite says.

**Anchoring case (2026-08-31, this section's origin).** Told to make Solo Settings → Connections →
Calendars genuinely usable, CC audited the source, found every required flow bound to a real write
with tests, and reported the assignment ~90% pre-delivered — offering options instead of building.
The owner's answer was that he cannot use it on his own platform. Grep proved handlers existed; it
never proved a human could complete a single flow. The audit was the artifact of the failure, not a
finding about it.

**Cross-references:** §32 (a green build is not a working render — the parent rule), §13 (honest
reporting), §31 (never shortchange the request), §36 (intuitiveness — discoverable in five minutes),
§58 (a shipped capability is never silently removed), §00 (CD owns how it looks; whether a human can
FINISH is correctness, and that is CC's).

### §70.1 — THE USER-USABILITY GATE (acceptance + release gate, every Paige task)

> **OWNER-RULED 2026-08-31.** Non-negotiable. This is the operational checklist form of §70,
> and it lives here rather than in a session note because a gate stated in chat evaporates on
> the next context reset — which is precisely how the failures above kept recurring.

**A Paige feature is NOT complete because code compiles, a screen renders, fixtures display, a
prototype is interactive, or automated tests pass.** For every capability presented as supported,
prove the owner can personally complete it through the REAL product UI against the REAL durable
contract on their own authenticated account:

- [ ] **Begin from the actual first-use / empty state** — not a seeded record.
- [ ] **Create or configure** the supported object.
- [ ] **Edit it and save it.**
- [ ] **Reload or revisit, and confirm the durable result** — the value survived, not just the toast.
- [ ] **Exercise permission, failure/retry, abandonment, and account-switch** paths.
- [ ] **Distinguish AUTHENTICATED proof** from preview, fixture, mock, or structural-harness evidence.

**None of these count as delivered:** a mocked save · a seeded record · local-only state that dies
on reload · a static readiness card · a disabled "coming soon" control · or UI that *describes* a
capability without allowing its supported human flow.

**When a contract genuinely does not exist**, mark THAT EXACT capability honestly unavailable with
its reason and its recovery path — then keep delivering every other supported flow. An unavailable
dependency is never a licence to leave a whole surface static or read-only.

**Release rule.** No PR may be called feature-complete, or put forward for Gate 2, until this gate
is met — or until its remaining gaps are explicitly reported as `UNVERIFIED` / `UNAVAILABLE` and
EXCLUDED from the claimed deliverable. "Tests pass" is not this gate. "It renders" is not this gate.
The gate is a person finishing the job.

**Evidence must be separated by class, every time:** automated test · static/build · structural or
harness render · **authenticated runtime on the real platform** · `UNVERIFIED` with its reason. A
harness drive against an in-memory double is the third class and must never be reported as the
fourth.

### §70.2 — THE OWNER-INTENT GATE (runs BEFORE planning, editing, or declaring done)

> **OWNER-RULED 2026-08-31.** Mandatory. Sits in front of §70.1: §70.2 asks *what outcome was
> asked for*, §70.1 asks *can a human actually reach it*.

**Before planning, editing, or declaring a flow complete**, identify the current owner's INTENDED
USABLE OUTCOME from their active instruction and their approved decisions. Carry that outcome
through the flow contract, and compare it against the **actual rendered or executed result** before
calling anything complete.

**Nothing below overrides that intent:** a green test suite · a fixture · a prototype · a static
status view · a PRIOR AGENT'S REPORT · or existing runtime behaviour. Each is evidence about the
system; none is evidence that the owner got what they asked for. Existing behaviour is especially
treacherous — it is the thing being complained about, so "it already works this way" is a
description of the defect, not a defence against it.

**Never report a capability as delivered** unless the supported human or system flow the owner
asked for actually works through its durable contract.

**When product evidence conflicts with the intended outcome:** preserve safety and authority
boundaries, name the EXACT missing contract, and complete every proven usable part. Do not
substitute a static representation for a usable feature, and do not let one missing contract
justify leaving the rest of the surface inert (§70.1).

**The test, every time:** *"What did the owner actually ask to be able to DO — and does the thing
in front of me now do it? Or am I about to hand back an artifact that describes it?"*

**Anchoring case (2026-08-31).** Asked to make Calendars usable, CC read the source, found every
flow bound to a real write with tests, and reported the work ~90% pre-delivered. The owner's
intended outcome — *I can use this on my own platform* — was never checked against a rendered
result. Driven, four flows failed, including a save that reports "Saved." and discards the write.
The prior report was the artifact of the miss, not a finding about it.

## 71. GROUND BEFORE YOU BUILD — four questions, each answered with an artifact, before the first edit.

> **OWNER-RULED 2026-09-25.** *"Is there a standing rule that you can add somewhere inside of our Git
> repo to make sure that the agents, when they do their grounding, always apply it the same way…?
> I've been telling every single agent to do this exact same thing, but no one seems to be able to
> build it in the same direction."* Binding immediately, on every task.

§69 says run Flow-by-Flow. §13 says report honestly. §32 says a green build is not a working render.
§70 says the deliverable is a human finishing the job. **All of that is about how you WORK and how
you REPORT. §71 is about the four minutes before any of it**, and it exists because a session can
satisfy every one of those sections while building the wrong thing, or rebuilding something that
already shipped.

Each question below is answered with an **artifact** — a query result, a deploy log, a diff, a
failing test — pasted into the work. **A belief is not an answer.** "I checked" with nothing shown
is the thing this section exists to stop.

### 1. IS IT ACTUALLY BROKEN, AND IS IT STILL BROKEN? *(artifact: a deploy log or a live query)*

Before repairing a reported defect, prove it is live **now**. A report is a snapshot; the fix may
have landed between the report and you. Check `git log` for the repair, `git merge-base
--is-ancestor <fix> origin/main` for whether it shipped, and the **deploy run for that commit** for
whether it reached production — CI moves the `edge-live` tag, and `/edge-drift` reads it.

The anchoring case is this section's own: a hand-off named a live self-approval hole as the first
piece of work. It had been fixed and deployed to prod **fourteen hours earlier** (`cda229c`, deploy
run #363, `✓ deployed paige-ai-chat`). Building the named fix would have been a no-op on a hole that
was already closed, while the real live regression — caused by that very fix removing a
compensation — went unbuilt. **A fix without this check can be a day of work that changes nothing.**

**AND IS THE SURFACE REACHABLE?** *(artifact: the import graph, and the built bundle)* — added
2026-09-25, because the first version of this section did not ask it and its own author walked
straight into the gap hours later. A file's path and name are not evidence that it ships. Before
editing a surface, prove something mounts it: `grep` for imports of it, and `grep` the built bundle
for a string only it contains. In the same session that wrote this section, `src/solo/agent.tsx` —
in the Solo folder, exporting `Agent` and `PaigePanel`, owning `useSoloChat`, reading exactly like
the Solo chat — was edited, tested, committed and pushed before anyone asked what imported it.
**Nothing did**, and its strings are absent from `dist/`. The live Solo chat was
`SoloPaigeWorkspace` → `PaigeAIChat` the entire time, and the diagnosis built on the dead file was
wrong. A test that passes against unreachable code passes exactly as convincingly as one that
does not (§70 — the deliverable is a human completing the task, and nobody can reach dead code).

### 2. WHAT DOES PRODUCTION ACTUALLY SAY? *(artifact: a real query result)*

Reason from the live system before reasoning from the source. Source tells you what CAN happen;
production tells you what DID. Read-only queries against real tables cost nothing and routinely
overturn the diagnosis.

Concretely: count the thing that should have happened and did not. Rows that never reached a
terminal state; sends whose last row predates the complaint; a feature configured on one tenant and
no other. In the anchoring case, `paige_pending_confirmations` over 30 days showed **36 proposals,
21 never acted on** — and the ONE surface with a 0-unanswered rate identified the working code path
by contrast. No amount of source reading produces that number, and the number is what made the
defect precise.

### 3. HAVE I PROVEN THE BASELINE, OR AM I ASSERTING IT? *(artifact: a measured before/after)*

**"Those failures are pre-existing" is a measurement, not an observation.** Run the same command on
the base commit and on the change, whole suite both sides, and record both numbers. Same for a
lint, a typecheck count, a timing. A session that writes "pre-existing" without both runs is
guessing in the one place a reader will believe it, and it is how a real regression ships inside a
known-red suite.

**USE A WORKTREE, NOT `git stash`** (added 2026-09-25, from this section's author failing it). A
`git stash` on an ALREADY-CLEAN tree stashes nothing, `stash pop` answers "No stash entries found",
and the "before" run is the same tree as the "after" run — **a comparison that cannot fail, and
therefore measures nothing.** It looks exactly like a passing check. `git worktree add /tmp/base
<base-sha>` with `node_modules` symlinked in gives a comparison that can actually disagree with you.

**And measure the WHOLE suite, not the subset you were looking at.** A partial run generalised into
a whole-suite claim is the same error wearing a number: the same session reported "19 across 4
files" from a `src/solo/`-only run when the true figure was 21 across 6, and only found out because
CI disagreed. The conclusion survived; the evidence had never reached it.

### 4. DOES MY TEST BITE? *(artifact: the test failing on purpose)*

Write the test, then **reinstate the defect and watch it fail**, then restore. A test that passes
against broken code proves nothing and actively harms: it converts an unproven claim into a green
check that the next reader trusts.

This is not §39's peer-gate — that is a second pair of eyes on the real diff, and it stays required.
§71.4 is the author falsifying their own assertion before anyone else sees it.

### For anything the owner will SEE, two more, and they are not optional

- **RENDER IT AND LOOK AT IT.** Not a description, not a code reading — the real component, the real
  tokens, both themes, an image in the reply (§00: CC shows the work). Three defects in the
  anchoring case were invisible to 11 passing tests and obvious in one frame: identical icons on
  rows that behaved differently, no size step between heading and summary, and a refusal that said
  itself twice.
- **SEPARATE THE EVIDENCE CLASSES AND NAME THE ONE YOU DID NOT REACH.** Automated · static ·
  rendered · behavioural · authenticated-runtime · `UNVERIFIED`. A jsdom click is not a browser
  drive; a rendered harness is not the app; and saying so costs nothing next to being caught at it
  (§13/§32/§70.1).

### The test, every time

*"Can I point at an artifact for all four — that it is still broken, what production says, the
measured baseline, and my test failing on purpose — or am I about to start building on four beliefs?"*
If any answer is a belief, you have not grounded; you have guessed with extra steps.

**HONEST NOTE, and it binds the next session that reads this.** This repo has written down
repeatedly that *"a standing rule stated in chat evaporates on the next reset"* and that *"prose
alone has failed this rule more than once"* (§1, §18, §51). §71 is prose. It will be skipped the
same way unless the four artifacts become things a gate can see — the ratchet, `lint:*` and the UI
evidence validator are the model, and the evidence record (`docs/evidence/ui-delivery/`) is already
the place three of these could be asserted and checked. **Building that gate is the durable version
of this section; treat this text as the interim.**

**Cross-references:** §69 (the process this runs in front of) · §13 (what an unfalsifiable claim is)
· §32 (compiled ≠ ran) · §70/§70.1 (a human finishing the job) · §39 (the peer-gate §71.4 does not
replace) · §BRAIN.1 (read the record first — §71 is what to do when the record is silent) · §24
(automate the repeat — the note above).

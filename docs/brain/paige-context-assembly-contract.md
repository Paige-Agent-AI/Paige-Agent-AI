# Paige Context Assembly Contract — PROPOSAL (owner green-lit via Stage 1)

> **Status:** PROPOSAL. Documentation only. Extends the Paige Runtime Harness doctrine
> (`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §3, responsibility #1 "Context assembly") as
> the third Stage 1 contract, sibling to `paige-durable-job-contract.md` and
> `paige-receipt-rail-contract.md`. It owns no Brain/Spine/registry fact and creates no
> new source of truth.

---

## 1. Problem (grounded survey, 2026-09-10, `main` `6dcde4da`)

Master §3's inventory: context assembly "remains distributed." Grounded:

- **`paige-ai-chat/index.ts` is 13,374 lines** containing at least six independent,
  hand-rolled context builders wired inline: persona resolution
  (`get_paige_persona_context`), working-tenant resolution, scoped identity
  (`contextUserId = scopedClientId || user.id`), semantic tenant knowledge
  (`match_tenant_knowledge`), skill prompts (e.g. `FUNDING_SKILL_PROMPT`), and the
  transcript replay with its silent prior-turn drop (#93/#117).
- **`_shared/client-context.ts` (851 lines)** — `buildUserContext` builds the biggest
  block (profile, subscription, tasks, businesses, documents, credit-awareness) as
  formatted strings, funding-gated by parameter. It is unit-testable and service-built
  (good), but its failure mode is a swallowed `catch` → silently partial context, and it
  returns a string, so no caller can tell what was available, degraded, or stale.
- **Silent degradation is the norm:** persona resolution "defaults to neutral" on error;
  working-context tenant resolution "defaults to null" with a `console.warn`; user
  context catches to empty. The doctrine requires failing closed on unresolved identity
  or stale scope — today the model just receives less context and the owner is told
  nothing.
- **The model citizen already exists:** `_shared/paige-spine/resolveEvidence.ts` — typed
  `available | unavailable` results with named reasons (`capability_unavailable`,
  `resolver_unavailable`, `subject_required`, `scope_changed`), exact-key validation, and
  scope-change detection. Proof that the pattern fits this codebase.

## 2. The contract

E09 customer-private Chat extends the existing thread/turn records with an explicit
customer audience. Native identity comes from the caller-bound CRM relationship,
never the staff active-workspace pointer. Private customer turns require issued
actor/business/intent and terminal evidence; legacy admin/owner thread visibility
does not grant access to this audience. The existing v2 admission/publication
contracts consume that relationship without changing rollout or executor gates.
This native seam alone does not activate customer model input, Knowledge
publication, tools, Live or browser history; those consumers must bind the same
audience, exclude owner context and preserve current publication permissions.

**One ContextBundle per turn, many typed sources, zero silent degradation.**

1. **Identity once, scope-checked continuously.** Actor, tenant, workspace, role, and
   act-as state resolve ONCE at turn start into the bundle; every subsequent step
   re-validates against `scope_changed` (the `resolveEvidence.ts` precedent). Identity
   never re-derives mid-turn, never blends (a scoped-client turn keeps the client's
   context under the client's identity — the existing `contextUserId` fence stays).
2. **Sources are typed resolvers, not string builders.** Each source returns
   `{ status: "available" | "unavailable" | "degraded", reason?, data }`. String
   formatting happens LAST, from structured results, so callers can render, test, and
   audit what was included. `buildUserContext`'s string output becomes a projection of a
   typed resolver, not the source of truth.
3. **Degradation is recorded, never silent.** An unavailable source appears in the bundle
   with its reason and (per the receipt contract) can ride the turn's trace. The model
   may be told "X unavailable" in bounded language; the owner can see it on the Rail.
   What is NEVER allowed: catch-to-empty, default-to-neutral identity, null-tenant with
   a warn and onward execution as if scoped.
4. **Minimum necessary.** The bundle carries only sources the task's lane requires
   (funding gate precedent: credit context rides only when the tenant's funding preset
   is on). Breadth is a policy decision recorded in the bundle, not an accident of
   which builder ran.
5. **Eligibility rules hold.** Brain knowledge, bounded Mind evidence, and governed
   Memory enter only through their existing eligibility contracts; the bundle assembles,
   it never bypasses.

## 3. Adapter-first rollout

1. **Seam module** `_shared/paige-context/` — the `ContextSource` / `ContextBundle` types,
   the identity resolver, and the degradation ledger. No tables; dependency-free,
   vitest-importable (the `resolveEvidence.ts` and durable-job seam precedents).
2. **First adopter: `buildUserContext` → typed resolver.** Biggest block, already
   unit-testable with a mock client; its catch-to-empty becomes honest
   `degraded`/`unavailable` results, with the existing string projection preserved for
   the prompt so no model-behavior change ships in the same beat.
3. **Then:** persona + working-tenant resolution into the bundle (their silent defaults
   become recorded degradations); transcript replay's prior-turn drop becomes an
   explicit bounded-Mind source (joins the #93/#117 memory workstream, which owns the
   compaction design).
4. **New work rule:** any new context source ships as a typed resolver; no new inline
   string-builder in a function body.

**Maturity gate.** `PROOF OWED` until the first adopter proves: sources report honest
availability under mock failures, degradation is visible in the bundle (and testable),
identity fence holds under scoped-client turns, and no prompt output changes in the
refactor beat (byte-comparable projection for identical inputs).

## 4. Collision assessment

- Extends Master §3 responsibility #1; owns no Brain/Spine/Rail/registry fact.
- #917 (orchestration/tools): the bundle feeds the same governed execution path; no
  orchestration decision preempted.
- #576/#591 (chat/knowledge isolation): the identity-once fence composes with their
  account-switch fences; their acceptance criteria are untouched.
- #93/#117 (memory/compaction): the transcript source defers to that workstream's design;
  this contract only types the seam.
- #754 (Brain wiring): Brain/Mind/Memory eligibility contracts are linked, not redefined.

## 5. Customer frame read primitive — implementation candidate

The existing customer self-profile, public brand and portal configuration can be
composed through `public.client_portal_frame()` in one STABLE database snapshot.
Its caller JWT supplies the subject; there are no actor, client or tenant arguments.
The unchanged native relationship reader excludes inactive/merged/unlinked or
ambiguous relationships. Brand and profile must name the same business. The closed
result is `{actor_id,profile,brand,config}`; it creates no identity, staff membership,
program, Knowledge store, action or receipt. Only authenticated execution is granted;
PUBLIC, anon and service_role execution is revoked. Canonical records remain the
existing clients, tenant brand cascade and tenants.features.portal_config.

The primitive is preparation for the existing customer frame and a typed customer
ContextSource adapter; it does not wire either consumer or add a Spine/model tool.
The customer assistant represents the business to its customer. Its future adapter
must include only customer-public presentation and authorized customer/program
records, report unavailable/degraded input honestly, revalidate the actor/client/
business and policy/publication versions at protected boundaries, and preserve
internal owner/operator context separately. Presentation settings do not grant
record, Knowledge, tool, approval or provider authority. Private customer AI history
and deliberately business-shared Conversations retain separate native audiences.

Source: migration `20271108190000_e09_customer_frame_projection.sql`. Proof extends
the incumbent `scripts/proof/e09-client-self-projection.mjs --frame` and the existing
fully replayed `supabase/tests/client_portal_self_projection.sql`; no new QA or CI
engine. Local synthetic native PostgreSQL cases are not authenticated Supabase or
customer acceptance. Exact-head review/CI, migration/source readback and consumer
acceptance remain separately required. Overall clients.portal remains PARTIAL;
multi-business selection, customer Knowledge publication, private durable history,
Chat/Live applicability and the complete seven-pillar experience remain proof owed.

### Customer Chat consumer candidate

The typed client-portal-persona ContextSource reads that atomic frame and exposes
only bounded customer-public business presentation. In the incumbent paige-ai-chat
runtime, customer_portal narrows the audience; native relationship and private
thread authorization establish it. The browser sends current text, native thread
and intent, never customer identity or prompt history. Canonical issued turns are
rehydrated from the existing Chat records. Owner/operator playbook, brief,
Knowledge, operating Memory and specialist context are excluded; trace content
is metadata-only and private AI text is not copied to business-shared Rail.

The existing provider/admission/settlement path remains controlling. Native
actor/client/business, private audience and presentation policy are revalidated
before protected dispatch/output. Customer tools and Live are not activated by
this conversational repair. Explicit version-bound customer/program Knowledge
publication, real domain reads/actions and verified multi-business membership
remain required follow-on contracts. See
docs/evidence/ui-delivery/e09-customer-chat-audience.md for source, local proof
and the separate hosted/authenticated acceptance boundary. This is a consumer
candidate, not proof of complete customer Chat or Portal availability.

The incumbent legacy paige-context-router remains a workspace persona: a resumed
thread must have a caller-JWT-verified workspace audience before context loading,
writes or model work. It cannot replay customer-private history into that persona.

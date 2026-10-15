# Sales E4: preserve an approved agreement revision

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing-project repair; agreement read, approved draft revision, canonical save, refusal and readback mapped below.
PAIGE_UI_DESIGN: PASS: Project skill, upstream, accessibility and review references read; this change contains no interface markup, navigation or visual redesign.
MATERIAL_FLOW_CHANGE: NO: Restore the existing draft revision's intended binding and stale-write protection; no new owner goal, confirmation mechanism or external effect.
FLOW_PROTOTYPE: NOT_REQUIRED: Bounded integrity repair of the existing approved agreement flow, with no new interaction container or design.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A Solo owner/admin revises the specific approved draft without losing its client, offer, commercial terms or document provenance.
VISUAL_DIRECTION: PASS: Existing Solo Sales and PAIGE surfaces preserved; no style, layout or navigation changes.
AUTOMATED_EVIDENCE: PASS: scripts/agreements/chat-draft-revision.test.mjs has 14 passing tests; initial current-main reproduction had 10 failures and one create-path positive control. A resolved transport-error control failed before its correction. scripts/agreements/chat-draft-revision-pg.mjs has 26 passing isolated PostgreSQL assertions over the canonical writer and triggers.
STATIC_EVIDENCE: PASS: git diff --check; existing writer and table-specific signing trigger source inspected. Hosted checks and full regression remain separate release gates.
RENDERED_EVIDENCE: NOT_APPLICABLE: No component, markup, CSS or visual state implementation changed in this domain slice.
BEHAVIORAL_EVIDENCE: PASS: Executed the actual adapter against synthetic ports and the canonical PostgreSQL writer; browser interaction is not claimed.
AUTHENTICATED_RUNTIME: UNVERIFIED: No genuine customer session executed this repair. Shared schema/dispatch must carry the approved revision token; INT-346 consequential execution remains separately held.
KEYBOARD_FOCUS: NOT_APPLICABLE: No interactive component or focus behavior changes.
ZOOM_REFLOW: NOT_APPLICABLE: No layout or geometry changes.
REDUCED_MOTION: NOT_APPLICABLE: No motion changes.
STATE_COVERAGE: PASS: Create, bound/unbound draft revision, stale/missing revision, foreign identity, denied role, changed workspace, uploaded document refusal, sent immutability, malformed provenance and uncertain write readback tested at the stated synthetic evidence level.
TRUTHFUL_STATE_LABELS: PASS: Failed source reads never become writes; uncertain saves require inspection rather than retry; signature, delivery and terms effectuation are not inferred.
SOLO_UI: YES: this backend-only integrity record is composed into #2128's SOLO release; existing agreement interfaces are unchanged.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: backend-only correction; no new native agreement capture in this record.
UNVERIFIED: Hosted release gates, deployment identity, signed-in Chat/Live acceptance and provider acceptance are outside this local proof.
OWNER_INTENT: Complete the existing conversation-led commercial workflow through canonical records while preserving exact identity, source versions and shared approval authority.
MUST_NOT_HAPPEN: Strip a terms/offer binding, replace an uploaded file with generated text, revise a sent document, adopt a foreign client, overwrite a newer revision, or claim an uncertain save succeeded.
MUST_PRESERVE: Existing save_paige_agreement, signing immutability, one confirmation gate, caller authorization, receipt classification, create behavior, Solo navigation and provider holds.
ACCEPTANCE_CRITERIA: With legitimate customer authorization, a proposal carries the exact read updatedAt; its approved revision reloads with the original client/offer/terms/source; stale or forbidden cases refuse with no write. This authenticated criterion remains proof owed.
MOTION_PURPOSE: NONE: No motion change.
PROTECTED_SEAMS: Affected: tenant/client scope, approved source revision, canonical save/readback and uncertain-outcome reporting, covered by 14 adapter tests and 26 PostgreSQL checks. Approval proof, authentication, entitlement/billing/provisioning, transcript/stream/thread/popout, Live, Vault/browser, providers, durable jobs, Memory, shell geometry and accessibility implementation are not edited. Shared schema/dispatch integration and actual receipt rendering remain independently verified by their owners.
INTERNAL_BUILD_IDENTITY: 00234a4afab4f612ff379654033c3a15f08950b1; deployment=NOT_APPLICABLE; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat domain adapter release); evidence=scripts/agreements/chat-draft-revision.test.mjs,scripts/agreements/chat-draft-revision-pg.mjs
RELEASE_CHANNEL: development: Local domain source and isolated synthetic proof; no production execution claimed.
RELEASE_CLASSIFICATION: patch: Repair existing agreement draft revision integrity and truthful uncertain save outcomes.
CUSTOMER_RELEASE_IDENTITY: none: Internal correction awaiting release evidence; no named customer release.
RELEASE_NOTE_REQUIRED: no: No customer announcement or new product surface in this bounded correction.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Domain implementation and synthetic database proof do not establish shared Chat integration, deployment or authenticated acceptance.
RELEASE_RECOVERY: position=forward-fix; reference=existing draft writer and protected signing lifecycle; never restore a path that drops binding or accepts stale revision input.

## Contract and collision boundary

Sales owns `_shared/agreements/chat-write.ts`. The appointed Shared Chat Runtime owner holds the shared tool-schema, declaration and `paige-ai-chat` callsite lease, coordinated with Experience 04. No shared file is edited here.

`draftAgreement` requires `expectedUpdatedAt` for a revision. It is the exact `updatedAt` from the canonical agreement read and must be included in the existing stored proposal and fingerprint by the shared owner. A fresh timestamp fetched after approval is not a replacement. The adapter reads only the specific active-tenant agreement through the caller client, preserves its persisted bindings, and passes the original timestamp into the existing PostgreSQL writer. Missing integration fails closed.

An uploaded document cannot be revised as markdown through this capability. The source file is preserved by refusal. Creating a normal new draft continues through the existing writer without a revision read. A transport failure or wrong/missing save readback reports an unconfirmed outcome and advises inspecting existing records before another draft attempt.

The PostgreSQL proof reuses `scripts/agreements/_fixture-schema.sql`, the canonical `20270401000000` writer and signing triggers, and the delivered `20271020000310` table-specific trigger contracts. Auth helpers are explicit synthetic stand-ins; these checks do not prove a production customer session.

## Required CI diagnosis

Published head `11f14c866aeffedd78dab3631fd669783ccd5179` received independent non-author SHIP review and passed the hosted full test step, but failed the Deno ratchet. Run `38576442933`, retained artifact `11899114858`, binds the exact base and head: nine inherited diagnostics and one new `TS2589` at the existing `draftAgreement` call site. This was Sales-owned generic query-port typing, not an unrelated baseline failure.

Build `00234a4afab4f612ff379654033c3a15f08950b1` confines the query-shape assertion to the existing read, keeping Supabase's generic select parser out of caller assignability. No runtime guards or writes changed. A local actual Deno importer check reports the same nine inherited diagnostics and no `TS2589`; this is not a passing hosted release check. Adapter tests remain 14 PASS and canonical PostgreSQL checks remain 26 PASS. The new published head still requires satisfactory exact-head hosted CI and review-policy disposition before merge. The repository's further review-round limit has been escalated in the existing program record; no waiver is inferred.

The adapter's `no_readback` result must be translated by the shared dispatch owner into the existing `outcome_unknown` envelope and Rail outcome. This domain slice does not change the shared classifier or prove the successor-write brake. Chat/Live acceptance remains owed.

## Separate dependencies

Signed-to-effective terms still require immutable signing-time commercial economics/version and effective provenance. Historical completed agreements without that evidence remain unverified; this repair does not activate terms, issue invoices, send signing links or request payments.

Sales overdue metric version/calendar correction (#2086), shared Analytics version support, secure Stripe TEST merchant/runtime/webhook setup and INT-346 remain separate. No credentials, real customer fixtures, provider calls or money movement are included.

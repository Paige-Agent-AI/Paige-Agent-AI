# UI delivery evidence: vibe-studio-v0-migration-renumber

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded on production before editing — supabase_migrations.schema_migrations holds 20270539000000 for sales_invoice_line_description (#1679), resolve_tool_autonomy_detail does not exist, and the deploy-migrations run for #1680's merge failed at its push step. Flow: Studio build turn → the lift asks the ceiling fact → today it fails closed (no function) → after this merge the canonical reader answers
PAIGE_UI_DESIGN: PASS: no interface change; the V0 surfaces and frames are unchanged and remain current
MATERIAL_FLOW_CHANGE: YES: once Migration A applies, the Studio lift can run again at Trust Compass rung 2+; at rung 0-1 Studio saves stay held for approval (as they are now, fail-closed)
FLOW_PROTOTYPE: PASS: no new surface; a migration identity fix under the owner's Migration A authorization (2026-10-03)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner/admin building in a Studio project; primary action unchanged
VISUAL_DIRECTION: PASS: unchanged (layout C)
AUTOMATED_EVIDENCE: PASS: supabase/tests/tool_autonomy_ceiling_fact.sql 1,216 checks against the renamed file; lint:migration-versions fails on main 6af516f51840a32e0b12fe9df923c80961f744c8 naming the 20270539000000 pair and passes on this branch (1,147 migrations); its self-test passes
STATIC_EVIDENCE: PASS: the renamed migration is content-identical apart from a four-line version note (94% similarity rename); no remaining reference to the old filename; independent reviewer confirmed production applies exactly this one file on push
RENDERED_EVIDENCE: PASS: no UI change; the current frames are docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/ (harness render · not live)
BEHAVIORAL_EVIDENCE: PASS: scripts/client-memory-authz/check.mjs section 32 (the lift asks resolve_tool_autonomy_detail and fails closed on an error) is unchanged and passing
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser here; the persisted apply is confirmed after merge from schema_migrations and by calling resolve_tool_autonomy_detail on production
KEYBOARD_FOCUS: PASS: no interface change
ZOOM_REFLOW: PASS: no interface change
REDUCED_MOTION: PASS: no interface change
STATE_COVERAGE: PASS: function absent (fail closed, saves held) / function present at rung 0-1 (saves held) / rung 2+ (the lift applies)
TRUTHFUL_STATE_LABELS: PASS: V0 records Migration A as owed, not applied, until the post-merge confirmation
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
UNVERIFIED: authenticated runtime (above)

OWNER_INTENT: "Migration A is authorized … The Studio auto-run list may NEVER override a ceiling-imposed confirm/off result. This is a P0 correctness fix."
MUST_NOT_HAPPEN: renumbering an applied migration; Migration A recorded as applied before its objects exist; another lane's migrations blocked by a duplicate version
MUST_PRESERVE: the Sales migration and its applied row; Migration A's content; the V0 surfaces
ACCEPTANCE_CRITERIA: after merge, schema_migrations holds 20270540000000 and resolve_tool_autonomy_detail exists and answers on production
MOTION_PURPOSE: none
PROTECTED_SEAMS: resolve_tool_autonomy answers unchanged (proven before: 112 tenant × tool answers, 0 changed); deploy-migrations now also runs the collision guard before its push and lints renamed files

INTERNAL_BUILD_IDENTITY: 42fe5a4101299e00fb1e5bc5d4ceb1e53e2ea861 plus this PR; deployment=local; environment=development; migrations=PROOF_OWED(20270540000000 is applied by deploy-migrations on merge and confirmed from schema_migrations and the live function afterwards); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/vibe-studio-v0-migration-renumber.md
RELEASE_CHANNEL: development: verified locally and by an independent reviewer before merge; Migration A applies through the migration pipeline on merge (pre-launch merge-on-verified, §4)
RELEASE_CLASSIFICATION: internal-only: no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: no: internal-only fix
RELEASE_TRUTH_BOUNDARY: PARTIAL: ships on merge; Migration A counts as applied only after the post-merge production confirmation
RELEASE_RECOVERY: position=forward-fix, the rename is additive and the previous resolve_tool_autonomy body can be restored verbatim from 20270122000000; reference=deploy-migrations pipeline applies the forward fix

## Scope and collisions

- Classification: migration identity fix after a version collision between #1679 and #1680.
- Explicit exclusions: V1 (separate PR).

## Review and limitations

Independent review (a reviewer who did not write it): the migration fix is correct and production applies exactly this one file; one HIGH (this evidence gate, fixed by this record) and three LOWs, all fixed — nested parentheses in the V0 record, renamed files now linted (--diff-filter=AMR), and the collision guard now runs in deploy-migrations before the push.

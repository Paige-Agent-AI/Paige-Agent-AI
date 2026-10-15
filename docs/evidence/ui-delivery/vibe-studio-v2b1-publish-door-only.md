# UI delivery evidence: vibe-studio-v2b1-publish-door-only

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded on production before editing — the eight publish/unpublish RPCs and their helpers md5-match the repo; grants were owner + authenticated + service_role; the publish door is the only caller across all eight producer classes. Flow: the Studio panel or chat asks the door → the door claims the approval → the door runs the RPC as service role with the verified workspace and the real person → readback → one receipt
PAIGE_UI_DESIGN: PASS: no interface change; the panel and chat show exactly the same states as after #1699
MATERIAL_FLOW_CHANGE: YES: a signed-in owner or admin can no longer call the publish/unpublish RPCs directly (e.g. from the browser console) to skip the lane check, approval and receipt; publishing through the panel and chat is unchanged
FLOW_PROTOTYPE: PASS: no new surface; backend hardening under the owner's ruling "Authorize G as an immediate follow-up" (2026-10-04)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner/admin publishing from the Studio panel or chat; primary action unchanged
VISUAL_DIRECTION: PASS: unchanged
AUTOMATED_EVIDENCE: PASS: supabase/tests/migration_g_studio_publish_door_only.sql (295 checks, migration applied twice, seven in-suite mutation proofs plus four against the migration file); door tests (src/__tests__/growth-publish-door*.test.ts, 94) including a Migration G block asserting every act calls the service-role client with the session workspace and the signed-in person; three door mutations caught; scripts/client-memory-authz 525/525
STATIC_EVIDENCE: PASS: ci:tsc 10 = 10 baseline; deno check --no-lock clean on growth-publish-command; the definer-fns, migration-versions, action-risk, receipt-coverage, governed-execution and approval-gate lints pass
RENDERED_EVIDENCE: PASS: no UI change; the current panel frames are docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/ (harness render · not live)
BEHAVIORAL_EVIDENCE: PASS: in an isolated Postgres with production bodies — before G a signed-in owner published directly; after G authenticated and anon are refused by privilege on all eight; a service-role call with workspace and person publishes and records that person (owner, admin, managing agency, company-workspace operator); refusals for no person, no workspace, a member holding the global role, another workspace's owner, and a signed-in caller naming someone else; 43 guard cases answer identically before and after
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser here; owed — after deploy, a signed-in Solo owner publishes a page from the Studio panel and from chat, and a direct console call to growth_page_publish is refused
KEYBOARD_FOCUS: PASS: no interface change
ZOOM_REFLOW: PASS: no interface change
REDUCED_MOTION: PASS: no interface change
STATE_COVERAGE: PASS: door call with an approved card (publishes) / direct signed-in RPC call (refused) / service-role call without a person or workspace (refused) / person not owner or admin (refused) / deploy window (honest failure, nothing changed)
TRUTHFUL_STATE_LABELS: PASS: a refused or failed publish says nothing changed; the audit row names the real person, never null or the service role
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project → Publish
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1536x770-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1536x770-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1366x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1366x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1024x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-1024x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-900x1000-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-publish-door/solo-900x1000-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no UI file changed; the panel calls the same door contract). The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
UNVERIFIED: authenticated runtime (above)

OWNER_INTENT: "Authorize G as an immediate follow-up" — the publish door is the only way the publish RPCs run
MUST_NOT_HAPPEN: a signed-in caller publishing or unpublishing without the door's lane check, approval and receipt; an audit row with no person; a service-role call acting for someone who is not owner, admin, managing agency or company-workspace operator of that workspace
MUST_PRESERVE: every existing publish guard and message; publishing and unpublishing through the panel and chat; the receipt and Rail line
ACCEPTANCE_CRITERIA: after deploy, the panel and chat publish as before, and a direct authenticated RPC call is refused
MOTION_PURPOSE: none
PROTECTED_SEAMS: _growth_admin_tenant unchanged; _growth_page_go_live / _growth_form_go_live unchanged; door readback, receipt and audit unchanged

INTERNAL_BUILD_IDENTITY: 80ce3211b4bf997992fa07e17ee1a85d7a70cbe0 plus this record; deployment=local; environment=development; migrations=PROOF_OWED(20270554000000 applies on merge through deploy-migrations); edge=PROOF_OWED(growth-publish-command deploys on merge through deploy-edge-functions); evidence=docs/evidence/ui-delivery/vibe-studio-v2b1-publish-door-only.md
RELEASE_CHANNEL: development: verified locally and by an independent reviewer before merge; deploys through CI on merge (pre-launch merge-on-verified, §4)
RELEASE_CLASSIFICATION: internal-only: no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: no: internal-only security hardening
RELEASE_TRUTH_BOUNDARY: PARTIAL: ships on merge; LIVE after both deploy runs, the schema_migrations row, and the owed authenticated drive
RELEASE_RECOVERY: position=forward-fix, a revert migration restores the two-argument signatures and the authenticated grant; reference=deploy-migrations and deploy-edge-functions run on merge

## Scope and collisions

- Classification: backend hardening that follows #1699's independent review.
- Deploy window: the migration and the edge function deploy separately. Until both are live, publish/unpublish return an honest error and nothing changes. Production has no published pages.

## Review and limitations

Independent review: recorded on the PR.

# Existing-account OAuth recovery and auth branding

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing owner signs in, sees a sanitized failure if the provider rejects exchange, then starts a fresh sign-in. No callback replay or account mutation.
PAIGE_UI_DESIGN: PASS: Existing Auth layout, Button components and favicon asset reused; no redesign or new layout.
MATERIAL_FLOW_CHANGE: YES: Correct existing-login callback and error recovery transitions.
FLOW_PROTOTYPE: UNVERIFIED: Direct owner urgent repair; safe release precedes live verification under the controlling prelaunch instruction.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Existing business owners recover sign-in without being directed into creating another account.
VISUAL_DIRECTION: PASS: Existing PAIGE favicon and Auth visual language retained.
AUTOMATED_EVIDENCE: PASS: 65 tests across seven focused files, including mounted BrowserRouter fragment failure, retry, cleared hash, rendered login and fresh Google login callback; separate non-author reviewer reproduced 13 tests.
STATIC_EVIDENCE: PASS: Changed-file ESLint zero errors and two existing export warnings; production build passed; no provider, user, membership or permission mutation.
RENDERED_EVIDENCE: UNVERIFIED: Repaired production page is not yet deployed; current live error reproduced through normal owner-authorized Google login.
BEHAVIORAL_EVIDENCE: UNVERIFIED: Mounted real Auth route recovery passes; live Google exchange still returns invalid_grant and is not repaired by this patch.
AUTHENTICATED_RUNTIME: UNVERIFIED: Fresh owner login fails upstream before workspace authorization; database readback confirms both existing memberships remain active.
KEYBOARD_FOCUS: UNVERIFIED: Existing native Button semantics retained; post-release keyboard drive pending.
ZOOM_REFLOW: UNVERIFIED: No layout changes; repaired page not yet live.
REDUCED_MOTION: NOT_APPLICABLE: No motion added or modified.
STATE_COVERAGE: UNVERIFIED: Query and fragment errors, sanitized denial/expiry/provider classification, retry, signup return and existing-login return covered; upstream provider success remains unverified.
TRUTHFUL_STATE_LABELS: PASS: No success claim, provisioning claim, account grant or provider repair inferred.
SOLO_UI: NO: Public shared authentication entrance; no authenticated Solo shell or PAIGE panel layout changed.
UNVERIFIED: Google exchange root cause, repaired production release and successful owner login remain open; no account recreation or authorization bypass.
INTERNAL_BUILD_IDENTITY: c9a771b21da76b184b70d09b5aa11a60b6fda3de; deployment=UNVERIFIED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=PR3259
RELEASE_CHANNEL: development: Owner-authorized incident repair through normal independent review and exact-head CI.
RELEASE_CLASSIFICATION: PATCH: Existing sign-in recovery and branding repair, no new capability or provider activation.
CUSTOMER_RELEASE_IDENTITY: none: Internal incident repair, no customer version designation approved.
RELEASE_NOTE_REQUIRED: no: Internal repair with incident readback; no marketing availability claim.
RELEASE_TRUTH_BOUNDARY: PARTIAL: recovery and branding source repair; Google login remains FAIL until ordinary owner login succeeds.
RELEASE_RECOVERY: position=Revert this narrow frontend patch if it regresses the shared auth route; reference=PR3259 and parent3f5608996.

## Attribution and preserved boundaries

- Root auth.html was introduced without icon declarations by PR700, branch codex/a2p-compliance-admin-url-purge, merged September1 UTC. This does not prove a current Experience agent caused the observed icon or Google failure.
- Current native OAuth integration delegates code exchange to Supabase Auth. Fresh Google exchange failure is independently reproduced; application-side replay and a responsible recent code change are unverified.
- Read-only production checks found active original access for both owner-designated businesses. No ownership, roles, identities, credentials, configuration, billing or tenant data changed.
- Other implementation lanes remain paused by owner order. Reviewer independent_rule_review did not edit or co-author these changes and approved the exact five code/test blobs with zero material findings.

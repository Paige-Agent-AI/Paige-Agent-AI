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

## Confirmed lock cause and recovery — November 3, 18:11 UTC

The earlier upstream-root-cause uncertainty is superseded by a captured database
blocker. During the separately owner-authorized native recovery request at
18:07:36 UTC, `supabase_auth_admin` was waiting 7.9 seconds to update the affected
user's recovery fields. PostgreSQL identified a blocking PostgREST transaction
executing `save_paige_chat_knowledge_link`. Its shared authority helper locks
`auth.users FOR SHARE`; continuous same-actor saves formed a reader cohort ahead
of native Auth writes. No missing membership or Chrome-specific cause was found.

Independent review approved narrow reversible containment. Actual save function
ACL was `{postgres=X/postgres,authenticated=X/postgres}` and definition hash
`5d77dd7ee0004925752d37fdd102b406`. Only authenticated EXECUTE on that function was
temporarily revoked with exact-source/ACL guards. Active saves drained before
cancellation was needed; no backend was canceled and no data was deleted. Native
Google login then succeeded at 18:11:38 UTC. The live chooser showed the original
two owner-designated businesses with their unchanged Owner/Admin roles. The owner
separately confirmed login worked. Endpoint containment remains distinct from the
permanent repair and must not be silently restored by an unrelated release.

The permanent migration changes only the helper's Auth-row lock from FOR SHARE
to FOR NO KEY UPDATE. This strengthens same-actor serialization, preserves the
ban/deletion barrier, original authorization predicates, remaining lock order,
function ownership and ACL. Original body `788d27bc980fee58e6272c3e53ca6096` becomes
`3f61f700706ae3d80dbde0164954e46c`; unexpected source/configuration aborts.

Actual original Chat-save concurrency proof passed in a verified disposable
PostgreSQL 16 cluster, using the existing producer/dependency fixture (not full
Supabase schema or customer/provider proof):

- Old shared-lock baseline: queued native-style Auth update times out behind a
  later same-user save cohort.
- Candidate: Auth finishes before the later Knowledge transaction releases;
  both saves retain the same original reference and link revision.
- Committed ban and soft deletion still refuse the actual save.
- Another actor remains independent; cancellation releases the Auth lock.
- Migration replay retains the original ACL; original 53 host assertions,
  16 installation fault refusals and five existing concurrency pairs also pass.

Command: `python scripts/proof/exp01-chat-knowledge-postgres.py --psql <local-psql>
--port 55479 --expected-data-directory <verified-disposable-directory>
--auth-lock-migration supabase/migrations/20271130020015_knowledge_auth_lock_fairness.sql`.
The same proof is included in the existing database-contract job.

Attribution: the shared authority-lock helper was present in the October 1
Knowledge migration (commit `9312da119203373ef82351b2deba07ed7601b5bd`, author
`ZCode Knowledge Lane`). The Chat-link writer was released by EXP01 November 1
(`0f306aa8a3384353c5047ccf4810060c0e852a9a`), with original Chat document presentation
integrated by EXP13 November 2 (`e8f3eb27a37379045bbce6aca8ec266b2477bdc6`).
This identifies the source chain, not the unverified initiator of the continuous
requests. No recent EXP09 Auth source change was established as this incident's
cause. All original agents remain paused and the hourly timer remains off.

Permanent repair source/review/CI/merge/deployment and restoration of the exact
paused grant remain separately verified release steps; do not infer them from
the successful containment login.


### November 3 forward lock-order correction (release still pending)

The stronger actor lock also requires Auth-before-Work ordering in seven existing
entry points. Native overlap tests reproduced the old deadlock for extraction
start/completion, review, publication start/stage/completion and reviewed Setup.
Forward migration `20271130020019_knowledge_auth_lock_order.sql` takes only the
actor Auth lock first, then retains original authorization/state/receipt logic.
Workers discover actor/tenant provisionally and verify identity after Work lock;
review uses the current reviewing actor; Setup keeps its profile/tenant order.
All eight affected function OIDs, metadata and existing ACLs are preserved.

A separate native test reproduced the pre-existing publication same-intent replay
versus recovery cycle: document→publication Work versus Work→document. The same
forward migration prelocks only the exact existing tenant/actor/intent publication
Work before its document; original replay validation remains afterward. Recovery
continues using its original SKIP LOCKED behavior and no new scheduler is added.

Applied Preview migrations 20015/20016/20017 remain immutable. Version 20017 adds
the null-safe release contract after the earlier recorded 20016. Production save
permission remains contained until the complete reviewed release/readback.
The final native proof, independent review, exact-head CI and live save/reopen
are required release evidence, not inferred from these reproduced baselines.

# Operations O3a — project and milestone creation

Pre-edit routing and flow contract. Development slice; no production or authenticated acceptance claim.

1. Owner outcome: give a project an accountable person and time window, then establish milestones to which canonical tasks can be attached.
2. Domain: Operations consumes existing Planning plans/items and Team identities. Sales and Clients keep their commitments and acceptance records. No changes to other departments.
3. Harness/Gateway: manual caller JWT and existing Planning permissions. Shared conversational execution remains independently governed; this slice does not change Chat admission or executor security.
4. Spine: existing `planning.create`, `planning.add_milestone`, `planning.list` and `planning.assign_task`. Current declaration is PARTIAL, not verified conversational execution. Arbitrary dependency graph and project lifecycle mutation are not supplied by these creation capabilities.
5. Provider: none. Canonical database records and existing audit only. No customer communication or provider spend.
6. Authority: reversible internal Planning records, source-owned membership and staff/self restrictions. UI reviews intended creation using existing shared confirmation components; no alternate PAIGE approval channel or new role.
7. Durable work: no async job is needed for project/milestone insertion. Existing assignment action bus remains owned by Planning. Non-idempotent creation must never replay an uncertain response.
8. Readback: expected actor/tenant are fenced under the existing profile scope lock, canonical writer returns bounded identity, independent caller-RLS read verifies all intended fields before success. Unknown outcomes retain identity and expose authorized inspection.
9. Surface: canonical Solo Projects and existing item/project detail panels. Binding Ledger stays PROOF_OWED for the full department. Recorded work progress is not verified client acceptance.
10. Proof: rollback SQL membership/role/tenant/relationship and ACL negatives; adapter lost-response, field mismatch and actor-switch tests; actual rendered confirmation, draft/recovery/focus and responsive behavior; completed non-author review; exact-head CI; production migration identity. Named authenticated runtime remains UNVERIFIED under standing restrictions.

## Flow

Open New project, enter name/context, choose scope and an authorized owner, set a real date window and Planning horizon. Review and confirm. Preserve the draft when confirmation is canceled or authority refuses. On a verified canonical readback refresh Projects and allow inspecting its canonical active status, explicitly disclosed before confirmation. Add milestone from project detail, choose a name, responsible person, priority and deadline, review and confirm. The server locks the in-scope parent project before delegating the canonical milestone writer. Task creation can reference the same milestone through the existing source relationship.

Busy flows reject abandonment. Unsaved drafts guard workspace switching and reload. Unknown results prohibit repeat save; known identities open the existing authorized details, unknown identities refresh current projects/work. Missing source or Team identity stays unavailable, not fabricated. No browser-only project, cloned identity, independent planning engine or invented client acceptance.

## Development evidence

- Adapter: 12 tests PASS for independently read draft/milestone fields, foreign acknowledgement, actor changes, canonical refusal and lost response without replay.
- Creator: four tests PASS for review/cancel retention, verified-only draft success, uncertain inspection lock and nonstaff milestone refusal. Initial test helper selected Start twice; corrected Finish selection and rerun passed.
- Product/shared-shell browser: 12 cases PASS across Obsidian/Mineral and required four sizes plus phone: project review cancellation, canonical refusal, actual scrolling/containment and focus; milestone refusal and focus in each theme. Explicit synthetic reads/role/refusal ports, not saved-record or authenticated proof.
- Scoped source ESLint, definer grant lint and signature ACL lint PASS. Type ratchet PASS (baseline 10/current 10) before guarded-read follow-up.
- Eighteen SQL rollback assertions are registered in database-contract CI. Native PostgreSQL could not start because local loopback binding returned permission denied: SQL execution is UNVERIFIED, not PASS. No customer database write or provider effect was attempted.
- Independent bounded static and visual reviews PASS for the prior core; target-tenant authority follow-up static review PASS. Fresh Solo-boundary review, exact-head rebuilt-schema CI, hosted migration/readback and authenticated acceptance remain owed. Project lifecycle editing, arbitrary dependencies and delivery acceptance are later slices, not implied by creation.

## Solo API scope pre-edit follow-up

Match the canonical isSoloStandalone registry boundary (literal standalone, no parent) before Operations record access or canonical delegation. Preserve current membership/tenant administration, creator/assignee authority, validation, CAS, audit and effective legacy permission intersection. No lifecycle entitlement inference or non-Solo expansion. Add disposable excluded-account SQL refusals; new SQL remains UNEXECUTED until rebuilt-schema CI, with independent review required. No customer workspace testing.

Current registered rollback SQL assertions: 22; new Solo-scope assertions UNEXECUTED pending fresh rebuilt-schema CI.

Guarded-read/Solo-boundary local follow-up: complete Operations plus tenant-switch suite PASS, 91 tests in 16 files; scoped shared-hook/Workspace lint and definer/ACL-signature lint PASS. New rollback SQL execution remains UNVERIFIED pending rebuilt-schema CI. No customer runtime or production acceptance inferred.

Fresh current-scope rendered proof: 22 project/milestone cases PASS; both worlds, all four required sizes with PAIGE open/closed plus phone closed, explicit synthetic target-tenant administration/refusal ports. JSON records flags, focus, scrolling and containment. Type ratchet PASS baseline10/current10. Native/hosted SQL, runtime and customer acceptance are not inferred.

Fresh independent non-author rendered creator critique: bounded SHIP, no material fixes; screenshots prove synthetic visual/refusal behavior only, not authenticated permissions, saved records or genuine employee photographs.

## Release preparation after task-creation a40245ea

Prepared on current task-creation head a40245eac4b4824e0ab940f58f2a57919ccfae66. Preserved its uncertain-task recovery lock. Unknown project acknowledgements likewise refresh without closing/re-enabling creation; only a known identity opens source detail, or an explicit warned abandonment closes. Target-tenant administrator UI read replaces global role inference and refreshes when actor/tenant changes. SQL wrappers retain literal standalone membership scope and canonical writers. Local adapters/creator/workspace: 22 focused tests PASS (16 adapter/creator and six workspace); scoped ESLint PASS. SQL 22 assertions remain UNEXECUTED. Historical rendered evidence is retained, not claimed as a fresh final-head proof. Development migration 20270602000413 is unallocated and must be renumbered against production and reservations before opening the bounded release PR. No production project or customer write occurred.

Current preparation c69e4a44e received completed independent non-author static PASS, no material findings. Fresh22 rendered shared-shell configurations PASS for required sizes, both themes, genuine narrow PAIGE fold, keyboard invoker restoration, draft/confirmation/refusal and containment. Phone geometry initially inherited292.5px; corrected to the incumbent approved creation sheet390px and affected22matrix/fourcreator tests rerunPASS. Reports are explicit synthetic fixture evidence, not persisted or authenticated work. Fresh final-head review and native zoom proof remain owed before promotion.

Eight genuine unsigned-in native Chrome200/400%zoom cases PASS, measuredDPR2/4 CSS674/337 physical1366, both worlds/PAIGEinitialstates, genuinefold, confirmationfocus/refusal/reachableactions/containment/invokerfocus. Full required viewport capture matrix recaptured for critic; visual verdictpending. Current type ratchetPASS10/10 and definer/ACLsignaturePASS. Reconciled task-creation95e5ac0c/currentmainc9 without conflicts, same product source. Unapplied00413 renamed body-identically to provisional20271020000120; production/reservations recheck before promotion, no applied-history reset. Still local/no secondPR; SQL22unexecuted.

## Current release-order reconciliation

Head c5b93c80083a1aa838d77ee2c1236f272b24eea8 passed verify but database-contract114403621778 FAILED. Production had gained Operator functions absent from that head; grant reproduction stopped before applying Operations120. The project fixture then failed at its first function-privilege check, not an executed authority assertion. No SQL22 PASS is claimed.

Clean merged head3a0f67070b5dd855eabfa6eaad0eef145d0d0613 includes current main60f03a7eb (Operator1970 migration100 and Model1980 grants200). Separate non-author exact-head review returned COMPLETE COMPATIBLE. Operations product, SQL body, fixture and proof workflow remained byte-identical. Production read-only ledger confirms100/110/200 applied,120 absent.

The production deploy workflow prohibits include-all/backdated deployment. Therefore the unapplied project migration is now body-identically renamed to20271020000210. Current main and all recent open touching PR migration files were checked; no210 applied or reserved was found. Earlier120 remains historical evidence only. No production history reset, manual DDL, authority expansion or repeated unchanged visual testing. Fresh exact-head review and required CI, actual SQL22 execution, deployment and source readback remain required. Authenticated customer acceptance remains UNVERIFIED.
Independent non-author visual critic completed bounded SHIP on e2400142 with all requested captures and native zoom, no material fixes. Saved/authenticated/production outcomes remain UNVERIFIED.

Reconciled release preparation9db2fb7b9574b4809a0803f0ce109cb303c4e7f8 against actual task merge123a6db1/currentmain. Master keeps Ads/Operator/Operations rows, workflow keeps task18 plus project22assertions, Workspace keeps released task unknown-response lock plus project creator. Fresh production ledger frontier110; active1970reserves100,1967stillclaims30; no120reservation observed. Proposed120unapplied, recheckbeforemerge. Production taskcloseout recorded with exactbuild/function/ACL/source evidence. Fresh22localtests requested; first attempt failed before tests with sandbox temporary-cache EPERM and is not a testPASS; permitted isolated unsandboxed rerun underway. Productproject source unchangedapprovede240.

Reconciled local rerun22tests in3filesPASS. Sandbox EPERM is retained as failed infrastructure attempt; actual tests completed outside sandbox without customer/provider access. Current source/migration120/fullCI and final non-author compatibility review remain required before release.

## Canonical creation-status correction after executed database proof
Head 0da61e57 passed verify. Database-contract 114406863360 successfully applied migration210 and executed ACL/scope negatives, then failed the canonical project draft assertion at line38. Existing plans default is active and plan_create preserves that default. Corrected independent readback, confirmation, success copy and rollback assertion to active; no writer, migration body, authority or activation path was added. Updated tests first failed2/16; corrected focused22/3 PASS and scopedlint PASS. Earlier draft-status success claims are superseded. Complete SQL22 still not proved until fresh CI. Hosted preview failed separately with SQLSTATE53200; parked #1986, no shared infrastructure change.


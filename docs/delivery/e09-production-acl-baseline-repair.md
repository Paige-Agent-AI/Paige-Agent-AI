# Production ACL baseline fidelity — EXP09 release prerequisite

## Problem and bounded correction (2026-10-21)

After migration `20271113050000` became recorded production history, K2's
unchanged90-case database suite failed cases2/3/6/14 in job119290794800.
Fresh read-only production metadata still showed the intended public-vector
function bodies and API-role permissions. The reconstructed CI database differed.

The pinned Supabase CLI2.109.1 full schema dump uses greedy GRANT/REVOKE
excluded-schema filters. They also match a **public** function's
`"extensions"."vector"` argument type, commenting out its ACL; the default
comment filter then deletes it. The reconciler correctly resets built-in
`PUBLIC EXECUTE`, but receives no production revoke or authenticated grant.
Previously the still-pending migration reapplied its ACL afterward, masking this.

Primary sources:
- [Pinned CLI ACL filters](https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/pkg/migration/scripts/dump_schema.sh#L48-L49).
- [Explicit-schema selection and comment deletion](https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/pkg/migration/dump.go#L159-L174).
- [PostgreSQL17 default-ACL schema selection](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_dump.c#L1954-L1963).

The existing read-only baseline now adds the official `--schema public` dump
inside its original before/after migration-ledger bracket. Public-object
reconciliation and its ordering negative control use that dump. The original
full dump remains authoritative for `--defaults`: an explicit public-only dump
would omit schema-less default privileges. No commented SQL is recovered or run.

No production mutation, function-specific allowlist, fixture grant, permission
inference, parser/minimum-count relaxation, native-test change, extra credential,
new workflow or change to reset → reconcile → pending-migration ordering.
The disabled premerge workflow and its independently owned debt stay untouched.
There is no customer UI, action, activation, or Spine registration in this repair.

## Verification

- Existing real ACL/ledger/default/reset-plan parser self-test PASS, extended with
  a neutral vector-signature revoke/grant fixture.
- Seven isolated tests run the **actual shell orchestration** with synthetic
  Supabase/Node transports: stable snapshot, one retry, repeated drift refusal,
  failed public dump, unreadable ledger, separate object/default routing and
  missing-public-dump refusal. No production connection in these tests.
- Controlled removal of the new dump command caused five tests to fail; source
  restored byte-for-byte, SHA256
  `28e56b7266175b91b7e61a88fa4f4731a7ff720847fa164dc83f36b370e54a5d`.
- Local sandbox cannot initialize Git Bash's Windows namespace; the same isolated
  tests passed under ordinary shell permissions. This is local execution scope,
  not a production-access or security-policy exception.
- Exact-head hosted database reconstruction, unchanged K2 90-case suite,
  defaults and grant-ordering negative controls: required before merge.
- Ordinary signed-in client behavior and full EXP09 founder acceptance remain
  UNVERIFIED; baseline repair alone supplies no customer-facing availability proof.

## Release identity and recovery

Channel development until exact reviewed merge/check evidence is recorded in the
PR. This is an internal engineering prerequisite, with no customer release
name/version/announcement. No production migration or Edge deployment is required
(`NOT_APPLICABLE`); production readback means the merged CI script/workflow and
actual read-only baseline reconstruction, not a customer-runtime claim.
Shipped Delivery Log: N/A until this candidate reaches main; exact post-merge
identity will be appended to Master Section4.0 in the next owning closeout.

Recovery is a bounded reviewed forward correction. Do not fall back to a known
filtered dump or restore production grants from migration intent. ALG-01/12 test
fidelity is improved; no new verified ALG-02/04/13 behavior is claimed.

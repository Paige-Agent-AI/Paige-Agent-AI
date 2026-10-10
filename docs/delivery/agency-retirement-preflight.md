# Agency retirement preflight — 2026-10-09

Status: BLOCKED before mutation. Owner has authorized deletion of Agency accounts and their children. No additional general owner approval is required. No production rows, Auth identities, memberships, connector settings or provider resources were changed.

## Verified target tree

| Agency | Children |
| --- | --- |
| Project Mogul Enterprise Inc | Sample Account LTD; Unknown Name- 1; [TEST] Acme Consulting; [TEST] Northstar Advisors |
| Test Agency Preview | None found |

The two canceled test children still exist and belong in this deletion scope. Sample Account LTD is an agency child, not a standalone Solo; the latest deletion direction supersedes its earlier proposed QA use. Preserve standalone accounts and Platform Operator authority. Do not delete shared Auth identities: two identities have memberships in the target tree, and one also has standalone memberships.

## Verified dependencies (aggregate counts only)

Six target tenants have six membership records. Target tenant references: clients 0; deals 0; messages 0; channel_connectors 6; tenant_phone_numbers 0; paige_chat_threads 1; paige_invoices 0; business_vault_records 0. These are bounded checks, not a complete absence-of-data certificate. Connector contents and Chat content were not read.

The deployed foreign keys restrict parent deletion while children exist and restrict tenant deletion while Chat threads exist. Other tenant relationships include CASCADE, SET NULL, RESTRICT and NO ACTION; deleting only tenant rows could discard evidence or leave records without tenant ownership. Do not disable constraints or blindly cascade.

## Exact outstanding operation

The authorized production database/lifecycle administrator needs to provide or execute a reviewed, recoverable whole-workspace retirement operation for these six tenants. The inspected deployed public functions have no tenant/agency/workspace retirement operation. `agency_remove_member` removes a team member; `delete_tenant_knowledge` deletes a document. Neither is a tenant deletion procedure. `operator_set_tenant_status` changes lifecycle status and is not hard deletion. `admin-delete-user` deletes an Auth identity and is not a substitute for deleting an Agency tree.

Execution must preserve a restorable snapshot and necessary audit/history, inventory remaining database/storage/provider/worker references, resolve the protected Chat-thread retention dependency through its supported lifecycle, disconnect/quiesce target-owned integrations without provider sends or paid actions, remove children before parents transactionally, preserve shared identities and all standalone/Operator records, then verify no target rows, memberships, active scope pointers or orphan records remain. Do not impersonate an authenticated operator or use raw Auth-table changes.

## Scope ambiguity outside the Agency tree

Current database contains six active standalone accounts, plus trial/canceled standalone accounts and Operator/default workspaces. The phrase “my active Solo account” does not uniquely identify one survivor. No standalone account is included in this six-tenant deletion target. Any later standalone consolidation requires an exact survivor set, not an assumption based on its display name.

## Evidence source

Read-only Supabase queries against deployed `tenants`, `tenant_members`, selected tenant-scoped dependency tables, information_schema and pg_constraint/pg_proc; repository lifecycle/administrative handlers. No deployed agent sign-in. INT-346 remains DRAINING. Existing local Solo parity repair is unchanged and unreleased.

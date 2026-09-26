# Roles & Permissions — domain brain

**Read this before touching any role check, RLS policy, or `SECURITY DEFINER` function.**
Authoritative design: `docs/doctrine/role-taxonomy-and-matrix.md`. Live audit:
`docs/audits/R1-role-call-site-inventory.md`. This file is the fast answer to
*"how do roles actually work here?"*

## The permission model — owner ruling 2026-09-26 (read first)

- **Roles authorize, titles describe.** The tenant role set is exactly `owner` · `admin` · `member`, and it does not grow. No tenant-defined permission sets. The platform operator tiers (§53), the agency roles and client assignment are separate gates, unchanged by this ruling.
- **Coach is not a permission, anywhere.** It is a title only. A member reaches the clients assigned to them; assignment (a data relationship) is what replaced coach.
- **A title never enters a permission decision.** It sits in `tenant_members.job_title` today; the tenant-isolation lane owns the title field going forward. It is descriptive. Activity records **must** keep the title as it was at the time, but **nothing does that yet**: the title-change audit row in `set_solo_team_member_work_profile` records only `tenant_id` and `target_user_id`. It ships with the title work (UNVERIFIED until then).
- The code still carries coach checks until the removal slices ship. **Describing today's code is not the same as stating the rule.** Authoritative: `docs/doctrine/role-taxonomy-and-matrix.md` §0 · decision log 2026-09-26.

## The three stores (conflating them IS the §59 bug)

| Store | Scope key | Tenant-scoped? |
|---|---|---|
| `user_roles` | `user_id`, `role` — **no `tenant_id`** | ❌ **GLOBAL by construction** |
| `tenant_members` | `tenant_id`, `user_id`, `role`, `status`, `is_owner` | ✅ tenant |
| `agency_team_members` | `agency_tenant_id`, `user_id`, `agency_role`, `scoped_subaccounts` | ✅ agency |

`is_tenant_member()` reads **only** `tenant_members` (`status='active'`) — never the agency rail.

## The one fact that changes how you read every guard

`map_tenant_role_to_app_role()` maps tenant **`owner` → `admin`** and **`admin` → `admin`**, and
trigger **`trg_sync_tenant_member_to_user_roles`** (ENABLED on `tenant_members`) writes it into the
tenant-less `user_roles`.

**So `has_role(auth.uid(),'admin')` means "any tenant owner on the platform," not "a trusted
operator."** Measured 2026-08-18: 9 `admin` holders across 10 of 13 tenants; 1 `super_admin`.

## Which helper to reach for

- Cross-tenant / platform authority → `is_platform_operator()` (super_admin OR platform_admin).
- God-tier / integrity gates → `is_platform_owner()` — **frozen super_admin-only**, do not widen.
- Tenant-scoped authority → `tenant_id = current_user_tenant_id()` **AND** a role check.
- **Never** authorise a cross-tenant action on a tenant-level `app_role` (§53/§59 global-role trap).

## Live shape (prod, 2026-08-18)

- `app_role` has 15 values. Class A = `super_admin`, `platform_admin`. Class C = `user`. Everything
  else is Class B (tenant-level) and is currently mis-stored in the global table — 15 such grants.
- Role predicates appear in **186 RLS policies / 91 tables / 118 DB functions**; **117 of 118
  functions are `SECURITY DEFINER`** (RLS bypassed — the in-body check is the only guard).
- **The corpus undercounts.** Policies that call `is_admin()` / `is_staff()` / `studio_role_ok()` /
  `check_feature_access()` reach `user_roles` one level down and match none of the
  `has_role|has_any_role|user_roles` tokens. Closing that is R2b.

## Not yet built

- No custom-roles table, no permissions table (`user_roles` is the only role table).
- ~~On `main`, `tenant_members` has **no work-title/responsibilities columns**.~~ **CORRECTED 2026-09-02 — it does.** `job_title` and `responsibilities` are live `text` columns on prod (`information_schema.columns`, ref `xygzykjyynhzqytbqnzu`), shipped via PR #728. They are **descriptive tenant data only**: `role`/`is_owner` remain the only enforced permission inputs, and the RPC that writes them cannot reach `permission`. The half of the original caution that still stands: **authenticated behaviour is still UNPROVEN** — no leg of the Team flow has been driven on the live authenticated platform, so do not report the end-to-end flow as verified.
- `app_role` has **no** `sales_lead` / `closer` / `appointment_setter` / `sdr` / `sales_ops`
  (only `sales_rep`). The owner-ruled sales catalog is entirely net-new.

## Migration state (6-slice plan, taxonomy doc §6)

R0 doc ✅ · **R1 inventory ✅** · R2a workflow-registry seam ✅ · R2b wrapper closure ⬜ ·
**R3a `match_paige_memory` ✅ fix shipped + boundary-proven** (2026-09-13, migration `20270304000000`; prod drive PROOF OWED §32.c/§70) · R3 rest of c1/c2 ⬜ ·
R4 backfill + dual-read ⬜ · R5 Class-A-only CHECK ⬜.
**Do not skip to R5** — the constraint is the end of the migration, not the start.

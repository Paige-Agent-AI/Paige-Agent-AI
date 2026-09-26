# Role Taxonomy & Matrix

**Owner-directed 2026-08-18:** *"We should make sure all of the roles are tenant scoped before we
move on. Everything about our platform needs a Taxonomy and Matrix. Some form of organization so we
can recall it whenever we need to."*

This is the **one home** (§18) for *who holds what authority, in which store, at which scope, and
who may grant it*. It is the role twin of `tier-matrix.md` (which answers *which account types
exist*) and `route-and-url-taxonomy.md` (which answers *which URL belongs to whom*). Cross-reference
those; do not duplicate them here.

Every number in §4 and §5 is a real query result against prod (`xygzykjyynhzqytbqnzu`) on
2026-08-18, not an estimate (§13).

---

## 0. Owner ruling — three roles authorize, titles describe (2026-09-26)

**This section supersedes the Class-B target state in §2 and §3. The superseded rows stay visible below, marked, because §58 forbids silently deleting a dated entry.**

- **The tenant role set is exactly `owner` · `admin` · `member`.** That set does not grow. Within a tenant, what a staff member may do comes from their tenant role, never from a title and never from a tenant-defined permission set. No tenant may define its own permission set. **This ruling does not touch the independent gates.** The platform operator tiers (`super_admin`, `platform_admin`, §53), the agency roles (`agency_team_members.agency_role`), and resource-scope relationships such as client assignment keep deciding access alongside the tenant role. Tenant-defined permissions, if ever needed, would be a separate explicit owner decision with its own design.
- **Coach holds no power anywhere.** It is not a role, not a permission, not a condition in any check, and not a selectable option on any screen or tool. It survives only as a title. The capability it carried becomes **a member reaches the clients assigned to them**. Assignment is a data relationship and replaces coach; nothing else does. Existing coach seats become `member` + title "Coach", with effective access proven identical.
- **A title is descriptive tenant data, never an authority input.** It describes what a tenant calls its people and what they do. No policy, function, gate or tool reads a title to decide access, and a CI check enforces this in the same PR as the first change that relies on it. Activity records must keep the title *as it was* when the action happened. **That is a requirement, not current behaviour:** nothing records it yet (today the title-change audit row carries no title), and it ships with the title work.
- **The word is "title"** (pending the owner's final word; alternative on record: "customized role"). The display term lives in one place.
- **Consequence for the other Class-B values:** `admin` is one of the three tenant roles, so its correct store stays `tenant_members.role`. A global `admin` grant reconciles there only when its holder's tenant is proven by an existing membership; any other global `admin` grant is investigated and retired (R4). None of the remaining Class-B values (`sales_rep`, `cs_rep`, `finance`, `viewer`, `moderator`, `developer`, `client`, `affiliate`, `broker`, `broker_team_member`) becomes a `tenant_members` role. This ruling names coach's retirement. How each of those other values is retired is **not decided here**; each needs its own decision.
- **Unchanged by this ruling:** Class A (§2) and the §7 standing rule. `user_roles` still holds only platform-global operator tiers, and nothing tenant-scoped is ever authorised from it.

Decision record: `docs/brain/decision-log.md` (2026-09-26).

---

## 1. The three role stores

The platform has **three** places a role can live. Two are correctly scoped. One is not.

| Store | Scope key | Grants authority over | Scoped? |
|---|---|---|---|
| `user_roles` | `user_id`, `role` — **NO tenant column** | Everything, everywhere | ❌ **GLOBAL** |
| `tenant_members` | `tenant_id`, `user_id`, `role`, `status`, `is_owner` | One tenant | ✅ tenant |
| `agency_team_members` | `agency_tenant_id`, `user_id`, `agency_role`, `status`, `scoped_subaccounts` | One agency (+ optional sub-account subset) | ✅ agency |

**The defect is structural, not accidental:** `user_roles` has no `tenant_id`, so *any* role stored
there is platform-wide by construction. `has_role(uid,'admin')` cannot mean "admin **of tenant X**"
— it can only mean "admin **somewhere**". This is the §59 *global-role trap*.

---

## 2. The taxonomy — every `app_role` value, classified

`app_role` has 15 values. They fall into three classes, and the class determines the correct store.

### Class A — PLATFORM-GLOBAL (correctly in `user_roles`)
Operator tiers. Global is the *intent*: they act across all tenants (§53).

| Role | Meaning | Correct store |
|---|---|---|
| `super_admin` | God tier. Grants any role. Bootstrap-only, invite-only via an existing super_admin. | `user_roles` ✅ |
| `platform_admin` | Delegated operator. Fleet/support/provisioning. Cannot grant super_admin, cannot pass `is_platform_owner()`. | `user_roles` ✅ |

### Class B — TENANT-SCOPED (currently mis-stored in `user_roles`)

> **SUPERSEDED IN PART by §0 (owner ruling, 2026-09-26).** The *"Correct store"* column below described a target in which these values become `tenant_members` roles. Only `admin` does, because tenant roles are exactly owner · admin · member; for `admin` the *Correct store* column still holds. `coach` is retired as a permission and survives only as a title. The retirement of the other values is undecided. The classification of these values as **tenant-scoped rather than platform-global** still stands.

These describe a person's authority **inside one business**. Global storage is a category error:
being "a coach" is meaningless without answering *whose coach*.

| Role | Meaning | Correct store |
|---|---|---|
| `admin` | Runs a tenant's workspace | `tenant_members.role` |
| `coach` | ~~Serves that tenant's clients~~ **Retired as a permission (§0); a title only** | ~~`tenant_members.role`~~ **none: a title, never a role** |
| `client` | An end customer **of** a tenant | `tenant_members` / `clients` linkage |
| `sales_rep` | Sells for a tenant | `tenant_members.role` |
| `cs_rep` | Support for a tenant | `tenant_members.role` |
| `finance` | Books for a tenant | `tenant_members.role` |
| `viewer` | Read-only within a tenant | `tenant_members.role` |
| `moderator` | Moderates within a tenant | `tenant_members.role` |
| `affiliate` | Refers into a tenant | tenant-scoped affiliate table |
| `broker` / `broker_team_member` | Broker vertical | tenant-scoped |
| `developer` | Build access to a tenant | `tenant_members.role` |

### Class C — BASELINE
| Role | Meaning | Note |
|---|---|---|
| `user` | Authenticated, no authority | Carries no grant; safe anywhere. Candidate for retirement. |

### Agency rail — a separate, already-correct axis
`agency_team_members.agency_role` is **not** an `app_role`. It is agency-scoped by construction and
is already right. Live values: `agency_owner`, `agency_admin`.

---

## 3. The matrix — scope × authority × grant path

| Role | Store | Scope | Who may grant | Gate helper |
|---|---|---|---|---|
| `super_admin` | `user_roles` | Platform | **Only** an existing super_admin (DB trigger enforced, §53) | `is_super_admin()` / `is_platform_owner()` |
| `platform_admin` | `user_roles` | Platform | **Only** a super_admin (same trigger) | `is_platform_admin()` / `is_platform_operator()` |
| `agency_owner` | `agency_team_members` | One agency | Agency owner / super_admin | `agency_current_id()` + `agency_team_role()` |
| `agency_admin` | `agency_team_members` | One agency | Agency owner | same |
| `owner` | `tenant_members` | One tenant | Tenant owner / provisioning | `is_tenant_member()` + role check |
| ~~`admin`, `coach`, `sales_rep`, … | `tenant_members` **(target state)** | One tenant | Tenant admin/owner | tenant-scoped check~~ |
| `admin`, `member` **(§0, 2026-09-26)** | `tenant_members` | One tenant | Tenant owner (admin/member only; nobody grants owner) | tenant-scoped check |

**Hard rule (§59):** cross-tenant authority is `is_platform_owner()` / `is_platform_operator()` —
**never** a tenant-level `app_role`. A function branching on `has_role(uid,'admin')` to permit a
cross-tenant action is a §9 leak, because that `admin` is global.

---

## 4. Current live state (prod, 2026-08-18)

Grants in `user_roles`:

| Role | Holders | Class | Verdict |
|---|---|---|---|
| `admin` | 9 | B | ❌ mis-scoped |
| `coach` | 3 | B | ❌ mis-scoped |
| `client` | 2 | B | ❌ mis-scoped |
| `user` | 2 | C | ⚠ baseline, harmless |
| `sales_rep` | 1 | B | ❌ mis-scoped |
| `super_admin` | 1 | A | ✅ correct |
| `platform_admin` | 0 | A | ✅ correct |
| all others | 0 | — | — |

**15 tenant-level grants sit in a global table.** Mitigating fact: most reads *also* filter by
tenant via RLS (`current_user_tenant_id()`), so this is a latent structural weakness rather than a
confirmed live leak. It is not proven safe either — that is exactly what §5's audit must establish
per call site.

---

## 5. Blast radius (why this is not a one-shot change)

Live prod objects referencing `has_role` / `has_any_role` / `user_roles`:

| Surface | Count |
|---|---|
| RLS policies | **186** |
| …across tables | **91** |
| Database functions | **118** |
| Migrations referencing | 244 |
| Edge functions | 68 |
| Frontend files | 33 |

This is the platform's authorization backbone. A wrong move in one direction locks every user out;
in the other it opens cross-tenant reads. **Therefore: no big-bang migration.**

---

## 6. Migration plan — safe slices

Each slice is its own PR with a §37 producer inventory, §32 proof, and §39 peer-gate.

- **R0 — This document.** Taxonomy + matrix + audit. No code. ✅ **DONE** (PR #537)
- **R1 — Classify every call site.** ✅ **DONE 2026-08-18** — `docs/audits/R1-role-call-site-inventory.md`.
  *(R2a, the one LIVE finding — the `paige_workflow_registry` platform seam — shipped with it.)*
  Original scope: Mechanically label all 186 policies + 118 functions as:
  (a) legitimately platform-global → migrate to `is_platform_operator()`;
  (b) already tenant-filtered → cosmetic;
  (c) **genuinely relying on a global tenant-role** → the real defects.
  Output: a checked-in inventory. Still no behaviour change.
- **R2 — Fix class (a).** Swap operator-intent checks to the operator helpers. Low risk, well-understood.
- **R3 — Fix class (c) defects**, highest-severity first, one family per PR.
  - **R3a — `match_paige_memory` ✅ FIX SHIPPED 2026-09-13** (migration `20270304000000`, §53/§59; deployed + persisted + boundary-proven, prod runtime PROOF OWED §32.c/§70). The confirmed
    §4c defect: closed the forged-ID self-reference bypass + the global-`admin` trap; per-target
    resource-scoped authority (cross-USER: self / `is_platform_operator`; staff cross-CONTACT via
    `can_access_contact`; the per-user coach/tenant-admin grant was dropped — §39 Finding 1, as
    `chat_message_embeddings` has no tenant column), per-branch data gating, bounded search params, and an
    explicit `service_role` trust branch so the legitimate `paige-ai-chat` path works. Boundary proof
    `supabase/tests/match_paige_memory_authz.sql`; evidence `docs/evidence/match-paige-memory-authz.md`.
    (The remaining c1 candidates + the c2 policy queue are NOT swept here — narrow, evidence-led slice.)
- **R4 — Backfill + dual-read, narrowed by §0 (2026-09-26) to `admin` only. Do not execute the struck plan for any other value.** ~~Ensure every Class-B grant exists in `tenant_members`; make helpers
  read tenant-scoped first, global second. Reversible.~~ **`admin` keeps the original reconciliation, but only where the tenant is proven.** It is one of the three tenant roles, so a global `admin` grant is reconciled into `tenant_members.role` only when its holder already has a matching active owner or admin membership. `user_roles` carries no tenant, so that membership is the only evidence of which tenant the grant belongs to. A global `admin` grant with no such membership is **never** turned into a new membership, because that would invent tenant authority. It is investigated and retired. Helpers read the tenant-scoped grant first and the global one second. Reconciling the proven grants and retiring the unproven ones is what makes the R5 constraint safe. **Every other Class-B grant does not move into `tenant_members`**, because none of those values becomes a tenant role. For them, R4 is a **per-value retirement**, one decision per value. `coach` is ruled: the seat becomes `member` + title "Coach", and access comes from client assignment, with effective access proven identical before any grant is removed. Every other Class-B value is **undecided** and stays as it is until its own decision.
- **R5 — Cut over and constrain.** Once no reader depends on global Class-B roles, add a DB CHECK so
  `user_roles` accepts **only** Class-A roles. Structural, not conventional (the §51/§53 pattern).

**Do not skip to R5.** The constraint is the *end* of the migration, not the start.

---

## 7. The standing rule

> A role in `user_roles` is a claim about the **platform**. A role in `tenant_members` is a claim
> about **one business**. Only Class-A operator tiers belong in the former.

**The test, every time:** *"Does this role mean something without naming a tenant?"* If it does not,
it is tenant-scoped and must not be authorised from `user_roles`.

**Cross-references:** §9 (tenant isolation) · §51 (tier matrix — the account-type twin) · §53
(operator tiers, grant lockdown) · §59 (SECURITY DEFINER caller scope; the global-role trap) · §37
(producer inventory) · `tier-matrix.md` · `route-and-url-taxonomy.md`

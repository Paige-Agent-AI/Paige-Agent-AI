# Team Ownership & Authority Lifecycle handoff

**Status: UNAVAILABLE / future Team workstream.**

**Owner, 2026-10-23:** the EXP08 *Manage My Team / Team Hub* lead (Claude Code) receives this
lifecycle. Receiving it does not make it available and authorizes no ownership transfer. Team Hub
roles, invitations and offboarding keep the existing owner/admin/member taxonomy and the existing
last-owner guard (`revoke_co_owner`). **Since `20271116020008` (2026-10-26, provisional owner default):** only the
account holder of record (or the platform owner) grants or revokes co-ownership, and nobody revokes the
account holder through `revoke_co_owner` — moving the holder is the ownership transfer this lifecycle owns. Any transfer of workspace ownership still needs the full
contract below and an exact owner authorization first. Current Team source:
[surface card](../doctrine/surface-cards/team.md#current-source-and-ownership--exp08-receiving-lead-2026-10-23).

Solo Setup now records owner-provided business ownership facts and may designate an existing active
Team person as a human representative. Those facts never create a Team member, invite anyone, grant
Admin, grant workspace Owner, change an existing role, or transfer platform authority.

An owner who needs to grant or transfer actual workspace authority must be routed to this future
Team-owned lifecycle. That workstream must define, at minimum:

- Current-owner authentication and reauthentication requirements
- Recipient eligibility and active membership requirements
- Acceptance, cancellation, expiry, retry, and recovery states
- Single-owner versus multi-owner rules
- Server-enforced role transition and rollback behavior
- Notification and attributable outcome contracts
- Billing, legal, and provider dependencies without letting any one of them silently imply access
- Tenant-switch and stale-request protection
- Owner-visible audit/Rail treatment through the established shared contracts

Setup must not implement any of those transitions. Business ownership percentages are optional
owner-provided facts, are not legal validation, and never imply that stored interests total 100%.

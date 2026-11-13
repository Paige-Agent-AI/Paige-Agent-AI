---
version: 1
slug: "src-solo-social-command-tsx"
primary_target: "src/solo/social-command.tsx"
related_targets: ["src/solo/publish-piece.tsx", "src/solo/social-command.css"]
---

# Social — the visual publishing desk

Mode: Operate. Existing PAIGE SOLO world; no system redesign. The owner approved concept A directly on November 11, 2026: “Approve A — Visual desk (Recommended)”. Approved comp: `.impeccable/mocks/exp07-visual-social-20261111-a.png`; its canonical prompt sidecar records approval. B/calendar and C/campaign remain contextual views of the same original records, not parallel products.

## Direction contract

THESIS: Work with the actual post. Media, exact account, saved version, approval and original result occupy one recoverable workspace. Replace the current wall of unavailable counters with the visual desk.

OWN-WORLD: Preserve incumbent Mineral/Obsidian tokens, Schibsted Grotesk, PAIGE Command Mark, existing NEXUS magenta Megaphone, quiet dividers and familiar controls. A customer works in ordinary daylight at a laptop or phone; theme follows the existing choice.

STORY: Create or open a saved post; revise its actual media/caption; review the exact destination; approve once; return to the same receipt and available performance. Minimize/reopen preserves the original work.

FIRST VIEWPORT: Incumbent navigation/header and Marketing tabs. Social title/NEXUS and Create post lead into compact filters. A two-column media desk fills the remaining left area; selected work occupies a wide right pane, with Expand, Minimize and Close, exact destination, Post/Versions/Result, readable media and caption, Review exact post and Save draft. Narrow screens use one full-width workspace with a clear return.

FORM: Owner-pinned visual desk, first of the three requested structures; direction key `owner-pinned-exp07-visual-publishing` (assigned, no random seed claimed). The generated comp is composition authority; sample names/posts/metrics are design material, never production facts. Show website artifacts separately, and render real post statuses, media limitations and unknown metrics honestly. The comp's review strip does not ship in product UI.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Flow prototype brief

Goal: one real saved media post becomes one approved publication and a recoverable original result.
Human and feel: permitted SOLO owner/admin, with clear control over destination and consequence.
Entry and exit: Social/Content/Calendar/original Campaign link or either chat; return to the same post and originating context.
System: existing React SOLO shell, compact working density, incumbent tokens and accessible controls.
Signature: the selected post retains identity through wide pane, expanded work and minimized return.
Feedback: one short pane-continuity transition; immediate controls; reduced motion removes travel; no autoplay/audio or browser vibration.
Rejecting: fabricated progress/performance and a new publish/approval/analytics engine.
Variants: read-only member; absent/ambiguous/revoked connection; unsupported media/platform; phone full workspace.

## State and transition map

| From | Trigger/guard | To/container | Recovery/exit |
| -- | -- | -- | -- |
| Desk | Create/open original post | Saved draft in wide pane | Close/return preserves original draft |
| Draft | Edit caption/media/order | Unsaved draft inline | Save same original; explicit discard if closing unsaved changes |
| Draft | Save succeeds | Saved revision | Reopen same post/version; failed save retains edits |
| Any workspace | Expand/minimize/reopen | Same post full workspace/return control | Focus follows deliberate action; no resave or dispatch |
| Saved draft | Review exact post; supported media/account | Exact original proposal in workspace | Back to edit invalidates old approval; cancel leaves draft |
| Review | Actor approves once | Original attempt, truthful processing | Duplicate controls disabled; no replay on reopen |
| Processing | Verified provider result | Published original receipt/result | View original public post; close/reopen retained |
| Processing | Timeout/lost reply | Unknown original attempt | Check same attempt only; new send refused |
| Review | Expired/stale version/revoked authority | Refusal inline | Re-read actual permission/version/account; fresh review |
| Desk/workspace | Loading/empty/error/offline | Honest local state | Retry read; retain local edits; never imply a send |
| Read-only member | Open post | Restricted projection | No publish authority or private provider identifiers |
| Result | Metrics available/stale/pending/unsupported/error | Source-timed readback | Never turn missing into zero; no provider fetch per render |

Prototype network, persistence, approval, publication and metrics are deterministic local simulations, labelled outside product chrome. Native haptics are N/A for this web surface. Production implementation retains original server authority; prototype approval is not provider or live-post approval.

## Owner-approved post scheduling amendment — November13

The owner approved removing the unused Marketing Calendar tab and putting Publish now / Schedule for later inside the same original post workspace. The existing Clients Calendar remains appointment-focused: an optional Marketing layer is hidden by default, projects the SAME original schedule identity, and never reserves appointment availability. This is the same approved Visual Desk direction, not a second calendar or scheduler. Exact original EXP05 scheduling/calendar and shared-source handbacks remain pending at this design checkpoint.

The post review must show the actual mode, precise date/time and timezone beside the existing exact caption/media/destination; the server rejects a past or invalid instant rather than silently publishing now. Editing any approved field requires the original fresh review. A saved plan is not a scheduled post; existing planning records, including unlinked notes, must retain a usable original reader without being converted to sends. Retire the old tab and only genuinely obsolete overlapping UI when its replacement is complete.

| From | Trigger/guard | To/container | Recovery/exit |
| -- | -- | -- | -- |
| Saved draft | Choose Schedule for later | Original post's time controls | Return to Publish now removes schedule intent; no send |
| Scheduled draft | Exact future time resolves in shown timezone | Original exact approval | Invalid/past/nonexistent local time refuses inline; source edits invalidate review |
| Approved scheduling | Original authoritative scheduler/provider confirms | Scheduled original receipt | Scheduled never means Published; same original identity reopens |
| Scheduled original | Explicit approved edit/reschedule/cancel | Same original schedule/receipt | Confirmation/readback of that change; lost answer remains unknown, no replay |
| Clients Calendar | Opt into Marketing layer | Minimal permitted original schedule projection | Hide restores appointment-only view; same post opens; no appointment/event copy |

These amended states are design/receiving scope only until the actual shared contract is implemented and checked. No future post, provider effect, source-access expansion or rendered/authenticated PASS is authorized or claimed here.

## Original Conversations dependency

The owner's November 11 amendment adds supported public comments/replies and private DMs through the existing SOLO Conversations path: `src/solo/conversations.tsx` → `Inbox2` → `useConversations` → original `public.messages`. EXP07 supplies verified Social account/post/activity context and readiness; EXP03 retains original ingestion, durable thread identity, reply authorization/sender, claim/finalize/reconciliation and CRM linkage. EXP10 retains shared connection/scopes/Vault. The exact receiving/thread/reply ABI is not yet implemented or leased, and EXP03's selected Opportunity work remains selected. A generic navigation link does not prove this integration. Public comments stay public; DMs stay private; inbound is untrusted; display names do not establish CRM identity; private Social content is never automatically disclosed to shared Hub channels. No simulated Conversations sender or substitute store ships from this prototype. Original handoff and corrected SOLO source acknowledgment remain in the existing ANT-147 discussion.

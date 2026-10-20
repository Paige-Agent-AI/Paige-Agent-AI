# Calendar, Conversations, and spatial workspace integration

**Evidence date:** 2026-08-22  
**Prototype:** `/tenant-redesign`

> **Current mounting correction, 2026-10-13:** The ruling below is the dated2026-08-22 prototype record. Current SOLO mounts `TenantCanonicalCalendarWorkspace` → `SoloCalendarWorkspace`/`useSoloCalendar` under Clients; `CalendarAdmin` remains an existing implementation and owner-personal Planning overlay precedent. E5 recurring commitment visibility must consume the same owner-only canonical process status as Chat, separately from `list_team_bookings`. A process marker has no booking identity, duration or occupancy, and a booking grants no autonomous authority. Execution stays on the existing process scheduler/Harness/Rail; owner business-zone display is distinct from the approved schedule zone. E5's new projection/prototype is unmounted preparation, not resolution of the booking Rail/Mind FU-3/#786 boundary. Current inventory, reviews and activation holds: `../delivery/experience-05-weekly-commitment-check.md`.

## Canonical capability ruling

- `CalendarAdmin` remains the single connected scheduling and time-commitment implementation. Calendar lives under **Work** with Calendar, Agenda, Availability, Booking Pages, Connections, and Settings views. Tasks, reminders, deadlines, appointments, blocked time, and commitments are object types or filters—not new primary destinations.
- `ClientsConversations` remains the connected tenant messaging surface at **Clients / Conversations**. The Solo conversation composition is useful design evidence but is not a second inbox or data model.
- The supplied snapshot (11 calendars, 4 hosts, 3 internal bookings, 1 staff setting, 3 planning items, 2 legacy task rows, and 8 messages) is dated audit evidence. It is not embedded as live UI data, except where copy explicitly says “supplied audit.”

## Implementation

The public prototype provides an authored, data-honest anatomy for both instruments and an explicit **Mount canonical component** control. That control lazy-loads the real `CalendarAdmin` or `ClientsConversations` component inside the PAIGE shell; it does not iframe or rebuild the connected implementation. An unauthenticated reviewer receives the canonical component’s real loading, empty, authorization, or error behavior rather than fictional records.

Calendar anatomy covers day/week/month controls, task visibility, unified event shapes, contextual filters, selected appointment/task inspectors, PAIGE preparation, Agenda, Availability, Booking Pages, Connections, Settings, and an execution strip. Conversations anatomy covers list/search/filter, selected thread, PAIGE draft/edit/approval, attachments, dictation, schedule, relationship inspector, audience boundary, and conversion to task/event/note/deal/workflow/portal action.

## Spatial workspace model

Navigation has three persisted states: expanded, compact, and canvas. Canvas mode has a visible top-bar restore control and `Ctrl/Cmd + \\` cycles modes. At smaller laptop widths the initial mode is compact or canvas; user preference wins after selection.

PAIGE defaults closed rather than occupying permanent workspace width. The approved Command Mark in the top bar opens the contextual drawer, `Ctrl/Cmd + J` opens PAIGE, full focus remains available inside PAIGE, and work count remains visible when closed. Conversation draft state remains in the shell when PAIGE closes.

Selected surfaces can use **Open in new workspace**. The prototype opens the same authenticated route with a shared workspace-session identifier and synchronizes theme, destination, view, and navigation preference through `BroadcastChannel`. The server remains responsible for authentication, tenant/role/RLS, Trust authority, live updates, idempotency, and approvals. The browser channel never authorizes an action or carries protected records.

## Backend truth and limitations

| Surface | Repository truth | Prototype status |
|---|---|---|
| Calendar | Live `CalendarAdmin`, tenant hooks/RPCs/realtime/planning overlays | Real component mount available; authored anatomy is representative |
| Conversations | Live `ClientsConversations` and messaging/send seams | Real component mount available; authored anatomy is representative |
| Detachment | Same authenticated application can open another window | Context synchronization implemented; production event/data synchronization remains canonical backend responsibility |
| Legacy tasks | Parallel legacy rows reported | Not merged or presented as canonical |
| Future/empty stores | Reported empty in supplied audit | Not represented as live |

No send, booking, status mutation, task creation, approval, or destructive action is wired from the anatomy layer.

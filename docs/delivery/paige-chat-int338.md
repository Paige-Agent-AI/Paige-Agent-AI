# INT-338 — canonical Chat clipboard and composer drop

Parent INT-304. Dependency INT-336 accepted MERGED + DEPLOYED, DEL-118; authenticated production owner acceptance owed. Owner approved INT-338 intended behavior and implementation2026-10-07. Fresh base3daf4360a01171cee107089e592ccd6f88a74525 (Sales#1809 changes do not overlap Chat). SHELL: SOLO; FLOW-BY-FLOW: APPLIED; IMPECCABLE: APPLIED; independent non-author exact-head review required before merge.

## Reuse and ownership

Picker, actual clipboard files and composer drop all call stageFiles → the existing processFile in useChatDocumentUpload → the same AttachedDocument. No additional parser/store/base64 processor/send path. PDF/JPEG/PNG/WEBP/DOCX and10MB remain. DOCX extraction, errors and chip remain canonical. A known explicit unsupported MIME cannot bypass the validator using a supported filename; missing/generic MIME retains extension fallback with accurate JPEG/WebP type.

Complete requested composer identity (tenant/user/thread/client/mission) keys preparation. Scope epoch plus selection generation fence every await, error and settlement. Scope changes hide old state immediately, including A→B→A; remove/clear/unmount/new selection invalidate delayed bytes and stale toasts. Send takes one prepared attachment using existing attachmentSubmissionRef and canonical streamTurn. Pending bytes guard button and same-tick Enter; text stays writable. Stop leaves the independent unsent draft/file preparation in the same scope.

## Clipboard and drop contract

- Text/URL/rich HTML without actual File payload remains native text; no clipboard URL fetch.
- Actual File payload wins over associated text/HTML representation; preventDefault avoids duplicate text. Browser files list takes precedence over item fallback, avoiding duplicate representations.
- One staged file. Multi-input chooses first supported file within limit and announces the one-at-a-time contract; if none qualifies, first file gets the canonical refusal. Intentional replacement is announced and prior chip remains until successful preparation.
- Only composer stages drops. Its restrained temporary overlay says “Drop to attach”. Surrounding chat chrome refuses file navigation and tells the user to drop on the message box; plain text dragging remains native. Nested child leave does not flicker; leave/drop/Escape/scope change clears the affordance.
- No automatic submit, focus move or unsent-file persistence. Existing paperclip remains keyboard accessible; preparation and chip announcements use a polite status region.

## Protected INT-336 / C4

PAIGE working does not disable text or file staging. New text+file Send uses the same canonical interactive request fence and supersedes the previous request; stale bytes cannot append and one attachment belongs to the new instruction. Stop is separate and preserves next draft/file. Existing executor, completed-effect, outcome_unknown, approval fingerprint, explicit ASK_USER and durable-work contracts are unchanged. A file beside ASK_USER is explicitly sent as a new message and does not bind an answer. No Live transport or server edit.

## Flow-by-Flow

| Flow | Proof / disposition |
|---|---|
| F1 plain text paste | Native clipboard Ctrl+V in real-component local Chromium, no file chip; hook leaves text/URL/HTML default insertion |
| F2 clipboard image | Native generated PNG clipboard + Ctrl+V stages canonical image bytes/chip |
| F3 file drag | Real hook PNG/PDF/DOCX test; PDF DataTransfer drop in component browser |
| F4 no auto-send | Paste/drop request counts unchanged before Send |
| F5 chip/remove | Browser remove preserves text; hook clear invalidates delayed result |
| F6 oversized | Same10MB error on picker/paste/drop; exact boundary accepted |
| F7 unsupported | Same canonical unsupported-type error, explicit MIME mismatch refused |
| F8 multiple | First valid bounded file + one-at-a-time feedback, no invisible backlog |
| F9 ordinary typing | Chip persists; focus/input measured while Thinking at five viewports |
| F10 send once | Real component same-tick duplicate click results in one document successor; preparation blocks premature Enter |
| F11 interrupt with file | Prior signal aborted; requestIntentId bound supersession; delayed old SSE tail absent |
| F12 Stop | Local browser/component retains next draft and staged PDF; no implicit durable cancellation |
| F13 thread switch | Delayed file result fenced; requested scope hides chip, no foreign send |
| F14 workspace switch | Delayed file/error fenced; client/mission/user share complete key; ABA tested |
| F15 approval/ASK_USER | Existing approval/ASK suites plus actual pasted/dropped file send carries no answer/approval binding |
| F16 mobile/touch |390x844 local component text16px, no overflow, reachable input/chip/Stop/Send; physical keyboard/touch acceptance owed |

All browser/component proof above is local scripted-history/model evidence, not authenticated production. Existing long owner thread, real PAIGE image response, two signed-in tenants, full shell closed/open and physical device acceptance remain PROOF OWED if infrastructure blocks them.

## Architecture and release boundary

Chat input UX and composer draft seam only. Canonical records, Spine, Harness, orchestration, Trust authority, Rail, Metric/Evidence runtime, Memory, Knowledge/Second Brain architecture, Mind, providers: no engineering change. Existing attachment processor reused. No new tier or external connection. #1807 reconciliation/crash-held executor debt excluded. Multi-file and unsupported-media expansion parked.

Development proof: original29 cases moved from8 PASS/21 FAIL to29 PASS; four extra processor cases pass;9 real-composer cases pass; same-tick and two ASK cases added. Protected suite143 PASS; hook/approval/turn/legacy suite101 PASS. Build, product ESLint and Impeccable detector PASS. Final head, exact review/CI, PR, merge/deployment/source readback and authenticated boundary will be added at delivery; no customer version/announcement or inferred DEL.

After this bounded hotfix, saved sequence remains C4d durable-work resume/terminal failure then C4e Deep Research on canonical paige_durable_work; no implementation of those in INT-338.

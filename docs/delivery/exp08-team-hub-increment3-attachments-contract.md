# EXP08 Team Hub increment 3: attachments contract

Status: building.

Owner decisions are recorded 2026-10-24 in the decision log, under "EXP08 Team Hub increment 3". This increment:

- reuses the private `comms-attachments` bucket under a Team Hub path;
- adds one EXP08 file-record table;
- adds restrictive storage policies, so only people who can see the conversation can upload or read;
- uses 60 s signed URLs;
- adds the Team Hub prefix to account retirement;
- adds no new bucket;
- ships without malware scanning, under these conditions:
  - safe types only;
  - 10 MB per file and 5 per message;
  - the server checks the real type;
  - downloads are served as attachments;
  - the UI and docs say files are not scanned.

Every rule in the increment-1 and increment-2 contracts still holds. The design follows approved prototype v2 (§28).

## 1. Scope

A teammate in a canonical SOLO workspace can:

1. **Attach files** to a message or a thread reply, using the paperclip in the composer or by dropping files onto it.
   - Up to 5 files per message, each 1 byte to 10 MB.
   - Each file shows as a chip that goes through four states: *Uploading…*, *Checking…*, ready, or refused with the reason.
   - A chip can be removed before sending.
   - A message may be files only, with no text.
2. **See files on messages.** Each file shows as a row with:
   - a type glyph;
   - its name and size;
   - a **Download** action.

   Images (PNG, JPEG, WEBP, GIF) also get a small thumbnail.
3. **Download** a file. Each download mints a fresh 60-second signed URL served as an attachment (`Content-Disposition: attachment` with the original name).
4. **Read the disclosure.** It sits next to the paperclip and in the file row's accessible description: *Files aren't scanned for viruses. Only open files from people you trust.*

### Allowed types

The server checks each file's real type:

| Type | Extensions | Declared MIME | Real-type check (bytes) |
|---|---|---|---|
| PDF | .pdf | application/pdf | starts `%PDF-` |
| PNG | .png | image/png | 89 50 4E 47 0D 0A 1A 0A |
| JPEG | .jpg .jpeg | image/jpeg | FF D8 FF |
| WEBP | .webp | image/webp | `RIFF` + `WEBP` at offset 8 |
| GIF | .gif | image/gif | `GIF87a` / `GIF89a` |
| Word | .docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | ZIP `PK\x03\x04`; contains entries `[Content_Types].xml` and `word/document.xml`; contains no `vbaProject.bin` |
| Excel | .xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | ZIP `PK\x03\x04`; contains entries `[Content_Types].xml` and `xl/workbook.xml`; contains no `vbaProject.bin` |
| Text | .txt | text/plain | valid UTF-8, no NUL byte |
| CSV | .csv | text/csv | valid UTF-8, no NUL byte |

**Not allowed, stated in the UI:**
- **Legacy `.doc` / `.xls` (OLE).** They can carry macros, and nothing here can inspect that without scanning.
- **PowerPoint.** The shared bucket does not accept it, and widening the bucket would also change Inbox uploads.
- Anything else.

## 2. Storage

- **Bucket:** `comms-attachments` (existing, private, 10 MB, MIME allow-list unchanged).
- **Object path:** `<tenant_id>/team-hub/<file_id>`.
  - Exactly three segments, all lowercase.
  - `file_id` is the `team_hub_files.id` uuid. The server builds the path and the client never chooses it.
- **Restrictive `storage.objects` policies.**
  - They apply `TO authenticated` and are AND-ed with the existing permissive `comms_attach member *` policies.
  - Each one applies only when `bucket_id = 'comms-attachments' AND (storage.foldername(name))[2] = 'team-hub'`. For every other object, each policy is `true`.

  | Policy | On the Team Hub prefix |
  |---|---|
  | `team_hub_files_insert_boundary` (INSERT, WITH CHECK) | `public._team_hub_file_can_upload(name)` |
  | `team_hub_files_select_boundary` (SELECT, USING) | `public._team_hub_file_can_read(name)` |
  | `team_hub_files_update_boundary` (UPDATE, USING and WITH CHECK) | `false`: no overwrite, no rename into the prefix |
  | `team_hub_files_delete_boundary` (DELETE, USING) | `false`: only the service role removes Team Hub objects |

  These policies also stop the platform owner and agency standing, which the permissive policies admit, from reaching Team Hub objects. The service role bypasses RLS.
- **`_team_hub_file_can_upload(name)`**
  - SECURITY DEFINER, `search_path=''`. EXECUTE to `authenticated` only.
  - True only when:
    - the caller passes `_team_hub_refusal(folder[1])` (active seat, SOLO, current workspace equals the path's tenant);
    - a `team_hub_files` row exists with `storage_path = name`, `uploaded_by = auth.uid()`, `state = 'pending'` and `created_at` within the last day;
    - its channel is still visible to the caller.
- **`_team_hub_file_can_read(name)`**
  - Same security posture.
  - True only when:
    - the refusal check passes for `folder[1]`;
    - a row exists with `storage_path = name`, `state = 'ready'` and a non-null `message_id` whose message has `deleted_at IS NULL`;
    - its channel is visible to the caller now.

    A person removed from a private channel loses read access at once.
- **Email exclusion.** `send-message` refuses any attachment path that starts with `<tenant>/team-hub/`. A Team Hub file can never be attached to an outbound email by path.

## 3. Table `team_hub_files` (additive)

| Column | Notes |
|---|---|
| `id uuid` | Primary key, `gen_random_uuid()` |
| `tenant_id uuid` | |
| `channel_id uuid` | References `team_hub_channels` |
| `uploaded_by uuid` | |
| `client_request_id uuid` | Unique `(uploaded_by, client_request_id)` |
| `storage_path text` | Unique; equals `<tenant_id>/team-hub/<id>` (check) |
| `file_name text` | 1–255 characters; no `/`, `\` or control characters (check) |
| `mime_type text` | One of the 9 allowed (check) |
| `size_bytes bigint` | 1–10485760 |
| `state text` | `pending` · `ready` · `rejected` · `discarded` |
| `rejected_reason text` | Set only when rejected |
| `message_id uuid` | References `team_hub_messages`, `ON DELETE CASCADE`; only when ready |
| `created_at`, `checked_at`, `posted_at` | `timestamptz` |

- A scope trigger requires `tenant_id` and `channel_id` to match the channel, and to match the message when one is set.
- RLS is on with no policies, and there are no browser grants.
- Retirement disposition is `delete` (A10). The bytes are purged by the `team_hub_files` retirement provider (§6).

## 4. Functions

All are SECURITY DEFINER with `search_path=''` and return `{ok, code}`. They reuse the increment-1 refusal codes and add three new ones:
- `too_large`: over 10 MB;
- `limit_reached`: more than 20 unposted files in the last day for this person;
- `rejected`: the real type does not match.

### For the browser (`authenticated`)

- **`team_hub_begin_file(p_expected_tenant, p_channel_id, p_name, p_mime, p_size, p_client_request_id)`**
  - Returns `{ok, file:{id, path, name, mime, size, state}}`.
  - Checks:
    - the door (the increment-1 workspace and seat check);
    - the channel can be seen (`not_found`);
    - the name, and that the extension matches the MIME type (`invalid`);
    - the size (`invalid` / `too_large`);
    - the unposted limit (`limit_reached`).
  - Idempotent on `(uploaded_by, client_request_id)`: a retry returns the same row; the same id in another conversation returns `invalid`.
- **`team_hub_file_for_check(p_expected_tenant, p_file_id)`**
  - Returns `{ok, file:{id, path, mime, size, state}}`.
  - Only for the uploader. Requires the door, a visible channel, and `state` of `pending` or `ready`.
  - The `team-hub-file` edge function calls it with the caller's JWT before it reads any bytes.
- **`team_hub_discard_file(p_expected_tenant, p_file_id)`**
  - Returns `{ok, path}`.
  - Only for the uploader, and only on an unposted file. Sets `discarded`.
  - Idempotent: a file already discarded returns the path again.
- **`team_hub_post_message`** is replaced by the same function with an extra trailing parameter, `p_file_ids uuid[] DEFAULT '{}'`. The 6-argument version is dropped; `team_hub_request_task`'s 6-argument positional call resolves to the new one.
  - With files, the body may be blank.
  - 0–5 distinct ids. Each file must be:
    - `ready`;
    - uploaded by the caller;
    - in this channel;
    - not yet posted.

    Otherwise the result is `invalid` and nothing is stored.
  - Files are locked `FOR UPDATE` and stamped with `message_id` and `posted_at` in the same transaction as the message.
  - A retry returns the original message with its files.
- **`_team_hub_message_json`** gains `files: [{id, name, mime, size, path}]` in posting order (`[]` when there are none). The path is needed to mint the signed URL. Reading the object still requires the read policy.

### Service role only

- **`team_hub_file_verdict(p_file_id, p_uploader, p_detected_mime, p_accept, p_reason)`**
  - Requires `state = 'pending'` and `uploaded_by = p_uploader`.
  - Accepts only when all of these hold:
    - `p_accept` is true;
    - `p_detected_mime` equals `mime_type`;
    - `storage.objects` has the object with `owner_id = p_uploader`, `metadata->>'size' = size_bytes` and `metadata->>'mimetype' = mime_type`.

    It then sets `ready` and `checked_at`. Otherwise it sets `rejected` with the reason.
  - Returns `{ok, state}`.
- **`team_hub_claim_stale_files(p_uploader)`**
  - Marks the uploader's own `pending` files older than one day as `discarded`, and returns their paths so the edge function can remove the objects.

## 5. Edge function `team-hub-file`

`verify_jwt = true`. It takes `POST {action, expected_tenant, file_id}`, and every action runs under the caller's own JWT first.

- **`finish`**:
  1. Calls `team_hub_file_for_check` with the caller's JWT. A `ready` file returns as it is.
  2. Downloads the object with the service role. A missing object is `not_uploaded`.
  3. Sniffs the bytes with `_shared/team-hub-file-type.ts`, as in the table in §1.
  4. Calls `team_hub_file_verdict`.
  5. On rejection, removes the object.
  6. Then sweeps that caller's stale files (`team_hub_claim_stale_files`, followed by removal).

  Returns `{ok, file}` or `{ok:false, code:'rejected', reason}`.
- **`discard`**: `team_hub_discard_file` with the caller's JWT, then removal by the service role.
- **Response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- **Logging:** never logs file names or bytes, only reason codes.

## 6. Account retirement

A new storage retirement provider, `team_hub_files`, modelled on `generated_media`, purges `<tenant>/team-hub/*` in `comms-attachments`.

- **Manifest:** strict path regex, at most 100 objects, refuses anything else.
- **Guard trigger:** refuses new Team Hub objects once the account is archived or paused.
- **Branches** in fingerprint, ready, claim, assert and finish.
- **Retirement flow:** preview treats Team Hub objects as supported, begin plans them, and read lists them.
- **Edge:** a provider entry in `operator-account-retirement`. Readback lists only the `<tenant>/team-hub/` sub-prefix, never the tenant's whole folder.

Other comms objects in the same bucket stay deletion blockers, exactly as today. That gap predates this increment and is outside its scope.

## 7. Interface

The composer gains a paperclip button between @ and /. It has a hidden file input whose `accept` attribute is the allowed extensions.

**File chips:**
- Each chip shows name, size and state, with Remove.
- A refused chip says why: *That file type isn't allowed*, *Over 10 MB*, *Its contents don't match its type*, *5 files per message*.
- Send is enabled once every chip is ready, or once the refused chips are removed.
- Send stays disabled while any chip is uploading or checking.

**Message file rows:** surface, hairline and rim, following the increment-2 task card. Download is a neutral button, never gold.

**Disclosure:** quiet text under the chips. The paperclip's tooltip and accessible name read *Attach files (not scanned)*.

**Behaviour and accessibility:**
- Keyboard-complete, with a single announcer: *Uploading 2 files*, *File ready*, *File refused: …*.
- Esc in the composer does not discard the chips.
- Download mints a fresh URL on every click. A failed mint says *Couldn't get the file. Try again.*

## 8. Proof owed

**SQL proof** (disposable PG16, with a minimal `storage` schema stub copied from Supabase's definitions):
- `begin` validation, idempotency and the unposted limit;
- each storage policy:
  - the uploader can insert only their own pending path;
  - another member, a non-member, another workspace and the platform owner are refused;
  - UPDATE and DELETE are refused;
  - a non-Team-Hub comms path is unaffected;
- `verdict` accept and reject, including the metadata size/MIME mismatch and the wrong uploader;
- `post` with files: 0–5, not ready, someone else's file, another channel, already posted, retry;
- read after posting: a visible member can read; a removed private member, a non-member, another tenant and the owner cannot;
- `discard`;
- `request_task` still posts;
- the A10 disposition.

Mutation-tested.

**Unit tests:**
- the sniff module, with real minimal byte fixtures for every allowed type plus mismatches (a docx that contains `vbaProject.bin`, an OLE `.doc`, a NUL byte in text, a renamed executable);
- the `send-message` exclusion;
- the retirement provider (manifest and handler tests).

**Vitest, mocked RPC:**
- chips, limits and refusals;
- the files-only send;
- download minting;
- the disclosure.

**Rendered harness:** the four viewports with PAIGE closed and open, both themes, plus the phone.

**Authenticated drive** on the owner-designated SOLO account: owed.

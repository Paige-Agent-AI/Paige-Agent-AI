// E09 Documents — the ONE way Paige changes whether a client can see a file that stays on the same
// client: public.client_file_set_client_share (migration 20271110070000), through the CALLER's
// client. That function is SECURITY DEFINER and re-proves actor, current workspace and business
// admin from auth.uid() (§59), so nothing here grants authority: the expected actor is the verified
// session user and the expected tenant is the server-resolved persona tenant. No model argument can
// name either; a forged `tenant_id` is never read.
//
// Re-filing a document onto ANOTHER client (or rewriting its description) moves it with a direct
// write through the caller's client that NEVER touches visibility (refileClientDocument). The
// database refuses any non-service write into or out of 'shared' that is not the share writer
// (trg_client_files_share_stamp, FILE_SHARE_WRITER_REQUIRED), and refuses any signed-in move of a
// SHARED file to another client (FILE_SHARED_MOVE_REFUSED): that would take the file away from the
// client who has it with no record. So a shared file is first withdrawn through the share writer
// (one client_unshare audit row) and only then moved, private. Whether the new client sees it is
// decided by the share writer alone, at the version the move produced: business admin, live
// client, finished upload, audited.

export type FileDocumentSource = {
  id: string;
  contact_id: string;
  visibility: string;
};

/** Which writer a crm_file_document call needs. Pure: no I/O, no authority. */
export type FileDocumentRoute = "refuse_client_upload" | "share" | "refile";

export function routeFileDocument(
  doc: FileDocumentSource,
  destinationContactId: string,
  description: unknown,
): FileDocumentRoute {
  // What a client uploaded is their record of what they sent. Never relabelled, never moved.
  if (doc.visibility === "client_upload") return "refuse_client_upload";
  const sameClient = typeof doc.contact_id === "string" && typeof destinationContactId === "string"
    && doc.contact_id.toLowerCase() === destinationContactId.toLowerCase();
  const describes = typeof description === "string" && description.trim().length > 0;
  return sameClient && !describes ? "share" : "refile";
}

export type ClientFileShareFailure =
  | "no_workspace" | "bad_request" | "scope_changed" | "not_for_account" | "not_found"
  | "client_upload" | "not_ready" | "client_not_found" | "changed" | "refused" | "outcome_unknown";

export type ClientFileShareResult =
  | { success: true; fileId: string; shared: boolean; replayed: boolean; sharedAt: string | null;
      updatedAt: string; portalConnected: boolean | null }
  | { success: false; reason: ClientFileShareFailure; message: string; writeAttempted: boolean;
      currentUpdatedAt?: string };

export type ClientFileShareCaller = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  readFile: (fileId: string, tenantId: string) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const CLIENT_FILE_SHARE_MESSAGES: Record<ClientFileShareFailure, string> = {
  no_workspace: "I can't tell which workspace this file is in, so I haven't changed who can see it.",
  bad_request: "That request wasn't complete, so I haven't changed who can see the file.",
  scope_changed: "Your workspace or role changed, so I haven't changed who can see the file. Check you're in the right business and try again.",
  not_for_account: "This account doesn't keep files on client records, so there's nothing to share.",
  not_found: "That file isn't in this workspace, so I can't change who sees it.",
  client_upload: "The client uploaded that file themselves. It's already theirs, and I won't relabel it.",
  not_ready: "That file hasn't finished uploading, so it can't be shared yet.",
  client_not_found: "That client isn't active in this workspace, so I can't share a file with them.",
  changed: "The file changed since I read it, so I haven't changed who can see it. Look at it again first.",
  refused: "Who can see the file didn't change.",
  outcome_unknown: "I couldn't confirm whether the file's sharing changed. Check the client's file before trying again.",
};

const SHARE_REFUSALS: Record<string, ClientFileShareFailure> = {
  INVALID_REQUEST: "bad_request",
  CLIENT_FILES_UNAVAILABLE: "not_for_account",
  FILE_NOT_FOUND: "not_found",
  FILE_IS_CLIENT_UPLOAD: "client_upload",
  FILE_NOT_READY: "not_ready",
  CONTACT_NOT_FOUND: "client_not_found",
  FILE_CHANGED: "changed",
};

const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object"
  && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) ? v as Record<string, unknown> : null;
const instant = (v: unknown): v is string => typeof v === "string" && v.length <= 80
  && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

export async function shareClientFile(input: {
  caller: ClientFileShareCaller;
  expectedActorId: string | null | undefined;
  expectedTenantId: string | null | undefined;
  fileId: unknown;
  shared: unknown;
  expectedUpdatedAt: unknown;
}): Promise<ClientFileShareResult> {
  let attempted = false;
  const fail = (reason: ClientFileShareFailure, extra: { currentUpdatedAt?: string } = {}): ClientFileShareResult =>
    ({ success: false, reason, message: CLIENT_FILE_SHARE_MESSAGES[reason], writeAttempted: attempted, ...extra });
  const actor = input.expectedActorId, tenant = input.expectedTenantId;
  if (!uuid(actor) || !uuid(tenant)) return fail("no_workspace");
  if (!uuid(input.fileId) || typeof input.shared !== "boolean" || !instant(input.expectedUpdatedAt)) return fail("bad_request");
  const fileId = input.fileId.toLowerCase(), shared = input.shared;
  let reply: { data: unknown; error: unknown };
  try {
    attempted = true;
    reply = await input.caller.rpc("client_file_set_client_share", {
      p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_file_id: fileId,
      p_shared: shared, p_expected_updated_at: input.expectedUpdatedAt,
    });
  } catch {
    return fail("outcome_unknown");
  }
  if (reply.error) {
    const code = String(object(reply.error)?.code ?? "");
    // Only an answered SQL refusal proves its transaction rolled back. A gateway or network error
    // can arrive after the database committed, so it is reported as unknown, never "not applied".
    if (!/^[0-9A-Z]{5}$/.test(code)) return fail("outcome_unknown");
    attempted = false;
    if (code === "42501") return fail("scope_changed");
    if (["22023", "22P02"].includes(code)) return fail("bad_request");
    return fail("refused");
  }
  const ack = object(reply.data);
  if (ack?.ok === false) {
    // A named refusal: the function wrote nothing (20271110070000, client_file_set_client_share steps 2-7).
    attempted = false;
    const reason = SHARE_REFUSALS[String(ack.error)] ?? "refused";
    return fail(reason, reason === "changed" && instant(ack.updated_at) ? { currentUpdatedAt: ack.updated_at } : {});
  }
  if (!ack || ack.ok !== true || typeof ack.file_id !== "string" || ack.file_id.toLowerCase() !== fileId
    || ack.shared !== shared || typeof ack.replayed !== "boolean") return fail("outcome_unknown");
  // Success is reported only after the stored row says so.
  let read: { data: unknown; error: unknown };
  try { read = await input.caller.readFile(fileId, tenant); } catch { return fail("outcome_unknown"); }
  const row = object(read.data);
  const sharedAt = row?.shared_at;
  if (read.error || !row || typeof row.id !== "string" || row.id.toLowerCase() !== fileId || row.tenant_id !== tenant
    || !instant(row.updated_at) || (row.visibility === "shared") !== shared
    || !(sharedAt === null || instant(sharedAt)) || (sharedAt !== null) !== shared) return fail("outcome_unknown");
  return { success: true, fileId, shared, replayed: ack.replayed, sharedAt: sharedAt as string | null,
    updatedAt: row.updated_at as string, portalConnected: typeof ack.portal_connected === "boolean" ? ack.portal_connected : null };
}

export type ClientFileRefileCaller = ClientFileShareCaller & {
  /** The direct move: contact_id (and description) only, scoped to the server tenant, returning
   * `id, contact_id, visibility, updated_at`. It must never carry visibility. */
  moveFile: (fileId: string, tenantId: string, patch: { contact_id: string; description?: string }) =>
    PromiseLike<{ data: unknown; error: unknown }>;
};

export type ClientFileRefileResult =
  | { success: true; fileId: string; contactId: string; movedFromContactId: string | null; shared: boolean;
      share: { replayed: boolean; sharedAt: string | null; portalConnected: boolean | null } | null }
  | { success: false; moved: boolean | null; fileId: string; contactId: string | null; shared: boolean | null;
      reason: ClientFileShareFailure | "not_moved"; message: string; outcomeUnknown: boolean };

const sameId = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export async function refileClientDocument(input: {
  caller: ClientFileRefileCaller;
  expectedActorId: string | null | undefined;
  expectedTenantId: string | null | undefined;
  fileId: unknown;
  fromContactId: unknown;
  toContactId: unknown;
  description: unknown;
  visibility: unknown;
}): Promise<ClientFileRefileResult> {
  const fileId = typeof input.fileId === "string" ? input.fileId.toLowerCase() : "";
  const nothing = (reason: ClientFileShareFailure | "not_moved", message: string, unknown = false,
    shared: boolean | null = null): ClientFileRefileResult =>
    ({ success: false, moved: unknown ? null : false, fileId, contactId: null, shared, reason, message, outcomeUnknown: unknown });
  const tenant = input.expectedTenantId;
  if (!uuid(input.expectedActorId) || !uuid(tenant)) return nothing("no_workspace", CLIENT_FILE_SHARE_MESSAGES.no_workspace);
  if (!uuid(input.fileId) || !uuid(input.fromContactId) || !uuid(input.toContactId)
    || (input.visibility !== "internal" && input.visibility !== "shared")) {
    return nothing("bad_request", "That request wasn't complete, so I haven't moved the document.");
  }
  const toContact = input.toContactId.toLowerCase();
  const wantShared = input.visibility === "shared";
  const patch: { contact_id: string; description?: string } = { contact_id: toContact };
  if (typeof input.description === "string" && input.description.trim()) patch.description = input.description.trim().slice(0, 500);
  const changesClient = !sameId(input.fromContactId, toContact);
  // 0. A shared file never moves while shared. Read it as stored now; if the client can see it,
  // withdraw that through the share writer (version-checked, one audit row) before the move.
  let withdrawn = false;
  if (changesClient) {
    let current: { data: unknown; error: unknown };
    try { current = await input.caller.readFile(fileId, tenant); } catch {
      return nothing("not_moved", "I couldn't read the document as it is now, so I haven't moved it.");
    }
    const now = object(current.data);
    if (current.error || !now || !sameId(now.id, fileId) || now.tenant_id !== tenant || !instant(now.updated_at)
      || (now.visibility !== "internal" && now.visibility !== "shared")) {
      return nothing("not_moved", "I couldn't read the document as it is now, so I haven't moved it.");
    }
    if (now.visibility === "shared") {
      const withdraw = await shareClientFile({ caller: input.caller, expectedActorId: input.expectedActorId,
        expectedTenantId: tenant, fileId, shared: false, expectedUpdatedAt: now.updated_at });
      if (!withdraw.success) {
        return { success: false, moved: false, fileId, contactId: null, shared: withdraw.writeAttempted ? null : true,
          reason: withdraw.reason, outcomeUnknown: withdraw.writeAttempted,
          message: withdraw.writeAttempted
            ? `The document did not move. ${withdraw.message}`
            : `The document did not move, and its client can still see it: ${withdraw.message}` };
      }
      withdrawn = true;
    }
  }
  const stillThere = withdrawn
    ? "The document did not move, but its client can no longer see it: I withdrew their access first and the move was then refused. Tell the operator exactly that."
    : "The document did not move. Tell the operator plainly that it is still where it was, and don't say otherwise.";
  const notMoved = () => nothing("not_moved", stillThere, false, withdrawn ? false : null);
  const unknownMove = () => nothing("outcome_unknown", withdrawn
    ? "I withdrew the client's access, but I couldn't confirm whether the document then moved. Check the client's file before trying again."
    : "I couldn't confirm whether the document moved. Check the client's file before trying again.", true, withdrawn ? false : null);
  // 1. The move. Visibility is never in the patch: the share writer is the only way to change it.
  let moved: { data: unknown; error: unknown };
  try { moved = await input.caller.moveFile(fileId, tenant, patch); } catch {
    return unknownMove();
  }
  if (moved.error) {
    // Only an answered SQL refusal proves nothing was written (same rule as the share writer).
    return /^[0-9A-Z]{5}$/.test(String(object(moved.error)?.code ?? "")) ? notMoved() : unknownMove();
  }
  const row = object(moved.data);
  if (!row) return notMoved();
  if (!sameId(row.id, fileId) || !sameId(row.contact_id, toContact) || !instant(row.updated_at)
    || (row.visibility !== "internal" && row.visibility !== "shared")) {
    return nothing("outcome_unknown", "I couldn't confirm where the document is now. Check the client's file before trying again.", true);
  }
  const movedFrom = changesClient ? (input.fromContactId as string).toLowerCase() : null;
  const nowShared = row.visibility === "shared";
  if (nowShared === wantShared) {
    return { success: true, fileId, contactId: toContact, movedFromContactId: movedFrom, shared: nowShared, share: null };
  }
  // 2. Who can see it: the share writer, at the version the move just produced.
  const shared = await shareClientFile({ caller: input.caller, expectedActorId: input.expectedActorId, expectedTenantId: tenant,
    fileId, shared: wantShared, expectedUpdatedAt: row.updated_at });
  if (shared.success) {
    return { success: true, fileId, contactId: toContact, movedFromContactId: movedFrom, shared: shared.shared,
      share: { replayed: shared.replayed, sharedAt: shared.sharedAt, portalConnected: shared.portalConnected } };
  }
  const where = nowShared ? "the client can still see it" : "only the team can see it";
  return { success: false, moved: true, fileId, contactId: toContact, shared: shared.writeAttempted ? null : nowShared,
    reason: shared.reason, outcomeUnknown: shared.writeAttempted,
    message: shared.writeAttempted
      ? `It's filed on their record, but ${shared.message.charAt(0).toLowerCase()}${shared.message.slice(1)}`
      : `It's filed on their record, but ${where}: ${shared.message}` };
}

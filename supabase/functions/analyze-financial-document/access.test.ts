// EXP08 stage 0 — who may analyze a financial document.
//
//   deno test --allow-read=supabase/functions --node-modules-dir=none --deny-net \
//     supabase/functions/analyze-financial-document/access.test.ts
//
// The function downloads with the service role, so ./access.ts is the whole access control. It used
// to admit any holder of the GLOBAL `admin` row (an owner/admin seat in ANY workspace). Fictional ids.

import assert from "node:assert/strict";
import { decideDocumentAnalysisAccess, type DocumentAccessDeps } from "./access.ts";

const OWNER = "1a1a1a1a-0000-4000-8000-000000000001"; // the person who uploaded the document
const ADMIN_A = "2b2b2b2b-0000-4000-8000-000000000002"; // owner/admin of workspace A, where OWNER is a client
const ADMIN_B = "3c3c3c3c-0000-4000-8000-000000000003"; // owner/admin of workspace B only (global `admin` row)
const OPERATOR = "4d4d4d4d-0000-4000-8000-000000000004";
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const CLIENT_A = "c1c1c1c1-0000-4000-8000-0000000000c1"; // in A, linked to OWNER
const CLIENT_B_UNLINKED = "c2c2c2c2-0000-4000-8000-0000000000c2"; // in B, NOT linked to OWNER

function deps(caller: string, calls: string[] = []): DocumentAccessDeps {
  return {
    isOperator: async () => (calls.push("operator"), caller === OPERATOR),
    linkedClientTenant: async (clientId, ownerUserId) => {
      calls.push(`client:${clientId}`);
      if (clientId === CLIENT_A && ownerUserId === OWNER) return TENANT_A;
      return null; // CLIENT_B_UNLINKED is in B but not linked to OWNER
    },
    isWorkspaceAdmin: async (tenantId) => {
      calls.push(`admin:${tenantId}`);
      return (caller === ADMIN_A && tenantId === TENANT_A) || (caller === ADMIN_B && tenantId === TENANT_B);
    },
  };
}

Deno.test("the document's owner may analyze it, with no other read", async () => {
  const calls: string[] = [];
  assert.deepEqual(await decideDocumentAnalysisAccess(OWNER, { user_id: OWNER, client_id: null }, deps(OWNER, calls)),
    { allowed: true, via: "owner" });
  assert.deepEqual(calls, []);
});

Deno.test("an owner/admin of the document's own client workspace may analyze it", async () => {
  assert.deepEqual(await decideDocumentAnalysisAccess(ADMIN_A, { user_id: OWNER, client_id: CLIENT_A }, deps(ADMIN_A)),
    { allowed: true, via: "workspace_admin" });
});

Deno.test("an admin of ANOTHER workspace is refused — the global admin row is not authority here", async () => {
  assert.deepEqual(await decideDocumentAnalysisAccess(ADMIN_B, { user_id: OWNER, client_id: CLIENT_A }, deps(ADMIN_B)),
    { allowed: false });
  assert.deepEqual(await decideDocumentAnalysisAccess(ADMIN_B, { user_id: OWNER, client_id: null }, deps(ADMIN_B)),
    { allowed: false });
});

Deno.test("client_id pointed at a client in the admin's workspace but not linked to the owner is refused", async () => {
  // The row owner can write client_id, so the link to the owner is what makes the workspace theirs.
  assert.deepEqual(
    await decideDocumentAnalysisAccess(ADMIN_B, { user_id: OWNER, client_id: CLIENT_B_UNLINKED }, deps(ADMIN_B)),
    { allowed: false });
});

Deno.test("the Platform Operator may analyze any document", async () => {
  assert.deepEqual(await decideDocumentAnalysisAccess(OPERATOR, { user_id: OWNER, client_id: null }, deps(OPERATOR)),
    { allowed: true, via: "operator" });
});

Deno.test("no caller, and a read error, never grant", async () => {
  assert.deepEqual(await decideDocumentAnalysisAccess("", { user_id: OWNER }, deps("")), { allowed: false });
  const failing: DocumentAccessDeps = { ...deps(ADMIN_A), linkedClientTenant: async () => { throw new Error("db down"); } };
  await assert.rejects(decideDocumentAnalysisAccess(ADMIN_A, { user_id: OWNER, client_id: CLIENT_A }, failing), /db down/);
});

Deno.test("the handler uses this decision before anything is written or downloaded, and asks no global role", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert.doesNotMatch(src, /has_role/);
  assert.doesNotMatch(src, /user_roles/);
  const decide = src.indexOf("await decideDocumentAnalysisAccess(user.id, doc,");
  assert.ok(decide > 0);
  assert.ok(decide < src.indexOf("documentSourceError(doc.bucket_name"));
  assert.ok(decide < src.indexOf(".from('financial_document_analyses')"));
  assert.ok(decide < src.indexOf(".download(doc.file_path)"));
  assert.match(src, /\.eq\('id', clientId\)\.eq\('linked_user_id', ownerUserId\)/);
  assert.match(src, /resolveWorkspaceAuthorityAs\(supabase, user\.id, tenantId\)/);
  assert.match(src, /callerClient\.rpc\('is_platform_operator'\)/);
});

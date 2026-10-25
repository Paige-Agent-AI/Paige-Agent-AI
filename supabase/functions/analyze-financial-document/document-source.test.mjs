// node --test supabase/functions/analyze-financial-document/document-source.test.mjs
// EXP08 Team Hub increment 3, re-review N5: analyze-financial-document downloads with the service
// role, and a user can point their own `public.documents` row at any bucket and path. The download
// is allowed only from the buckets the real producers write to (personal-documents,
// business-documents) and only under the row owner's `<user_id>/` folder. The handler starts a
// server on import, so this test lifts the REAL documentSourceError source out of index.ts, strips
// its types with Node's own stripper and runs it — the shipped function, not a copy that could drift.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = source.indexOf("const ANALYZABLE_DOCUMENT_BUCKETS");
const fn = source.indexOf("function documentSourceError(", start);
const end = source.indexOf("\n}\n", fn);
assert.ok(start >= 0 && fn > start && end > fn, "documentSourceError must exist in analyze-financial-document/index.ts");
const documentSourceError = new Function(
  `${stripTypeScriptTypes(source.slice(start, end + 2))}\nreturn documentSourceError;`,
)();

// The guard must run before the service-role download and before the analysis row is written.
const guardAt = source.indexOf("documentSourceError(doc.bucket_name, doc.file_path, doc.user_id)");
const upsertAt = source.indexOf(".from('financial_document_analyses')");
const downloadAt = source.indexOf(".download(doc.file_path)");

const owner = "11111111-2222-4333-8444-555555555555";
const other = "99999999-8888-4777-8666-555555555555";
const business = "0b0e2d3c-6c8f-4a51-9a3e-2f6f9d1c7a10";

describe("analyze-financial-document refuses files its producers never wrote", () => {
  it("is called in the handler before the analysis row is written and before the download", () => {
    assert.ok(guardAt > 0, "the handler must call documentSourceError on the row's bucket, path and owner");
    assert.ok(guardAt < upsertAt && guardAt < downloadAt, "the guard must precede the upsert and the download");
  });
  it("refuses a Team Hub object in comms-attachments, even under the owner's own id", () => {
    assert.equal(documentSourceError("comms-attachments", `${other}/team-hub/${business}`, owner), "bucket_not_allowed");
    assert.equal(documentSourceError("comms-attachments", `${owner}/team-hub/${business}`, owner), "bucket_not_allowed");
  });
  it("refuses any bucket the producers do not use, whatever its spelling", () => {
    for (const bucket of ["Business-Documents", "business-documents ", "avatars", "", null, undefined, ["business-documents"]]) {
      assert.equal(documentSourceError(bucket, `${owner}/x.pdf`, owner), "bucket_not_allowed", String(bucket));
    }
  });
  it("refuses another user's folder in an allowed bucket", () => {
    assert.equal(documentSourceError("business-documents", `${other}/${business}/bank_statements/1_a.pdf`, owner), "path_not_owner_folder");
    assert.equal(documentSourceError("personal-documents", `${other}/drivers_license-1.pdf`, owner), "path_not_owner_folder");
    // Storage's policy compares the folder to auth.uid()::text, which is lower case.
    assert.equal(documentSourceError("business-documents", `${business.toUpperCase()}/x.pdf`, business), "path_not_owner_folder");
    assert.equal(documentSourceError("business-documents", `${owner}x/x.pdf`, owner), "path_not_owner_folder");
  });
  it("refuses the bare owner folder and a file at the bucket root", () => {
    assert.equal(documentSourceError("business-documents", owner, owner), "path_not_owner_folder");
    assert.equal(documentSourceError("business-documents", "x.pdf", owner), "path_not_owner_folder");
  });
  it("refuses traversal, encodings and anything the URL parser would reinterpret", () => {
    for (const path of [
      `${owner}/../${other}/x.pdf`, `${owner}/./x.pdf`, `${owner}//x.pdf`, `${owner}/x/..`, `/${owner}/x.pdf`,
      `${owner}/%2e%2e/${other}/x.pdf`, `${owner}/..%2F${other}/x.pdf`, `${owner}/report%20final.pdf`,
      `${owner}\\..\\${other}\\x.pdf`, `${owner}/.\t./${other}/x.pdf`, `${owner}/x\n.pdf`,
      `${owner}/x.pdf?download`, `${owner}/x.pdf#frag`, `${owner}/`,
    ]) {
      assert.equal(documentSourceError("business-documents", path, owner), "path_not_allowed", JSON.stringify(path));
    }
  });
  it("refuses a non-string or oversized path and an unresolvable owner", () => {
    assert.equal(documentSourceError("business-documents", 42, owner), "path_not_allowed");
    assert.equal(documentSourceError("business-documents", "", owner), "path_not_allowed");
    assert.equal(documentSourceError("business-documents", `${owner}/${"a".repeat(1100)}`, owner), "path_not_allowed");
    assert.equal(documentSourceError("business-documents", `${owner}/x.pdf`, null), "owner_unresolved");
    assert.equal(documentSourceError("business-documents", `../x.pdf`, ".."), "owner_unresolved");
  });
});

describe("the real producers' paths are still analyzed", () => {
  it("accepts FinancialDocsSection: business-documents/<user>/<business>/<docType>/<ts>_<name>", () => {
    assert.equal(documentSourceError("business-documents", `${owner}/${business}/bank_statements/1761400000000_Statement Oct.pdf`, owner), null);
  });
  it("accepts BusinessDocumentsManager: business-documents/<user>/<business>/<ts>_<name>", () => {
    assert.equal(documentSourceError("business-documents", `${owner}/${business}/1761400000000_P&L 2025.pdf`, owner), null);
  });
  it("accepts DocumentUpload in either bucket: <bucket>/<user>/<docType>-<ts>.<ext>", () => {
    assert.equal(documentSourceError("personal-documents", `${owner}/drivers_license-1761400000000.pdf`, owner), null);
    assert.equal(documentSourceError("business-documents", `${owner}/ein_letter-1761400000000.png`, owner), null);
  });
  it("a dot inside a file name is not traversal", () => {
    assert.equal(documentSourceError("business-documents", `${owner}/${business}/1761400000000_q3..final.pdf`, owner), null);
  });
});

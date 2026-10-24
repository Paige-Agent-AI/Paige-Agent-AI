// node --test supabase/functions/send-message/attachment-validation.test.mjs
// EXP08 Team Hub increment 3 (contract §2 "Email exclusion"): send-message must refuse any
// attachment path under <tenant>/team-hub/. The handler file starts a server on import, so this
// test lifts the REAL attachmentValidationError source out of index.ts, strips its types with
// Node's own stripper and runs it. It is the shipped function, not a copy that could drift.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = source.indexOf("const MAX_COMMS_ATTACHMENTS");
const fn = source.indexOf("function attachmentValidationError(", start);
const end = source.indexOf("\n}\n", fn);
assert.ok(start >= 0 && fn > start && end > fn, "attachmentValidationError must exist in send-message/index.ts");
const attachmentValidationError = new Function(
  `${stripTypeScriptTypes(source.slice(start, end + 2))}\nreturn attachmentValidationError;`,
)();

const tenant = "11111111-2222-4333-8444-555555555555";
const other = "99999999-8888-4777-8666-555555555555";
const one = (url, extra = {}) => attachmentValidationError([{ url, name: "a.pdf", mime: "application/pdf", size: 10, ...extra }], tenant);

describe("send-message refuses Team Hub files as email attachments", () => {
  it("refuses the canonical Team Hub object path", () => {
    assert.equal(one(`${tenant}/team-hub/0b0e2d3c-6c8f-4a51-9a3e-2f6f9d1c7a10`), "attachment_not_allowed");
  });
  it("refuses spellings that address the same folder", () => {
    for (const path of [`${tenant}/Team-Hub/f`, `${tenant}/TEAM-HUB/f`, `${tenant}//team-hub/f`, `${tenant}/./team-hub/f`, `${tenant}/team-hub`]) {
      assert.equal(one(path), "attachment_not_allowed", path);
    }
  });
  it("refuses the whole list when any one attachment is a Team Hub file", () => {
    assert.equal(attachmentValidationError([{ url: `${tenant}/inbox/a.pdf` }, { url: `${tenant}/team-hub/f` }], tenant), "attachment_not_allowed");
  });
  it("another workspace's Team Hub path is still refused as not tenant-owned", () => {
    assert.equal(one(`${other}/team-hub/f`), "attachment_not_tenant_owned");
  });
});

describe("ordinary tenant attachments are unaffected", () => {
  it("accepts the tenant's own comms paths", () => {
    for (const path of [`${tenant}/report.pdf`, `${tenant}/inbox/2026/report.pdf`, `${tenant}/team-hubs/report.pdf`,
      `${tenant}/notes/team-hub/report.pdf`]) {
      assert.equal(one(path), null, path);
    }
  });
  it("no attachments is still fine", () => {
    assert.equal(attachmentValidationError(undefined, tenant), null);
  });
  it("the existing guards still hold", () => {
    assert.equal(one(`${other}/report.pdf`), "attachment_not_tenant_owned");
    assert.equal(one(`${tenant}/../x`), "attachment_not_tenant_owned");
    assert.equal(one(`https://example.com/${tenant}/x`), "attachment_not_tenant_owned");
    assert.equal(one(`${tenant}/report.pdf`, { size: 10 * 1024 * 1024 + 1 }), "invalid_attachment_size");
    assert.equal(attachmentValidationError([{ url: `${tenant}/a` }], null), "attachment_tenant_unresolved");
  });
});

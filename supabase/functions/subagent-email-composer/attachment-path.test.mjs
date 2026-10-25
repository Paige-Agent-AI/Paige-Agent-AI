// node --test supabase/functions/subagent-email-composer/attachment-path.test.mjs
// EXP08 Team Hub increment 3 (contract §2 "Email exclusion"): the email composer downloads staged
// comms-attachments objects with the SERVICE ROLE, which bypasses the Team Hub members-only storage
// policy. So its path guard must refuse every spelling of a Team Hub object before that read,
// including percent-encoded ones that Storage's router decodes (`team-hub%2F<id>` is read as
// `team-hub/<id>`). The handler file starts a server on import, so this test lifts the REAL
// attachmentPathRefusal source out of index.ts, strips its types with Node's own stripper and runs
// it — the shipped function, not a copy that could drift.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const fn = source.indexOf("function attachmentPathRefusal(");
const end = source.indexOf("\n}\n", fn);
assert.ok(fn >= 0 && end > fn, "attachmentPathRefusal must exist in subagent-email-composer/index.ts");
assert.ok(
  source.indexOf("attachmentPathRefusal(path, callerTenantId)") > 0 &&
    source.indexOf("attachmentPathRefusal(path, callerTenantId)") < source.indexOf(".from(COMMS_ATTACH_BUCKET).download(path)"),
  "the guard must run before the service-role download",
);
const attachmentPathRefusal = new Function(
  `${stripTypeScriptTypes(source.slice(fn, end + 2))}\nreturn attachmentPathRefusal;`,
)();

const tenant = "11111111-2222-4333-8444-555555555555";
const other = "99999999-8888-4777-8666-555555555555";
const file = "0b0e2d3c-6c8f-4a51-9a3e-2f6f9d1c7a10";

describe("the email composer never reads a Team Hub file", () => {
  it("refuses percent-encoded spellings Storage decodes into a Team Hub path", () => {
    for (const path of [
      `${tenant}/team-hub%2F${file}`,
      `${tenant}/team-hub%2f${file}`,
      `${tenant}/team%2Dhub%2F${file}`,
      `${tenant}/%74eam-hub%2F${file}`,
      `${tenant}/team-hub%252F${file}`,
    ]) {
      assert.equal(attachmentPathRefusal(path, tenant), "encoded_path", path);
    }
  });
  it("refuses a backslash, which is not a separator anywhere a real key is built", () => {
    assert.equal(attachmentPathRefusal(`${tenant}/team-hub\\${file}`, tenant), "encoded_path");
  });
  it("refuses the Team Hub folder itself, in any case", () => {
    for (const path of [`${tenant}/team-hub`, `${tenant}/Team-Hub`, `${tenant}/TEAM-HUB`]) {
      assert.equal(attachmentPathRefusal(path, tenant), "team_hub_file", path);
    }
  });
  it("still refuses the plain nested Team Hub path and another workspace's files", () => {
    assert.equal(attachmentPathRefusal(`${tenant}/team-hub/${file}`, tenant), "not_tenant_file");
    assert.equal(attachmentPathRefusal(`${other}/report.pdf`, tenant), "not_tenant_file");
    assert.equal(attachmentPathRefusal(`${tenant}/`, tenant), "not_tenant_file");
    assert.equal(attachmentPathRefusal(`${tenant}/..`, tenant), "not_tenant_file");
  });
});

describe("real Inbox attachment keys are still read", () => {
  it("accepts the shape useCommsAttachments writes: <tenant>/<uuid>-<name with [\\w.-]>", () => {
    for (const path of [`${tenant}/${file}-Q3_report.pdf`, `${tenant}/${file}-team-hub-notes.pdf`, `${tenant}/${file}-a.b_c-d.docx`]) {
      assert.equal(attachmentPathRefusal(path, tenant), null, path);
    }
  });
});

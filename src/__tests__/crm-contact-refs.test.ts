import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
// Pure edge modules (no Deno imports, the database client is injected): the real logic that turns
// the client_ref Paige was shown into the contact a governed CRM command acts on.
import { normalizeClientRef, resolveClientRef } from "../../supabase/functions/_shared/client-ref";
import { resolveCommandContactRefs, type ContactRefCommand } from "../../supabase/functions/_shared/crm-command/contact-refs";
import { CRM_COMMAND_TOOLS, crmApprovalSubject } from "../../supabase/functions/_shared/crm-command/catalog";
import { orderedContactMethods } from "../../supabase/functions/_shared/contact-methods";

afterEach(() => vi.restoreAllMocks());

const TENANT = "11111111-1111-4111-8111-111111111111";
const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A `clients` table holding account numbers in ONE workspace; records every filter applied. */
function clientsTable(rows: Array<{ id: string; tenant_id: string; account_number: string }>, error: unknown = null) {
  const lookups: Array<Record<string, unknown>> = [];
  const from = vi.fn(() => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      maybeSingle: async () => {
        lookups.push({ ...filters });
        if (error) return { data: null, error };
        const row = rows.find((r) => r.tenant_id === filters.tenant_id && r.account_number === filters.account_number);
        return { data: row ? { id: row.id } : null, error: null };
      },
    };
    return chain;
  });
  return { client: { from }, lookups };
}

const BOOK = [
  { id: ADA, tenant_id: TENANT, account_number: "CLT-ADA000000001" },
  { id: BO, tenant_id: TENANT, account_number: "CLT-BO0000000002" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", tenant_id: "other-tenant", account_number: "CLT-ELSEWHERE001" },
];

describe("client_ref resolution", () => {
  it("normalizes a reference the way account numbers are stored", () => {
    expect(normalizeClientRef("  clt-ada000000001 ")).toBe("CLT-ADA000000001");
    expect(normalizeClientRef("   ")).toBeNull();
    expect(normalizeClientRef(42)).toBeNull();
  });

  it("finds the contact only inside the caller's workspace", async () => {
    const { client, lookups } = clientsTable(BOOK);
    expect(await resolveClientRef(client, TENANT, "clt-ada000000001", "test")).toBe(ADA);
    expect(lookups[0]).toEqual({ tenant_id: TENANT, account_number: "CLT-ADA000000001" });
    // Another workspace's contact is indistinguishable from none.
    expect(await resolveClientRef(client, TENANT, "CLT-ELSEWHERE001", "test")).toBeNull();
  });

  it("never looks up without a workspace, and reports a failed lookup as not found, loudly", async () => {
    const { client, lookups } = clientsTable(BOOK);
    expect(await resolveClientRef(client, null, "CLT-ADA000000001", "test")).toBeNull();
    expect(lookups).toHaveLength(0);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = clientsTable(BOOK, { code: "57014", message: "timeout" });
    expect(await resolveClientRef(failing.client, TENANT, "CLT-ADA000000001", "crm-command")).toBeNull();
    expect(error).toHaveBeenCalledWith("[crm-command] client_ref_lookup_failed", expect.objectContaining({ code: "57014" }));
  });
});

describe("a governed command naming contacts by client_ref", () => {
  it("fills in the contact id and keeps the normalized reference (the defect: search gave a ref, update demanded an id)", async () => {
    const { client } = clientsTable(BOOK);
    const command: ContactRefCommand = { client_ref: " clt-ada000000001" };
    expect(await resolveCommandContactRefs(client, TENANT, command, "test")).toEqual({ ok: true });
    expect(command).toEqual({ client_ref: "CLT-ADA000000001", contact_id: ADA });
  });

  it("resolves a merge's losing contact the same way", async () => {
    const { client } = clientsTable(BOOK);
    const command: ContactRefCommand = { client_ref: "CLT-ADA000000001", loser_client_ref: "CLT-BO0000000002" };
    expect((await resolveCommandContactRefs(client, TENANT, command, "test")).ok).toBe(true);
    expect(command.contact_id).toBe(ADA);
    expect(command.loser_contact_id).toBe(BO);
  });

  it("refuses a reference from another workspace as not found, without disclosure", async () => {
    const { client } = clientsTable(BOOK);
    const command: ContactRefCommand = { client_ref: "CLT-ELSEWHERE001" };
    expect(await resolveCommandContactRefs(client, TENANT, command, "test"))
      .toEqual({ ok: false, status: 404, code: "CRM_CONTACT_NOT_FOUND", detail: ["client_ref"] });
    expect(command.contact_id).toBeUndefined();
  });

  it("refuses a reference and an id that name different contacts", async () => {
    const { client } = clientsTable(BOOK);
    expect(await resolveCommandContactRefs(client, TENANT, { client_ref: "CLT-ADA000000001", contact_id: BO }, "test"))
      .toEqual({ ok: false, status: 400, code: "CRM_CONTACT_REFERENCE_MISMATCH", detail: ["client_ref", "contact_id"] });
    // The same contact named both ways is fine, whatever the id's case.
    expect((await resolveCommandContactRefs(client, TENANT, { client_ref: "CLT-ADA000000001", contact_id: ADA.toUpperCase() }, "test")).ok).toBe(true);
  });

  it("resolves a bulk update's contacts, and names every reference it could not find", async () => {
    const { client } = clientsTable(BOOK);
    const command: ContactRefCommand = { target_client_refs: ["clt-ada000000001", "CLT-BO0000000002", "CLT-ADA000000001"] };
    expect((await resolveCommandContactRefs(client, TENANT, command, "test")).ok).toBe(true);
    expect(command.target_ids).toEqual([ADA, BO]);
    const missing: ContactRefCommand = { target_client_refs: ["CLT-ADA000000001", "CLT-NOPE00000000"] };
    expect(await resolveCommandContactRefs(client, TENANT, missing, "test"))
      .toEqual({ ok: false, status: 404, code: "CRM_CONTACT_NOT_FOUND", detail: ["CLT-NOPE00000000"] });
  });

  it("leaves a command that names no contact by reference untouched", async () => {
    const { client } = clientsTable(BOOK);
    const command: ContactRefCommand = { contact_id: ADA };
    expect((await resolveCommandContactRefs(client, TENANT, command, "test")).ok).toBe(true);
    expect(command).toEqual({ contact_id: ADA });
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("the approval subject for a command naming a contact by client_ref", () => {
  it("is the same on the proposing call and the approving call, before and after resolution", async () => {
    const proposed = await crmApprovalSubject("contact.update", { client_ref: "clt-ada000000001", patch: { tags: ["a"] } });
    const approvedResolved = await crmApprovalSubject("contact.update", { client_ref: "CLT-ADA000000001", contact_id: ADA, patch: { tags: ["b"] } });
    expect(approvedResolved).toBe(proposed);
    expect(await crmApprovalSubject("contact.update", { client_ref: "CLT-BO0000000002" })).not.toBe(proposed);
  });

  it("keys a bulk update on its set of references, in any order", async () => {
    const a = await crmApprovalSubject("contact.bulk_update", { target_client_refs: ["CLT-BO0000000002", "clt-ada000000001"] });
    const b = await crmApprovalSubject("contact.bulk_update", { target_client_refs: ["CLT-ADA000000001", "CLT-BO0000000002"], target_ids: [ADA, BO] });
    expect(a).toBe(b);
  });
});

describe("the CRM tools Paige is shown", () => {
  const tool = (name: string) => CRM_COMMAND_TOOLS.find((t) => t.function.name === name)!.function.parameters;

  it("ask for the contact's client_ref, which her search returns, rather than an id she never sees", () => {
    for (const name of ["crm_update_contact", "crm_archive_contact", "crm_log_activity", "crm_assign_deal_contact"]) {
      expect(tool(name).required).toContain("client_ref");
      expect(tool(name).required).not.toContain("contact_id");
    }
    expect(tool("crm_merge_contacts").required).toEqual(expect.arrayContaining(["client_ref", "loser_client_ref"]));
    expect(tool("crm_bulk_update_contacts").required).toContain("target_client_refs");
  });

  it("offer add_contact_methods and contact_methods on update, and no single email or phone", () => {
    const patch = tool("crm_update_contact").properties.patch as { properties: Record<string, unknown> };
    expect(Object.keys(patch.properties)).toEqual(expect.arrayContaining(["contact_methods", "add_contact_methods"]));
    expect(Object.keys(patch.properties)).not.toContain("email");
    expect(Object.keys(patch.properties)).not.toContain("phone");
  });
});

describe("crm-command resolves references before anything is decided", () => {
  const source = readFileSync("supabase/functions/crm-command/index.ts", "utf8");
  it("resolves before the cached readback, the approval subject and the request it executes", () => {
    const resolve = source.indexOf("resolveCommandContactRefs(admin, tenantId, body.command");
    expect(resolve).toBeGreaterThan(0);
    expect(resolve).toBeLessThan(source.indexOf("const requestArgs = { command: body.command"));
    expect(resolve).toBeLessThan(source.indexOf('admin.rpc("read_crm_command_result"'));
    expect(resolve).toBeLessThan(source.indexOf("crmApprovalSubject(body.command.action"));
  });
});

describe("a contact's methods as a reader sees them", () => {
  it("lists emails then phones, each in the owner's order, marking the primary", () => {
    expect(orderedContactMethods([
      { kind: "phone", value: "+1 555 010 0102", label: null, is_primary: false, position: 1 },
      { kind: "email", value: "b@x.test", label: "Work", is_primary: false, position: 1 },
      { kind: "phone", value: "+1 555 010 0101", label: "Mobile", is_primary: true, position: 0 },
      { kind: "email", value: "a@x.test", label: null, is_primary: true, position: 0 },
    ])).toEqual([
      { kind: "email", value: "a@x.test", label: null, is_primary: true },
      { kind: "email", value: "b@x.test", label: "Work", is_primary: false },
      { kind: "phone", value: "+1 555 010 0101", label: "Mobile", is_primary: true },
      { kind: "phone", value: "+1 555 010 0102", label: null, is_primary: false },
    ]);
    expect(orderedContactMethods(null)).toEqual([]);
  });
});


describe("deal creation retains the resolved client's approval identity", () => {
  it("matches before and after server reference resolution, without losing commercial inputs", async () => {
    const proposed = { action: "deal.create", title: "New opportunity", pipeline_id: "pipeline-a", stage_id: "stage-a", client_ref: "clt-ada000000001" };
    const { client } = clientsTable(BOOK);
    const resolved = { ...proposed };
    expect((await resolveCommandContactRefs(client, TENANT, resolved, "test")).ok).toBe(true);
    expect(resolved).toMatchObject({ client_ref: "CLT-ADA000000001", contact_id: ADA });
    expect(await crmApprovalSubject("deal.create", resolved)).toBe(await crmApprovalSubject("deal.create", proposed));
    expect(await crmApprovalSubject("deal.create", { ...resolved, title: "Different opportunity" })).not.toBe(await crmApprovalSubject("deal.create", proposed));
    expect(await crmApprovalSubject("deal.create", { ...resolved, client_ref: "CLT-BO0000000002", contact_id: BO })).not.toBe(await crmApprovalSubject("deal.create", proposed));
  });
});

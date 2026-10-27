// @vitest-environment node
// A business's From through PAIGE's SendGrid transport (security H2 + replies), for the senders outside
// send-message: paige-mcp's send tools and skill-runner's approved document email. Synthetic data only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownManagedAddresses, tenantAddressing } from "../../supabase/functions/_shared/email/tenant-sender.ts";

function reader(row: Record<string, unknown> | null, opts: { throws?: boolean } = {}) {
  const seen: Array<{ table: string; col: string; value: string }> = [];
  return {
    seen,
    admin: {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, value: string) => ({
            maybeSingle: async () => { seen.push({ table, col, value }); if (opts.throws) throw new Error("read failed"); return { data: row, error: null }; },
          }),
        }),
      }),
    },
  };
}

describe("ownManagedAddresses", () => {
  it("adds the business's ACTIVE registered identity, read for the server-resolved tenant", async () => {
    const r = reader({ local_part: "cedar", status: "active" });
    expect(await ownManagedAddresses(r.admin, "tenant-a", ["hello@cedar.example", null])).toEqual(["hello@cedar.example", "cedar@mail.paigeagent.ai"]);
    expect(r.seen).toEqual([{ table: "tenant_email_identities", col: "tenant_id", value: "tenant-a" }]);
  });
  it("ignores an inactive identity, and a failed read only keeps what was resolved", async () => {
    expect(await ownManagedAddresses(reader({ local_part: "cedar", status: "pending" }).admin, "tenant-a")).toEqual([]);
    expect(await ownManagedAddresses(reader(null, { throws: true }).admin, "tenant-a", ["x@mail.paigeagent.ai"])).toEqual(["x@mail.paigeagent.ai"]);
  });
});

describe("tenantAddressing", () => {
  const own = ["cedar@mail.paigeagent.ai"];
  it("keeps the business's own managed address and adds no Reply-To", () => {
    expect(tenantAddressing("Cedar Studio <cedar@mail.paigeagent.ai>", own)).toEqual({ from: "Cedar Studio <cedar@mail.paigeagent.ai>", replyTo: null });
  });
  it("sends a business's own domain as notifications@, with replies still reaching the business", () => {
    expect(tenantAddressing("Cedar Studio <hello@cedar.example>", own)).toEqual({ from: "Cedar Studio <notifications@mail.paigeagent.ai>", replyTo: "hello@cedar.example" });
  });
  it("an explicit Reply-To wins", () => {
    expect(tenantAddressing("Cedar Studio <hello@cedar.example>", own, "team@cedar.example").replyTo).toBe("team@cedar.example");
  });
  it("can never send as another business's managed address or as PAIGE, and never points replies at paigeagent.ai", () => {
    for (const from of ["Cedar <acme@mail.paigeagent.ai>", "Cedar <support@paigeagent.ai>", "Cedar <alerts@mail.paigeagent.ai>"]) {
      expect(tenantAddressing(from, own)).toEqual({ from: "Cedar <notifications@mail.paigeagent.ai>", replyTo: null });
    }
  });
});

describe("paige-mcp's business-From send tools use it", () => {
  const src = readFileSync("supabase/functions/paige-mcp/index.ts", "utf8");
  const span = (tool: string) => {
    const start = src.indexOf(`mcp.tool("${tool}"`);
    return src.slice(start, src.indexOf("\n});", start));
  };
  it.each(["send_transactional_email", "send_composed_email", "bulk_send_template_email"])("%s", (tool) => {
    const s = span(tool);
    expect(s).toMatch(/await ownManagedAddresses\(admin, tenant_id, \[fromAddress\]\)/);
    expect(s).toMatch(/tenantAddressing\(fromHeader, own/);
    expect(s).toMatch(/from: addressing\.from/);
    expect(s).toMatch(/replyTo: addressing\.replyTo/);
  });
  it("send_btf_template_email routes a model-supplied from_override through it; only PAIGE's own scope sender is platform-mapped", () => {
    const s = span("send_btf_template_email");
    expect(s).toMatch(/args\.from_override\s*\?\s*tenantAddressing\(/);
  });
});

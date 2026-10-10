import { describe, expect, it, vi } from "vitest";
import { authorizeQuickBooksSync } from "../../../supabase/functions/_shared/quickbooks-sync-authority";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the deployed handler body with controlled dependencies, not a copied handler.
function loadHandler(getUser: () => Promise<unknown>, privilegedRead: ReturnType<typeof vi.fn>) {
  const source = readFileSync("supabase/functions/quickbooks-sync-financials/index.ts", "utf8");
  const handler = source.slice(source.indexOf("serve(async (req) => {")).replace(/^serve\(/, "return (").replace(/\);\s*$/, ");");
  const createClient = (_url: string, key: string) => key === "test-service-key"
    ? { from: privilegedRead }
    : { auth: { getUser } };
  const javascript = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("createClient", "Deno", "authorizeQuickBooksSync", "corsHeaders", "syncOneConnection", javascript)(
    createClient, { env: { get: (key: string) => ({ SUPABASE_SERVICE_ROLE_KEY: "test-service-key", SUPABASE_ANON_KEY: "test-anon", SUPABASE_URL: "https://test.invalid" })[key] } },
    authorizeQuickBooksSync, {}, vi.fn(),
  ) as (request: Request) => Promise<Response>;
}

describe("QuickBooks sync deployed handler containment", () => {
  it.each([{}, { sync_all: true }, { user_id: "test-victim", sync_all: true }])("denies anonymous requests without a privileged read: %j", async (body) => {
    const privilegedRead = vi.fn();
    const getUser = vi.fn();
    const response = await loadHandler(getUser, privilegedRead)(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(401);
    expect(privilegedRead).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
  it("denies verified-user bulk requests before a privileged read", async () => {
    const privilegedRead = vi.fn();
    const response = await loadHandler(async () => ({ data: { user: { id: "test-user-owner" } } }), privilegedRead)(new Request("https://test.invalid", {
      method: "POST", headers: { Authorization: "Bearer test-user-token" }, body: JSON.stringify({ sync_all: true }),
    }));
    expect(response.status).toBe(403);
    expect(privilegedRead).not.toHaveBeenCalled();
  });
  it("pins a person lookup to verified identity and the requested connection", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const privilegedRead = vi.fn(() => query);
    const response = await loadHandler(async () => ({ data: { user: { id: "test-user-owner" } } }), privilegedRead)(new Request("https://test.invalid", {
      method: "POST", headers: { Authorization: "Bearer test-user-token" },
      body: JSON.stringify({ user_id: "test-other-owner", connection_id: "test-other-connection" }),
    }));
    expect(response.status).toBe(404);
    expect(query.eq.mock.calls).toEqual([["user_id", "test-user-owner"], ["is_active", true], ["id", "test-other-connection"]]);
  });
});

describe("QuickBooks sync caller boundary", () => {
  const verifiedUser = vi.fn(async () => "test-user-owner");
  it("rejects absent credentials before user verification", async () => {
    verifiedUser.mockClear();
    expect(await authorizeQuickBooksSync(null, "test-service-key", false, verifiedUser)).toEqual({ allowed: false, status: 401 });
    expect(verifiedUser).not.toHaveBeenCalled();
  });
  it("does not accept a substring of the service credential", async () => {
    expect(await authorizeQuickBooksSync("Bearer prefix-test-service-key", "test-service-key", true, verifiedUser)).toEqual({ allowed: false, status: 403 });
  });
  it("allows bulk only for an exact configured service bearer", async () => {
    expect(await authorizeQuickBooksSync("Bearer test-service-key", "test-service-key", true, verifiedUser)).toEqual({ allowed: true, actor: "service" });
    expect(await authorizeQuickBooksSync("Bearer test-user-token", "test-service-key", true, verifiedUser)).toEqual({ allowed: false, status: 403 });
  });
  it("resolves a person from verified auth rather than request identity", async () => {
    expect(await authorizeQuickBooksSync("Bearer test-user-token", "test-service-key", false, verifiedUser)).toEqual({ allowed: true, actor: "person", userId: "test-user-owner" });
  });
  it("fails closed on invalid tokens and verification errors", async () => {
    expect(await authorizeQuickBooksSync("Bearer invalid", "test-service-key", false, async () => null)).toEqual({ allowed: false, status: 401 });
    expect(await authorizeQuickBooksSync("Bearer invalid", "test-service-key", false, async () => { throw new Error("offline"); })).toEqual({ allowed: false, status: 401 });
  });
  it("never trusts an empty configured service key", async () => {
    expect(await authorizeQuickBooksSync("Bearer ", "", true, verifiedUser)).toEqual({ allowed: false, status: 401 });
  });
});

import {beforeEach, describe, expect, it, vi} from "vitest";
const f = vi.hoisted(() => ({rpc: vi.fn(), abort: vi.fn(), getUser: vi.fn()}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc: f.rpc, auth: {getUser: f.getUser}}}));
import {fetchClientPortalSavedEntry, readClientPortalSavedEntry} from "./client-portal-return";

const actor = "e0960100-0000-4000-8000-000000000002";
const other = "e0960100-0000-4000-8000-000000000003";
const business = "e0960200-0000-4000-8000-000000000002";
const slug = "test-tenant-return-b";
const entry = () => ({contract_version: 1, actor_id: actor, tenant_id: business, tenant_slug: slug, state: "open"});
const signal = () => new AbortController().signal;
beforeEach(() => {vi.clearAllMocks(); f.rpc.mockReturnValue({abortSignal: f.abort}); f.abort.mockResolvedValue({data: entry(), error: null}); f.getUser.mockResolvedValue({data: {user: {id: actor}}, error: null});});

describe("closed original saved-business entry", () => {
  it.each(["open", "paused", "ended"])("decodes exact own %s pointer without inventing membership", state => {
    expect(readClientPortalSavedEntry({...entry(), state}, actor, slug)).toEqual({actorId: actor, businessId: business, businessSlug: slug, state});
  });
  it("copies metadata and matches original public-reader normalization", () => {
    const raw = entry(), result = readClientPortalSavedEntry(raw, actor, ` ${slug.toUpperCase()} `)!;
    raw.tenant_id = other; raw.tenant_slug = "changed";
    expect(result.businessId).toBe(business); expect(result.businessSlug).toBe(slug);
  });
  it.each([null, [], {}, "ok", {...entry(), contract_version: 2}, {...entry(), actor_id: other}, {...entry(), tenant_id: "owner"}, {...entry(), tenant_slug: "another-business"}, {...entry(), state: "multiple"}, {...entry(), state: null}, {...entry(), private_note: "hidden"}, {...entry(), client_id: other}, {...entry(), tenant_slug: null}])("withholds foreign, private or malformed native metadata %j", value => {
    expect(readClientPortalSavedEntry(value, actor, slug)).toBeNull();
  });
  it.each([["owner", slug], [actor, ""], [actor, "  "]])("requires valid expected actor and requested slug %j", (expectedActor, requestedSlug) => {
    expect(readClientPortalSavedEntry(entry(), expectedActor, requestedSlug)).toBeNull();
  });
});

describe("original SDK return read", () => {
  it("sends only the slug and caller signal, then verifies current actual Auth", async () => {
    const s = signal(), result = await fetchClientPortalSavedEntry(actor, slug, {signal: s});
    expect(f.rpc).toHaveBeenCalledWith("client_portal_entry_for_slug", {p_slug: slug});
    expect(f.abort).toHaveBeenCalledWith(s); expect(f.getUser).toHaveBeenCalledOnce();
    expect(result?.businessId).toBe(business);
  });
  it("preserves a genuine native no-relationship result after current Auth verification", async () => {
    f.abort.mockResolvedValue({data: null, error: null});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).resolves.toBeNull();
    expect(f.getUser).toHaveBeenCalledOnce();
  });
  it.each(["42501", "PGRST000"])("withholds native error %s and scrubs backend details", async code => {
    f.abort.mockResolvedValue({data: entry(), error: {code, message: "private backend detail"}});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).rejects.toMatchObject({reason: code === "42501" ? "refused" : "unavailable", message: "Your portal could not be verified. Try again."});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it("refuses an old, wrong-business, wrong-actor or extra-field envelope", async () => {
    f.abort.mockResolvedValue({data: {...entry(), actor_id: other}, error: null});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).rejects.toMatchObject({reason: "unavailable"});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it.each([{data: {user: {id: other}}, error: null}, {data: {user: null}, error: null}, {data: {user: {id: actor}}, error: {message: "offline"}}])("withholds changed, lost or unreadable actual identity %j", async identity => {
    f.getUser.mockResolvedValue(identity);
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).rejects.toMatchObject({reason: "session_changed"});
  });
  it("checks identity even for native null after a subject switch", async () => {
    f.abort.mockResolvedValue({data: null, error: null});
    f.getUser.mockResolvedValue({data: {user: {id: other}}, error: null});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).rejects.toMatchObject({reason: "session_changed"});
  });
  it("makes no request after canceled or invalid input", async () => {
    const c = new AbortController(); c.abort();
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
    await expect(fetchClientPortalSavedEntry("owner", slug, {signal: signal()})).rejects.toMatchObject({reason: "invalid"});
    await expect(fetchClientPortalSavedEntry(actor, " ", {signal: signal()})).rejects.toMatchObject({reason: "invalid"});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("discards native completion after cancellation", async () => {
    const c = new AbortController(); f.abort.mockImplementation(async () => {c.abort(); return {data: entry(), error: null};});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it("discards Auth completion after cancellation", async () => {
    const c = new AbortController(); f.getUser.mockImplementation(async () => {c.abort(); return {data: {user: {id: actor}}, error: null};});
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
  });
  it.each(["native", "auth"])("scrubs rejected %s transport details", async source => {
    (source === "native" ? f.abort : f.getUser).mockRejectedValue(new Error("private transport detail"));
    await expect(fetchClientPortalSavedEntry(actor, slug, {signal: signal()})).rejects.toMatchObject({reason: "unavailable", message: "Your portal could not be verified. Try again."});
  });
});

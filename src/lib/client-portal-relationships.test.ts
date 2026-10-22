import {beforeEach, describe, expect, it, vi} from "vitest";
const f = vi.hoisted(() => ({rpc: vi.fn(), abort: vi.fn(), getUser: vi.fn()}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc: f.rpc, auth: {getUser: f.getUser}}}));
import {fetchClientPortalRelationshipChoices, readClientPortalRelationshipPage} from "./client-portal-relationships";

const actor = "e0960100-0000-4000-8000-000000000002";
const other = "e0960100-0000-4000-8000-000000000003";
const client = (n: number) => `e0960300-0000-4000-8000-${String(n).padStart(12,"0")}`;
const tenant = (n: number) => `e0960200-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row = (n: number) => ({client_id: client(n), tenant_id: tenant(n), business_name: `Test business ${n}`, logo_url: null, logo_dark_url: null});
const page = (rows = [row(1),row(2)]) => ({contract_version: 1,actor_id: actor,relationships: rows,has_more: false,next_after: null as string | null});
const signal = () => new AbortController().signal;
beforeEach(() => {vi.clearAllMocks(); f.rpc.mockReturnValue({abortSignal: f.abort}); f.abort.mockResolvedValue({data: page(),error: null}); f.getUser.mockResolvedValue({data: {user: {id: actor}},error: null});});

describe("closed original relationship choices", () => {
  it("decodes an ordered own-business page and makes a detached projection", () => {
    const raw = page(), parsed = readClientPortalRelationshipPage(raw,actor)!;
    expect(parsed.relationships.map(r => [r.clientId,r.tenantId])).toEqual([[client(1),tenant(1)],[client(2),tenant(2)]]);
    raw.relationships[0].business_name = "changed"; raw.relationships.reverse();
    expect(parsed.relationships[0].businessName).toBe("Test business 1");
  });
  it("accepts genuine empty, complete and bounded keyset pages", () => {
    expect(readClientPortalRelationshipPage(page([]),actor)?.relationships).toEqual([]);
    const raw = {...page([row(2)]),has_more: true,next_after: client(2)};
    expect(readClientPortalRelationshipPage(raw,actor,1,client(1))?.nextAfter).toBe(client(2));
  });
  it.each([null,[],{},"ok",{...page(),contract_version: 2},{...page(),actor_id: other},{...page(),extra: "private"}])("withholds invalid envelope %j", raw => {
    expect(readClientPortalRelationshipPage(raw,actor)).toBeNull();
  });
  it.each([
    [{...row(1),private_note: "hidden"}], [{...row(1),client_id: "email@example.test"}],
    [{...row(1),tenant_id: "staff"}], [{...row(1),business_name: " "}],
    [{...row(1),logo_url: {url: "private"}}], [row(1),row(1)], [row(2),row(1)],
    [row(1),{...row(2),tenant_id: tenant(1)}],
  ])("withholds malformed, private, duplicate or unordered rows %j", rows => {
    expect(readClientPortalRelationshipPage({...page(),relationships: rows},actor)).toBeNull();
  });
  it.each([0,51,NaN,1.5])("rejects invalid page bound %s", limit => {
    expect(readClientPortalRelationshipPage(page(),actor,limit)).toBeNull();
  });
  it("rejects invalid actor/cursor and a row before its original cursor", () => {
    expect(readClientPortalRelationshipPage(page(),"owner")).toBeNull();
    expect(readClientPortalRelationshipPage(page(),actor,20,"email")).toBeNull();
    expect(readClientPortalRelationshipPage(page(),actor,20,client(1))).toBeNull();
  });
  it("rejects too many rows and inconsistent continuation evidence", () => {
    expect(readClientPortalRelationshipPage(page(),actor,1)).toBeNull();
    expect(readClientPortalRelationshipPage({...page(),next_after: client(2)},actor)).toBeNull();
    expect(readClientPortalRelationshipPage({...page(),has_more: true,next_after: client(1)},actor,2)).toBeNull();
    expect(readClientPortalRelationshipPage({...page(),has_more: true,next_after: client(2)},actor,3)).toBeNull();
    expect(readClientPortalRelationshipPage({...page([]),has_more: true},actor,1)).toBeNull();
  });
});

describe("original SDK read and current session", () => {
  it("passes only pagination and the caller's abort signal, then checks actual Auth", async () => {
    const s = signal();
    const result = await fetchClientPortalRelationshipChoices(actor,{signal: s});
    expect(f.rpc).toHaveBeenCalledWith("client_portal_relationship_choices",{p_limit: 20,p_after: null});
    expect(f.abort).toHaveBeenCalledWith(s); expect(f.getUser).toHaveBeenCalledOnce();
    expect(result.actorId).toBe(actor);
  });
  it("uses exact original cursor with no actor/business authority parameter", async () => {
    f.abort.mockResolvedValue({data: page([row(2)]),error: null});
    expect((await fetchClientPortalRelationshipChoices(actor,{signal: signal(),limit: 1,after: client(1)})).relationships).toHaveLength(1);
    expect(f.rpc).toHaveBeenCalledWith("client_portal_relationship_choices",{p_limit: 1,p_after: client(1)});
  });
  it.each(["42501","PGRST000"])("withholds native error %s without publishing data", async code => {
    f.abort.mockResolvedValue({data: page(),error: {code,message: "private backend detail"}});
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: signal()})).rejects.toMatchObject({reason: code === "42501" ? "refused" : "unavailable"});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it("withholds wrong-actor or malformed native payload before further use", async () => {
    f.abort.mockResolvedValue({data: {...page(),actor_id: other},error: null});
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: signal()})).rejects.toMatchObject({reason: "unavailable"});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it.each([{data: {user: {id: other}},error: null},{data: {user: null},error: null},{data: {user: {id: actor}},error: {message: "offline"}}])("withholds session loss/switch/error %j", async identity => {
    f.getUser.mockResolvedValue(identity);
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: signal()})).rejects.toMatchObject({reason: "session_changed"});
  });
  it("does not request anything after cancellation or invalid input", async () => {
    const c = new AbortController(); c.abort();
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: signal(),limit: 0})).rejects.toMatchObject({reason: "invalid"});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("discards native completion after cancellation", async () => {
    const c = new AbortController();
    f.abort.mockImplementation(async () => {c.abort(); return {data: page(),error: null};});
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
    expect(f.getUser).not.toHaveBeenCalled();
  });
  it("discards Auth completion after cancellation", async () => {
    const c = new AbortController();
    f.getUser.mockImplementation(async () => {c.abort(); return {data: {user: {id: actor}},error: null};});
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: c.signal})).rejects.toMatchObject({reason: "canceled"});
  });
  it("scrubs rejected transport details", async () => {
    f.abort.mockRejectedValue(new Error("private backend detail"));
    await expect(fetchClientPortalRelationshipChoices(actor,{signal: signal()})).rejects.toMatchObject({reason: "unavailable",message: "Customer businesses could not be checked"});
  });
});

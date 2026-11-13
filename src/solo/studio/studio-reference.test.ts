import { expect, it } from "vitest";
import { parseChatStudioReference } from "./studio-reference";
const reference = { artifactType: "studio", kind: "studio_source", id: "11111111-1111-4111-8111-111111111111", title: "Studio brief", tenant_id: "22222222-2222-4222-8222-222222222222", url: null };
it("admits only the closed original-source navigation shape", () => {
  expect(parseChatStudioReference(reference)).toEqual({ sourceTurnId: reference.id, tenantId: reference.tenant_id });
  for (const patch of [{ id: "https://example.test" }, { artifactType: "document" }, { kind: "project" }, { title: "Published" }, { tenant_id: undefined }, { url: "https://example.test" }, { approval: true }, { brief: "untrusted" }, { session_id: reference.id }]) expect(parseChatStudioReference({ ...reference, ...patch })).toBeNull();
});

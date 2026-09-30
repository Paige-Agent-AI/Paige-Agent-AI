// The Client Journey page reads the contact's PRIMARY email from its contact methods, and the
// timeline it composes (including the journey bridge's `get_journey` request) is built from that
// derived row — never from the raw row, which no longer carries an `email` column.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokes: Array<{ fn: string; body: unknown }> = [];

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const result = () => {
    if (table === "clients") {
      return {
        data: {
          id: "c1", first_name: "Jordan", last_name: "Reyes", linked_user_id: null,
          journey_stage_id: null, journey_stage_slug: null, journey_stage_entered_at: null, created_at: "2026-01-01T00:00:00Z",
          client_contact_methods: [
            { id: "e2", kind: "email", value: "second@example.test", label: null, is_primary: false, position: 1 },
            { id: "e1", kind: "email", value: "first@example.test", label: null, is_primary: true, position: 0 },
          ],
        },
        error: null,
      };
    }
    return { data: [], error: null };
  };
  for (const op of ["select", "eq", "order", "limit", "in"]) self[op] = () => self;
  self.maybeSingle = () => Promise.resolve(result());
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: {
      invoke: (fn: string, options: { body: unknown }) => {
        invokes.push({ fn, body: options.body });
        return Promise.resolve({ data: { data: { events: [] } }, error: null });
      },
    },
  },
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "c1" }),
  useNavigate: () => () => {},
}));

const { default: ClientJourney } = await import("./ClientJourney");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invokes.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Client Journey — the contact's email", () => {
  it("asks the journey bridge with the contact's PRIMARY email, read from its contact methods", async () => {
    await act(async () => { root.render(<ClientJourney />); });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

    const request = invokes.find((call) => call.fn === "tenant-journey");
    expect(request?.body).toEqual({ verb: "get_journey", payload: { contact_id: "c1", email: "first@example.test" } });
  });
});

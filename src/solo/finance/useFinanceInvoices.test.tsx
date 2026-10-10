import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useFinanceInvoices } from "./useFinanceInvoices";
const { read, auth } = vi.hoisted(() => ({ read: vi.fn(), auth: { listener: () => {} } }));
vi.mock("../sales/invoiceLifecycleApi", () => ({ listInvoiceRecords: read }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), auth: { onAuthStateChange: (listener: () => void) => { auth.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
function Probe({ epoch }: { epoch: string | null }) { const state = useFinanceInvoices(epoch); return <><time>{state.readAt}</time><output>{state.phase}:{state.rows.map(row => row.number).join(",")}</output><button onClick={state.retry}>Refresh</button><button onClick={state.loadMore}>More</button></>; }
beforeEach(() => { read.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(epoch: string | null) { await act(async () => { root.render(<Probe epoch={epoch}/>); }); }
const page = (number: string, more = false) => ({ ok: true, value: { rows: [{ id: number, number }], hasMore: more, nextCursor: more ? "next" : null } });
describe("Finance canonical Sales read fencing", () => {
 it("does not read without resolved workspace", async () => { await render(null); expect(read).not.toHaveBeenCalled(); expect(host.querySelector("output")?.textContent).toBe("unavailable:"); });
 it("drops late prior-workspace results", async () => { const pending: Array<(value: unknown) => void> = []; read.mockImplementation(() => new Promise(resolve => pending.push(resolve))); await render("A"); await render("B"); await act(async () => pending[0](page("private-A"))); expect(host.textContent).not.toContain("private-A"); await act(async () => pending[1](page("invoice-B"))); expect(host.textContent).toContain("invoice-B"); });
 it("withholds rows when the canonical server refuses access", async () => { read.mockResolvedValue({ ok: false, outcome: "refused" }); await render("A"); expect(host.querySelector("output")?.textContent).toBe("denied:"); });
 it("refreshes automatically on mount and deliberately on retry", async () => { read.mockResolvedValue(page("invoice")); await render("A"); expect(read).toHaveBeenCalledTimes(1); await act(async () => host.querySelector("button")?.click()); expect(read).toHaveBeenCalledTimes(2); });
 it("keeps the first-page snapshot timestamp across pagination", async () => { read.mockResolvedValueOnce(page("first", true)).mockResolvedValueOnce(page("second")); await render("A"); const initial = host.querySelector("time")?.textContent; expect(initial).toBeTruthy(); await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click()); expect(host.querySelector("time")?.textContent).toBe(initial); expect(host.textContent).toContain("first,second"); });
 it("refreshes the first page after returning online", async () => { read.mockResolvedValue(page("invoice")); await render("A"); await act(async () => window.dispatchEvent(new Event("online"))); expect(read).toHaveBeenCalledTimes(2); expect(read.mock.calls[1][2]).toBeNull(); });
 it("invalidates prior identity on auth change", async () => { read.mockResolvedValue(page("invoice")); await render("A"); read.mockImplementation(() => new Promise(() => {})); await act(async () => auth.listener()); expect(host.querySelector("output")?.textContent).toBe("loading:"); });
});

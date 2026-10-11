// The Supabase client as the Ads desk (marketing-ads.tsx) and the pipeline lead funnel
// (pipeline-lead-funnel.tsx) see it in the harness. Saved ad copy keeps Marketing's planned-tabs fixture;
// the pictures and videos, the submissions and the two contracted server reads answer from
// ads-fixtures.ts. Only those modules are pointed here (vite.config.ts).
import { mode } from "../marketing-mount/mode";
import { supabase as planned } from "../marketing-mount/planned-supabase-stub";
import { funnelAnswer, funnelMissing, media, submissionRows } from "./ads-fixtures";

type Answer = { data: unknown; error: unknown };
const FEATURED_LIMIT = 6;

function answer(rows: unknown): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "Harness read failed" } });
  if (mode === "first") return Promise.resolve({ data: Array.isArray(rows) ? [] : null, error: null });
  return Promise.resolve({ data: rows, error: null });
}

function from(table: string) {
  const steps: [string, unknown[]][] = [];
  let kindFilter = false;
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "eq", "neq", "gte", "is", "not", "range"]) chain[method] = (...args: unknown[]) => { steps.push([method, args]); return chain; };
  chain.in = (column: string, ...rest: unknown[]) => { if (column === "kind") kindFilter = true; steps.push(["in", [column, ...rest]]); return chain; };
  const resolveRows = (): Promise<Answer> => {
    if (table === "growth_form_submissions") {
      const since = steps.find(([method, args]) => method === "gte" && args[0] === "created_at")?.[1][1] as string | undefined;
      return answer(submissionRows.filter((row) => !since || row.created_at >= since));
    }
    if (table === "marketing_content" && kindFilter) return answer([...media].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
    // Saved ad copy and anything else: Marketing's planned-tabs fixture, with the same filters replayed.
    let next = (planned.from as (t: string) => Record<string, (...args: unknown[]) => unknown>)(table);
    for (const [method, args] of steps) next = (next[method] as (...a: unknown[]) => typeof next)(...args);
    return next as unknown as Promise<Answer>;
  };
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => resolveRows().then(resolve, reject);
  return chain;
}

function rpc(name: string, args: Record<string, unknown>): Promise<Answer> {
  if (name === "get_pipeline_lead_funnel") {
    if (funnelMissing) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_pipeline_lead_funnel(p_pipeline_id, p_since) in the schema cache" } });
    return answer(funnelAnswer(String(args.p_pipeline_id), (args.p_since as string | null) ?? null));
  }
  if (name === "set_ad_creative_featured") {
    const row = media.find((item) => item.id === args.p_content_id);
    if (!row) return Promise.resolve({ data: null, error: { message: "AD_CREATIVE_NOT_FOUND" } });
    const featured = args.p_featured === true;
    const count = media.filter((item) => (item.meta as Record<string, unknown>)?.ads_featured === true && item.id !== row.id).length;
    if (featured && count >= FEATURED_LIMIT) return Promise.resolve({ data: null, error: { code: "P0001", message: "AD_FEATURED_LIMIT" } });
    row.meta = { ...(row.meta as Record<string, unknown>), ads_featured: featured, ads_featured_at: new Date().toISOString() };
    return Promise.resolve({ data: { id: row.id, featured }, error: null });
  }
  return (planned.rpc as () => Promise<Answer>)();
}

export const supabase = { from, rpc };

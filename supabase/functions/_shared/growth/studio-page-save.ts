import { UUID } from "../comms-email/contract.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";
import type { StudioPageSaveSource } from "./studio-page-source.ts";

type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
export type StudioPageSaveInput = { pageId?: unknown; slug: unknown; title: unknown; blocks: unknown; theme: unknown; seo: unknown };
export type StudioPageSaved = { ok: true; page: Row & { id: string; tenant_id: string; slug: string; title: string; status: string }; versionId: string; forms: Array<{ id: string; slug: string }>; changed: boolean; reconciled: boolean };
export type StudioPageSaveResult = StudioPageSaved | { ok: false; code: "changed" | "not_allowed" | "invalid" | "unknown"; notApplied: boolean };
type Dependencies = { caller: { rpc(name: string, args: Row): PromiseLike<{ data: unknown; error: unknown }> }; current: () => boolean; signal?: AbortSignal; timeoutMs?: number };

function saved(source: StudioPageSaveSource, value: unknown): StudioPageSaved | null {
  const result = object(value), page = object(result?.page);
  if (!result || result.ok !== true || !page || typeof page.id !== "string" || !UUID.test(page.id)
      || page.tenant_id !== source.tenant_id || source.page_id !== null && page.id !== source.page_id
      || typeof page.slug !== "string" || !page.slug.trim() || page.slug.length > 160
      || typeof page.title !== "string" || page.title.length > 1000 || !["draft", "published"].includes(String(page.status))
      || typeof result.version_id !== "string" || !UUID.test(result.version_id)
      || typeof result.changed !== "boolean" || typeof result.reconciled !== "boolean" || !Array.isArray(result.forms)) return null;
  const forms: Array<{ id: string; slug: string }> = [];
  for (const raw of result.forms) {
    const form = object(raw);
    if (!form || typeof form.id !== "string" || !UUID.test(form.id) || typeof form.slug !== "string" || !form.slug.trim() || form.slug.length > 160) return null;
    forms.push({ id: form.id, slug: form.slug });
  }
  return { ok: true, page: page as StudioPageSaved["page"], versionId: result.version_id, forms, changed: result.changed, reconciled: result.reconciled };
}

/** An invocation-local adapter to the ORIGINAL native Studio writer. A source
 * can dispatch at most once. A lost acknowledgment and every repeated call
 * inspect the frozen source/payload identity, never replay the write. */
export function createStudioPageSave(source: StudioPageSaveSource, deps: Dependencies) {
  let attempted = false, frozen: Row | null = null, wire: string | null = null;
  const current = () => !deps.signal?.aborted && deps.current();
  const rpc = (name: string, args: Row) => deps.caller.rpc(name, args);
  const call = (name: string, args: Row) => createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, current)(() => rpc(name, args));
  const unknown = (): StudioPageSaveResult => ({ ok: false, code: "unknown", notApplied: false });
  const inspect = async (): Promise<StudioPageSaveResult> => {
    if (!frozen || !current()) return unknown();
    try {
      const response = await call("studio_page_save_state", frozen);
      return current() && !response.error ? saved(source, response.data) ?? unknown() : unknown();
    } catch { return unknown(); }
  };
  const save = async (input: StudioPageSaveInput): Promise<StudioPageSaveResult> => {
    if (!current()) return attempted ? unknown() : { ok: false, code: "not_allowed", notApplied: true };
    if (input.pageId !== undefined && input.pageId !== null && input.pageId !== source.page_id
        || typeof input.slug !== "string" || !input.slug.trim() || input.slug.length > 160
        || typeof input.title !== "string" || !input.title.trim() || input.title.length > 1000 || !Array.isArray(input.blocks)) {
      return { ok: false, code: "invalid", notApplied: true };
    }
    let args: Row, serialized: string;
    try {
      args = JSON.parse(JSON.stringify({ p_expected_tenant: source.tenant_id, p_session_id: source.session_id,
        p_expected_artifact_refs: source.artifact_refs, p_expected_project_context: source.project_context,
        p_page_id: source.page_id, p_expected_updated_at: source.updated_at, p_expected_conversion: source.conversion,
        p_slug: input.slug, p_title: input.title, p_blocks_json: input.blocks, p_theme_json: input.theme ?? null,
        p_seo_json: input.seo ?? null, p_form_schema_json: null }));
      serialized = JSON.stringify(args);
    } catch { return { ok: false, code: "invalid", notApplied: true }; }
    if (attempted) return serialized === wire ? inspect() : { ok: false, code: "changed", notApplied: true };
    frozen = args; wire = serialized; attempted = true;
    try {
      const response = await call("studio_save_page", frozen);
      if (!current()) return unknown();
      if (response.error) {
        const code = object(response.error)?.code;
        // Native SQL exceptions roll back the whole statement. A transport
        // failure makes no such promise and takes the read-only path below.
        if (["42501", "40001", "22023", "23505", "P0002"].includes(String(code))) {
          return { ok: false, code: code === "42501" ? "not_allowed" : code === "22023" ? "invalid" : "changed", notApplied: true };
        }
      } else {
        const result = saved(source, response.data);
        if (result) return result;
        const refusal = object(response.data);
        if (refusal?.ok === false && ["not_allowed", "scope_changed", "changed", "invalid"].includes(String(refusal.code))) {
          return { ok: false, code: refusal.code === "scope_changed" ? "not_allowed" : refusal.code as "not_allowed" | "changed" | "invalid", notApplied: true };
        }
      }
    } catch { /* The original transaction may already have committed. */ }
    return inspect();
  };
  return Object.freeze({ save });
}

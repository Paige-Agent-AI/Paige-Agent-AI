// The Cloudflare Workers Static Assets client behind the growth-hosting-command door.
//
// ONE deployment per approved export, under the PAIGE-held account, with a platform token whose
// honest exposure is account-wide for Workers scripts (the corrected service-enable decision names
// it; nothing here may widen or narrow that). The token/account arrive ONLY as environment
// configuration — the door refuses `hosting_not_enabled` when either is absent (provider activation
// is HELD by the owner; direction 88b2f756).
//
// WIRE FORMAT: the calls below follow Cloudflare's documented Workers script API (PUT/DELETE
// /client/v4/accounts/:account_id/workers/scripts/:script_name with a multipart body whose metadata
// carries the static-assets configuration). The interface, auth, error mapping and no-retry
// semantics are the contract this module owns; byte-level wire compatibility with the live API is
// verified at activation (PROOF OWED — deliberately not claimed before a real deployment exists).
//
// UNCERTAIN OUTCOMES ARE NEVER RETIED HERE. A thrown fetch or an ambiguous response returns
// { ok:false, uncertain:true } and the DOOR records the row unverified/unconfirmed; a human decides
// the next step. This mirrors the publish door's nothing-ran discipline.

export interface ProviderConfig {
  accountId: string;
  apiToken: string;
  /** The base URL of the Workers API (overridable for tests). */
  baseUrl?: string;
}

export interface DeployInput {
  /** The stable deployment name (one per page: `<tenant-slug>-<page-slug>`). */
  name: string;
  /** The exported file(s): the single self-contained HTML document today. */
  files: Array<{ path: string; contentType: string; content: string }>;
}

export interface DeployResult {
  ok: boolean;
  /** The deployment's public address on the platform account (workers.dev shape). */
  url?: string;
  error?: string;
  /** True when the outcome is UNKNOWN (network throw / unreadable answer) — never retried here. */
  uncertain?: boolean;
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
  uncertain?: boolean;
}

const DEFAULT_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareResponse {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: Record<string, unknown>;
}

async function readJson(res: Response): Promise<CloudflareResponse | null> {
  try {
    return (await res.json()) as CloudflareResponse;
  } catch {
    return null;
  }
}

function firstError(body: CloudflareResponse | null, res: Response): string {
  const message = body?.errors?.[0]?.message;
  if (message) return String(message).slice(0, 300);
  return `http_${res.status}`;
}

/** Deploy (or re-deploy — same name, same bytes) one static site. */
export async function deployStaticSite(config: ProviderConfig, input: DeployInput, fetchImpl: typeof fetch = fetch): Promise<DeployResult> {
  const metadata = {
    main_module: input.files[0]?.path ?? "index.html",
    compatibility_date: new Date().toISOString().slice(0, 10),
    assets: { directory: "./", html_handling: "auto-trailing-slash", not_found_handling: "none" },
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata), { type: "application/json" } as never);
  for (const file of input.files) {
    form.append(file.path, new Blob([file.content], { type: file.contentType }), file.path);
  }
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl ?? DEFAULT_BASE}/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(input.name)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${config.apiToken}` },
      body: form,
    });
  } catch (e) {
    return { ok: false, uncertain: true, error: `provider_unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await readJson(res);
  if (!res.ok || body?.success !== true) {
    // A 4xx/5xx with a readable body is a REFUSED deployment, not an uncertain one; an unreadable
    // body is uncertain. Neither is retried here.
    const uncertain = body === null;
    return { ok: false, uncertain, error: `deploy_refused: ${firstError(body, res)}` };
  }
  const subdomain = typeof body.result?.subdomain === "string" ? body.result.subdomain : null;
  const url = `https://${input.name}.${subdomain ?? "workers.dev"}`;
  return { ok: true, url };
}

/** Remove a deployment. Deleting something already gone converges to ok (idempotent by design). */
export async function deleteStaticSite(config: ProviderConfig, name: string, fetchImpl: typeof fetch = fetch): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl ?? DEFAULT_BASE}/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
  } catch (e) {
    return { ok: false, uncertain: true, error: `provider_unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await readJson(res);
  if (!res.ok && res.status !== 404) {
    const uncertain = body === null;
    return { ok: false, uncertain, error: `delete_refused: ${firstError(body, res)}` };
  }
  return { ok: true };
}

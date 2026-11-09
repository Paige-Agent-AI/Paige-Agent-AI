// _shared/voyage.ts
// Voyage AI embeddings for Paige edge functions (Anthropic-ecosystem partner).
// Replaces OpenAI text-embedding-3-small (1536) and Gemini gemini-embedding-001 (3072).
//
// Default model voyage-3 => 1024 dimensions. The pgvector columns are sized to
// VOYAGE_DIMS via the R5 schema migration, and every embed call site must use the
// SAME model so vectors are comparable.

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-3";
export const VOYAGE_DIMS = 1024; // must match the vector(N) column definitions

export type VoyageInputType = "query" | "document";

function apiKey(): string {
  const k = Deno.env.get("VOYAGE_API_KEY");
  if (!k) throw new Error("VOYAGE_API_KEY is not set");
  return k;
}

export interface VoyageOpts {
  model?: string;
  inputType?: VoyageInputType; // "document" when embedding stored content, "query" at search time
  signal?: AbortSignal;
}

// Embed one or many strings. Always returns an array of vectors, aligned to input order.
export async function voyageEmbed(
  input: string | string[],
  opts: VoyageOpts = {},
): Promise<number[][]> {
  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.length === 0) return [];

  const resp = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      input: inputs,
      model: opts.model ?? VOYAGE_MODEL,
      ...(opts.inputType ? { input_type: opts.inputType } : {}),
    }),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Voyage ${resp.status}: ${detail.slice(0, 500)}`);
  }
  const data = await resp.json();
  const rows: { index: number; embedding: number[] }[] = data?.data ?? [];
  // Preserve input order regardless of response ordering.
  return rows
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r) => r.embedding);
}

// Convenience for the common single-string case.
export async function voyageEmbedOne(text: string, opts: VoyageOpts = {}): Promise<number[]> {
  const [v] = await voyageEmbed(text, opts);
  return v;
}

// Drop-in replacement for `fetch(embeddingsUrl, init)` — mimics the OpenAI/gateway
// embeddings response shape ({data:[{index,embedding}]}) via Voyage, so existing
// call sites migrate by swapping the fetch target only:
//   fetch("https://api.openai.com/v1/embeddings", init)  ->  embeddingsCompat("voyage", init)
// (input_type is left unset for now — symmetric embeddings work; query/document
//  tuning is a future optimization.)
export async function embeddingsCompat(
  _url: string,
  init: { body?: string; method?: string; headers?: unknown },
): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  try {
    const parsed = init?.body ? JSON.parse(init.body) : {};
    const vecs = await voyageEmbed(parsed.input, {});
    const data = vecs.map((embedding, index) => ({ object: "embedding", index, embedding }));
    const payload = { object: "list", model: VOYAGE_MODEL, data };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const m = msg.match(/Voyage (\d{3})/);
    const status = m ? Number(m[1]) : 500;
    return { ok: false, status, json: async () => ({ error: msg }), text: async () => msg };
  }
}

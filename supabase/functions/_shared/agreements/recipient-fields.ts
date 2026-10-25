import { object, UUID } from "../sales-collections/primitives.ts";
import { readAgreementPdfDocument, readAssignedFields, type AgreementField } from "./field-preparation.ts";

type RecipientSource = {
  tenant_id: string; agreement_id: string; signer_id: string; source_version: number;
  document_sha256: string; content_storage_key: string | null;
};
type Db = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}> };
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export class RecipientFieldsUnavailable extends Error {
  constructor(readonly refused = false) { super("AGREEMENT_RECIPIENT_FIELDS_UNAVAILABLE"); }
}
export type RecipientFields = {
  kind: "prepared"; preparation_id: string; preparation_sha256: string;
  document: ReturnType<typeof readAgreementPdfDocument>;
  fields: Omit<AgreementField,"signer_id">[];
};
/** Original token-derived server source only. This ordinary read neither records
 * consent/signature nor relaxes native prepared-token/effect holds. A missing
 * native read is unavailable, never an inference that this is a legacy file. */
export async function readRecipientSigningFields(db: Db, tokenHash: string, expected: RecipientSource):
  Promise<{kind:"legacy"} | RecipientFields> {
  const fail = (): never => { throw new RecipientFieldsUnavailable(); };
  if (!digest(tokenHash)) return fail();
  let data: unknown, error: unknown;
  try { ({data,error} = await db.rpc("_read_agreement_signing_fields",{_token_hash:tokenHash})); }
  catch { return fail(); }
  if (error) throw new RecipientFieldsUnavailable(object(error) && error.code === "42501");
  let r: unknown;
  try { r = structuredClone(data); } catch { return fail(); }
  if (!object(r) || r.tenant_id !== expected.tenant_id || r.agreement_id !== expected.agreement_id
    || r.signer_id !== expected.signer_id) return fail();
  if (r.kind === "legacy" && closed(r,["kind","tenant_id","agreement_id","signer_id"])) return {kind:"legacy"};
  if (!closed(r,["kind","tenant_id","agreement_id","signer_id","source_version","content_storage_key",
    "preparation_id","preparation_sha256","document","fields"]) || r.kind !== "prepared"
    || r.source_version !== expected.source_version || r.content_storage_key !== expected.content_storage_key
    || typeof r.preparation_id !== "string" || !UUID.test(r.preparation_id)
    || !digest(r.preparation_sha256) || !Array.isArray(r.fields) || r.fields.length < 1 || r.fields.length > 500) return fail();
  let document: ReturnType<typeof readAgreementPdfDocument>;
  try { document = readAgreementPdfDocument(r.document); } catch { return fail(); }
  if (document.sha256 !== expected.document_sha256) return fail();
  let assigned: AgreementField[];
  try {
    const own = r.fields.map(value => {
      if (!closed(value,["id","kind","page","x","y","width","height","required","label"])) return fail();
      return {...value,signer_id:expected.signer_id};
    });
    assigned = readAssignedFields(document,new Set([expected.signer_id]),own);
  } catch { return fail(); }
  const fields = assigned.map(({id,kind,page,x,y,width,height,required,label}) =>
    ({id,kind,page,x,y,width,height,required,label}));
  if (!fields.some(f=>f.kind === "signature")) return fail();
  // Only this recipient's assigned display fields leave the private RPC. The
  // native allow-list omits all other recipients, internal source keys and words.
  return {kind:"prepared",preparation_id:r.preparation_id,preparation_sha256:r.preparation_sha256,document,fields};
}

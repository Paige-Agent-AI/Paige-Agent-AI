/** Native canonical Knowledge audience client. Inject the ordinary caller SDK.
 * No content cache, authority inference, automatic write retry or second receipt.
 */
export interface ResourceScope { actor: string; tenant: string; contact: string }
export interface ResourceRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {code?: string} | null}>;
}
export class ResourceError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface SourceReference { share_id: string; share_revision: number; source_fingerprint: string }
export interface CustomerResource extends SourceReference {
  document_id: string; document_revision: number; generation_id: string | null; title: string;
  content: null; content_truncated: false;
}
export interface OwnerResourceShare extends SourceReference {
  document_id: string; document_revision: number; generation_id: string | null; title: string;
  granted_at: string; revoked_at: string | null; receipt_id: string; currently_available: boolean;
}
export interface ShareProposal {
  tenant_id: string; contact_id: string; document_id: string; available: boolean;
  expected_share_revision: number; proposal_hash: string; source_fingerprint: string | null;
  document_revision: number | null; generation_id: string | null; title: string | null;
  preview: string | null; preview_truncated: boolean; already_shared: boolean;
}
export interface ShareReceipt {
  tenant_id: string; contact_id: string; document_id: string; share_id: string; receipt_id: string;
  replayed: boolean; changed: boolean; original_revision: number; current_revision: number; currently_available: boolean;
}
export interface ResourcePage {
  actor_id: string; tenant_id: string; contact_id: string; source_ref: SourceReference;
  document: {id: string; revision: number; generation_id: string | null; title: string};
  content: string; offset: number; next_offset: number; total_characters: number; has_more: boolean;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const text = (v: unknown, limit: number): v is string => typeof v === 'string' && Array.from(v).length <= limit;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const generation = (v: unknown) => v === null || uuid(v);
function bad(): never { throw new ResourceError('CUSTOMER_RESOURCE_RESPONSE_INVALID'); }
const same = (v: unknown, expected: string) => uuid(v) && v.toLowerCase() === expected.toLowerCase();
function ownerScope(v: Record<string, unknown>, scope: ResourceScope) {
  if (!same(v.tenant_id, scope.tenant) || !same(v.contact_id, scope.contact)) bad();
}
function customerScope(v: Record<string, unknown>, scope: ResourceScope) {
  ownerScope(v, scope); if (!same(v.actor_id, scope.actor)) bad();
}
function reference(v: unknown): v is SourceReference {
  return object(v) && uuid(v.share_id) && integer(v.share_revision, 1) && hash(v.source_fingerprint);
}
function source(v: unknown): v is CustomerResource {
  return object(v) && exact(v, ['share_id','share_revision','source_fingerprint','document_id','document_revision','generation_id','title','content','content_truncated'])
    && reference(v) && uuid(v.document_id) && integer(v.document_revision, 1) && generation(v.generation_id)
    && text(v.title, 300) && v.content === null && v.content_truncated === false;
}
async function call(client: ResourceRpc, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.rpc(name, args); // Preserve the incumbent SDK receiver.
  if (result.error) throw new ResourceError(result.error.code ?? 'CUSTOMER_RESOURCE_REQUEST_FAILED');
  if (!object(result.data)) bad();
  return result.data;
}
export async function listCustomerResources(client: ResourceRpc, scope: ResourceScope, offset = 0) {
  const v = await call(client, 'client_portal_knowledge_context', {
    p_tenant_id: scope.tenant, p_source_refs: null, p_limit: 20, p_offset: offset, p_include_content: false,
  });
  customerScope(v, scope);
  if (!exact(v, ['actor_id','contact_id','tenant_id','sources','next_offset','page_may_continue'])
    || !Array.isArray(v.sources) || v.sources.length > 20 || !v.sources.every(source)
    || v.next_offset !== offset + v.sources.length || typeof v.page_may_continue !== 'boolean'
    || v.page_may_continue !== (v.sources.length === 20)
    || new Set(v.sources.map(s => s.share_id)).size !== v.sources.length) bad();
  return {resources: v.sources as CustomerResource[], nextOffset: v.next_offset as number, hasMore: v.page_may_continue as boolean};
}
export async function readCustomerResource(client: ResourceRpc, scope: ResourceScope, resource: CustomerResource, offset = 0): Promise<ResourcePage> {
  const v = await call(client, 'client_portal_knowledge_document', {
    p_tenant_id: scope.tenant, p_share_id: resource.share_id, p_share_revision: resource.share_revision,
    p_source_fingerprint: resource.source_fingerprint, p_offset: offset, p_limit: 12000,
  });
  customerScope(v, scope);
  if (!exact(v, ['actor_id','contact_id','tenant_id','source_ref','document','content','offset','next_offset','total_characters','has_more'])
    || !reference(v.source_ref) || !exact(v.source_ref as unknown as Record<string, unknown>, ['share_id','share_revision','source_fingerprint'])
    || !same(v.source_ref.share_id, resource.share_id) || v.source_ref.share_revision !== resource.share_revision
    || v.source_ref.source_fingerprint !== resource.source_fingerprint || !object(v.document)
    || !exact(v.document, ['id','revision','generation_id','title']) || !same(v.document.id, resource.document_id)
    || v.document.revision !== resource.document_revision || v.document.generation_id !== resource.generation_id
    || !text(v.document.title, 300) || !text(v.content, 12000) || v.offset !== offset
    || !integer(v.next_offset) || v.next_offset !== offset + Array.from(v.content).length
    || !integer(v.total_characters) || v.next_offset > v.total_characters
    || v.has_more !== (v.next_offset < v.total_characters)
    || (v.has_more && v.next_offset === offset)) bad();
  return v as unknown as ResourcePage;
}
export async function listOwnerResourceShares(client: ResourceRpc, scope: ResourceScope, offset = 0) {
  const v = await call(client, 'list_client_portal_knowledge_shares', {p_tenant_id: scope.tenant, p_contact_id: scope.contact, p_limit: 50, p_offset: offset});
  ownerScope(v, scope);
  if (!exact(v, ['tenant_id','contact_id','shares','next_offset','page_may_continue']) || !Array.isArray(v.shares) || v.shares.length > 50
    || !v.shares.every(r => object(r) && exact(r, ['share_id','share_revision','source_fingerprint','document_id','document_revision','generation_id','title','granted_at','revoked_at','receipt_id','currently_available'])
      && reference(r) && uuid(r.document_id) && integer(r.document_revision, 1) && generation(r.generation_id) && text(r.title, 300)
      && date(r.granted_at) && (r.revoked_at === null || date(r.revoked_at)) && uuid(r.receipt_id) && typeof r.currently_available === 'boolean')
    || v.next_offset !== offset + v.shares.length || v.page_may_continue !== (v.shares.length === 50)
    || new Set(v.shares.map(s => s.share_id)).size !== v.shares.length) bad();
  return {shares: v.shares as OwnerResourceShare[], nextOffset: v.next_offset as number, hasMore: v.page_may_continue as boolean};
}
export async function prepareResourceShare(client: ResourceRpc, scope: ResourceScope, documentId: string, available: boolean): Promise<ShareProposal> {
  const v = await call(client, 'prepare_client_portal_knowledge_share', {p_tenant_id: scope.tenant, p_contact_id: scope.contact, p_document_id: documentId, p_available: available});
  ownerScope(v, scope);
  if (!exact(v, ['tenant_id','contact_id','document_id','available','expected_share_revision','proposal_hash','source_fingerprint','document_revision','generation_id','title','preview','preview_truncated','already_shared'])
    || !same(v.document_id, documentId) || v.available !== available || !integer(v.expected_share_revision) || !hash(v.proposal_hash)
    || !(v.source_fingerprint === null || hash(v.source_fingerprint)) || !(v.document_revision === null || integer(v.document_revision, 1))
    || !generation(v.generation_id) || !(v.title === null || text(v.title, 300)) || !(v.preview === null || text(v.preview, 1600))
    || typeof v.preview_truncated !== 'boolean' || typeof v.already_shared !== 'boolean'
    || (available && (!hash(v.source_fingerprint) || !integer(v.document_revision, 1) || !text(v.title, 300) || !text(v.preview, 1600)))
    || (!available && (v.title !== null || v.preview !== null || v.preview_truncated))) bad();
  return Object.freeze(v as unknown as ShareProposal);
}
/** Exactly one caller-driven attempt. On ambiguity, inspect the existing list receipt. */
export async function commitResourceShare(client: ResourceRpc, scope: ResourceScope, proposal: ShareProposal, operationId: string): Promise<ShareReceipt> {
  ownerScope(proposal as unknown as Record<string, unknown>, scope);
  if (!uuid(operationId)) bad();
  const v = await call(client, 'set_client_portal_knowledge_share', {
    p_tenant_id: scope.tenant, p_contact_id: scope.contact, p_document_id: proposal.document_id, p_available: proposal.available,
    p_expected_share_revision: proposal.expected_share_revision, p_proposal_hash: proposal.proposal_hash, p_operation_id: operationId,
  });
  ownerScope(v, scope);
  if (!exact(v, ['tenant_id','contact_id','document_id','share_id','receipt_id','replayed','changed','original_revision','current_revision','currently_available'])
    || !same(v.document_id, proposal.document_id) || !same(v.receipt_id, operationId) || !uuid(v.share_id)
    || typeof v.replayed !== 'boolean' || v.changed !== !v.replayed
    || !integer(v.original_revision, 1) || !integer(v.current_revision, 1) || v.original_revision !== v.current_revision
    || v.current_revision !== proposal.expected_share_revision + 1 || typeof v.currently_available !== 'boolean') bad();
  return v as unknown as ShareReceipt;
}

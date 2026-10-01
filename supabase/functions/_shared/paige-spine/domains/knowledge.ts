import type { SpineCapability } from "../contracts.ts";
export const KNOWLEDGE_READ = {
 key:"knowledge.read",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"read",executor:"public.read_tenant_knowledge",chatTool:"knowledge_read",riskPolicyKey:"read_only",approvalAuthority:"none",idempotency:"Read only, bounded active workspace projection."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Read only, no mutation receipt."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_UPDATE = {
 key:"knowledge.update",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"mutate",executor:"public.update_tenant_knowledge_metadata",chatTool:"knowledge_update",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Exact document revision CAS; never automatically retry uncertain acknowledgement. Existing Chat proposal binds document, revision and normalized metadata patch."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Canonical SQL owns operation receipt; completed_unrecorded means change verified but receipt missing. Source objects and Memory are unchanged."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_DELETE = {
 key:"knowledge.delete",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"mutate",executor:"public.delete_tenant_knowledge",chatTool:"knowledge_delete",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Exact document revision CAS; never automatically retry uncertain acknowledgement. Existing Chat proposal binds document, revision and normalized metadata patch."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Canonical SQL owns operation receipt; completed_unrecorded means change verified but receipt missing. Source objects and Memory are unchanged."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_CAPABILITIES=[KNOWLEDGE_READ,KNOWLEDGE_UPDATE,KNOWLEDGE_DELETE] as const;
export const KNOWLEDGE_TOOLS = [
 {type:"function",function:{name:"knowledge_read",description:"Read canonical Knowledge in the current workspace. List metadata or read one document by exact document_id. Returns current revisions for metadata updates/deletion. Content may be explicitly truncated; a saved record or chunk count does not prove complete indexing or owner-confirmed Memory.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},limit:{type:"integer",minimum:1,maximum:20},offset:{type:"integer",minimum:0}}}}},
 {type:"function",function:{name:"knowledge_update",description:"Update only title, summary, category or tags of the exact Knowledge document revision just read. Uses existing governed approval. Conflict requires fresh read and a new reviewed proposal. Never retry an uncertain outcome automatically. Does not change content, reindex, share, or create Memory.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1},patch:{type:"object",additionalProperties:false,minProperties:1,properties:{title:{type:"string",minLength:1,maxLength:300},summary:{type:["string","null"],maxLength:2000},category:{type:["string","null"],maxLength:100},tags:{type:"array",maxItems:20,items:{type:"string",maxLength:60}}}}},required:["document_id","expected_revision","patch"]}}},
 {type:"function",function:{name:"knowledge_delete",description:"Permanently delete the exact Knowledge document revision and its chunks after rendered approval. Read the document first; do not guess its ID or revision. Uploaded source objects remain. A conflict requires fresh read/new approval; uncertain outcomes must be inspected before another proposal. No Memory is deleted.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1}},required:["document_id","expected_revision"]}}},
];

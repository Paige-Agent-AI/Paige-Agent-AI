import {describe, expect, it} from "vitest";
import {CLIENT_DOCUMENT_LIMIT, clientDocumentMime, portalDocumentFromUpload, readClientDocument, readPortalDocumentList} from "./client-portal-documents";

const scope = {actor:"e0914000-0000-0000-0000-000000000001",contact:"e0934000-0000-0000-0000-000000000001",tenant:"e0924000-0000-0000-0000-000000000001"};
const id = "e0944000-0000-0000-0000-000000000001";
const row = () => ({id,tenant_id:scope.tenant,contact_id:scope.contact,uploaded_by_user_id:scope.actor,
  storage_path:`${scope.tenant}/${scope.contact}/client_upload/${scope.actor}/${id}`,original_filename:"Preparation.pdf",
  mime_type:"application/pdf",size_bytes:240,visibility:"client_upload",upload_state:"ready",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"});

describe("permitted customer document selection", () => {
  it.each([["Preparation.pdf","application/pdf"],["Photo.jpg","image/jpeg"],["Photo.jpeg","image/jpeg"],["Diagram.png","image/png"],
    ["Notes.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]])("accepts %s at the approved20MB boundary", (name,type) => {
    expect(clientDocumentMime({name,type,size:CLIENT_DOCUMENT_LIMIT})).toBe(type);
  });
  it("uses the extension only when a native picker provides no MIME type", () => {
    expect(clientDocumentMime({name:"Notes.DOCX",type:"",size:240})).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
  it.each([
    {name:"run.html",type:"text/html",size:240}, {name:"notes",type:"application/pdf",size:240},
    {name:"notes.pdf",type:"text/html",size:240}, {name:"notes.pdf",type:"application/pdf",size:CLIENT_DOCUMENT_LIMIT+1},
    {name:"notes.pdf",type:"application/pdf",size:0}, {name:"notes.pdf",type:"application/pdf",size:NaN},
    {name:"../notes.pdf",type:"application/pdf",size:240}, {name:"bad\nname.pdf",type:"application/pdf",size:240},
  ])("refuses invalid selection %j", candidate => {expect(() => clientDocumentMime(candidate)).toThrow(/PDF/);});
});
describe("closed current-customer document projection", () => {
  it("reads the exact own file and permits original attribution from an earlier login", () => {
    const file = {...row(),uploaded_by_user_id:"e0914000-0000-0000-0000-000000000003"};
    expect(readClientDocument(file,scope)).toEqual(file);
  });
  it.each(["foreign tenant","foreign contact","internal","wrong namespace","private payload","invalid actor","invalid date","negative size"])("refuses %s", kind => {
    const file:Record<string,unknown> = row();
    if(kind==="foreign tenant")file.tenant_id="e0924000-0000-0000-0000-000000000002";
    if(kind==="foreign contact")file.contact_id="e0934000-0000-0000-0000-000000000002";
    if(kind==="internal")file.visibility="internal";
    if(kind==="wrong namespace")file.storage_path="another-business/private.pdf";
    if(kind==="private payload")file.internal_note="Never project internal CRM";
    if(kind==="invalid actor")file.uploaded_by_user_id="not-a-uuid";
    if(kind==="invalid date")file.updated_at="not-a-date";
    if(kind==="negative size")file.size_bytes=-1;
    expect(() => readClientDocument(file,scope)).toThrow();
  });
  it("requires exact reserved actor/id/path for an unfinished upload", () => {
    expect(() => readClientDocument({...row(),upload_state:"pending",storage_path:`${scope.tenant}/elsewhere/file.pdf`},scope)).toThrow();
  });
});

describe("closed customer document list (client_portal_documents, E09 Slice 4)", () => {
  const shared = () => ({id,filename:"Brand guide.pdf",mime_type:"application/pdf",size_bytes:240,source:"business",state:"ready",
    shared_at:"2026-01-02T00:00:00Z",created_at:"2026-01-01T00:00:00Z",storage_path:`${scope.tenant}/${scope.contact}/internal/${id}`});
  const page = (files:Record<string,unknown>[]) => ({tenant_id:scope.tenant,client_id:scope.contact,summary:{shared:1,from_you:0},files,has_more:false});
  it("reads exactly the promised keys, in the customer's own scope", () => {
    expect(readPortalDocumentList(page([shared()]),scope)).toEqual({...page([shared()])});
  });
  it("keeps the customer's own unfinished upload at its reserved path", () => {
    const own = {...shared(),source:"you",state:"pending",shared_at:null,storage_path:`${scope.tenant}/${scope.contact}/client_upload/${scope.actor}/${id}`};
    expect(readPortalDocumentList(page([own]),scope).files[0].state).toBe("pending");
  });
  it.each(["extra row key","missing row key","extra page key","foreign tenant","foreign client","unshared business file","pending business file",
    "own pending elsewhere","negative summary","duplicate id","parent path"])("refuses %s", kind => {
    const file:Record<string,unknown> = shared(); const value:Record<string,unknown> = page([file]);
    if(kind==="extra row key")file.uploaded_by_user_id=scope.actor;
    if(kind==="missing row key")delete file.shared_at;
    if(kind==="extra page key")value.next=null;
    if(kind==="foreign tenant")value.tenant_id="e0924000-0000-0000-0000-000000000002";
    if(kind==="foreign client")value.client_id="e0934000-0000-0000-0000-000000000002";
    if(kind==="unshared business file")file.shared_at=null;
    if(kind==="pending business file")file.state="pending";
    if(kind==="own pending elsewhere")Object.assign(file,{source:"you",state:"pending",shared_at:null});
    if(kind==="negative summary")value.summary={shared:-1,from_you:0};
    if(kind==="duplicate id")value.files=[file,{...file}];
    if(kind==="parent path")file.storage_path=`${scope.tenant}/../${id}`;
    expect(() => readPortalDocumentList(value,scope)).toThrow();
  });
  it("names the customer's confirmed upload as theirs", () => {
    expect(portalDocumentFromUpload(readClientDocument(row(),scope))).toMatchObject({source:"you",state:"ready",filename:"Preparation.pdf",shared_at:null});
  });
});

import { describe,expect,it } from "vitest";
import { socialDeskPosts,publicationPerformance,snapshotMedia } from "./social-publishing-model";
import type { ContentPiece } from "./marketing-content-model";
const tenant="10000000-0000-4000-8000-000000000001",id="20000000-0000-4000-8000-000000000001",receipt="30000000-0000-4000-8000-000000000001";
const piece:ContentPiece={id,kind:"text",channel:"social_post",status:"draft",title:"Saved post",body:"Current words",image_url:null,size:null,brief:null,updated_at:"2026-11-13T12:00:00Z",meta:{}};
const row={id:receipt,tenant_id:tenant,content_id:id,platform:"threads",status:"published",created_at:piece.updated_at,request_args:{caption:"Original approved words",content_revision:piece.updated_at},provider_post_url:"https://www.threads.com/@test/post/original"};
describe("the visual desk's original record projection",()=>{
  it("never treats a Catalog image or website artifact as a social publication",()=>{
    expect(socialDeskPosts(tenant,[{...piece,kind:"image",channel:null,status:"published"}],[{...row,platform:"website"}])).toEqual([]);
  });
  it("shows an original published caption while a revised source remains a separate draft",()=>{
    const posts=socialDeskPosts(tenant,[{...piece,updated_at:"2026-11-13T13:00:00Z"}],[row]);
    expect(posts).toHaveLength(2);expect(posts[0].status).toBe("draft");
    expect(posts[1]).toMatchObject({receiptId:receipt,status:"published",caption:"Original approved words"});
  });
  it("keeps unknown attempts as original receipts and never invents another draft for their revision",()=>{
    const posts=socialDeskPosts(tenant,[piece],[{...row,status:"outcome_unknown"}]);
    expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({receiptId:receipt,status:"outcome_unknown"});
  });
  it.each(["failed","refused"])("preserves an editable saved draft after a known %s attempt",status=>{
    const posts=socialDeskPosts(tenant,[piece],[{...row,status}]);
    expect(posts.some(p=>p.receiptId===null&&p.pieceId===id&&p.status==="draft")).toBe(true);
    expect(posts.some(p=>p.receiptId===receipt&&p.status===status)).toBe(true);
  });
  it("refuses a foreign workspace result and malformed original receipt",()=>{
    expect(()=>socialDeskPosts(tenant,[piece],[{...row,tenant_id:"foreign"}])).toThrow();
    expect(()=>socialDeskPosts(tenant,[piece],[{...row,id:"not-a-receipt"}])).toThrow();
  });
  it("preserves absent metrics and real measured zero separately",()=>{
    expect(publicationPerformance(null)).toEqual({state:"unavailable",checkedAt:null,values:{}});
    expect(publicationPerformance({state:"available",metrics:{views:0,likes:null},checked_at:piece.updated_at})).toMatchObject({state:"available",values:{views:0}});
    expect(publicationPerformance({state:"available",metrics:{likes:-1,views:"17"}}).state).toBe("pending");
  });
  it("does not render unsafe or partial media snapshots",()=>{
    const media={content_id:id,type:"image",source_url:"https://storage.example/original.png"};
    expect(snapshotMedia(JSON.stringify([media,{...media,source_url:"javascript:alert(1)"}]))).toEqual([]);
    expect(snapshotMedia(JSON.stringify([media]))).toHaveLength(1);
  });
});

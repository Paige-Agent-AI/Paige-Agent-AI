import {expect,it} from "vitest";
import {readSocialPublicationReference} from "../../supabase/functions/_shared/social-publish-command/reference.ts";
const ref={schema:1,tenant_id:"11111111-1111-4111-8111-111111111111",content_id:"22222222-2222-4222-8222-222222222222",content_revision:"2026-11-13T12:00:00Z",publication_id:null};
it("keeps only an exact original reference, with no model status/URL/approval authority",()=>{
 expect(readSocialPublicationReference(ref)).toEqual(ref);
 for(const over of [{url:"https://foreign.example"},{status:"published"},{approved:true},{schema:2},{tenant_id:"foreign"},{content_revision:"v1"},{publication_id:"invented"}])expect(readSocialPublicationReference({...ref,...over})).toBeNull();
});

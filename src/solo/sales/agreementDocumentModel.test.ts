import {describe,it,expect} from 'vitest';
import {assignedFieldSchema,documentDescriptorSchema,newAssignedField,pointOnDocument,positionField,type DocumentPage} from './agreementDocumentModel';

const page:DocumentPage={page:1,crop_x:18,crop_y:36,crop_width:400,crop_height:600,rotation:90,width:600,height:400};
const signer='a1111111-0000-4000-8000-000000000001';
describe('actual visible PDF-point proposals',()=>{
  it('uses the already rotated crop once at 50% and 125% view scales',()=>{
    expect(pointOnDocument(page,{left:20,top:40,width:300,height:200},170,140)).toEqual({x:300,y:200});
    expect(pointOnDocument(page,{left:80,top:50,width:750,height:500},455,300)).toEqual({x:300,y:200});
  });
  it.each([[19,40],[321,40],[20,39],[20,241],[NaN,80],[Infinity,80]])('refuses outside or invalid pointer %s,%s',(x,y)=>{
    expect(pointOnDocument(page,{left:20,top:40,width:300,height:200},x,y)).toBeNull();
  });
  it('refuses a distorted/zero page rather than deriving misleading positions',()=>{
    expect(pointOnDocument(page,{left:0,top:0,width:300,height:300},100,100)).toBeNull();
    expect(pointOnDocument(page,{left:0,top:0,width:0,height:200},0,0)).toBeNull();
  });
  it.each(['signature','initials','signed_date','text','checkbox']as const)('creates a bounded actual-signer %s without mutating page geometry',kind=>{
    const before=structuredClone(page),field=newAssignedField(kind,signer,page,{x:599,y:399});
    expect(field).toMatchObject({signer_id:signer,page:1,kind,required:true});
    expect(field.x+field.width).toBeLessThanOrEqual(page.width);expect(field.y+field.height).toBeLessThanOrEqual(page.height);
    expect(assignedFieldSchema.safeParse(field).success).toBe(true);expect(page).toEqual(before);
  });
  it('clamps movement within the visible page and preserves original field identity',()=>{
    const field=newAssignedField('signature',signer,page,{x:100,y:100}),before=structuredClone(field);
    expect(positionField(field,page,-500,9999)).toMatchObject({id:field.id,signer_id:signer,x:0,y:page.height-field.height});
    expect(field).toEqual(before);
    expect(()=>positionField(field,page,NaN,0)).toThrow();expect(()=>positionField({...field,width:700},page,0,0)).toThrow();
  });
  it('rejects extra authority/private keys and control characters at the UI JSON boundary',()=>{
    const field=newAssignedField('text',signer,page,{x:100,y:100});
    expect(assignedFieldSchema.safeParse({...field,approved:true}).success).toBe(false);
    expect(assignedFieldSchema.safeParse({...field,label:'hidden\nwords'}).success).toBe(false);
    expect(assignedFieldSchema.safeParse({...field,label:'   '}).success).toBe(false);
    expect(documentDescriptorSchema.safeParse({sha256:'a'.repeat(64),byte_length:500,pages:[page],storage_key:'private'}).success).toBe(false);
  });
});

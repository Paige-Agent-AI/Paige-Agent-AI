import {expect,it} from 'vitest';
import {readRecipientFieldReply,recipientFieldAnswers} from './recipientSigningFields';

const field=(id:string,kind:string,patch:Record<string,unknown>={})=>({id,kind,page:1,x:20,y:20,width:80,height:24,required:true,label:kind,...patch});
const signature='f1111111-0000-4000-8000-000000000001',text='f1111111-0000-4000-8000-000000000002',box='f1111111-0000-4000-8000-000000000003',date='f1111111-0000-4000-8000-000000000004';
const reply=()=>({kind:'prepared',preparation_id:'a1111111-0000-4000-8000-000000000001',preparation_sha256:'a'.repeat(64),document:{sha256:'b'.repeat(64),byte_length:50,pages:[{page:1,crop_x:0,crop_y:0,crop_width:612,crop_height:792,rotation:0,width:612,height:792}]},fields:[field(signature,'signature'),field(text,'text',{y:60}),field(box,'checkbox',{y:100}),field(date,'signed_date',{y:140})]});
const prepared=()=>{const r=readRecipientFieldReply(reply());if(r.kind!=='prepared')throw Error('fixture');return r;};
it('retains the original exact document/preparation and only the public assigned-field projection',()=>{
 const raw=reply(),r=readRecipientFieldReply(raw);expect(r).toEqual(raw);raw.fields[0].label='later mutation';expect(r.kind==='prepared'&&r.fields[0].label).toBe('signature');
 expect(JSON.stringify(r)).not.toMatch(/tenant_id|signer_id|storage_key|agreement_id/);
});
it('requires an explicit, closed legacy reply rather than falling back on failure',()=>{
 expect(readRecipientFieldReply({kind:'legacy'})).toEqual({kind:'legacy'});
 for(const r of [null,{},[],{kind:'legacy',fields:[]},{kind:'prepared'}, {ok:true}])expect(()=>readRecipientFieldReply(r)).toThrow();
});
it.each(['tenant_id','signer_id','content_storage_key','agreement_id'])('rejects an internal/foreign selector in the public reply: %s',key=>{
 expect(()=>readRecipientFieldReply({...reply(),[key]:'foreign'})).toThrow();
 expect(()=>readRecipientFieldReply({...reply(),fields:[{...reply().fields[0],[key]:'foreign'}]})).toThrow();
});
it('rejects a duplicate field, missing signature, foreign page and geometry outside the retained page',()=>{
 const r=reply();for(const fields of [[r.fields[0],r.fields[0]],[r.fields[1]],[{...r.fields[0],page:2}],[{...r.fields[0],x:610}],[{...r.fields[0],required:false}]])expect(()=>readRecipientFieldReply({...r,fields})).toThrow();
 expect(()=>readRecipientFieldReply({...r,document:{...r.document,pages:[{...r.document.pages[0],rotation:90}]}})).toThrow();
});
it('keeps false as an explicit checkbox answer, supplies the signing mark and never supplies a date',()=>{
 expect(recipientFieldAnswers(prepared(),{[text]:'Agreed contact',[box]:false})).toEqual([{field_id:signature,value:true},{field_id:text,value:'Agreed contact'},{field_id:box,value:false}]);
});
it.each([{[text]:'Contact'}, {[text]:' ',[box]:true}, {[text]:'Contact',[box]:'false'}, {[text]:'Contact',[box]:true,[date]:'2099-01-01'}, {[text]:'Contact',[box]:true,[signature]:true}, {[text]:'Contact',[box]:true,['c1111111-0000-4000-8000-000000000001']:'other signer'}])('rejects omitted required or caller-forged automatic/foreign answers: %j',answers=>expect(()=>recipientFieldAnswers(prepared(),answers)).toThrow());
it('refuses an aggregate request that cannot fit the original signing bound without truncating answers',()=>{
 expect(()=>recipientFieldAnswers(prepared(),{[text]:'é'.repeat(262145),[box]:false})).toThrow();
 expect(recipientFieldAnswers(prepared(),{[text]:'preserve\nthese words',[box]:true})[1].value).toBe('preserve\nthese words');
});

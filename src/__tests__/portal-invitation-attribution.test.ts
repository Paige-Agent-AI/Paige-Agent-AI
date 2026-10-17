// @vitest-environment node
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it} from 'vitest';

// Execute the actual attribution resolver. A CRM contact or delivery operation
// must never be recorded as the invitation's id when acknowledgement is absent.
const text=readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8');
const source=ts.createSourceFile('handler.ts',text,ts.ScriptTarget.Latest,true);
const names=['WRITE_TARGET','TARGET_ID_KEYS','UUID','resolveWriteTargetId'];
const declarations=new Map<string,string>();
function visit(node:ts.Node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&names.includes(node.name.text))declarations.set(node.name.text,`const ${node.getText(source)};`);
  ts.forEachChild(node,visit);
}
visit(source);
if(declarations.size!==names.length)throw Error('Review the actual attribution resolver boundary');
const code=ts.transpileModule(names.map(name=>declarations.get(name)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const {resolve,targets}=new Function(`${code};return {resolve:resolveWriteTargetId,targets:WRITE_TARGET}`)();
const contact='11111111-1111-4111-8111-111111111111',invitation='22222222-2222-4222-8222-222222222222';
it('attributes the new invitation to its canonical portal token',()=>{
  expect(targets.client_portal_invitation_send).toBe('portal_tokens');
  expect(resolve({contact_id:contact},{invitation_id:invitation,contact_id:contact},'client_portal_invitation_send')).toBe(invitation);
});
it.each([{}, {invitation_id:'invalid'}, {operation_id:invitation}, {readback:{id:contact}}])('does not substitute a contact or operation when invitation acknowledgement is absent: %j',out=>{
  expect(resolve({contact_id:contact},out,'client_portal_invitation_send')).toBeNull();
});

// @vitest-environment node
import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import ts from "typescript";
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("chat.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function variable(name:string){let found:ts.VariableDeclaration|undefined;const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,visit);};visit(ast);if(!found?.initializer)throw Error("Missing actual "+name);return found.initializer.getText(ast);}
function begin(customerPortal:boolean,files?:string[]){const calls:unknown[]=[];const rpc=(...args:unknown[])=>{calls.push(args);return Promise.resolve({data:null,error:null});};
 const js=ts.transpile("const actual="+variable("beginTurn")+";actual(true);",{target:ts.ScriptTarget.ES2020});
 new Function("customerPortal","customerCaller","supabaseClient","interactiveInput","validatedData","userText","customerQuery","customerFileIds",js)(customerPortal,{rpc},{rpc},{kind:"message"},{threadId:"thread",requestIntentId:"intent",customerFileIds:files},"question",null,files);return calls as [string,Record<string,unknown>][];}
describe("actual handler original native begin expression",()=>{
 it("binds explicit private files to the released original file admission",()=>{const [call]=begin(true,["file-a","file-b"]);expect(call[0]).toBe("client_portal_assistant_begin_files");expect(call[1].p_file_ids).toEqual(["file-a","file-b"]);expect(call[1].p_effectful).toBe(true);});
 it("retains original ordinary customer and owner begin paths",()=>{expect(begin(true)[0][0]).toBe("client_portal_assistant_begin_sessions");expect(begin(false)[0][0]).toBe("paige_chat_interactive_begin_v2");expect(begin(false)[0][1]).not.toHaveProperty("p_file_ids");});
 it("actual customer assembly invokes the existing extractor through Fabric and source fences",()=>{const assembly=source.slice(source.indexOf('if (customerPortal && customerPersona && customerAssistant) {'));expect(assembly.includes("readCustomerFileText(")).toBe(true);expect(assembly.includes('customer_file_extract')).toBe(true);expect(assembly.includes('beforeProviderAttempt:async()=>{await processing.assertCurrent();await assertFileProcessing();return true;}')).toBe(true);expect(source.includes('customerFilesTerminalSource(customerFilesSnapshot')).toBe(true);expect(source.includes('JSON.stringify(filesSource.data) === JSON.stringify(customerFilesContext)')).toBe(true);});
});

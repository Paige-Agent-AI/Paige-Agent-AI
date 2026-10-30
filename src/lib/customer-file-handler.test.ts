// @vitest-environment node
import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import ts from "typescript";
import {z} from "zod";
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("chat.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function variable(name:string){let found:ts.VariableDeclaration|undefined;const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,visit);};visit(ast);if(!found?.initializer)throw Error("Missing actual "+name);return found.initializer.getText(ast);}
function begin(customerPortal:boolean,files?:string[],link?:string){const calls:unknown[]=[];const rpc=(...args:unknown[])=>{calls.push(args);return Promise.resolve({data:null,error:null});};
 const js=ts.transpile("const actual="+variable("beginTurn")+";actual(true);",{target:ts.ScriptTarget.ES2020});
 new Function("customerPortal","customerCaller","supabaseClient","interactiveInput","validatedData","userText","customerQuery","customerFileIds","customerPublicLink","customerInvoicesSelected",js)(customerPortal,{rpc},{rpc},{kind:"message"},{threadId:"thread",requestIntentId:"intent",customerFileIds:files},"question",null,files,link,false);return calls as [string,Record<string,unknown>][];}
describe("actual handler original native begin expression",()=>{
 it("binds explicit private files to the released original file admission",()=>{const [call]=begin(true,["file-a","file-b"]);expect(call[0]).toBe("client_portal_assistant_begin_files");expect(call[1].p_file_ids).toEqual(["file-a","file-b"]);expect(call[1].p_effectful).toBe(true);});
 it("retains original ordinary customer and owner begin paths",()=>{expect(begin(true)[0][0]).toBe("client_portal_assistant_begin_sessions");expect(begin(false)[0][0]).toBe("paige_chat_interactive_begin_v2");expect(begin(false)[0][1]).not.toHaveProperty("p_file_ids");});
 it("keeps the ordinary file-only admission free of link authority",()=>{expect(begin(true,["file-a"])[0][1]).not.toHaveProperty("p_url");expect(begin(true)[0][1]).not.toHaveProperty("p_file_ids");});
 it("binds the selected page and the same ordered private files in one original native request",()=>{const [call]=begin(true,["file-b","file-a"],"https://example.org/program");expect(call[0]).toBe("client_portal_assistant_begin_link");expect(call[1]).toMatchObject({p_url:"https://example.org/program",p_file_ids:["file-b","file-a"],p_thread:"thread",p_intent:"intent",p_effectful:true});});
 it("binds a page without inventing private file IDs",()=>{expect(begin(true,undefined,"https://example.org/program")[0][1]).toMatchObject({p_url:"https://example.org/program",p_file_ids:null});});
 it("actual customer assembly invokes the existing extractor through Fabric and source fences",()=>{const assembly=source.slice(source.indexOf('if (customerPortal && customerPersona && customerAssistant) {'));expect(assembly.includes("readCustomerFileText(")).toBe(true);expect(assembly.includes('customer_file_extract')).toBe(true);expect(assembly.includes('beforeProviderAttempt:async()=>{await processing.assertCurrent();await assertFileProcessing();return true;}')).toBe(true);expect(source.includes('customerFilesTerminalSource(customerFilesSnapshot')).toBe(true);expect(source.includes('JSON.stringify(filesSource.data) === JSON.stringify(customerFilesContext)')).toBe(true);});
});

function schemaFileIds(){let property:ts.PropertyAssignment|undefined;const visit=(n:ts.Node)=>{if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==="customerFileIds")property=n;ts.forEachChild(n,visit);};visit(ast);if(!property)throw Error("Missing actual private file schema");return new Function("z","return "+ts.transpile(property.initializer.getText(ast),{target:ts.ScriptTarget.ES2020}).trim().replace(/;$/,""))(z) as z.ZodType<string[]|undefined>;}
it("actual schema bounds and canonicalizes the exact ordered private IDs",()=>{const schema=schemaFileIds(),id="E0990000-0000-4000-8000-000000000001";expect(schema.parse([id])).toEqual([id.toLowerCase()]);for(const value of [[],[id,id.toLowerCase()],["not-an-id"],Array(6).fill(id)])expect(schema.safeParse(value).success).toBe(false);});
for(const [portal,kind,resume] of [[false,"message",false],[true,"stop",false],[true,"status",false],[true,"message",true]] as const)it("actual handler rejects file authority outside ordinary customer message "+[portal,kind,resume].join("/"),()=>{
 let guard:ts.IfStatement|undefined;const visit=(n:ts.Node)=>{if(ts.isIfStatement(n)&&n.thenStatement.getText(ast).includes('code:"CUSTOMER_FILES_INPUT_UNAVAILABLE"'))guard=n;ts.forEachChild(n,visit);};visit(ast);if(!guard)throw Error("Missing actual private input guard");
 const js=ts.transpile(guard.getText(ast),{target:ts.ScriptTarget.ES2020});const result=new Function("customerFileIds","customerPortal","validatedData","corsHeaders",js)(["file"],portal,{interactive:{kind},resume:resume?{kind:"answer"}:undefined},{});expect(result.status).toBe(400);
});

import {expect,it} from "vitest";
import {parseOperationsTaskFocus} from "./operations-task-focus";
const id="33333333-3333-4333-8333-333333333333";
it("accepts exactly one UUID address while preserving unrelated routing state",()=>{
 expect(parseOperationsTaskFocus(`?task=${id.toUpperCase()}&filter=active`)).toEqual({kind:"task",id});
 expect(parseOperationsTaskFocus("?filter=active")).toBeNull();
 expect(parseOperationsTaskFocus(`?weeklySource=planning_item&item=${id}`)).toBeNull();
});
it.each(["?task=","?task=undefined","?task=not-a-task",`?task=${id}&task=${id}`,`?task=${id}&weeklySource=planning_item`,`?task=${id}&item=${id}`,`?task=%20${id}`,`?task=${id}%20`])("refuses malformed/duplicate/mixed address %s",query=>{
 expect(parseOperationsTaskFocus(query)).toEqual({kind:"invalid"});
});

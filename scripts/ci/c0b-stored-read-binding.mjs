// Build-time proof of existing inline reads, not an executor or runtime authority store.
import ts from "typescript";
const specs = [
  ["automation_list", "automations.list", "paige_automations", "id,name,category,trigger_key,granted_lane,state,created_at", false, true],
  ["automation_triggers_list", "automations.triggers_list", "paige_automation_triggers", "key,label,category,description,is_live,dark_reason", false, false],
  ["document_pending_reviews", "research_knowledge.document_pending_reviews", "credit_report_uploads", "id,file_name,created_at,last_analyzed_at", false, false],
  ["document_resume_review", "research_knowledge.document_resume_review", "credit_report_uploads", "id,user_id,client_id,file_name,analysis_result,extraction_review_state", false, false],
  ["crm_list_documents", "crm_clients.list_documents", "client_files", "id,contact_id,original_filename,mime_type,size_bytes,visibility,description,created_at", true, true],
  ["improvement_list", "platform_meta.improvement_list", "paige_improvement_proposals", "id,kind,target_ref,title,proposed_change,evidence,proposed_by,status,created_at,decided_at,decision_rationale", true, false],
];
const printer = ts.createPrinter({ removeComments: true });
const visit = (node, predicate) => { const out = []; const walk = (n) => { if (predicate(n)) out.push(n); ts.forEachChild(n, walk); }; walk(node); return out; };
const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/\s/g, "");
const ident = (node) => node && ts.isIdentifier(node) ? node.text : "";
const method = (call) => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
const root = (node) => ts.isCallExpression(node) ? root(node.expression) : ts.isPropertyAccessExpression(node) ? root(node.expression) : ident(node);
const property = (object, name) => object && ts.isObjectLiteralExpression(object)
  ? object.properties.find((p) => ts.isPropertyAssignment(p) && (ident(p.name) || (ts.isStringLiteral(p.name) ? p.name.text : "")) === name)?.initializer : undefined;
const string = (node) => node && ts.isStringLiteral(node) ? node.text : null;
const readMethods = new Set(["from", "select", "eq", "order", "limit", "maybeSingle", "rpc"]);
const valueMethods = new Set(["map", "filter", "trim", "replace"]);
const primitives = new Set(["String", "Number"]);

export function validateStoredReadBindings(chatText, helperText) {
  const chat = ts.createSourceFile("paige-ai-chat.ts", chatText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helper = ts.createSourceFile("credit-extraction-payload.ts", helperText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [], tools = new Map();
  const require = (ok, label) => { if (!ok) findings.push(`stored-read binding: ${label}`); };
  require(!chat.parseDiagnostics.length && !helper.parseDiagnostics.length, "sources parse");
  const declarations = (name) => visit(chat, (n) => (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n)) && ident(n.name) === name);
  const factoryImports = visit(chat, ts.isImportDeclaration).filter((n) => string(n.moduleSpecifier) === "https://esm.sh/@supabase/supabase-js@2.75.0");
  require(factoryImports.length === 1 && factoryImports[0].importClause?.namedBindings
    && ts.isNamedImports(factoryImports[0].importClause.namedBindings)
    && factoryImports[0].importClause.namedBindings.elements.some((e) => ident(e.name) === "createClient" && !e.propertyName)
    && declarations("createClient").length === 0, "canonical unshadowed client factory");
  const client = declarations("supabaseClient");
  require(client.length === 1 && ts.isVariableDeclaration(client[0]) && ts.isCallExpression(client[0].initializer)
    && ident(client[0].initializer.expression) === "createClient"
    && ident(client[0].initializer.arguments[0]) === "supabaseUrl" && ident(client[0].initializer.arguments[1]) === "supabaseKey"
    && ident(property(property(property(client[0].initializer.arguments[2], "global"), "headers"), "Authorization")) === "authHeader", "one unshadowed caller-JWT client");
  const enclosingFunction = (node) => { for (let p = node?.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return undefined; };
  const clientScope = enclosingFunction(client[0]);
  const key = declarations("supabaseKey"), header = declarations("authHeader").filter((n) => enclosingFunction(n) === clientScope);
  require(key.length === 1 && print(key[0].initializer) === 'Deno.env.get("SUPABASE_ANON_KEY")!', "caller client uses anon key");
  require(header.length === 1 && header[0].initializer && ts.isCallExpression(header[0].initializer)
    && print(header[0].initializer.expression) === "req.headers.get" && string(header[0].initializer.arguments[0]) === "Authorization", "header comes from the request");
  require(!visit(chat, (n) => ts.isBinaryExpression(n) && ["supabaseClient", "supabaseKey", "authHeader"].includes(ident(n.left)) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken).length, "caller client credentials are never reassigned");
  const helperNames = new Set(visit(helper, ts.isFunctionDeclaration).map((n) => ident(n.name)));
  const counts = visit(helper, (n) => ts.isVariableDeclaration(n) && ident(n.name) === "counts");
  const formatterLoop = visit(helper, (n) => ts.isForOfStatement(n) && ident(n.expression) === "counts");
  const formatterSafe = counts.length === 1 && ts.isArrayLiteralExpression(counts[0].initializer)
    && counts[0].initializer.elements.every((row) => ts.isArrayLiteralExpression(row) && row.elements.length === 4 && ts.isArrowFunction(row.elements[3]))
    && formatterLoop.length === 1 && print(formatterLoop[0].initializer) === "const[key,label,arr,fmt]";
  require(formatterSafe, "proposal formatters are local pure tuple callbacks");
  if (formatterSafe) helperNames.add("fmt");
  for (const n of visit(helper, (n) => ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)))) helperNames.add(ident(n.name));
  const helperRoots = new Set(visit(helper, (n) => ts.isVariableDeclaration(n) || ts.isParameter(n)).map((n) => ident(n.name)));
  require(!visit(helper, ts.isImportDeclaration).length, "proposal projection has no imports");
  for (const call of visit(helper, ts.isCallExpression)) {
    const name = print(call.expression), m = method(call);
    require(primitives.has(name) || helperNames.has(name) || name === "Array.isArray"
      || (["map", "filter", "push", "some", "includes", "toLowerCase"].includes(m) && (!root(call.expression) || helperRoots.has(root(call.expression)))), `pure proposal helper call ${name}`);
  }
  require(!visit(helper, ts.isNewExpression).length, "proposal helper creates no effectful object");
  const helperImports = visit(chat, ts.isImportDeclaration).filter((n) => string(n.moduleSpecifier) === "../_shared/credit-extraction-payload.ts");
  require(helperImports.length === 1 && ["buildCreditProposal", "buildCreditSyncPayload"].every((name) =>
    helperImports[0].importClause?.namedBindings && ts.isNamedImports(helperImports[0].importClause.namedBindings)
    && helperImports[0].importClause.namedBindings.elements.some((e) => ident(e.name) === name && !e.propertyName)
    && declarations(name).length === 0), "unshadowed canonical proposal helpers");
  for (const [tool, key, table, columns, admin, selfDescribe] of specs) {
    const branches = visit(chat, (n) => ts.isIfStatement(n) && ts.isBinaryExpression(n.expression)
      && n.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && print(n.expression.left) === "tc.function.name" && string(n.expression.right) === tool);
    require(branches.length === 1, `${tool}: exact existing dispatch branch`);
    if (branches.length !== 1) continue;
    const body = branches[0].thenStatement, calls = visit(body, ts.isCallExpression);
    require(calls.filter((c) => method(c) === "from" && root(c.expression) === "supabaseClient" && string(c.arguments[0]) === table).length === 1, `${tool}: caller-JWT ${table} read`);
    require(calls.some((c) => method(c) === "select" && root(c.expression) === "supabaseClient" && string(c.arguments[0])?.replace(/\s/g, "") === columns), `${tool}: bounded safe columns`);
    const mounted = visit(chat, (n) => ts.isPropertyAssignment(n) && ident(n.name) === "name" && string(n.initializer) === tool)
      .some((n) => { for (let p = n.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) && ident(p.name) === "toolDefs") return true; return false; });
    require(mounted, `${tool}: mounted model tool`);
    for (const call of calls) {
      const name = print(call.expression), m = method(call), r = root(call.expression);
      let safe = primitives.has(name) || ["JSON.parse", "JSON.stringify", "Promise.all", "Math.min", "UUIDISH.test", "toolResults.push"].includes(name)
        || (valueMethods.has(m) && ["", "rows", "fileRows", "args", "listQuery"].includes(r))
        || (tool === "document_resume_review" && ["buildCreditProposal", "buildCreditSyncPayload"].includes(name));
      if (r === "supabaseClient") safe = readMethods.has(m) && (m !== "rpc" || (tool === "automation_list" && string(call.arguments[0]) === "resolve_automation_autonomy"));
      if (r === "q") safe = tool === "crm_list_documents" && ["eq", "ilike"].includes(m);
      require(safe, `${tool}: unknown/effectful call ${name}`);
    }
    require(!visit(body, ts.isNewExpression).length, `${tool}: no effectful constructors`);
    require(!visit(body, (n) => (ts.isVariableDeclaration(n) || ts.isParameter(n)) && ["supabaseClient", "JSON", "Promise", "Math", "String", "UUIDISH"].includes(ident(n.name))).length, `${tool}: no trusted binding shadows`);
    if (tool === "crm_list_documents") {
      require(calls.some((c) => method(c) === "eq" && root(c.expression) === "supabaseClient" && string(c.arguments[0]) === "tenant_id" && ident(c.arguments[1]) === "crmTenantId"), `${tool}: server tenant pin`);
      const q = visit(body, (n) => ts.isVariableDeclaration(n) && ident(n.name) === "q");
      require(q.length === 1 && root(q[0].initializer) === "supabaseClient", `${tool}: query alias comes from caller client`);
      require(!visit(body, (n) => ts.isBinaryExpression(n) && ident(n.left) === "q" && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && root(n.right) !== "q").length, `${tool}: query alias cannot change clients`);
    }
    tools.set(tool, { key, write: false, seatAuthority: admin ? "workspace-admin" : "member", selfDescribe });
  }
  return { findings, tools };
}
